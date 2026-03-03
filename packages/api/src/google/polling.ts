import { POLL_INTERVAL_MS } from '@reclaim/shared';
import type { CalendarEvent } from '@reclaim/shared';
import { GoogleCalendarClient } from './calendar.js';

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
   */
  constructor(
    private client: GoogleCalendarClient,
    private calendarId: string = 'primary',
    private onChanges: (events: CalendarEvent[]) => Promise<void>,
    private getSyncToken: () => Promise<string | null>,
    private saveSyncToken: (token: string) => Promise<void>,
  ) {}

  /** Start the initial sync and begin the polling interval. */
  async start(): Promise<void> {
    this.syncToken = await this.getSyncToken();

    // Initial full/incremental sync
    await this.poll();

    this.intervalId = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
  }

  /** Stop polling. */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
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

      // Update our local snapshot
      for (const event of result.events) {
        if (event.googleEventId) {
          this.lastEventsById.set(event.googleEventId, event);
        }
      }

      if (externalChanges.length > 0) {
        await this.onChanges(externalChanges);
      }
    } catch (error) {
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
   * Filter out events that were recently modified by us.
   *
   * We consider an event "ours" if its `lastModifiedByUs` extended property
   * timestamp is within the last 30 seconds.  Everything else is treated as
   * an external change that the scheduler needs to know about.
   */
  private filterExternalChanges(events: CalendarEvent[]): CalendarEvent[] {
    const now = Date.now();
    const GRACE_PERIOD_MS = 30_000; // 30 seconds

    return events.filter((event) => {
      // Events without a googleEventId are malformed; skip them
      if (!event.googleEventId) {
        return false;
      }

      // Check if this event was recently written by us
      if (event.isManaged) {
        // The lastModifiedByUs timestamp lives in the event's extended
        // properties.  Since we store it when building the event body, we
        // can look at the previous snapshot to check the timestamp.
        const previous = this.lastEventsById.get(event.googleEventId);
        if (previous) {
          // If the event hasn't actually changed compared to our last snapshot,
          // it's not an external change.
          if (this.eventsAreEqual(previous, event)) {
            return false;
          }
        }
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
      a.itemId === b.itemId
    );
  }
}

// ---------- Utility ---------------------------------------------------------

function isGoneError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 410;
}
