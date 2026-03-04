# Multi-Calendar Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to discover, toggle, and use multiple Google Calendars — writable calendars for placing events and locked calendars as immovable scheduling constraints.

**Architecture:** New `calendars` table stores discovered Google Calendars with mode/enabled state. A `CalendarPollerManager` orchestrates per-calendar pollers. The engine remains calendar-agnostic — the API layer merges events from all enabled calendars and routes operations to the correct calendar. Frontend adds calendar management to the settings page.

**Tech Stack:** SQLite (Drizzle ORM), Express, Vitest, SvelteKit 5, Tailwind CSS, Google Calendar API v3

---

### Task 1: Add shared types and constants

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/constants.ts`

**Step 1: Add CalendarMode enum and Calendar interface to types.ts**

Add after the `DecompressionTarget` enum (line 48):

```typescript
export enum CalendarMode {
  Writable = 'writable',
  Locked = 'locked',
}
```

Add after the `SchedulingLink` interface (line 144):

```typescript
export interface Calendar {
  id: string;
  googleCalendarId: string;
  name: string;
  color: string;
  mode: CalendarMode;
  enabled: boolean;
  syncToken: string | null;
}
```

**Step 2: Add `calendarId` to CalendarEvent and CalendarOperation**

In `CalendarEvent` (line 150), add after `description?: string`:

```typescript
  calendarId?: string;         // which calendar this event belongs to
```

In `CalendarOperation` (line 194), add after `extendedProperties`:

```typescript
  calendarId?: string;         // target calendar for this operation
```

**Step 3: Add default calendar fields to UserSettings**

In `UserSettings` (line 215), add after `schedulingWindowDays`:

```typescript
  defaultHabitCalendarId?: string;
  defaultTaskCalendarId?: string;
```

**Step 4: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/constants.ts
git commit -m "feat: add multi-calendar shared types and constants"
```

---

### Task 2: Add calendars table and update schema

**Files:**
- Modify: `packages/api/src/db/schema.ts`

**Step 1: Add the calendars table**

Add after the `users` table definition (after line 12):

```typescript
// ============================================================
// Calendars
// ============================================================
export const calendars = sqliteTable('calendars', {
  id: text('id').primaryKey(),
  googleCalendarId: text('googleCalendarId').notNull(),
  name: text('name').notNull(),
  color: text('color').default('#4285f4'),
  mode: text('mode').default('writable'),  // 'writable' | 'locked'
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  syncToken: text('syncToken'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
});
```

**Step 2: Add calendarId to scheduledEvents**

In the `scheduledEvents` table (line 103), add after `googleEventId`:

```typescript
  calendarId: text('calendarId'),  // FK to calendars.id
```

**Step 3: Commit**

```bash
git add packages/api/src/db/schema.ts
git commit -m "feat: add calendars table and calendarId to scheduled_events"
```

---

### Task 3: Seed the primary calendar on startup

**Files:**
- Modify: `packages/api/src/db/seed.ts`

**Step 1: Read seed.ts to understand current structure**

Read: `packages/api/src/db/seed.ts`

**Step 2: Add primary calendar seeding**

Import the `calendars` table and add a seed entry for the primary calendar after the existing seeds:

```typescript
import { calendars } from './schema.js';

// Inside the seed() function, after existing seeds:
db.insert(calendars).values({
  id: 'primary',
  googleCalendarId: 'primary',
  name: 'Primary Calendar',
  color: '#4285f4',
  mode: 'writable',
  enabled: true,
  syncToken: null,
  createdAt: now,
  updatedAt: now,
}).onConflictDoNothing().run();
```

**Step 3: Commit**

```bash
git add packages/api/src/db/seed.ts
git commit -m "feat: seed primary calendar entry on startup"
```

---

### Task 4: Add Google Calendar discovery to GoogleCalendarClient

**Files:**
- Modify: `packages/api/src/google/calendar.ts`

**Step 1: Add listCalendars method**

Add this method to the `GoogleCalendarClient` class (after `deleteEvent`, around line 166):

