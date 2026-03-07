import { Router } from 'express';
import { eq, and, gt } from 'drizzle-orm';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';
import { db } from '../db/pg-index.js';
import {
  users, sessions, emailVerifications, passwordResets,
  habits, tasks, smartMeetings, focusTimeRules, bufferConfig,
  scheduledEvents, calendarEvents, calendars, habitCompletions,
  subtasks, activityLog, scheduleChanges, schedulingLinks,
} from '../db/pg-schema.js';
import { createOAuth2Client, getAuthUrl, exchangeCode } from '../google/index.js';
import { encrypt, decrypt } from '../crypto.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { schedulerRegistry } from '../scheduler-registry.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  getRefreshTokenExpiry,
  setAuthCookies,
  clearAuthCookies,
} from '../auth/jwt.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../auth/email.js';
import { requireAuth } from '../middleware/auth.js';
import {
  signupSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  deleteAccountSchema,
} from '../validation.js';
import type { AuthUser } from '@cadence/shared/auth-types';
import { sendValidationError, sendNotFound, sendError } from './helpers.js';

const router = Router();

// ============================================================
// Rate Limiters
// ============================================================

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many signup attempts, please try again later.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many password reset requests, please try again later.' },
});

// ============================================================
// Helpers
// ============================================================

function toAuthUser(row: typeof users.$inferSelect): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    emailVerified: row.emailVerified,
    googleId: row.googleId,
    hasPassword: !!row.passwordHash,
    plan: row.plan,
    onboardingCompleted: row.onboardingCompleted,
    createdAt: row.createdAt,
  };
}

async function createSession(
  userId: string,
  userAgent: string | undefined,
  ipAddress: string | undefined,
): Promise<{ accessToken: string; refreshToken: string }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error('User not found');

  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    plan: user.plan,
  });

  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);

  await db.insert(sessions).values({
    userId,
    refreshTokenHash,
    userAgent: userAgent || null,
    ipAddress: ipAddress || null,
    expiresAt: getRefreshTokenExpiry(),
  });

  return { accessToken, refreshToken };
}

function getClientIp(req: import('express').Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.ip || '';
}

// ============================================================
// POST /api/auth/signup
// ============================================================

router.post('/signup', signupLimiter, async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const { email, password, name, gdprConsent } = parsed.data;

  if (!gdprConsent) {
    sendError(res, 400, 'GDPR consent is required');
    return;
  }

  // Check if email already exists
  const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  if (existing.length > 0) {
    sendError(res, 409, 'An account with this email already exists');
    return;
  }

  const passwordHash = await hashPassword(password);

  const [newUser] = await db.insert(users).values({
    email: email.toLowerCase(),
    passwordHash,
    name,
    gdprConsentAt: new Date().toISOString(),
    consentVersion: '1.0',
  }).returning();

  // Generate email verification token
  const verifyToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(verifyToken);

  await db.insert(emailVerifications).values({
    userId: newUser.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
  });

  // Send verification email (fire-and-forget)
  sendVerificationEmail(email.toLowerCase(), verifyToken).catch((err) => {
    console.error('[auth] Failed to send verification email:', err);
  });

  // Create session and issue tokens
  const { accessToken, refreshToken } = await createSession(
    newUser.id,
    req.headers['user-agent'],
    getClientIp(req),
  );
  setAuthCookies(res, accessToken, refreshToken);

  res.status(201).json({ user: toAuthUser(newUser) });
});

// ============================================================
// POST /api/auth/login
// ============================================================

router.post('/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  if (!user || !user.passwordHash) {
    sendError(res, 401, 'Invalid email or password');
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    sendError(res, 401, 'Invalid email or password');
    return;
  }

  const { accessToken, refreshToken } = await createSession(
    user.id,
    req.headers['user-agent'],
    getClientIp(req),
  );
  setAuthCookies(res, accessToken, refreshToken);

  res.json({ user: toAuthUser(user) });
});

// ============================================================
// POST /api/auth/refresh
// ============================================================

router.post('/refresh', async (req, res) => {
  const oldRefreshToken = req.cookies?.refresh_token;
  if (!oldRefreshToken) {
    sendError(res, 401, 'No refresh token');
    return;
  }

  const oldHash = hashToken(oldRefreshToken);

  // Find the session with this refresh token
  const [session] = await db.select().from(sessions).where(
    and(
      eq(sessions.refreshTokenHash, oldHash),
      gt(sessions.expiresAt, new Date().toISOString()),
    ),
  );

  if (!session) {
    clearAuthCookies(res);
    sendError(res, 401, 'Invalid or expired refresh token');
    return;
  }

  // Rotate: delete old session, create new one
  await db.delete(sessions).where(eq(sessions.id, session.id));

  const { accessToken, refreshToken } = await createSession(
    session.userId,
    req.headers['user-agent'],
    getClientIp(req),
  );
  setAuthCookies(res, accessToken, refreshToken);

  res.json({ success: true });
});

