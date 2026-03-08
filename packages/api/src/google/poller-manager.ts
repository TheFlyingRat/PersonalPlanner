import { randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { calendars, calendarEvents } from '../db/pg-schema.js';
import { GoogleCalendarClient } from './calendar.js';
import { CalendarPoller } from './polling.js';
import type { CalendarEvent } from '@cadence/shared';
import { PUSH_FALLBACK_POLL_MS, WATCH_TTL_MS, WATCH_RENEWAL_BUFFER_MS } from '@cadence/shared';

/**
 * Manages one CalendarPoller per enabled calendar.
 * Provides methods to start/stop individual pollers when calendars
 * are enabled/disabled.
 */
export class CalendarPollerManager {
  private pollers = new Map<string, CalendarPoller>();
  private userId: string;
  private renewalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private client: GoogleCalendarClient,
    private onChanges: (calendarId: string, events: CalendarEvent[]) => Promise<void>,
    userId?: string,
    private onAuthError?: () => Promise<void>,
    private webhookBaseUrl?: string,
  ) {
    this.userId = userId || '';
  }

  get isPushMode(): boolean {
    return !!this.webhookBaseUrl;
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

    this.startRenewalTimer();
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
      const externalEvents = syncResult.events.filter(
        ev => !ev.isManaged && ev.start && ev.end && ev.title,
      );
      await db.transaction(async (tx) => {
        await tx.delete(calendarEvents)
          .where(and(eq(calendarEvents.calendarId, calId), eq(calendarEvents.userId, this.userId)));
        if (externalEvents.length > 0) {
          await tx.insert(calendarEvents).values(externalEvents.map(ev => ({
            userId: this.userId,
            calendarId: calId,
            googleEventId: ev.googleEventId || '',
            title: ev.title!,
            start: ev.start!,
            end: ev.end!,
            status: ev.status || 'busy',
            location: ev.location || null,
            isAllDay: !ev.start!.includes('T'),
            updatedAt: now,
          })));
        }
      });
      console.log(`[poller] Cached ${syncResult.events.length} events for calendar ${calId}`);
    } catch (err) {
      console.error(`[poller] Initial sync failed for ${calId}:`, err);
    }

    // Register watch channel in push mode
    let watchRegistered = false;
    if (this.webhookBaseUrl) {
      try {
        const channelId = randomUUID();
        const token = randomUUID();
        const address = `${this.webhookBaseUrl}/api/webhooks/google-calendar`;

        const watch = await this.client.watchEvents(
          googleCalendarId,
          address,
          channelId,
          token,
          WATCH_TTL_MS,
        );

        await db.update(calendars)
          .set({
            watchChannelId: channelId,
            watchResourceId: watch.resourceId,
            watchToken: token,
            watchExpiresAt: watch.expiration,
          })
          .where(eq(calendars.id, calId));

        watchRegistered = true;
        console.log(`[poller] Push channel registered for calendar ${calId}, expires ${watch.expiration}`);
      } catch (err) {
        console.error(`[poller] Failed to register push channel for ${calId}, falling back to polling:`, err);
      }
    }

    // Use longer fallback interval in push mode (5min vs 15s)
    const intervalMs = watchRegistered ? PUSH_FALLBACK_POLL_MS : undefined;

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
      intervalMs,
    );

    await poller.start();
    this.pollers.set(calId, poller);
  }

  /** Stop a specific calendar's poller and clear cached events. */
  async stopPoller(calId: string): Promise<void> {
    const poller = this.pollers.get(calId);
    if (poller) {
      poller.stop();

      // Stop push channel if active
      if (this.userId) {
        try {
          const calRows = await db.select().from(calendars).where(eq(calendars.id, calId));
          const cal = calRows[0];
          if (cal?.watchChannelId && cal?.watchResourceId) {
            await this.client.stopWatch(cal.watchChannelId, cal.watchResourceId);
            await db.update(calendars)
              .set({ watchChannelId: null, watchResourceId: null, watchToken: null, watchExpiresAt: null })
              .where(eq(calendars.id, calId));
            console.log(`[poller] Push channel stopped for calendar ${calId}`);
          }
        } catch (err) {
          console.error(`[poller] Failed to stop push channel for ${calId}:`, err);
        }
      }

      this.pollers.delete(calId);
    }
    // Clear cached events for this calendar (scoped to user)
    if (this.userId) {
      await db.delete(calendarEvents)
        .where(and(eq(calendarEvents.calendarId, calId), eq(calendarEvents.userId, this.userId)));
    } else {
      await db.delete(calendarEvents)
        .where(eq(calendarEvents.calendarId, calId));
    }
  }

  /** Stop all pollers and deregister push channels. */
  async stopAll(): Promise<void> {
    this.stopRenewalTimer();
    for (const [calId, poller] of this.pollers) {
      poller.stop();
      // Deregister push channel if active
      if (this.userId) {
        try {
          const calRows = await db.select().from(calendars).where(eq(calendars.id, calId));
          const cal = calRows[0];
          if (cal?.watchChannelId && cal?.watchResourceId) {
            await this.client.stopWatch(cal.watchChannelId, cal.watchResourceId);
            await db.update(calendars)
              .set({ watchChannelId: null, watchResourceId: null, watchToken: null, watchExpiresAt: null })
              .where(eq(calendars.id, calId));
          }
        } catch (err) {
          console.error(`[poller] Failed to stop push channel for ${calId} during shutdown:`, err);
        }
      }
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

  /** Handle a push notification by triggering immediate sync on the target calendar. */
  handleWebhookNotification(calId: string): void {
    const poller = this.pollers.get(calId);
    if (poller) {
      poller.triggerSync();
    } else {
      console.warn(`[poller] Webhook notification for unknown calendar: ${calId}`);
    }
  }

  /** Start periodic check for expiring watch channels (every 30 min). */
  startRenewalTimer(): void {
    if (!this.webhookBaseUrl) return;

    this.renewalTimer = setInterval(() => {
      void this.renewExpiringChannels();
    }, 30 * 60 * 1000);
  }

  /** Stop the renewal timer. */
  stopRenewalTimer(): void {
    if (this.renewalTimer) {
      clearInterval(this.renewalTimer);
      this.renewalTimer = null;
    }
  }

  private async renewExpiringChannels(): Promise<void> {
    if (!this.userId || !this.webhookBaseUrl) return;

    try {
      const userCals = await db.select().from(calendars)
        .where(eq(calendars.userId, this.userId));

      const now = Date.now();
      for (const cal of userCals) {
        if (!cal.watchExpiresAt || !cal.watchChannelId) continue;

        const expiresAt = new Date(cal.watchExpiresAt).getTime();
        if (expiresAt - now > WATCH_RENEWAL_BUFFER_MS) continue;

        console.log(`[poller] Renewing push channel for calendar ${cal.id} (expires ${cal.watchExpiresAt})`);

        // Stop old channel
        try {
          if (cal.watchResourceId) {
            await this.client.stopWatch(cal.watchChannelId, cal.watchResourceId);
          }
        } catch (err) {
          console.warn(`[poller] Failed to stop old channel for ${cal.id}:`, err);
        }

        // Create new channel
        try {
          const channelId = randomUUID();
          const token = randomUUID();
          const address = `${this.webhookBaseUrl}/api/webhooks/google-calendar`;

          const watch = await this.client.watchEvents(
            cal.googleCalendarId,
            address,
            channelId,
            token,
            WATCH_TTL_MS,
          );

          await db.update(calendars)
            .set({
              watchChannelId: channelId,
              watchResourceId: watch.resourceId,
              watchToken: token,
              watchExpiresAt: watch.expiration,
            })
            .where(eq(calendars.id, cal.id));

          console.log(`[poller] Push channel renewed for calendar ${cal.id}, expires ${watch.expiration}`);
        } catch (err) {
          console.error(`[poller] Failed to renew push channel for ${cal.id}, restarting with polling fallback:`, err);
          // Clear stale watch data and restart poller (will fall back to 15s polling)
          await db.update(calendars)
            .set({ watchChannelId: null, watchResourceId: null, watchToken: null, watchExpiresAt: null })
            .where(eq(calendars.id, cal.id));
          await this.startPoller(cal.id, cal.googleCalendarId);
        }
      }
    } catch (err) {
      console.error(`[poller] Channel renewal check failed:`, err);
    }
  }
}
