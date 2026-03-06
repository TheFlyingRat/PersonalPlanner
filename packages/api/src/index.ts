import dotenv from 'dotenv';
import { resolve, join } from 'path';
dotenv.config({ path: resolve(import.meta.dirname, '../../../.env') });
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'fs';
import { timingSafeEqual } from 'crypto';
import { eq, gte } from 'drizzle-orm';

import { seed } from './db/seed.js';
import { db } from './db/index.js';
import {
  users,
  habits,
  tasks,
  smartMeetings,
  focusTimeRules,
  bufferConfig,
  calendars,
  calendarEvents,
  scheduledEvents,
} from './db/schema.js';
import { createOAuth2Client, setCredentials, GoogleCalendarClient, CalendarPollerManager } from './google/index.js';
import { decrypt } from './crypto.js';
import { reschedule } from '@cadence/engine';
import type {
  Habit,
  Task,
  SmartMeeting,
  FocusTimeRule,
  BufferConfig,
  CalendarEvent,
  UserSettings,
} from '@cadence/shared';
import {
  Priority,
  Frequency,
  SchedulingHours,
  TaskStatus,
  DecompressionTarget,
  EventStatus,
  ItemType,
  CalendarOpType,
} from '@cadence/shared';

import habitsRouter from './routes/habits.js';
import tasksRouter from './routes/tasks.js';
import meetingsRouter from './routes/meetings.js';
import focusRouter from './routes/focus.js';
import buffersRouter from './routes/buffers.js';
import scheduleRouter from './routes/schedule.js';
import linksRouter from './routes/links.js';
import analyticsRouter from './routes/analytics.js';
import authRouter from './routes/auth.js';
import settingsRouter from './routes/settings.js';
import calendarsRouter from './routes/calendars.js';
import searchRouter from './routes/search.js';
import activityRouter from './routes/activity.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Security headers — allow Geist font CDN
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
}));

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json());

// Global rate limit: 500 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 500,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use(globalLimiter);

// Stricter rate limits for public endpoints
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many booking requests, please try again later.' },
});
app.use('/api/links/:slug/book', bookingLimiter);

const rescheduleLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reschedule requests, please try again later.' },
});
app.use('/api/schedule/reschedule', rescheduleLimiter);

// Strict rate limit for OAuth initiation
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many auth requests, please try again later.' },
});
app.use('/api/auth/google', authLimiter);

// API key authentication middleware
const PUBLIC_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/api\/health$/ },
  { method: 'GET', pattern: /^\/api\/auth\/google\/callback/ },
  { method: 'GET', pattern: /^\/api\/links\/[^/]+\/slots$/ },
  { method: 'POST', pattern: /^\/api\/links\/[^/]+\/book$/ },
];

if (!process.env.API_KEY) {
  console.warn('\u26a0\ufe0f  WARNING: API_KEY not set. All endpoints are unprotected.');
}

