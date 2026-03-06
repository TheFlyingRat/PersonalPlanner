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
