import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import type { UserConfig, UserSettings } from '@reclaim/shared';

const router = Router();

const userSettingsSchema = z.object({
  workingHours: z.object({
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM format'),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM format'),
  }).optional(),
  personalHours: z.object({
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM format'),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM format'),
  }).optional(),
  timezone: z.string().optional(),
  schedulingWindowDays: z.number().int().positive().optional(),
});

const defaultSettings: UserSettings = {
  workingHours: { start: '09:00', end: '17:00' },
  personalHours: { start: '07:00', end: '22:00' },
  timezone: 'America/New_York',
  schedulingWindowDays: 14,
};

// GET /api/settings — return user settings
router.get('/', (_req, res) => {
  const userRows = db.select().from(users).all();
  if (userRows.length === 0) {
    res.status(404).json({ error: 'No user found' });
    return;
  }

  const user = userRows[0];
  const settings: UserSettings = user.settings
    ? JSON.parse(user.settings)
    : defaultSettings;

  const config: UserConfig = {
    id: user.id,
    settings,
    googleSyncToken: user.googleSyncToken ?? null,
    createdAt: user.createdAt ?? '',
  };

  res.json(config);
});

// PUT /api/settings — update user settings
router.put('/', (req, res) => {
  const parsed = userSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }

  const userRows = db.select().from(users).all();
  if (userRows.length === 0) {
    res.status(404).json({ error: 'No user found' });
    return;
  }

  const user = userRows[0];
  const currentSettings: UserSettings = user.settings
    ? JSON.parse(user.settings)
    : defaultSettings;

  const updatedSettings: UserSettings = {
    ...currentSettings,
    ...parsed.data,
  };

  db.update(users)
    .set({ settings: JSON.stringify(updatedSettings) })
    .where(eq(users.id, user.id))
    .run();

  const updatedUser = db.select().from(users).where(eq(users.id, user.id)).get();
  const config: UserConfig = {
    id: updatedUser!.id,
    settings: updatedSettings,
    googleSyncToken: updatedUser!.googleSyncToken ?? null,
    createdAt: updatedUser!.createdAt ?? '',
  };

  res.json(config);
});

// GET /api/settings/google/status — check if Google is connected
router.get('/google/status', (_req, res) => {
  const userRows = db.select().from(users).all();
  const connected = userRows.length > 0 && !!userRows[0].googleRefreshToken;
  res.json({ connected });
});

// POST /api/settings/google/disconnect — disconnect Google
router.post('/google/disconnect', (_req, res) => {
  const userRows = db.select().from(users).all();
  if (userRows.length === 0) {
    res.status(404).json({ error: 'No user found' });
    return;
  }

  db.update(users)
    .set({ googleRefreshToken: null, googleSyncToken: null })
    .where(eq(users.id, userRows[0].id))
    .run();

  res.json({ message: 'Google disconnected' });
});

export default router;