```typescript
  /**
   * List all calendars accessible by the authenticated user.
   * Returns calendar ID, name, and color for each.
   */
  async listCalendars(): Promise<Array<{
    googleCalendarId: string;
    name: string;
    color: string;
    accessRole: string;
  }>> {
    const result: Array<{
      googleCalendarId: string;
      name: string;
      color: string;
      accessRole: string;
    }> = [];

    let pageToken: string | undefined;

    do {
      const response = await this.calendar.calendarList.list({
        maxResults: 250,
        ...(pageToken ? { pageToken } : {}),
      });

      for (const item of response.data.items ?? []) {
        result.push({
          googleCalendarId: item.id ?? '',
          name: item.summary ?? '(Untitled)',
          color: item.backgroundColor ?? '#4285f4',
          accessRole: item.accessRole ?? 'reader',
        });
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return result;
  }
```

**Step 2: Commit**

```bash
git add packages/api/src/google/calendar.ts
git commit -m "feat: add listCalendars method to GoogleCalendarClient"
```

---

### Task 5: Create calendar API routes

**Files:**
- Create: `packages/api/src/routes/calendars.ts`
- Modify: `packages/api/src/index.ts`

**Step 1: Create the calendars router**

Create `packages/api/src/routes/calendars.ts`:

```typescript
import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { calendars, users } from '../db/schema.js';
import { createOAuth2Client, setCredentials, GoogleCalendarClient } from '../google/index.js';
import { decrypt } from '../crypto.js';
import type { Calendar } from '@reclaim/shared';
import { CalendarMode } from '@reclaim/shared';

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
    if (!userRows[0]?.googleRefreshToken) {
      res.status(400).json({ error: 'Google Calendar not connected' });
      return;
    }

    const oauth2Client = createOAuth2Client();
    const refreshToken = decrypt(userRows[0].googleRefreshToken);
    setCredentials(oauth2Client, refreshToken);
    const client = new GoogleCalendarClient(oauth2Client);

    const googleCalendars = await client.listCalendars();
    const now = new Date().toISOString();

    for (const gcal of googleCalendars) {
      const existing = db.select().from(calendars)
        .where(eq(calendars.googleCalendarId, gcal.googleCalendarId))
        .all();

      if (existing.length > 0) {
        // Update name and color from Google, keep user's mode/enabled
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
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const { mode, enabled } = req.body;

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

  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (mode !== undefined) {
    if (mode !== CalendarMode.Writable && mode !== CalendarMode.Locked) {
      res.status(400).json({ error: 'Mode must be "writable" or "locked"' });
      return;
    }
    updates.mode = mode;
  }
  if (enabled !== undefined) {
    updates.enabled = enabled;
  }

  db.update(calendars).set(updates).where(eq(calendars.id, id)).run();

  const updated = db.select().from(calendars).where(eq(calendars.id, id)).all();
  res.json(updated[0]);
});

export default router;
```

**Step 2: Register the route in index.ts**

In `packages/api/src/index.ts`, add the import (after line 54):

```typescript
import calendarsRouter from './routes/calendars.js';
```

Add the route registration (after line 156, the settings route):

```typescript
app.use('/api/calendars', calendarsRouter);
```

Also add `calendars` to the schema import on line 16:

```typescript
import {
  users,
  habits,
  tasks,
  smartMeetings,
  focusTimeRules,
  bufferConfig,
  scheduledEvents,
  calendars,
} from './db/schema.js';
```

**Step 3: Commit**

```bash
git add packages/api/src/routes/calendars.ts packages/api/src/index.ts
git commit -m "feat: add calendar discovery and management API routes"
```

---

### Task 6: Create CalendarPollerManager

**Files:**
- Create: `packages/api/src/google/poller-manager.ts`
- Modify: `packages/api/src/google/index.ts`

**Step 1: Create the poller manager**