app.use('/api', (req, res, next) => {
  const apiKey = process.env.API_KEY;

  // If API_KEY is not set, skip auth
  if (!apiKey) {
    next();
    return;
  }

  // Check if this route is public
  const fullPath = `/api${req.path}`;
  const isPublic = PUBLIC_ROUTES.some(
    (route) => route.method === req.method && route.pattern.test(fullPath),
  );

  if (isPublic) {
    next();
    return;
  }

  // Verify Authorization header
  const authHeader = req.headers.authorization;
  const expected = `Bearer ${apiKey}`;
  if (!authHeader || authHeader.length !== expected.length || !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/habits', habitsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/focus-time', focusRouter);
app.use('/api/buffers', buffersRouter);
app.use('/api/schedule', scheduleRouter);
app.use('/api/links', linksRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/auth', authRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/calendars', calendarsRouter);
app.use('/api/search', searchRouter);
app.use('/api/activity', activityRouter);

// Serve static SvelteKit build in production
const webBuildPath = resolve(import.meta.dirname, '../../web/build');
if (existsSync(webBuildPath)) {
  app.use(express.static(webBuildPath));
}

// SPA fallback: serve index.html for any non-API route (client-side routing)
app.get('/{*path}', (_req, res) => {
  res.sendFile(join(import.meta.dirname, '../../web/build/index.html'));
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize database with seed data
seed();

// ============================================================
// Calendar Polling
// ============================================================

import { pollingRef } from './polling-ref.js';
import { initWebSocket, broadcast, closeWebSocket } from './ws.js';

export let pollerManager: CalendarPollerManager | null = null;

function toHabit(row: any): Habit {
  return {
    ...row,
    priority: row.priority as Priority,
    frequency: row.frequency as Frequency,
    frequencyConfig: row.frequencyConfig ? JSON.parse(row.frequencyConfig) : {},
    schedulingHours: (row.schedulingHours || 'working') as SchedulingHours,
    locked: !!row.locked,
    autoDecline: !!row.autoDecline,
    enabled: row.enabled !== false && row.enabled !== 0,
    skipBuffer: !!row.skipBuffer,
  };
}

function toTask(row: any): Task {
  return {
    ...row,
    priority: row.priority as Priority,
    schedulingHours: (row.schedulingHours || 'working') as SchedulingHours,
    status: (row.status || 'open') as TaskStatus,
    isUpNext: !!row.isUpNext,
    skipBuffer: !!row.skipBuffer,
  };
}

function toMeeting(row: any): SmartMeeting {
  return {
    ...row,
    priority: row.priority as Priority,
    frequency: row.frequency as Frequency,
    attendees: row.attendees ? JSON.parse(row.attendees) : [],
    skipBuffer: !!row.skipBuffer,
  };
}

function toFocusRule(row: any): FocusTimeRule {
  return {
    ...row,
    schedulingHours: (row.schedulingHours || 'working') as SchedulingHours,
    enabled: !!row.enabled,
  };
}

function toBufConfig(row: any): BufferConfig {
  return {
    ...row,
    applyDecompressionTo: (row.applyDecompressionTo || 'all') as DecompressionTarget,
  };
}

// Concurrency guard: only one reschedule at a time.
// If a reschedule is requested while one is in progress, it is queued
// and runs once the current one finishes.
let isRescheduling = false;
let pendingReschedule: { calClient: GoogleCalendarClient; manager: CalendarPollerManager; reason: string } | null = null;

/**
 * Run the scheduling engine, apply operations to Google Calendar, and persist to DB.
 * Shared by both the poller callback and the periodic optimization timer.
 */
async function runRescheduleAndApply(
  calClient: GoogleCalendarClient,
  manager: CalendarPollerManager,
  reason: string,
): Promise<number> {
  if (isRescheduling) {
    console.log(`[scheduler] Reschedule already in progress, queuing: ${reason}`);
    pendingReschedule = { calClient, manager, reason };
    return 0;
  }

  isRescheduling = true;
  try {
    return await doRescheduleAndApply(calClient, manager, reason);
  } finally {
    isRescheduling = false;
    if (pendingReschedule) {
      const next = pendingReschedule;
      pendingReschedule = null;
      runRescheduleAndApply(next.calClient, next.manager, next.reason).catch((err) => {
        console.error(`[scheduler] Queued reschedule failed (${next.reason}):`, err);
      });
    }
  }
}

async function doRescheduleAndApply(
  calClient: GoogleCalendarClient,
  manager: CalendarPollerManager,
  reason: string,
): Promise<number> {
  const allHabits = db.select().from(habits).all().map(toHabit);
  const allTasks = db.select().from(tasks).all().map(toTask);
  const allMeetings = db.select().from(smartMeetings).all().map(toMeeting);
  const allFocusRules = db.select().from(focusTimeRules).all().map(toFocusRule);
  const bufRows = db.select().from(bufferConfig).all();
  const buf: BufferConfig = bufRows.length > 0
    ? toBufConfig(bufRows[0])
    : {
        id: 'default',
        travelTimeMinutes: 15,
        decompressionMinutes: 10,
        breakBetweenItemsMinutes: 5,
        applyDecompressionTo: DecompressionTarget.All,
      };

  const currentUserRows = db.select().from(users).all();
  const userSettings: UserSettings = currentUserRows.length > 0 && currentUserRows[0].settings
    ? JSON.parse(currentUserRows[0].settings)
    : {
        workingHours: { start: '09:00', end: '17:00' },
        personalHours: { start: '07:00', end: '22:00' },
        timezone: 'America/New_York',
        schedulingWindowDays: 14,
      };

  // Load existing managed events from DB (future only — don't touch past events)
  const nowISO = new Date().toISOString();
  const rawRows = db.select().from(scheduledEvents)
    .where(gte(scheduledEvents.end, nowISO)).all();

  // Deduplicate: if multiple rows share the same itemId (from past race conditions),
  // keep only the one with a googleEventId (or the newest) and delete the rest.
  const byItemId = new Map<string, any[]>();
  for (const row of rawRows) {
    const key = row.itemId || row.id;
    const group = byItemId.get(key) || [];
    group.push(row);
    byItemId.set(key, group);
  }

  const dedupedRows: any[] = [];
  for (const [, group] of byItemId) {
    if (group.length === 1) {
      dedupedRows.push(group[0]);
      continue;
    }
    // Prefer the row that has a googleEventId
    group.sort((a: any, b: any) => {
      if (a.googleEventId && !b.googleEventId) return -1;
      if (!a.googleEventId && b.googleEventId) return 1;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
    dedupedRows.push(group[0]);
    // Delete duplicate rows from DB
    for (let i = 1; i < group.length; i++) {
      db.delete(scheduledEvents).where(eq(scheduledEvents.id, group[i].id)).run();
      console.log(`[scheduler] Removed duplicate scheduledEvent row: ${group[i].id} (itemId: ${group[i].itemId})`);
    }
  }

  const existingEvents: CalendarEvent[] = dedupedRows.map((row: any) => ({
    id: row.id,
    googleEventId: row.googleEventId || '',
    title: row.title || '',
    start: row.start,
    end: row.end,
    isManaged: true,
    itemType: row.itemType as ItemType,
    itemId: row.itemId,
    status: (row.status || 'free') as EventStatus,
    calendarId: row.calendarId || 'primary',
  }));

  // Merge cached external events from all enabled calendars as constraints
  const allCachedExternal = db.select().from(calendarEvents).all();
  const enabledCals = db.select().from(calendars)
    .where(eq(calendars.enabled, true))
    .all();
  const calModeMap = new Map(enabledCals.map(c => [c.id, c.mode]));

  for (const row of allCachedExternal) {
    if (!row.start || !row.end) continue;
    const evEnd = new Date(row.end).getTime();
    if (isNaN(evEnd) || evEnd < Date.now()) continue; // skip past events
    const mode = calModeMap.get(row.calendarId);
    if (!mode) continue; // calendar not enabled

    existingEvents.push({
      id: row.id,
      googleEventId: row.googleEventId || '',
      title: row.title || '',
      start: row.start,
      end: row.end,
      isManaged: false,
      itemType: null,
      itemId: null,
      status: mode === 'locked' ? EventStatus.Locked : EventStatus.Busy,
      calendarId: row.calendarId,
    });
  }

  // Determine default calendars
  const defaultHabitCalId = userSettings.defaultHabitCalendarId || 'primary';
  const defaultTaskCalId = userSettings.defaultTaskCalendarId || 'primary';

  const habitCal = db.select().from(calendars)
    .where(eq(calendars.id, defaultHabitCalId)).all();
  const taskCal = db.select().from(calendars)
    .where(eq(calendars.id, defaultTaskCalId)).all();

  const habitCalRow = habitCal[0];
  const habitGoogleCalId = (habitCalRow?.enabled && habitCalRow?.mode === 'writable')
    ? habitCalRow.googleCalendarId
    : 'primary';
  const taskCalRow = taskCal[0];
  const taskGoogleCalId = (taskCalRow?.enabled && taskCalRow?.mode === 'writable')
    ? taskCalRow.googleCalendarId
    : 'primary';

  // Run the scheduling engine
  const result = reschedule(
    allHabits,
    allTasks,
    allMeetings,
    allFocusRules,
    existingEvents,
    buf,
    userSettings,
  );

  // Filter out trivial updates (< 2 min time change) to prevent drift loops
  const MIN_CHANGE_MS = 2 * 60 * 1000;
  result.operations = result.operations.filter((op) => {
    if (op.type !== CalendarOpType.Update || !op.eventId) return true;
    const existing = existingEvents.find((e) => e.id === op.eventId);
    if (!existing) return true;
    const startDiff = Math.abs(new Date(op.start).getTime() - new Date(existing.start).getTime());
    const endDiff = Math.abs(new Date(op.end).getTime() - new Date(existing.end).getTime());
    return startDiff >= MIN_CHANGE_MS || endDiff >= MIN_CHANGE_MS;
  });

  if (result.operations.length === 0) {
    return 0;
  }

  // Tag each operation with the appropriate calendarId
  for (const op of result.operations) {
    if (!op.calendarId) {
      if (op.itemType === ItemType.Habit || op.itemType === ItemType.Focus) {
        op.calendarId = defaultHabitCalId;
      } else if (op.itemType === ItemType.Task) {
        op.calendarId = defaultTaskCalId;
      } else {
        op.calendarId = 'primary';
      }
    }
  }

  // Group operations by target Google Calendar and apply
  const opsByGoogleCal = new Map<string, typeof result.operations>();
  for (const op of result.operations) {
    const cal = db.select().from(calendars)
      .where(eq(calendars.id, op.calendarId!)).all();
    const googleCalId = cal[0]?.googleCalendarId || 'primary';
    const existing = opsByGoogleCal.get(googleCalId) || [];
    existing.push(op);
    opsByGoogleCal.set(googleCalId, existing);
  }

  for (const [googleCalId, ops] of opsByGoogleCal) {
    await calClient.applyOperations(googleCalId, ops);
  }

  // Persist to DB
  for (const op of result.operations) {
    const now = new Date().toISOString();
    if (op.type === CalendarOpType.Create) {
      db.insert(scheduledEvents).values({
        id: crypto.randomUUID(),
        itemType: op.itemType,
        itemId: op.itemId,
        title: op.title,
        googleEventId: op.googleEventId || null,
        calendarId: op.calendarId || 'primary',
        start: op.start,
        end: op.end,
        status: op.status,
        alternativeSlotsCount: null,
        createdAt: now,
        updatedAt: now,
      }).run();
    } else if (op.type === CalendarOpType.Update && op.eventId) {
      db.update(scheduledEvents)
        .set({
          title: op.title,
          start: op.start,
          end: op.end,
          status: op.status,
          googleEventId: op.googleEventId || undefined,
          updatedAt: now,
        })
        .where(eq(scheduledEvents.id, op.eventId))
        .run();
    } else if (op.type === CalendarOpType.Delete && op.eventId) {
      db.delete(scheduledEvents)
        .where(eq(scheduledEvents.id, op.eventId))
        .run();
    }
  }

  manager.markAllWritten();
  for (const op of result.operations) {
    console.log(`[scheduler]   ${op.type} ${op.itemType}:${op.title} → ${op.start} - ${op.end}`);
  }
  console.log(`[scheduler] ${reason}: ${result.operations.length} operations applied`);
  broadcast('schedule_updated', reason);
  return result.operations.length;
}

// Periodic reschedule interval handle (for cleanup on shutdown)
let periodicRescheduleTimer: ReturnType<typeof setInterval> | null = null;

export async function initPolling(): Promise<CalendarPollerManager | null> {
  const userRows = db.select().from(users).all();
  if (!userRows[0]?.googleRefreshToken) {
    console.log('No Google Calendar connected. Polling disabled.');
    return null;
  }

  const oauth2Client = createOAuth2Client();
  const refreshToken = decrypt(userRows[0].googleRefreshToken);
  setCredentials(oauth2Client, refreshToken);
  const calClient = new GoogleCalendarClient(oauth2Client);
  pollingRef.calClient = calClient;

  // Will be set after manager is created (used by pollingRef.runReschedule)
  let managerRef: CalendarPollerManager;

  pollingRef.runReschedule = async (reason: string) => {
    return runRescheduleAndApply(calClient, managerRef, reason);
  };

  const manager = new CalendarPollerManager(
    calClient,
    async (calendarId, polledEvents) => {
      // Upsert changed events from this calendar (incremental sync sends only deltas)
      const now = new Date().toISOString();
      for (const ev of polledEvents) {
        if (!ev.googleEventId) continue;
        if (ev.isManaged) continue;

        // Handle cancelled/deleted events
        if (!ev.start || !ev.end || !ev.title) {
          db.delete(calendarEvents)
            .where(eq(calendarEvents.googleEventId, ev.googleEventId))
            .run();
          continue;
        }

        const existing = db.select().from(calendarEvents)
          .where(eq(calendarEvents.googleEventId, ev.googleEventId))
          .all();

        if (existing.length > 0) {
          db.update(calendarEvents)
            .set({
              title: ev.title,
              start: ev.start,
              end: ev.end,
              status: ev.status || 'busy',
              location: ev.location || null,
              isAllDay: !ev.start.includes('T'),
              updatedAt: now,
            })
            .where(eq(calendarEvents.googleEventId, ev.googleEventId))
            .run();
        } else {
          db.insert(calendarEvents).values({
            id: crypto.randomUUID(),
            calendarId,
            googleEventId: ev.googleEventId,
            title: ev.title,
            start: ev.start,
            end: ev.end,
            status: ev.status || 'busy',
            location: ev.location || null,
            isAllDay: !ev.start.includes('T'),
            updatedAt: now,
          }).run();
        }
      }

      // Only consider truly external events (not Cadence-managed) for conflict detection
      const externalOnly = polledEvents.filter((ev) => !ev.isManaged);

      if (externalOnly.length > 0) {
        broadcast('schedule_updated', 'External calendar events changed');

        // Check for conflicts between external events and managed events
        const managedEvents = db.select().from(scheduledEvents).all()
          .filter((r: any) => r.start && r.end);

        const changedTimed = externalOnly.filter(
          (ev) => ev.start && ev.end && ev.start.includes('T'),
        );

        const hasConflicts = changedTimed.some((ext) => {
          const extStart = new Date(ext.start!).getTime();
          const extEnd = new Date(ext.end!).getTime();
          return managedEvents.some((managed: any) => {
            const mStart = new Date(managed.start).getTime();
            const mEnd = new Date(managed.end).getTime();
            return extStart < mEnd && mStart < extEnd;
          });
        });

        if (hasConflicts) {
          await runRescheduleAndApply(calClient, manager, 'Conflict detected');
        } else {
          console.log(`[poller] Cached ${externalOnly.length} external event(s), no conflicts`);
        }
      }
    },
  );

  managerRef = manager;

  await manager.startAll();
  console.log('Calendar polling started for all enabled calendars');

  // Periodic reschedule every 5 minutes to optimize placement
  periodicRescheduleTimer = setInterval(async () => {
    try {
      const ops = await runRescheduleAndApply(calClient, manager, 'Periodic optimization');
      if (ops === 0) {
        console.log('[scheduler] Periodic check: schedule is optimal, no changes');
      }
    } catch (err) {
      console.error('[scheduler] Periodic reschedule failed:', err);
    }
  }, 5 * 60 * 1000);

  // Run an initial reschedule on startup to pick up any new/changed items
  try {
    await runRescheduleAndApply(calClient, manager, 'Startup sync');
  } catch (err) {
    console.error('[scheduler] Startup reschedule failed:', err);
  }

  return manager;
}

pollingRef.init = async () => {
  const manager = await initPolling();
  pollerManager = manager;
  pollingRef.manager = manager;
};

pollingRef.init()
  .then(() => {})
  .catch((err) => {
    console.error('Polling init failed:', err);
  });

const server = app.listen(PORT, () => {
  console.log(`Cadence API server running on http://localhost:${PORT}`);
});
initWebSocket(server);

function gracefulShutdown(signal: string) {
  console.log(`${signal} received. Shutting down gracefully...`);
  if (periodicRescheduleTimer) {
    clearInterval(periodicRescheduleTimer);
  }
  if (pollerManager) {
    pollerManager.stopAll();
  }
  closeWebSocket();
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  // Force exit after 10s if server hasn't closed
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