// ============================================================
// POST /api/auth/logout
// ============================================================

router.post('/logout', async (req, res) => {
  const refreshToken = req.cookies?.refresh_token;
  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    await db.delete(sessions).where(eq(sessions.refreshTokenHash, tokenHash));
  }

  clearAuthCookies(res);
  res.json({ success: true });
});

// ============================================================
// GET /api/auth/verify-email?token=
// ============================================================

router.get('/verify-email', async (req, res) => {
  const token = req.query.token as string;
  if (!token) {
    sendError(res, 400, 'Missing verification token');
    return;
  }

  const tokenHash = hashToken(token);

  const [verification] = await db.select().from(emailVerifications).where(
    and(
      eq(emailVerifications.tokenHash, tokenHash),
      gt(emailVerifications.expiresAt, new Date().toISOString()),
    ),
  );

  if (!verification) {
    sendError(res, 400, 'Invalid or expired verification token');
    return;
  }

  // Mark email as verified
  await db.update(users)
    .set({ emailVerified: true, updatedAt: new Date().toISOString() })
    .where(eq(users.id, verification.userId));

  // Delete all verification tokens for this user
  await db.delete(emailVerifications).where(eq(emailVerifications.userId, verification.userId));

  res.json({ success: true, message: 'Email verified successfully' });
});

// ============================================================
// POST /api/auth/forgot-password
// ============================================================

router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'Invalid input');
    return;
  }

  const { email } = parsed.data;

  // Always return success (prevent email enumeration)
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));

  if (user) {
    const resetToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(resetToken);

    await db.insert(passwordResets).values({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
    });

    sendPasswordResetEmail(email.toLowerCase(), resetToken).catch((err) => {
      console.error('[auth] Failed to send password reset email:', err);
    });
  }

  res.json({ success: true, message: 'If an account exists with that email, a reset link has been sent.' });
});

// ============================================================
// POST /api/auth/reset-password
// ============================================================

router.post('/reset-password', async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const { token, password } = parsed.data;
  const tokenHash = hashToken(token);

  const [reset] = await db.select().from(passwordResets).where(
    and(
      eq(passwordResets.tokenHash, tokenHash),
      gt(passwordResets.expiresAt, new Date().toISOString()),
    ),
  );

  if (!reset || reset.usedAt) {
    sendError(res, 400, 'Invalid or expired reset token');
    return;
  }

  const passwordHash = await hashPassword(password);

  // Update password and mark token as used
  await db.update(users)
    .set({ passwordHash, updatedAt: new Date().toISOString() })
    .where(eq(users.id, reset.userId));

  await db.update(passwordResets)
    .set({ usedAt: new Date().toISOString() })
    .where(eq(passwordResets.id, reset.id));

  // Revoke all existing sessions for this user (force re-login)
  await db.delete(sessions).where(eq(sessions.userId, reset.userId));

  res.json({ success: true, message: 'Password reset successfully' });
});

// ============================================================
// Google OAuth — unified sign-in + calendar scoping
// ============================================================

// Module-level OAuth state store (per-request, short-lived)
const pendingOAuthStates = new Map<string, { expiresAt: number }>();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// Cleanup expired states periodically
setInterval(() => {
  const now = Date.now();
  for (const [state, { expiresAt }] of pendingOAuthStates) {
    if (now > expiresAt) pendingOAuthStates.delete(state);
  }
}, 60_000);

// GET /api/auth/google — initiate unified OAuth
router.get('/google', (_req, res) => {
  const oauth2Client = createOAuth2Client();
  const state = randomBytes(16).toString('hex');
  pendingOAuthStates.set(state, { expiresAt: Date.now() + OAUTH_STATE_TTL_MS });

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    state,
  });

  res.json({ redirectUrl: url });
});

