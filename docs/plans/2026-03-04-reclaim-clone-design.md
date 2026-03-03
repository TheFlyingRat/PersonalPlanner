# Reclaim Clone - Self-Hosted Calendar Optimizer

## Overview

A self-hosted clone of Reclaim.ai that auto-schedules habits, tasks, meetings, and focus time on Google Calendar. When a user adds a manual event that conflicts with a flexible item, everything reshuffles optimally based on priority.

## Decisions

| Decision | Choice |
|----------|--------|
| Calendar provider | Google Calendar |
| Feature scope | Full parity with Reclaim (phased) |
| Backend | TypeScript, Express, Node.js |
| Frontend | SvelteKit (static adapter, no SSR) |
| Database | SQLite + Drizzle ORM |
| Hosting | Self-hosted Docker (single container) |
| Calendar sync method | Polling (15s interval, incremental sync) |
| Users | Single-user |
| Architecture | Monorepo (pnpm workspaces), single Docker image |

## Architecture

```
packages/
  engine/     -- Pure TypeScript scheduling engine (no I/O)
  api/        -- Express REST API (polls GCal, runs engine, writes back)
  web/        -- SvelteKit static SPA
```

Single Docker container: Express serves the API + static SvelteKit build. SQLite DB stored in a Docker volume.

## Scheduling Engine

### Core Algorithm: Priority-Based Constraint Solver

Input: `(currentCalendarEvents, habits, tasks, meetings, focusRules, bufferConfig, userConfig)`
Output: `CalendarOperation[]` (create/update/delete events on Google Calendar)

```
function reschedule(allItems, calendarEvents, userConfig):
  1. Separate fixed events (manual, locked) from flexible items
  2. Sort flexible items by: priority DESC, then type order (Meeting > Habit > Task > Focus)
  3. Build a timeline of the scheduling window (today + N days)
  4. Mark fixed events as occupied slots
  5. For each flexible item (highest priority first):
     a. Generate candidate slots within its time window
     b. Score each slot:
        - Proximity to ideal time (highest weight)
        - Continuity with related items
        - Buffer compliance (travel, decompression, breaks)
        - Habit dependencies satisfied
     c. Place in highest-scoring available slot
     d. If no slot available: mark as unschedulable for that period
  6. Apply Free/Busy logic:
     - Count remaining alternative slots for each placed item
     - If alternatives < threshold OR start time approaching: flip to Busy
  7. Diff against current calendar state
  8. Return minimal set of create/update/delete operations
```

### Priority System

| Priority | Level | Behavior |
|----------|-------|----------|
| P1 | Critical | Manual calendar events default here. Scheduled first. |
| P2 | High | Scheduled before P3/P4. Displaced by P1. |
| P3 | Medium | Scheduled before P4. Displaced by P1/P2. |
| P4 | Low | Scheduled last. Displaced by everything. |

Within same priority: Smart Meetings > Habits > Tasks > Focus Time.

Tasks at same priority: sooner due dates scheduled first.

### Free/Busy/Locked States

- **Free** (prefix `🟢`): Flexible, auto-reschedules on conflict. Others see time as available.
- **Busy** (prefix `🛡️`): Defended. Still auto-managed but shown as busy. Flipped when schedule pressure is high.
- **Locked** (prefix `🔒`): User manually locked. Will NOT auto-reschedule.

Flip logic: `remainingAlternativeSlots < 2 OR timeUntilStart < 2 hours` -> flip to Busy.

## Google Calendar Integration

### Auth
- One-time OAuth2 flow on first setup
- Refresh token stored in SQLite (encrypted with local key)
- Auto-refresh access tokens

### Polling Loop

```
Every 15 seconds:
  1. Fetch events via incremental sync (syncToken)
  2. Diff against local event cache
  3. If changes detected:
     a. Update local cache
     b. Run scheduling engine
     c. Apply operations to Google Calendar
  4. Store new syncToken
```

### Event Identification
- Extended properties on Google Calendar events store: `reclaimId`, `itemType`, `itemId`, `status`
- `lastModifiedByUs` timestamp prevents reacting to our own changes
- Debounce: skip next poll after writing changes

## Database Schema (SQLite + Drizzle)

### users
```
id TEXT PRIMARY KEY
googleRefreshToken TEXT (encrypted)
googleSyncToken TEXT
settings JSON
createdAt DATETIME
```

### habits
```
id TEXT PRIMARY KEY
name TEXT NOT NULL
priority INTEGER DEFAULT 3 (1-4)
windowStart TEXT (HH:MM)
windowEnd TEXT (HH:MM)
idealTime TEXT (HH:MM)
durationMin INTEGER (minutes)
durationMax INTEGER (minutes)
frequency TEXT (daily|weekly|monthly|custom)
frequencyConfig JSON
schedulingHours TEXT (working|personal|custom)
locked BOOLEAN DEFAULT false
autoDecline BOOLEAN DEFAULT false
dependsOn TEXT (FK habits.id)
enabled BOOLEAN DEFAULT true
createdAt DATETIME
updatedAt DATETIME
```

### tasks
```
id TEXT PRIMARY KEY
name TEXT NOT NULL
priority INTEGER DEFAULT 2 (1-4)
totalDuration INTEGER (minutes)
remainingDuration INTEGER (minutes)
dueDate DATETIME
earliestStart DATETIME
chunkMin INTEGER DEFAULT 15 (minutes)
chunkMax INTEGER DEFAULT 120 (minutes)
schedulingHours TEXT
status TEXT (open|done_scheduling|completed)
isUpNext BOOLEAN DEFAULT false
createdAt DATETIME
updatedAt DATETIME
```

