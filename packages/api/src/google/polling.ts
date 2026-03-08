import { POLL_INTERVAL_MS } from '@cadence/shared';
import type { CalendarEvent } from '@cadence/shared';
import { GoogleCalendarClient } from './calendar.js';

function isGoogleApiError(err: unknown): err is { code: number; message?: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

/**
 * Polls Google Calendar at a fixed interval and invokes a callback when
 * external changes (not originating from our own writes) are detected.
 */
export class CalendarPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private syncToken: string | null = null;
  private skipNextPoll = false;
  private lastEventsById: Map<string, CalendarEvent> = new Map();
  private isPolling = false;

  /**
   * @param client           Authenticated GoogleCalendarClient.
   * @param calendarId       The Google calendar to poll (defaults to 'primary').
   * @param onChanges        Called with the full set of changed events whenever
   *                         external modifications are detected.
   * @param getSyncToken     Load the persisted sync token (e.g. from DB).
   * @param saveSyncToken    Persist a new sync token after each successful poll.
   * @param onAuthError      Called when a 401 error is detected (token revoked).
   */
  constructor(
    private client: GoogleCalendarClient,
    private calendarId: string = 'primary',
    private onChanges: (events: CalendarEvent[]) => Promise<void>,
    private getSyncToken: () => Promise<string | null>,
    private saveSyncToken: (token: string) => Promise<void>,
    private onAuthError?: () => Promise<void>,
    private intervalMs: number = POLL_INTERVAL_MS,
  ) {}

  /** Start the initial sync and begin the polling interval. */
  async start(): Promise<void> {
    this.syncToken = await this.getSyncToken();

    // Initial full/incremental sync
    await this.poll();

    this.intervalId = setInterval(() => {
      void this.poll();
    }, this.intervalMs);
  }

  /** Stop polling. */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Trigger an immediate sync cycle (used by push notification webhook). */
  triggerSync(): void {
    void this.poll();
  }

  /**
   * Signal that we just wrote changes to the calendar.
   * The next poll cycle will be skipped to prevent a feedback loop where we
   * react to our own modifications.
   */
  markWritten(): void {
    this.skipNextPoll = true;
  }

  // ---------------------------------------------------------------------------

  private async poll(): Promise<void> {
    // Guard against overlapping polls (in case a poll takes longer than the interval)
    if (this.isPolling) {
      return;
    }

    if (this.skipNextPoll) {
      this.skipNextPoll = false;
      return;
    }

    this.isPolling = true;

    try {
      const result = await this.client.syncEvents(this.calendarId, this.syncToken);

      this.syncToken = result.nextSyncToken;
      await this.saveSyncToken(result.nextSyncToken);

      const externalChanges = this.filterExternalChanges(result.events);

      // Update our local snapshot (cap size to prevent memory leak)
      const MAX_EVENTS_CACHE = 10000;
      if (this.lastEventsById.size > MAX_EVENTS_CACHE) {
        this.lastEventsById.clear();
      }
      for (const event of result.events) {
        if (event.googleEventId) {
          this.lastEventsById.set(event.googleEventId, event);
        }
      }

      if (externalChanges.length > 0) {
        await this.onChanges(externalChanges);
      }
    } catch (error) {
      // EDGE-H4: Handle 401 (token revoked) by notifying the caller
      if (isGoogleApiError(error) && error.code === 401) {
        console.error('[poller] Google auth error (401) — token likely revoked');
        this.stop();
        if (this.onAuthError) {
          await this.onAuthError();
        }
        return;
      }

      console.error('[poller] Poll error:', error);

      // If the sync token has gone stale, clear it so the next poll does a
      // full sync automatically (syncEvents already handles 410 internally,
      // but this is a safety net for unexpected failures).
      if (isGoneError(error)) {
        this.syncToken = null;
      }
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Filter out events that haven't changed since the last poll cycle.
   * Compares each event against the `lastEventsById` snapshot — if
   * all tracked fields are identical, the event is dropped.
   */
  private filterExternalChanges(events: CalendarEvent[]): CalendarEvent[] {
    return events.filter((event) => {
      // Events without a googleEventId are malformed; skip them
      if (!event.googleEventId) {
        return false;
      }

      // If we've seen this event before and nothing changed, filter it out
      const previous = this.lastEventsById.get(event.googleEventId);
      if (previous && this.eventsAreEqual(previous, event)) {
        return false;
      }

      return true;
    });
  }

  /** Shallow comparison of the fields we care about for change detection. */
  private eventsAreEqual(a: CalendarEvent, b: CalendarEvent): boolean {
    return (
      a.title === b.title &&
      a.start === b.start &&
      a.end === b.end &&
      a.status === b.status &&
      a.itemType === b.itemType &&
      a.itemId === b.itemId &&
      (a.location ?? null) === (b.location ?? null)
    );
  }
}

// ---------- Utility ---------------------------------------------------------

function isGoneError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 410;
}
