import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { users } from '../db/pg-schema.js';
import type { UserSettings } from '@cadence/shared';
import { userSettingsSchema } from '../validation.js';
import { sendValidationError, sendNotFound } from './helpers.js';

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

  const userRows = await db.select().from(users).where(eq(users.id, req.userId));
  if (userRows.length === 0) {
    sendNotFound(res, 'User');
    return;
  }

  const user = userRows[0];
  const currentSettings: UserSettings = user.settings && typeof user.settings === 'object'
    ? user.settings as UserSettings
    : defaultSettings;

  const updatedSettings: UserSettings = {
    ...currentSettings,
    ...parsed.data,
  };

  await db.update(users)
    .set({ settings: updatedSettings, updatedAt: new Date().toISOString() })
    .where(eq(users.id, req.userId));

  res.json({
    id: user.id,
    settings: updatedSettings,
    createdAt: user.createdAt ?? '',
  });
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

  await db.update(users)
    .set({ googleRefreshToken: null, googleSyncToken: null, updatedAt: new Date().toISOString() })
    .where(eq(users.id, req.userId));

  res.json({ message: 'Google disconnected' });
});

export default router;
