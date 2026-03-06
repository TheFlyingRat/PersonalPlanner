import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { calendars, calendarEvents } from '../db/schema.js';
import { GoogleCalendarClient } from './calendar.js';
import { CalendarPoller } from './polling.js';
import type { CalendarEvent } from '@cadence/shared';

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

  /** Start a poller for a specific calendar. Also does an initial event cache. */
  async startPoller(calId: string, googleCalendarId: string): Promise<void> {
    // Stop existing poller if any
    this.stopPoller(calId);

    // Initial sync: fetch all events and cache them immediately
    try {
      const calRow = db.select().from(calendars)
        .where(eq(calendars.id, calId)).all()[0];
      const syncResult = await this.client.syncEvents(
        googleCalendarId,
        calRow?.syncToken || null,
      );

      // Store sync token
      if (syncResult.nextSyncToken) {
        db.update(calendars)
          .set({ syncToken: syncResult.nextSyncToken })
          .where(eq(calendars.id, calId))
          .run();
      }

      // Cache external events only (skip Cadence-managed ones, they live in scheduledEvents)
      const now = new Date().toISOString();
      db.delete(calendarEvents)
        .where(eq(calendarEvents.calendarId, calId))
        .run();
      for (const ev of syncResult.events) {
        if (ev.isManaged) continue;
        if (ev.start && ev.end && ev.title) {
          db.insert(calendarEvents).values({
            id: crypto.randomUUID(),
            calendarId: calId,
            googleEventId: ev.googleEventId || '',
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
      console.log(`[poller] Cached ${syncResult.events.length} events for calendar ${calId}`);
    } catch (err) {
      console.error(`[poller] Initial sync failed for ${calId}:`, err);
    }

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

  /** Stop a specific calendar's poller and clear cached events. */
  stopPoller(calId: string): void {
    const poller = this.pollers.get(calId);
    if (poller) {
      poller.stop();
      this.pollers.delete(calId);
    }
    // Clear cached events for this calendar
    db.delete(calendarEvents)
      .where(eq(calendarEvents.calendarId, calId))
      .run();
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
