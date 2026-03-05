import { Priority, ItemType } from './types.js';

// Event title prefixes for Google Calendar
export const STATUS_PREFIX = {
  free: '\u{1F7E2}',    // green circle
  busy: '\u{1F6E1}\uFE0F', // shield
  locked: '\u{1F512}',  // lock
} as const;

// Extended property keys stored on Google Calendar events
export const EXTENDED_PROPS = {
  cadenceId: 'cadenceId',
  itemType: 'cadenceItemType',
  itemId: 'cadenceItemId',
  status: 'cadenceStatus',
  lastModifiedByUs: 'cadenceLastModified',
} as const;

// Type ordering within same priority level (lower = scheduled first)
export const TYPE_ORDER: Record<ItemType, number> = {
  [ItemType.Meeting]: 0,
  [ItemType.Habit]: 1,
  [ItemType.Task]: 2,
  [ItemType.Focus]: 3,
};

// Free/Busy flip thresholds
export const FLIP_THRESHOLDS = {
  minAlternativeSlots: 2,      // flip to Busy when fewer alternatives
  hoursBeforeStart: 2,         // flip to Busy when this close to start
} as const;

// Polling interval in milliseconds
export const POLL_INTERVAL_MS = 15_000;

// Default scheduling window (days ahead)
export const DEFAULT_SCHEDULING_WINDOW_DAYS = 14;

// Default working hours
export const DEFAULT_WORKING_HOURS = {
  start: '09:00',
  end: '17:00',
};

// Default personal hours
export const DEFAULT_PERSONAL_HOURS = {
  start: '07:00',
  end: '22:00',
};

