import dotenv from 'dotenv';
import { resolve, join } from 'path';
dotenv.config({ path: resolve(import.meta.dirname, '../../../.env') });
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'fs';
import { timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';

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
      connectSrc: ["'self'"],
    },
  },
}));

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json());

// Global rate limit: 100 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
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

app.use('/api', (req, res, next) => {
  const apiKey = process.env.API_KEY;

  // If API_KEY is not set, warn and skip auth
  if (!apiKey) {
    console.warn('\u26a0\ufe0f  WARNING: API_KEY not set. All endpoints are unprotected.');
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
  };
}

function toTask(row: any): Task {
  return {
    ...row,
    priority: row.priority as Priority,
    schedulingHours: (row.schedulingHours || 'working') as SchedulingHours,
    status: (row.status || 'open') as TaskStatus,
    isUpNext: !!row.isUpNext,
  };
}

function toMeeting(row: any): SmartMeeting {
  return {
    ...row,
    priority: row.priority as Priority,
    frequency: row.frequency as Frequency,
    attendees: row.attendees ? JSON.parse(row.attendees) : [],
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

  const manager = new CalendarPollerManager(
    calClient,
    async (calendarId, polledEvents) => {
      // Upsert changed events from this calendar (incremental sync sends only deltas)
      const now = new Date().toISOString();
      for (const ev of polledEvents) {
        if (!ev.googleEventId) continue;

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

      // Check for conflicts between new/updated external events and managed events
      const managedEvents = db.select().from(scheduledEvents).all()
        .filter((r: any) => r.start && r.end);

      const changedTimed = polledEvents.filter(
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

      if (!hasConflicts) {
        console.log('[poller] No conflicts detected, skipping reschedule');
        return;
      }

      console.log('[poller] Conflicts detected with managed events, triggering reschedule');

      // Load all scheduling data from DB
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

      // Get existing managed calendar events from our DB
      const existingEvents: CalendarEvent[] = db.select().from(scheduledEvents).all().map((row: any) => ({
        id: row.id,
        googleEventId: row.googleEventId || '',
        title: '',
        start: row.start,
        end: row.end,
        isManaged: true,
        itemType: row.itemType as ItemType,
        itemId: row.itemId,
        status: (row.status || 'free') as EventStatus,
        calendarId: row.calendarId || 'primary',
      }));

      // Merge events from locked calendars as immovable constraints
      const enabledCals = db.select().from(calendars)
        .where(eq(calendars.enabled, true))
        .all();

      for (const cal of enabledCals) {
        if (cal.mode === 'locked') {
          const syncResult = await calClient.syncEvents(cal.googleCalendarId, cal.syncToken);
          for (const event of syncResult.events) {
            if (event.start && event.end) {
              existingEvents.push({
                ...event,
                isManaged: false,
                status: EventStatus.Locked,
                calendarId: cal.id,
              });
            }
          }
        }
      }

      // Determine default calendars for habits/tasks
      const defaultHabitCalId = userSettings.defaultHabitCalendarId || 'primary';
      const defaultTaskCalId = userSettings.defaultTaskCalendarId || 'primary';

      // Look up the googleCalendarId for each default
      const habitCal = db.select().from(calendars)
        .where(eq(calendars.id, defaultHabitCalId)).all();
      const taskCal = db.select().from(calendars)
        .where(eq(calendars.id, defaultTaskCalId)).all();

      // Validate defaults exist, are enabled, and are writable before using them
      const habitCalRow = habitCal[0];
      const habitGoogleCalId = (habitCalRow?.enabled && habitCalRow?.mode === 'writable')
        ? habitCalRow.googleCalendarId
        : 'primary';
      const taskCalRow = taskCal[0];
      const taskGoogleCalId = (taskCalRow?.enabled && taskCalRow?.mode === 'writable')
        ? taskCalRow.googleCalendarId
        : 'primary';

      // Run the reschedule engine
      const result = reschedule(
        allHabits,
        allTasks,
        allMeetings,
        allFocusRules,
        existingEvents,
        buf,
        userSettings,
      );

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

      // Store operations in the scheduled_events table
      for (const op of result.operations) {
        const now = new Date().toISOString();
        if (op.type === CalendarOpType.Create) {
          db.insert(scheduledEvents).values({
            id: crypto.randomUUID(),
            itemType: op.itemType,
            itemId: op.itemId,
            googleEventId: op.eventId || null,
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
            .set({ start: op.start, end: op.end, status: op.status, updatedAt: now })
            .where(eq(scheduledEvents.id, op.eventId))
            .run();
        } else if (op.type === CalendarOpType.Delete && op.eventId) {
          db.delete(scheduledEvents)
            .where(eq(scheduledEvents.id, op.eventId))
            .run();
        }
      }

      // Skip the next poll on all calendars
      manager.markAllWritten();

      console.log(`[poller] Reschedule complete: ${result.operations.length} operations applied`);
    },
  );

  await manager.startAll();
  console.log('Calendar polling started for all enabled calendars');
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

function gracefulShutdown(signal: string) {
  console.log(`${signal} received. Shutting down gracefully...`);
  if (pollerManager) {
    pollerManager.stopAll();
  }
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
