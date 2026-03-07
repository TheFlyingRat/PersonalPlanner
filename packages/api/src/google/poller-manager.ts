import { eq, and } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { calendars, calendarEvents } from '../db/pg-schema.js';
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
  private userId: string;

  constructor(
    private client: GoogleCalendarClient,
    private onChanges: (calendarId: string, events: CalendarEvent[]) => Promise<void>,
    userId?: string,
    private onAuthError?: () => Promise<void>,
  ) {
    this.userId = userId || '';
  }

  /** Start pollers for all enabled calendars (scoped to user if userId set). */
  async startAll(): Promise<void> {
    const query = this.userId
      ? and(eq(calendars.userId, this.userId), eq(calendars.enabled, true))
      : eq(calendars.enabled, true);
    const enabledCalendars = await db.select().from(calendars)
      .where(query!);

    for (const cal of enabledCalendars) {
      await this.startPoller(cal.id, cal.googleCalendarId);
    }
  }

  /** Start a poller for a specific calendar. Also does an initial event cache. */
  async startPoller(calId: string, googleCalendarId: string): Promise<void> {
    // Stop existing poller if any
    await this.stopPoller(calId);

    // Initial sync: fetch all events and cache them immediately
    try {
      const calRows = await db.select().from(calendars)
        .where(eq(calendars.id, calId));
      const calRow = calRows[0];
      const syncResult = await this.client.syncEvents(
        googleCalendarId,
        calRow?.syncToken || null,
      );

      // Store sync token
      if (syncResult.nextSyncToken) {
        await db.update(calendars)
          .set({ syncToken: syncResult.nextSyncToken })
          .where(eq(calendars.id, calId));
      }

      // Cache external events only (skip Cadence-managed ones, they live in scheduledEvents)
      const now = new Date().toISOString();
      await db.delete(calendarEvents)
        .where(eq(calendarEvents.calendarId, calId));
      for (const ev of syncResult.events) {
        if (ev.isManaged) continue;
        if (ev.start && ev.end && ev.title) {
          await db.insert(calendarEvents).values({
            userId: this.userId,
            calendarId: calId,
            googleEventId: ev.googleEventId || '',
            title: ev.title,
            start: ev.start,
            end: ev.end,
            status: ev.status || 'busy',
            location: ev.location || null,
            isAllDay: !ev.start.includes('T'),
            updatedAt: now,
          });
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
        const rows = await db.select().from(calendars)
          .where(eq(calendars.id, calId));
        return rows[0]?.syncToken || null;
      },
      async (token) => {
        await db.update(calendars)
          .set({ syncToken: token })
          .where(eq(calendars.id, calId));
      },
      this.onAuthError,
    );

    await poller.start();
    this.pollers.set(calId, poller);
  }

  /** Stop a specific calendar's poller and clear cached events. */
  async stopPoller(calId: string): Promise<void> {
    const poller = this.pollers.get(calId);
    if (poller) {
      poller.stop();
      this.pollers.delete(calId);
    }
    // Clear cached events for this calendar
    await db.delete(calendarEvents)
      .where(eq(calendarEvents.calendarId, calId));
  }

  /** Stop all pollers. */
  stopAll(): void {
    for (const [, poller] of this.pollers) {
      poller.stop();
    }
    this.pollers.clear();
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