// GET /api/auth/google/callback — handle OAuth callback
router.get('/google/callback', async (req, res) => {
  const code = req.query.code as string;
  const state = req.query.state as string | undefined;
  const frontendOrigin = process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:5173';

  if (!code) {
    res.redirect(`${frontendOrigin}/login?error=missing_code`);
    return;
  }

  // Verify state
  if (!state || !pendingOAuthStates.has(state)) {
    res.redirect(`${frontendOrigin}/login?error=invalid_state`);
    return;
  }

  const stateEntry = pendingOAuthStates.get(state)!;
  pendingOAuthStates.delete(state);

  if (Date.now() > stateEntry.expiresAt) {
    res.redirect(`${frontendOrigin}/login?error=state_expired`);
    return;
  }

  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Fetch Google user profile
    const { google: googleapis } = await import('googleapis');
    const oauth2 = googleapis.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    if (!profile.email) {
      res.redirect(`${frontendOrigin}/login?error=no_email`);
      return;
    }

    const googleId = profile.id!;
    const email = profile.email.toLowerCase();
    const name = profile.name || null;
    const avatarUrl = profile.picture || null;

    // Check if user exists by googleId or email
    let [user] = await db.select().from(users).where(eq(users.googleId, googleId));

    if (!user) {
      // Check by email
      [user] = await db.select().from(users).where(eq(users.email, email));

      if (user) {
        // Link Google account to existing user
        await db.update(users).set({
          googleId,
          emailVerified: true,
          avatarUrl: avatarUrl || user.avatarUrl,
          googleRefreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : user.googleRefreshToken,
          updatedAt: new Date().toISOString(),
        }).where(eq(users.id, user.id));

        // Re-fetch updated user
        [user] = await db.select().from(users).where(eq(users.id, user.id));
      } else {
        // Create new user via Google
        [user] = await db.insert(users).values({
          email,
          emailVerified: true,
          name,
          avatarUrl,
          googleId,
          googleRefreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
          gdprConsentAt: new Date().toISOString(),
          consentVersion: '1.0',
        }).returning();
      }
    } else {
      // Existing Google user — update refresh token if provided
      if (tokens.refresh_token) {
        await db.update(users).set({
          googleRefreshToken: encrypt(tokens.refresh_token),
          avatarUrl: avatarUrl || user.avatarUrl,
          updatedAt: new Date().toISOString(),
        }).where(eq(users.id, user.id));
      }
    }

    // Create session
    const { accessToken, refreshToken } = await createSession(
      user.id,
      req.headers['user-agent'],
      getClientIp(req),
    );
    setAuthCookies(res, accessToken, refreshToken);

    // Redirect based on onboarding status
    if (!user.onboardingCompleted) {
      res.redirect(`${frontendOrigin}/onboarding`);
    } else {
      res.redirect(`${frontendOrigin}/?google=connected`);
    }
  } catch (error: any) {
    console.error('[auth] Google OAuth error:', error);
    res.redirect(`${frontendOrigin}/login?error=oauth_failed`);
  }
});

// ============================================================
// GET /api/auth/me — current user profile
// ============================================================

router.get('/me', requireAuth, async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId));
  if (!user) {
    sendNotFound(res, 'User');
    return;
  }

  res.json({ user: toAuthUser(user) });
});

// ============================================================
// GET /api/auth/google/status — check Google connection status
// ============================================================

router.get('/google/status', requireAuth, async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId));
  const connected = !!user?.googleRefreshToken;
  res.json({ connected });
});

// ============================================================
// GDPR: Data Export — GET /api/auth/export
// ============================================================

const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 1,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Only one export per hour is allowed.' },
});

router.get('/export', requireAuth, exportLimiter, async (req, res) => {
  const userId = req.userId;

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    sendNotFound(res, 'User');
    return;
  }

  const [
    userHabits,
    userTasks,
    userMeetings,
    userFocus,
    userBuffers,
    userEvents,
    userCalendars,
    userCompletions,
    userSubtasks,
    userActivity,
    userChanges,
    userLinks,
  ] = await Promise.all([
    db.select().from(habits).where(eq(habits.userId, userId)),
    db.select().from(tasks).where(eq(tasks.userId, userId)),
    db.select().from(smartMeetings).where(eq(smartMeetings.userId, userId)),
    db.select().from(focusTimeRules).where(eq(focusTimeRules.userId, userId)),
    db.select().from(bufferConfig).where(eq(bufferConfig.userId, userId)),
    db.select().from(scheduledEvents).where(eq(scheduledEvents.userId, userId)),
    db.select().from(calendars).where(eq(calendars.userId, userId)),
    db.select().from(habitCompletions).where(eq(habitCompletions.userId, userId)),
    db.select().from(subtasks).where(eq(subtasks.userId, userId)),
    db.select().from(activityLog).where(eq(activityLog.userId, userId)),
    db.select().from(scheduleChanges).where(eq(scheduleChanges.userId, userId)),
    db.select().from(schedulingLinks).where(eq(schedulingLinks.userId, userId)),
  ]);

  const exportData = {
    exportDate: new Date().toISOString(),
    user: {
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      plan: user.plan,
      gdprConsentAt: user.gdprConsentAt,
      createdAt: user.createdAt,
    },
    settings: user.settings,
    habits: userHabits,
    tasks: userTasks,
    meetings: userMeetings,
    focusTimeRules: userFocus,
    bufferConfig: userBuffers,
    scheduledEvents: userEvents,
    calendars: userCalendars.map(c => ({
      ...c,
      syncToken: undefined, // exclude internal sync state
    })),
    habitCompletions: userCompletions,
    subtasks: userSubtasks,
    activityLog: userActivity,
    scheduleChanges: userChanges,
    schedulingLinks: userLinks,
  };

  const json = JSON.stringify(exportData, null, 2);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="cadence-data-export.json"');
  res.send(json);
});