Create `packages/api/src/google/poller-manager.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { calendars } from '../db/schema.js';
import { GoogleCalendarClient } from './calendar.js';
import { CalendarPoller } from './polling.js';
import type { CalendarEvent } from '@reclaim/shared';

/**
 * Manages one CalendarPoller per enabled calendar.
 * Provides methods to start/stop individual pollers when calendars
 * are enabled/disabled.
 */
export class CalendarPollerManager {
  private pollers = new Map<string, CalendarPoller>();

  constructor(
    private client: GoogleCalendarClient,
    private onChanges: (calendarId: string, events: CalendarEvent[]) => Promise<void>,
  ) {}

  /** Start pollers for all enabled calendars. */
  async startAll(): Promise<void> {
    const enabledCalendars = db.select().from(calendars)
      .where(eq(calendars.enabled, true))
      .all();

    for (const cal of enabledCalendars) {
      await this.startPoller(cal.id, cal.googleCalendarId);
    }
  }

  /** Start a poller for a specific calendar. */
  async startPoller(calId: string, googleCalendarId: string): Promise<void> {
    // Stop existing poller if any
    this.stopPoller(calId);

    const poller = new CalendarPoller(
      this.client,
      googleCalendarId,
      async (events) => {
        await this.onChanges(calId, events);
      },
      async () => {
        const rows = db.select().from(calendars)
          .where(eq(calendars.id, calId))
          .all();
        return rows[0]?.syncToken || null;
      },
      async (token) => {
        db.update(calendars)
          .set({ syncToken: token })
          .where(eq(calendars.id, calId))
          .run();
      },
    );

    await poller.start();
    this.pollers.set(calId, poller);
  }

  /** Stop a specific calendar's poller. */
  stopPoller(calId: string): void {
    const poller = this.pollers.get(calId);
    if (poller) {
      poller.stop();
      this.pollers.delete(calId);
    }
  }

  /** Stop all pollers. */
  stopAll(): void {
    for (const [calId] of this.pollers) {
      this.stopPoller(calId);
    }
  }

  /** Signal that we wrote to a specific calendar. */
  markWritten(calId: string): void {
    this.pollers.get(calId)?.markWritten();
  }

  /** Mark all pollers as written (used after rescheduling). */
  markAllWritten(): void {
    for (const poller of this.pollers.values()) {
      poller.markWritten();
    }
  }
}
```

**Step 2: Export from index.ts**

In `packages/api/src/google/index.ts`, add:

```typescript
export { CalendarPollerManager } from './poller-manager.js';
```

**Step 3: Commit**

```bash
git add packages/api/src/google/poller-manager.ts packages/api/src/google/index.ts
git commit -m "feat: add CalendarPollerManager for multi-calendar polling"
```

---

### Task 7: Update initPolling to use CalendarPollerManager

**Files:**
- Modify: `packages/api/src/index.ts`

**Step 1: Replace single CalendarPoller with CalendarPollerManager**

This is the most complex change. Replace the `initPolling` function and its surrounding code (lines 182-357 in `packages/api/src/index.ts`).

Key changes:
- Import `CalendarPollerManager` and `calendars` table
- Replace `calendarPoller: CalendarPoller | null` with `pollerManager: CalendarPollerManager | null`
- In `initPolling`, create a `CalendarPollerManager` instead of a single `CalendarPoller`
- The `onChanges` callback now receives a `calendarId` parameter
- When loading events for the engine, merge events from ALL enabled calendars
- Events from `locked` calendars get their status set to `EventStatus.Locked`
- When applying operations, route each operation to its `calendarId`
- After applying, `markAllWritten()` instead of a single `markWritten()`

Replace `export let calendarPoller: CalendarPoller | null = null;` (line 182) with:

```typescript
export let pollerManager: CalendarPollerManager | null = null;
```

Replace the `initPolling` function (lines 231-349) with:

```typescript
async function initPolling(): Promise<CalendarPollerManager | null> {
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
    async (_calendarId, _events) => {
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
          // Sync locked calendar events and add them as locked
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
      const habitGoogleCalId = habitCal[0]?.googleCalendarId || 'primary';
      const taskGoogleCalId = taskCal[0]?.googleCalendarId || 'primary';

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
```

Replace the init call (lines 351-357) with:

```typescript
initPolling()
  .then((manager) => {
    pollerManager = manager;
  })
  .catch((err) => {
    console.error('Polling init failed:', err);
  });
```

Also update the imports to include `CalendarPollerManager`:

```typescript
import { createOAuth2Client, setCredentials, GoogleCalendarClient, CalendarPollerManager } from './google/index.js';
```

**Step 2: Commit**

```bash
git add packages/api/src/index.ts
git commit -m "feat: use CalendarPollerManager for multi-calendar polling"
```

