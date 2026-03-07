import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db } from '../db/pg-index.js';
import { calendars, users } from '../db/pg-schema.js';
import { createOAuth2Client, setCredentials, GoogleCalendarClient } from '../google/index.js';
import { decrypt } from '../crypto.js';
import { CalendarMode } from '@cadence/shared';
import { schedulerRegistry } from '../scheduler-registry.js';
import { sendValidationError, sendNotFound, sendError } from './helpers.js';

const patchCalendarSchema = z.object({
  mode: z.enum([CalendarMode.Writable, CalendarMode.Locked]).optional(),
  enabled: z.boolean().optional(),
});

const router = Router();

// GET /api/calendars - list all saved calendars for the current user
router.get('/', async (req, res) => {
  const rows = await db.select().from(calendars).where(eq(calendars.userId, req.userId));
  res.json(rows);
});

// GET /api/calendars/discover - fetch from Google and upsert
router.get('/discover', async (req, res) => {
  try {
    const userRows = await db.select().from(users).where(eq(users.id, req.userId));

    if (userRows.length === 0 || !userRows[0].googleRefreshToken) {
      sendError(res, 400, 'Google Calendar not connected. Connect in Settings first.');
      return;
    }

    const oauth2Client = createOAuth2Client();
    const refreshToken = decrypt(userRows[0].googleRefreshToken);
    setCredentials(oauth2Client, refreshToken);
    const client = new GoogleCalendarClient(oauth2Client);
    const googleCalendars = await client.listCalendars();
    const now = new Date().toISOString();

    for (const gcal of googleCalendars) {
      const existing = await db.select().from(calendars)
        .where(and(eq(calendars.googleCalendarId, gcal.googleCalendarId), eq(calendars.userId, req.userId)));

      if (existing.length > 0) {
        // Update name and color, keep user's mode/enabled
        await db.update(calendars)
          .set({ name: gcal.name, color: gcal.color, updatedAt: now })
          .where(and(eq(calendars.googleCalendarId, gcal.googleCalendarId), eq(calendars.userId, req.userId)));
      } else {
        await db.insert(calendars).values({
          userId: req.userId,
          googleCalendarId: gcal.googleCalendarId,
          name: gcal.name,
          color: gcal.color,
          mode: 'writable',
          enabled: false,  // new calendars start disabled
          syncToken: null,
        });
      }
    }

    // Return updated list
    const rows = await db.select().from(calendars).where(eq(calendars.userId, req.userId));
    res.json(rows);
  } catch (err) {
    console.error('[calendars] Discovery failed:', err);
    sendError(res, 500, 'Failed to discover calendars');
  }
});

// PATCH /api/calendars/:id - update mode or enabled
router.patch('/:id', async (req, res) => {
  const { id } = req.params;

  const parsed = patchCalendarSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const { mode, enabled } = parsed.data;

  const existing = await db.select().from(calendars).where(and(eq(calendars.id, id), eq(calendars.userId, req.userId)));
  if (existing.length === 0) {
    sendNotFound(res, 'Calendar');
    return;
  }

  // Protect primary calendar
  if (existing[0].googleCalendarId === 'primary') {
    if (enabled === false) {
      sendError(res, 400, 'Cannot disable the primary calendar');
      return;
    }
    if (mode === CalendarMode.Locked) {
      sendError(res, 400, 'Cannot lock the primary calendar');
      return;
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (mode !== undefined) updates.mode = mode;
  if (enabled !== undefined) updates.enabled = enabled;

  await db.update(calendars).set(updates).where(and(eq(calendars.id, id), eq(calendars.userId, req.userId)));

  // Start/stop poller when enabled state changes
  if (enabled !== undefined) {
    const scheduler = schedulerRegistry.get(req.userId);
    const manager = scheduler?.getPollerManager();
    if (manager) {
      const calRows = await db.select().from(calendars).where(and(eq(calendars.id, id), eq(calendars.userId, req.userId)));
      const cal = calRows[0];
      if (enabled) {
        await manager.startPoller(cal.id, cal.googleCalendarId);
      } else {
        manager.stopPoller(cal.id);
      }
    }
  }

  // Reset defaults if disabled calendar was a default
  if (enabled === false) {
    const userRows = await db.select().from(users).where(eq(users.id, req.userId));
    if (userRows[0]?.settings && typeof userRows[0].settings === 'object') {
      const settings = { ...(userRows[0].settings as Record<string, unknown>) };
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
        await db.update(users)
          .set({ settings, updatedAt: new Date().toISOString() })
          .where(eq(users.id, req.userId));
      }
    }
  }

  const updated = await db.select().from(calendars).where(and(eq(calendars.id, id), eq(calendars.userId, req.userId)));
  res.json(updated[0]);
});

export default router;
