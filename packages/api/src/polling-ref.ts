import type { CalendarPollerManager } from './google/poller-manager.js';
import type { GoogleCalendarClient } from './google/calendar.js';

/** Shared mutable reference to avoid circular imports between index.ts and routes. */
export const pollingRef: {
  manager: CalendarPollerManager | null;
  calClient: GoogleCalendarClient | null;
  init: (() => Promise<void>) | null;
  runReschedule: ((reason: string) => Promise<number>) | null;
} = {
  manager: null,
  calClient: null,
  init: null,
  runReschedule: null,
};

/**
 * Trigger a reschedule from any route.
 * Uses Google-connected path if available, otherwise no-ops (local-only reschedule
 * is handled inline in the schedule route).
 * Fire-and-forget — errors are logged, not thrown.
 */
export function triggerReschedule(reason: string): void {
  if (pollingRef.runReschedule) {
    pollingRef.runReschedule(reason).catch((err) => {
      console.error(`[scheduler] Background reschedule failed (${reason}):`, err);
    });
  }
}
