import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(import.meta.dirname, '../../../.env') });
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'fs';
import { resolve, join } from 'path';
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
  scheduledEvents,
} from './db/schema.js';
import { createOAuth2Client, setCredentials, GoogleCalendarClient, CalendarPoller } from './google/index.js';
import { decrypt } from './crypto.js';
import { reschedule } from '@reclaim/engine';
import type {
  Habit,
  Task,
  SmartMeeting,
  FocusTimeRule,
  BufferConfig,
  CalendarEvent,
  UserSettings,
} from '@reclaim/shared';
import {
  Priority,
  Frequency,
  SchedulingHours,
  TaskStatus,
  DecompressionTarget,
  EventStatus,
  ItemType,
  CalendarOpType,
} from '@reclaim/shared';

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

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Security headers
app.use(helmet());

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

export let calendarPoller: CalendarPoller | null = null;

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

async function initPolling(): Promise<CalendarPoller | null> {
  const userRows = db.select().from(users).all();
  if (!userRows[0]?.googleRefreshToken) {
    console.log('No Google Calendar connected. Polling disabled.');
    return null;
  }

  const oauth2Client = createOAuth2Client();
  // Decrypt the refresh token before using it
  const refreshToken = decrypt(userRows[0].googleRefreshToken);
  setCredentials(oauth2Client, refreshToken);
  const calClient = new GoogleCalendarClient(oauth2Client);

  const poller = new CalendarPoller(
    calClient,
    'primary',
    async (_events) => {
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
      }));

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

      // Apply operations to Google Calendar
      await calClient.applyOperations('primary', result.operations);

      // Store operations in the scheduled_events table
      for (const op of result.operations) {
        const now = new Date().toISOString();
        if (op.type === CalendarOpType.Create) {
          db.insert(scheduledEvents).values({
            id: crypto.randomUUID(),
            itemType: op.itemType,
            itemId: op.itemId,
            googleEventId: op.eventId || null,
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

      // Skip the next poll to avoid reacting to our own writes
      poller.markWritten();

      console.log(`[poller] Reschedule complete: ${result.operations.length} operations applied`);
    },
    async () => {
      const rows = db.select().from(users).all();
      return rows[0]?.googleSyncToken || null;
    },
    async (token) => {
      db.update(users)
        .set({ googleSyncToken: token })
        .where(eq(users.id, userRows[0].id))
        .run();
    },
  );

  await poller.start();
  console.log('Calendar polling started (every 15 seconds)');
  return poller;
}

initPolling()
  .then((poller) => {
    calendarPoller = poller;
  })
  .catch((err) => {
    console.error('Polling init failed:', err);
  });

app.listen(PORT, () => {
  console.log(`Reclaim API server running on http://localhost:${PORT}`);
});

export default app;
