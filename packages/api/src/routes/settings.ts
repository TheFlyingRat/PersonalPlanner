import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { users } from '../db/pg-schema.js';
import type { UserSettings } from '@cadence/shared';
import { userSettingsSchema } from '../validation.js';
import { sendValidationError, sendNotFound } from './helpers.js';
import { createOAuth2Client } from '../google/index.js';
import { decrypt } from '../crypto.js';

const router = Router();

const defaultSettings: UserSettings = {
  workingHours: { start: '09:00', end: '17:00' },
  personalHours: { start: '07:00', end: '22:00' },
  timezone: 'America/New_York',
  schedulingWindowDays: 14,
};

// GET /api/settings — return user settings
router.get('/', async (req, res) => {
  const userRows = await db.select().from(users).where(eq(users.id, req.userId));
  if (userRows.length === 0) {
    sendNotFound(res, 'User');
    return;
  }

  const user = userRows[0];
  const settings: UserSettings = user.settings && typeof user.settings === 'object'
    ? user.settings as UserSettings
    : defaultSettings;

  res.json({
    id: user.id,
    settings,
    createdAt: user.createdAt ?? '',
  });
});

// PUT /api/settings — update user settings
router.put('/', async (req, res) => {
  const parsed = userSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const result = await db.transaction(async (tx) => {
    const userRows = await tx.select().from(users).where(eq(users.id, req.userId)).for('update');
    if (userRows.length === 0) {
      return null;
    }

    const user = userRows[0];
    const currentSettings: UserSettings = user.settings && typeof user.settings === 'object'
      ? user.settings as UserSettings
      : defaultSettings;

    const updatedSettings: UserSettings = {
      ...currentSettings,
      ...parsed.data,
    };

    await tx.update(users)
      .set({ settings: updatedSettings, updatedAt: new Date().toISOString() })
      .where(eq(users.id, req.userId));

    return { id: user.id, settings: updatedSettings, createdAt: user.createdAt ?? '' };
  });

  if (!result) {
    sendNotFound(res, 'User');
    return;
  }

  res.json(result);
});

// POST /api/settings/onboarding/complete — mark onboarding as completed
router.post('/onboarding/complete', async (req, res) => {
  await db.update(users)
    .set({ onboardingCompleted: true, updatedAt: new Date().toISOString() })
    .where(eq(users.id, req.userId));
  res.json({ onboardingCompleted: true });
});

// GET /api/settings/google/status — check if Google is connected
router.get('/google/status', async (req, res) => {
  const userRows = await db.select().from(users).where(eq(users.id, req.userId));
  const connected = userRows.length > 0 && !!userRows[0].googleRefreshToken;
  res.json({ connected });
});

// POST /api/settings/google/disconnect — disconnect Google
router.post('/google/disconnect', async (req, res) => {
  const userRows = await db.select().from(users).where(eq(users.id, req.userId));
  if (userRows.length === 0) {
    sendNotFound(res, 'User');
    return;
  }

  // Revoke Google refresh token before clearing
  if (userRows[0].googleRefreshToken) {
    try {
      const refreshToken = decrypt(userRows[0].googleRefreshToken);
      const oauth2Client = createOAuth2Client();
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      await oauth2Client.revokeCredentials();
    } catch (err) {
      console.error('[settings] Failed to revoke Google token:', err);
    }
  }

  await db.update(users)
    .set({ googleRefreshToken: null, googleSyncToken: null, updatedAt: new Date().toISOString() })
    .where(eq(users.id, req.userId));

  res.json({ message: 'Google disconnected' });
});

export default router;
