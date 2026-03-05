import type { CalendarPollerManager } from './google/poller-manager.js';

/** Shared mutable reference to avoid circular imports between index.ts and routes. */
export const pollingRef: { manager: CalendarPollerManager | null; init: (() => Promise<void>) | null } = {
  manager: null,
  init: null,
};