---

### Task 8: Wire calendar enable/disable to poller manager

**Files:**
- Modify: `packages/api/src/routes/calendars.ts`

**Step 1: Import pollerManager and restart pollers on toggle**

At the top of the calendars router, after existing imports:

```typescript
import { pollerManager } from '../index.js';
```

In the PATCH handler, after `db.update(calendars).set(updates)...`, add poller management:

```typescript
  // Start/stop poller when enabled state changes
  if (enabled !== undefined && pollerManager) {
    const cal = db.select().from(calendars).where(eq(calendars.id, id)).all()[0];
    if (enabled) {
      await pollerManager.startPoller(cal.id, cal.googleCalendarId);
    } else {
      pollerManager.stopPoller(cal.id);
    }
  }
```

Note: The PATCH handler needs to become `async`:

```typescript
router.patch('/:id', async (req, res) => {
```

**Step 2: Commit**

```bash
git add packages/api/src/routes/calendars.ts
git commit -m "feat: start/stop pollers when calendars are toggled"
```

---

### Task 9: Update settings route for default calendar fields

**Files:**
- Modify: `packages/api/src/routes/settings.ts`

**Step 1: Read the settings route**

Read: `packages/api/src/routes/settings.ts`

**Step 2: Allow `defaultHabitCalendarId` and `defaultTaskCalendarId` in PUT handler**

In the PUT handler, add the new fields to the settings update logic. They're optional string fields — just pass them through to the serialized JSON settings without special validation:

```typescript
if (req.body.defaultHabitCalendarId !== undefined) {
  newSettings.defaultHabitCalendarId = req.body.defaultHabitCalendarId;
}
if (req.body.defaultTaskCalendarId !== undefined) {
  newSettings.defaultTaskCalendarId = req.body.defaultTaskCalendarId;
}
```

**Step 3: Commit**

```bash
git add packages/api/src/routes/settings.ts
git commit -m "feat: support default calendar settings in settings API"
```

---

### Task 10: Add calendar management UI to settings page

**Files:**
- Modify: `packages/web/src/routes/settings/+page.svelte`

**Step 1: Read the current settings page**

Read: `packages/web/src/routes/settings/+page.svelte`

**Step 2: Add calendar management section**

Add a new section after the Google Account section. This section should:

1. Show a "Calendars" heading with a "Refresh" button that calls `GET /api/calendars/discover`
2. List all calendars from `GET /api/calendars` with:
   - Color dot (from `calendar.color`)
   - Calendar name
   - Toggle switch for enabled/disabled
   - Dropdown for mode (writable/locked) — only shown when enabled
   - Primary calendar shows "(Primary)" badge and cannot be disabled or locked
3. Show default calendar dropdowns:
   - "Default Habit Calendar" — dropdown of writable+enabled calendars
   - "Default Task Calendar" — dropdown of writable+enabled calendars
   - These update via `PUT /api/settings` with `defaultHabitCalendarId`/`defaultTaskCalendarId`

Use the existing patterns from the settings page:
- Same section card styling
- Same save feedback pattern
- API calls use the same `API_BASE` pattern

The calendar list should be fetched on page load and after discovery. Toggle/mode changes call `PATCH /api/calendars/:id`.

**Step 3: Commit**

```bash
git add packages/web/src/routes/settings/+page.svelte
git commit -m "feat: add calendar management UI to settings page"
```

---

### Task 11: Update schedule route to include calendarId

**Files:**
- Modify: `packages/api/src/routes/schedule.ts`

**Step 1: Read the schedule route**

Read: `packages/api/src/routes/schedule.ts`

**Step 2: Ensure calendarId is included in schedule responses**

When returning scheduled events from `GET /api/schedule`, include the `calendarId` field from the database row so the frontend knows which calendar each event belongs to.

**Step 3: Commit**

```bash
git add packages/api/src/routes/schedule.ts
git commit -m "feat: include calendarId in schedule API responses"
```

---

### Task 12: Add engine test for locked calendar events

**Files:**
- Modify: `packages/engine/src/__tests__/scheduler.test.ts`

**Step 1: Write a test that verifies locked external events are treated as immovable**

