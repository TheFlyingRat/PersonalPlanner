import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db } from '../db/index.js';
import { calendars, users } from '../db/schema.js';
import { createOAuth2Client, setCredentials, GoogleCalendarClient } from '../google/index.js';
import { decrypt } from '../crypto.js';
import { CalendarMode } from '@cadence/shared';
import { pollerManager } from '../index.js';

const patchCalendarSchema = z.object({
  mode: z.enum([CalendarMode.Writable, CalendarMode.Locked]).optional(),
  enabled: z.boolean().optional(),
});

const router = Router();

// GET /api/calendars - list all saved calendars
router.get('/', (_req, res) => {
  const rows = db.select().from(calendars).all();
  res.json(rows);
});

// GET /api/calendars/discover - fetch from Google and upsert
router.get('/discover', async (_req, res) => {
  try {
    const userRows = db.select().from(users).all();
    const now = new Date().toISOString();

    let googleCalendars: Array<{ googleCalendarId: string; name: string; color: string }>;

    if (!userRows[0]?.googleRefreshToken) {
      res.status(400).json({ error: 'Google Calendar not connected. Connect in Settings first.' });
      return;
    }

    const oauth2Client = createOAuth2Client();
    const refreshToken = decrypt(userRows[0].googleRefreshToken);
    setCredentials(oauth2Client, refreshToken);
    const client = new GoogleCalendarClient(oauth2Client);
    googleCalendars = await client.listCalendars();

    for (const gcal of googleCalendars) {
      const existing = db.select().from(calendars)
        .where(eq(calendars.googleCalendarId, gcal.googleCalendarId))
        .all();

      if (existing.length > 0) {
        // Update name and color, keep user's mode/enabled
        db.update(calendars)
          .set({ name: gcal.name, color: gcal.color, updatedAt: now })
          .where(eq(calendars.googleCalendarId, gcal.googleCalendarId))
          .run();
      } else {
        db.insert(calendars).values({
          id: crypto.randomUUID(),
          googleCalendarId: gcal.googleCalendarId,
          name: gcal.name,
          color: gcal.color,
          mode: 'writable',
          enabled: false,  // new calendars start disabled
          syncToken: null,
          createdAt: now,
          updatedAt: now,
        }).run();
      }
    }

    // Return updated list
    const rows = db.select().from(calendars).all();
    res.json(rows);
  } catch (err) {
    console.error('[calendars] Discovery failed:', err);
    res.status(500).json({ error: 'Failed to discover calendars' });
  }
});

// PATCH /api/calendars/:id - update mode or enabled
router.patch('/:id', async (req, res) => {
  const { id } = req.params;

  const parsed = patchCalendarSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }
  const { mode, enabled } = parsed.data;

  const existing = db.select().from(calendars).where(eq(calendars.id, id)).all();
  if (existing.length === 0) {
    res.status(404).json({ error: 'Calendar not found' });
    return;
  }

  // Protect primary calendar
  if (existing[0].googleCalendarId === 'primary') {
    if (enabled === false) {
      res.status(400).json({ error: 'Cannot disable the primary calendar' });
      return;
    }
    if (mode === CalendarMode.Locked) {
      res.status(400).json({ error: 'Cannot lock the primary calendar' });
      return;
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (mode !== undefined) updates.mode = mode;
  if (enabled !== undefined) updates.enabled = enabled;

  db.update(calendars).set(updates).where(eq(calendars.id, id)).run();

  // Start/stop poller when enabled state changes
  if (enabled !== undefined && pollerManager) {
    const cal = db.select().from(calendars).where(eq(calendars.id, id)).all()[0];
    if (enabled) {
      await pollerManager.startPoller(cal.id, cal.googleCalendarId);
    } else {
      pollerManager.stopPoller(cal.id);
    }
  }

  // Reset defaults if disabled calendar was a default
  if (enabled === false) {
    const userRows = db.select().from(users).all();
    if (userRows[0]?.settings) {
      const settings = JSON.parse(userRows[0].settings);
      let changed = false;
      if (settings.defaultHabitCalendarId === id) {
        settings.defaultHabitCalendarId = 'primary';
        changed = true;
      }
      if (settings.defaultTaskCalendarId === id) {
        settings.defaultTaskCalendarId = 'primary';
        changed = true;
      }
      if (changed) {
        db.update(users)
          .set({ settings: JSON.stringify(settings) })
          .where(eq(users.id, userRows[0].id))
          .run();
      }
    }
  }

  const updated = db.select().from(calendars).where(eq(calendars.id, id)).all();
  res.json(updated[0]);
});

export default router;