### smart_meetings
```
id TEXT PRIMARY KEY
name TEXT NOT NULL
priority INTEGER DEFAULT 2
attendees JSON
duration INTEGER (minutes)
frequency TEXT
idealTime TEXT (HH:MM)
windowStart TEXT (HH:MM)
windowEnd TEXT (HH:MM)
location TEXT
conferenceType TEXT
createdAt DATETIME
updatedAt DATETIME
```

### focus_time_rules
```
id TEXT PRIMARY KEY
weeklyTargetMinutes INTEGER
dailyTargetMinutes INTEGER
schedulingHours TEXT
enabled BOOLEAN DEFAULT true
createdAt DATETIME
updatedAt DATETIME
```

### buffer_config
```
id TEXT PRIMARY KEY
travelTimeMinutes INTEGER DEFAULT 15
decompressionMinutes INTEGER DEFAULT 10
breakBetweenItemsMinutes INTEGER DEFAULT 5
applyDecompressionTo TEXT DEFAULT 'all' (all|video_only)
```

### scheduled_events
```
id TEXT PRIMARY KEY
itemType TEXT (habit|task|meeting|focus)
itemId TEXT
googleEventId TEXT
start DATETIME
end DATETIME
status TEXT (free|busy|locked)
alternativeSlotsCount INTEGER
createdAt DATETIME
updatedAt DATETIME
```

### scheduling_links
```
id TEXT PRIMARY KEY
slug TEXT UNIQUE
name TEXT NOT NULL
durations JSON ([15, 30, 60])
schedulingHours TEXT
priority INTEGER DEFAULT 3
enabled BOOLEAN DEFAULT true
createdAt DATETIME
updatedAt DATETIME
```

## API Routes

```
Auth:
  POST   /api/auth/google           -- initiate OAuth flow
  GET    /api/auth/google/callback   -- OAuth callback

Habits:
  GET    /api/habits                 -- list all
  POST   /api/habits                 -- create
  PUT    /api/habits/:id             -- update
  DELETE /api/habits/:id             -- delete
  POST   /api/habits/:id/lock        -- lock/unlock toggle

Tasks:
  GET    /api/tasks                  -- list all
  POST   /api/tasks                  -- create
  PUT    /api/tasks/:id              -- update
  DELETE /api/tasks/:id              -- delete
  POST   /api/tasks/:id/complete     -- mark complete
  POST   /api/tasks/:id/up-next      -- toggle up-next

Smart Meetings:
  GET    /api/meetings               -- list all
  POST   /api/meetings               -- create
  PUT    /api/meetings/:id           -- update
  DELETE /api/meetings/:id           -- delete

Focus Time:
  GET    /api/focus-time             -- get config
  PUT    /api/focus-time             -- update config

Buffers:
  GET    /api/buffers                -- get config
  PUT    /api/buffers                -- update config

Schedule:
  GET    /api/schedule               -- current schedule state
  POST   /api/schedule/reschedule    -- force immediate reschedule

Scheduling Links:
  GET    /api/links                  -- list links
  POST   /api/links                  -- create link
  GET    /api/links/:slug/slots      -- get available slots (public)
  POST   /api/links/:slug/book       -- book a slot (public)

Analytics:
  GET    /api/analytics              -- overall stats
  GET    /api/analytics/weekly       -- weekly summary
```

## Frontend (SvelteKit Static SPA)

### Pages
- `/` -- Dashboard with week calendar view, all items color-coded
- `/habits` -- Manage habits (list + create/edit modals)
- `/tasks` -- Task planner (sortable list + timeline)
- `/meetings` -- Smart meetings management
- `/focus` -- Focus time settings + progress
- `/links` -- Scheduling links management
- `/analytics` -- Charts and stats
- `/settings` -- Google account, buffers, scheduling hours, preferences

### UI
- shadcn-svelte (Tailwind-based components)
- Custom calendar grid component (week view)
- Color coding: Habits (green), Tasks (blue), Meetings (purple), Focus (orange), Manual (gray)
- Drag-to-create and drag-to-resize on calendar
- Visual Free/Busy/Locked indicators

## Implementation Phases

### Phase 1: Core (Engine + Habits + GCal)
- Project scaffolding (monorepo, TypeScript, build tooling)
- Scheduling engine with habit placement algorithm
- Google Calendar OAuth + polling + sync
- Habit CRUD API + basic frontend
- Free/Busy flip logic
- Docker setup

### Phase 2: Tasks
- Task data model + CRUD API
- Engine: task chunking and deadline-aware scheduling
- Task planner UI
- Up Next feature
- Completion tracking

### Phase 3: Focus Time + Buffers
- Focus time rules and engine integration
- Buffer configuration (travel, decompression, breaks)
- Engine: buffer-aware scheduling
- Focus time progress tracking UI

### Phase 4: Smart Meetings + Scheduling Links
- Smart meeting scheduling
- Scheduling link generation and public booking
- Meeting priority escalation logic

### Phase 5: Analytics + Polish
- Analytics dashboard
- Weekly summaries
- UI polish, drag-and-drop, responsive design
- Performance optimization

## Docker

Single-stage build producing a small Alpine-based image:
```dockerfile
FROM node:22-alpine
# Build all packages
# Copy API + static web build
# Expose port 3000
# CMD: node packages/api/dist/index.js
```

Volume mount for SQLite database file: `-v ./data:/app/data`