Add a test case to `scheduler.test.ts` that:
1. Creates a habit that wants to schedule at 10:00
2. Adds a locked CalendarEvent at 10:00-11:00 (simulating a uni timetable event)
3. Runs `reschedule()`
4. Asserts the habit is NOT placed at 10:00-11:00 (it should find another slot)

```typescript
it('should schedule around locked external calendar events', () => {
  const habits: Habit[] = [{
    id: 'habit-1',
    name: 'Study',
    priority: Priority.Medium,
    windowStart: '09:00',
    windowEnd: '17:00',
    idealTime: '10:00',
    durationMin: 60,
    durationMax: 60,
    frequency: Frequency.Daily,
    frequencyConfig: { days: ['mon'] },
    schedulingHours: SchedulingHours.Working,
    locked: false,
    autoDecline: false,
    dependsOn: null,
    enabled: true,
    createdAt: '',
    updatedAt: '',
  }];

  // Simulated uni timetable event (locked, not managed by us)
  const lockedEvent: CalendarEvent = {
    id: 'uni-lecture',
    googleEventId: 'uni-lecture-gcal',
    title: 'CS101 Lecture',
    start: new Date(2026, 2, 2, 10, 0).toISOString(),  // Monday 10:00
    end: new Date(2026, 2, 2, 11, 0).toISOString(),    // Monday 11:00
    isManaged: false,
    itemType: null,
    itemId: null,
    status: EventStatus.Locked,
  };

  const result = reschedule(
    habits, [], [], [], [lockedEvent], defaultBuffer, defaultSettings,
    new Date(2026, 2, 2, 8, 0),
  );

  // The habit should be placed, but NOT overlapping the locked event
  const createOps = result.operations.filter(op => op.type === CalendarOpType.Create);
  expect(createOps.length).toBeGreaterThan(0);

  for (const op of createOps) {
    const opStart = new Date(op.start);
    const opEnd = new Date(op.end);
    const lockStart = new Date(2026, 2, 2, 10, 0);
    const lockEnd = new Date(2026, 2, 2, 11, 0);
    // No overlap: op ends before lock starts, or op starts after lock ends
    const overlaps = opStart < lockEnd && opEnd > lockStart;
    expect(overlaps).toBe(false);
  }
});
```

**Step 2: Run the test**

```bash
cd packages/engine && pnpm test
```

Expected: PASS (the engine already treats non-managed events and locked events as fixed)

**Step 3: Commit**

```bash
git add packages/engine/src/__tests__/scheduler.test.ts
git commit -m "test: verify scheduling around locked external calendar events"
```

---

### Task 13: Handle error cases — deleted calendars, missing defaults

**Files:**
- Modify: `packages/api/src/routes/calendars.ts`
- Modify: `packages/api/src/index.ts`

**Step 1: Add fallback logic for missing default calendars**

In `packages/api/src/index.ts`, in the `onChanges` callback where we look up default calendar IDs, add fallback:

```typescript
// If the configured default calendar doesn't exist or is disabled, fall back to primary
const habitCalRow = habitCal[0];
const habitGoogleCalId = (habitCalRow?.enabled && habitCalRow?.mode === 'writable')
  ? habitCalRow.googleCalendarId
  : 'primary';
```

Same pattern for `taskCal`.

**Step 2: In the calendars PATCH route, reset defaults if a calendar being disabled was a default**

After disabling a calendar, check if it was the default for habits or tasks. If so, reset the default to 'primary' in user settings.

**Step 3: Commit**

```bash
git add packages/api/src/routes/calendars.ts packages/api/src/index.ts
git commit -m "fix: fallback to primary calendar when defaults are unavailable"
```

---

### Task 14: Final integration test — manual verification

**Step 1: Start the dev server**

```bash
pnpm dev
```

**Step 2: Verify calendar discovery**

1. Ensure Google Calendar is connected
2. Navigate to Settings
3. Click "Refresh Calendars" — should show all Google Calendars
4. Toggle a calendar to enabled/locked
5. Verify habits schedule around locked calendar events

**Step 3: Verify default calendar assignment**

1. Set a writable calendar as default for habits
2. Create a habit
3. Trigger reschedule
4. Verify the event appears on the correct Google Calendar

---
