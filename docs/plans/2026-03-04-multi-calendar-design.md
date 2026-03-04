# Multi-Calendar Support Design

## Overview

Add support for multiple Google Calendars within the same Google account. Users can discover all their calendars, toggle them on/off, and set each as either **writable** (Reclaim can place events) or **locked** (events are immovable constraints the engine schedules around).

## Data Model

### New `calendars` table

| Column             | Type    | Description                                          |
|--------------------|---------|------------------------------------------------------|
| `id`               | text PK | Internal UUID                                        |
| `googleCalendarId` | text    | Google Calendar ID (e.g., `primary`, `abc@group...`) |
| `name`             | text    | Display name (from Google)                           |
| `color`            | text    | Hex color (from Google)                              |
| `mode`             | text    | `writable` or `locked`                               |
| `enabled`          | boolean | Whether the engine considers this calendar           |
| `syncToken`        | text    | Per-calendar incremental sync token                  |

### Changes to existing tables

- **`scheduledEvents`**: Add `calendarId` column (FK to `calendars.id`) — tracks which calendar each event lives on.
- **`users`**: `googleSyncToken` becomes obsolete (sync tokens move to `calendars` table).

### Changes to `UserSettings`

- Add `defaultHabitCalendarId: string` — which writable calendar habits are placed on.
- Add `defaultTaskCalendarId: string` — which writable calendar tasks are placed on.
- Both default to the `primary` calendar.

## Google Calendar Discovery

### New API endpoints

- **`GET /api/calendars/discover`** — Calls Google `calendarList.list()`, returns all calendars. Upserts into `calendars` table (matched by `googleCalendarId`).
- **`GET /api/calendars`** — List all saved calendars with mode/enabled state.
- **`PATCH /api/calendars/:id`** — Update `mode` or `enabled` toggle.

### Constraints

- The `primary` calendar is auto-created on first auth and cannot be disabled or set to locked.
- Discovery can be triggered manually ("Refresh calendars" button) or runs automatically on first auth.

## Polling Changes

Currently: single `CalendarPoller` for `primary` with one sync token.

### New: `CalendarPollerManager`

- Manages one `CalendarPoller` instance per enabled calendar.
- Each poller uses the `syncToken` from its `calendars` row.
- When a calendar is enabled/disabled via the API, the manager starts/stops the corresponding poller.
- Locked calendar pollers are read-only — they feed events into the engine as immovable busy time.
- Writable calendar pollers work like the current primary poller — detect external changes and trigger rescheduling.

## Engine Changes

Minimal changes needed:

1. **Input**: The API layer merges events from all enabled calendars into a single `CalendarEvent[]` before calling `reschedule()`. Events from locked calendars are marked with `locked: true`.
2. **Output**: `CalendarOperation` gains a `calendarId` field so `applyOperations()` writes to the correct Google Calendar.
3. The engine itself remains calendar-agnostic — it just sees events and schedule items.

## Frontend

### Settings page additions

- **Calendar management section**: List of discovered calendars with:
  - Toggle switch (enabled/disabled)
  - Mode selector (writable / locked)
  - Color indicator and name from Google
- **Default calendar dropdowns**: For habits and tasks, dropdown of writable calendars.
- **"Refresh calendars" button**: Re-runs discovery.

### No changes to habit/task creation forms

Items inherit the default calendar from settings.

## Error Handling

- **Calendar deleted from Google**: Poller gets errors, calendar is marked disabled, user notified.
- **Default calendar disabled/deleted**: Falls back to `primary`.
- **Locked calendar event cancelled**: Removed from engine's busy-time view on next poll.
