import { Router } from 'express';
import { eq, and, gt, ne, sql, lt } from 'drizzle-orm';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';
import { db, pool as getPool } from '../db/pg-index.js';
import {
  users, sessions, emailVerifications, passwordResets,
  habits, tasks, smartMeetings, focusTimeRules, bufferConfig,
  scheduledEvents, calendarEvents, calendars, habitCompletions,
  subtasks, activityLog, scheduleChanges, schedulingLinks, oauthStates,
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
import { sendValidationError, sendNotFound, sendError, validateUUID } from './helpers.js';

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

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reset attempts, please try again later.' },
});

const verifyEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many verification attempts, please try again later.' },
});

const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many password change attempts, please try again later.' },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts, please try again later.' },
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
    emailVerified: !!user.emailVerified,
    hasGdprConsent: !!user.gdprConsentAt,
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
  return req.ip || req.socket.remoteAddress || '';
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
    if (existing[0].googleId) {
      res.status(409).json({ error: 'An account with this email uses Google sign-in.', code: 'GOOGLE_ACCOUNT' });
    } else {
      sendError(res, 409, 'An account with this email already exists');
    }
    return;
  }

  const passwordHash = await hashPassword(password);

  // Generate email verification token
  const verifyToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(verifyToken);

  const [newUser] = await db.transaction(async (tx) => {
    const inserted = await tx.insert(users).values({
      email: email.toLowerCase(),
      passwordHash,
      name,
      gdprConsentAt: new Date().toISOString(),
      consentVersion: '1.0',
    }).returning();

    await tx.insert(emailVerifications).values({
      userId: inserted[0].id,
      tokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
    });

    return inserted;
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
  if (!user) {
    // Run bcrypt against a dummy hash to equalize response timing (prevent timing oracle)
    await verifyPassword(password, '$2b$12$000000000000000000000uGbOQPJ9K7.1JCJfUnpDBqkEGfjXbkm');
    sendError(res, 401, 'Invalid email or password');
    return;
  }

  if (!user.passwordHash && user.googleId) {
    res.status(409).json({ error: 'This account uses Google sign-in.', code: 'GOOGLE_ACCOUNT' });
    return;
  }

  if (!user.passwordHash) {
    await verifyPassword(password, '$2b$12$000000000000000000000uGbOQPJ9K7.1JCJfUnpDBqkEGfjXbkm');
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

router.post('/refresh', refreshLimiter, async (req, res) => {
  const oldRefreshToken = req.cookies?.refresh_token;
  if (!oldRefreshToken) {
    sendError(res, 401, 'No refresh token');
    return;
  }

  const oldHash = hashToken(oldRefreshToken);
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Find and lock the session row atomically
    const { rows: sessionRows } = await client.query(
      `SELECT id, user_id FROM sessions
       WHERE refresh_token_hash = $1 AND expires_at > NOW()
       FOR UPDATE`,
      [oldHash],
    );

    if (sessionRows.length === 0) {
      await client.query('ROLLBACK');
      clearAuthCookies(res);
      sendError(res, 401, 'Invalid or expired refresh token');
      return;
    }

    const session = sessionRows[0];

    // Delete old session
    await client.query('DELETE FROM sessions WHERE id = $1', [session.id]);

    await client.query('COMMIT');

    // Create new session (outside transaction — uses Drizzle)
    const { accessToken, refreshToken } = await createSession(
      session.user_id,
      req.headers['user-agent'],
      getClientIp(req),
    );
    setAuthCookies(res, accessToken, refreshToken);

    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

router.get('/verify-email', verifyEmailLimiter, async (req, res) => {
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

  // Mark email as verified and delete tokens atomically
  await db.transaction(async (tx) => {
    await tx.update(users)
      .set({ emailVerified: true, updatedAt: new Date().toISOString() })
      .where(eq(users.id, verification.userId));
    await tx.delete(emailVerifications).where(eq(emailVerifications.userId, verification.userId));
  });

  res.json({ success: true, message: 'Email verified successfully' });
});

// ============================================================
// POST /api/auth/resend-verification-email
// ============================================================

router.post('/resend-verification-email', signupLimiter, async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'Valid email is required');
    return;
  }
  const { email } = parsed.data;

  // Always return success (prevent email enumeration)
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));

  if (user && !user.emailVerified) {
    // Delete old verification tokens
    await db.delete(emailVerifications).where(eq(emailVerifications.userId, user.id));

    // Create new token
    const verifyToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(verifyToken);

    await db.insert(emailVerifications).values({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    sendVerificationEmail(email.toLowerCase(), verifyToken).catch((err) => {
      console.error('[auth] Failed to resend verification email:', err);
    });
  }

  res.json({ success: true, message: 'If an account with that email exists and is unverified, a new verification email has been sent.' });
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

router.post('/reset-password', resetPasswordLimiter, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const { token, password } = parsed.data;
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  // Atomic: mark token as used only if it hasn't been used yet (prevents TOCTOU)
  const updated = await db.update(passwordResets)
    .set({ usedAt: now })
    .where(
      and(
        eq(passwordResets.tokenHash, tokenHash),
        gt(passwordResets.expiresAt, now),
        sql`${passwordResets.usedAt} IS NULL`,
      ),
    )
    .returning();

  if (updated.length === 0) {
    sendError(res, 400, 'Invalid or expired reset token');
    return;
  }

  const reset = updated[0];
  const passwordHash = await hashPassword(password);

  // Update password
  await db.update(users)
    .set({ passwordHash, updatedAt: now })
    .where(eq(users.id, reset.userId));

  // Revoke all existing sessions for this user (force re-login)
  await db.delete(sessions).where(eq(sessions.userId, reset.userId));

  res.json({ success: true, message: 'Password reset successfully' });
});

// ============================================================
// Google OAuth — unified sign-in + calendar scoping
// ============================================================

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// Cleanup expired OAuth states periodically
setInterval(async () => {
  try {
    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date().toISOString()));
  } catch { /* ignore cleanup errors */ }
}, 60_000);

// GET /api/auth/google — initiate unified OAuth
router.get('/google', async (req, res) => {
  const oauth2Client = createOAuth2Client();
  const state = randomBytes(16).toString('hex');
  const stateHash = createHash('sha256').update(state).digest('hex');
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();

  await db.insert(oauthStates).values({ stateHash, expiresAt });

  // Use prompt=none for silent sign-in; fall back to select_account on retry
  const ALLOWED_PROMPTS = ['none', 'select_account'] as const;
  const rawPrompt = req.query.prompt as string | undefined;
  const promptParam = rawPrompt && ALLOWED_PROMPTS.includes(rawPrompt as any) ? rawPrompt : 'none';

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: promptParam,
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
  const rawFrontendOrigin = process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:5173';

  // Validate frontendOrigin is a valid URL to prevent open redirect
  let frontendOrigin: string;
  try {
    const parsed = new URL(rawFrontendOrigin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Invalid protocol');
    }
    frontendOrigin = parsed.origin;
  } catch {
    console.error('[auth] Invalid FRONTEND_URL/CORS_ORIGIN:', rawFrontendOrigin);
    frontendOrigin = 'http://localhost:5173';
  }

  // If Google returned an error (e.g. prompt=none failed), retry with select_account
  const oauthError = req.query.error as string | undefined;
  if (oauthError) {
    if (oauthError === 'interaction_required' || oauthError === 'consent_required' || oauthError === 'login_required') {
      res.redirect(`${frontendOrigin}/login?google_retry=1`);
      return;
    }
    console.warn('[auth] OAuth callback error:', oauthError);
    res.redirect(`${frontendOrigin}/login?error=auth_failed`);
    return;
  }

  if (!code) {
    console.warn('[auth] OAuth callback missing code parameter');
    res.redirect(`${frontendOrigin}/login?error=auth_failed`);
    return;
  }

  // Verify state from database
  if (!state) {
    console.warn('[auth] OAuth callback missing state parameter');
    res.redirect(`${frontendOrigin}/login?error=auth_failed`);
    return;
  }

  const stateHash = createHash('sha256').update(state).digest('hex');
  const stateRows = await db.delete(oauthStates)
    .where(and(eq(oauthStates.stateHash, stateHash), gt(oauthStates.expiresAt, new Date().toISOString())))
    .returning({ stateHash: oauthStates.stateHash });

  if (stateRows.length === 0) {
    console.warn('[auth] OAuth callback: invalid or expired state');
    res.redirect(`${frontendOrigin}/login?error=auth_failed`);
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
      console.warn('[auth] OAuth: Google profile has no email');
      res.redirect(`${frontendOrigin}/login?error=auth_failed`);
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
        // Create new user via Google (GDPR consent deferred to onboarding)
        [user] = await db.insert(users).values({
          email,
          emailVerified: true,
          name,
          avatarUrl,
          googleId,
          googleRefreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
          gdprConsentAt: null,
          consentVersion: null,
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

    // Start the user's scheduler now that Google is connected
    if (user.googleRefreshToken) {
      schedulerRegistry.getOrCreate(user.id).catch((err) => {
        console.error('[auth] Failed to start scheduler after Google OAuth:', err);
      });
    }

    // Redirect based on onboarding status
    if (!user.onboardingCompleted) {
      res.redirect(`${frontendOrigin}/onboarding?step=2`);
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

  const result = userSessions.map(s => {
    let isCurrent = false;
    if (currentHash) {
      try {
        const a = Buffer.from(s.refreshTokenHash, 'hex');
        const b = Buffer.from(currentHash, 'hex');
        isCurrent = a.length === b.length && timingSafeEqual(a, b);
      } catch {
        isCurrent = false;
      }
    }
    return {
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      current: isCurrent,
    };
  });

  res.json({ sessions: result });
});

// ============================================================
// GDPR: Revoke Session — DELETE /api/auth/sessions/:id
// ============================================================

router.delete('/sessions/:id', requireAuth, async (req, res) => {
  const sessionId = req.params.id as string;
  if (!validateUUID(sessionId, res)) return;
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

  // Warn if deleting current session — suggest /logout instead
  const currentRefreshToken = req.cookies?.refresh_token;
  if (currentRefreshToken) {
    const currentHash = hashToken(currentRefreshToken);
    try {
      const a = Buffer.from(session.refreshTokenHash, 'hex');
      const b = Buffer.from(currentHash, 'hex');
      if (a.length === b.length && timingSafeEqual(a, b)) {
        res.json({
          success: true,
          message: 'Session revoked',
          warning: 'You revoked your current session. Use /api/auth/logout to sign out properly.',
        });
        await db.delete(sessions).where(eq(sessions.id, sessionId));
        return;
      }
    } catch { /* hash comparison failed, proceed normally */ }
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

  // Delete all sessions for this user except current in a single query
  await db.delete(sessions).where(
    and(eq(sessions.userId, userId), ne(sessions.refreshTokenHash, currentHash))
  );

  res.json({ success: true, message: 'Other sessions revoked' });
});

// ============================================================
// Change Password — POST /api/auth/change-password
// ============================================================

router.post('/change-password', requireAuth, changePasswordLimiter, async (req, res) => {
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

  // Revoke all other sessions (keep current one)
  const currentRefreshToken = req.cookies?.refresh_token;
  if (currentRefreshToken) {
    const currentHash = hashToken(currentRefreshToken);
    await db.delete(sessions).where(
      and(eq(sessions.userId, userId), ne(sessions.refreshTokenHash, currentHash))
    );
  } else {
    // No current token — revoke all sessions
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }

  res.json({ success: true, message: 'Password changed successfully' });
});

export default router;