// ============================================================
// GDPR: Account Deletion — DELETE /api/auth/account
// ============================================================

router.delete('/account', requireAuth, async (req, res) => {
  const parsed = deleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  if (!parsed.data.confirm) {
    sendError(res, 400, 'Account deletion must be explicitly confirmed');
    return;
  }

  const userId = req.userId;
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    sendNotFound(res, 'User');
    return;
  }

  // If user has a password, require it for confirmation
  if (user.passwordHash) {
    if (!parsed.data.password) {
      sendError(res, 400, 'Password is required to delete account');
      return;
    }
    const valid = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!valid) {
      sendError(res, 403, 'Invalid password');
      return;
    }
  }

  // Revoke Google refresh token if connected
  if (user.googleRefreshToken) {
    try {
      const refreshToken = decrypt(user.googleRefreshToken);
      const oauth2Client = createOAuth2Client();
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      await oauth2Client.revokeCredentials();
    } catch (err) {
      console.error('[auth] Failed to revoke Google token during account deletion:', err);
      // Continue with deletion even if revocation fails
    }
  }

  // Stop user's scheduler if running
  try {
    const scheduler = schedulerRegistry.get(userId);
    if (scheduler) {
      await scheduler.stop();
    }
  } catch (err) {
    console.error('[auth] Failed to stop scheduler during account deletion:', err);
  }

  // Delete user row — ON DELETE CASCADE handles all domain data
  await db.delete(users).where(eq(users.id, userId));

  // Clear auth cookies
  clearAuthCookies(res);

  res.json({ success: true, message: 'Account deleted successfully' });
});

// ============================================================
// GDPR: Session Management — GET /api/auth/sessions
// ============================================================

router.get('/sessions', requireAuth, async (req, res) => {
  const userId = req.userId;
  const currentRefreshToken = req.cookies?.refresh_token;
  const currentHash = currentRefreshToken ? hashToken(currentRefreshToken) : null;

  const userSessions = await db.select().from(sessions).where(
    and(
      eq(sessions.userId, userId),
      gt(sessions.expiresAt, new Date().toISOString()),
    ),
  );

  const result = userSessions.map(s => ({
    id: s.id,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    current: currentHash ? s.refreshTokenHash === currentHash : false,
  }));

  res.json({ sessions: result });
});

// ============================================================
// GDPR: Revoke Session — DELETE /api/auth/sessions/:id
// ============================================================

router.delete('/sessions/:id', requireAuth, async (req, res) => {
  const sessionId = req.params.id as string;
  const userId = req.userId;

  const [session] = await db.select().from(sessions).where(
    and(
      eq(sessions.id, sessionId),
      eq(sessions.userId, userId),
    ),
  );

  if (!session) {
    sendNotFound(res, 'Session');
    return;
  }

  await db.delete(sessions).where(eq(sessions.id, sessionId));

  res.json({ success: true, message: 'Session revoked' });
});

// ============================================================
// GDPR: Revoke All Other Sessions — DELETE /api/auth/sessions
// ============================================================

router.delete('/sessions', requireAuth, async (req, res) => {
  const userId = req.userId;
  const currentRefreshToken = req.cookies?.refresh_token;

  if (!currentRefreshToken) {
    // Revoke all sessions for this user
    await db.delete(sessions).where(eq(sessions.userId, userId));
    res.json({ success: true, message: 'All sessions revoked' });
    return;
  }

  const currentHash = hashToken(currentRefreshToken);

  // Get all sessions for this user except current
  const allSessions = await db.select().from(sessions).where(eq(sessions.userId, userId));
  const otherSessions = allSessions.filter(s => s.refreshTokenHash !== currentHash);

  for (const s of otherSessions) {
    await db.delete(sessions).where(eq(sessions.id, s.id));
  }

  res.json({ success: true, message: `${otherSessions.length} other session(s) revoked` });
});

// ============================================================
// Change Password — POST /api/auth/change-password
// ============================================================

router.post('/change-password', requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const { currentPassword, newPassword } = parsed.data;
  const userId = req.userId;

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    sendNotFound(res, 'User');
    return;
  }

  if (!user.passwordHash) {
    sendError(res, 400, 'Account uses Google sign-in only. Set a password via forgot-password flow.');
    return;
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    sendError(res, 403, 'Current password is incorrect');
    return;
  }

  const newHash = await hashPassword(newPassword);
  await db.update(users)
    .set({ passwordHash: newHash, updatedAt: new Date().toISOString() })
    .where(eq(users.id, userId));

  res.json({ success: true, message: 'Password changed successfully' });
});

export default router;
