import {
  TimeSlot,
  UserSettings,
  SchedulingHours,
} from '@cadence/shared';
import {
  parseTime,
  setTimeInTimezone,
  getDayOfWeekInTimezone,
  startOfDayInTimezone,
  nextDayInTimezone,
} from './utils.js';

/**
 * Get the scheduling hours (start/end) for a given SchedulingHours type.
 */
export function getSchedulingWindow(
  schedulingHours: SchedulingHours,
  userSettings: UserSettings,
): { start: string; end: string } {
  switch (schedulingHours) {
    case SchedulingHours.Working:
      return userSettings.workingHours;
    case SchedulingHours.Personal:
      return userSettings.personalHours;
    case SchedulingHours.Custom:
      // Custom defaults to personal hours since we don't have custom config here
      return userSettings.personalHours;
    default:
      return userSettings.workingHours;
  }
}

/**
 * Build a timeline of available time slots between startDate and endDate.
 *
 * For each day in the range, creates slots for both working hours and personal hours.
 * Working hours are a subset of personal hours. We produce one slot per day per
 * scheduling-hours window.
 *
 * The returned slots are non-overlapping and sorted chronologically.
 */
export function buildTimeline(
  startDate: Date,
  endDate: Date,
  userSettings: UserSettings,
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const tz = userSettings.timezone || 'UTC';

  const workStart = parseTime(userSettings.workingHours.start);
  const workEnd = parseTime(userSettings.workingHours.end);
  const personalStart = parseTime(userSettings.personalHours.start);
  const personalEnd = parseTime(userSettings.personalHours.end);

  // Iterate day by day
  let current = startOfDayInTimezone(startDate, tz);
  const endMidnight = startOfDayInTimezone(endDate, tz);
  const endBound = nextDayInTimezone(endMidnight, tz);

  while (current < endBound) {
    const dayOfWeek = getDayOfWeekInTimezone(current, tz); // 0=Sun, 6=Sat

    // Skip weekends for working hours, but personal hours are every day
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

    if (isWeekday) {
      // Pre-work personal time (if personal starts before work)
      if (
        personalStart.hours < workStart.hours ||
        (personalStart.hours === workStart.hours && personalStart.minutes < workStart.minutes)
      ) {
        const preWorkStart = setTimeInTimezone(current, personalStart.hours, personalStart.minutes, tz);
        const preWorkEnd = setTimeInTimezone(current, workStart.hours, workStart.minutes, tz);

        if (preWorkStart < preWorkEnd) {
          slots.push(clampSlot({ start: preWorkStart, end: preWorkEnd }, startDate, endDate));
        }
      }

      // Working hours
      const wStart = setTimeInTimezone(current, workStart.hours, workStart.minutes, tz);
      const wEnd = setTimeInTimezone(current, workEnd.hours, workEnd.minutes, tz);

      if (wStart < wEnd) {
        slots.push(clampSlot({ start: wStart, end: wEnd }, startDate, endDate));
      }

      // Post-work personal time (if personal ends after work)
      if (
        personalEnd.hours > workEnd.hours ||
        (personalEnd.hours === workEnd.hours && personalEnd.minutes > workEnd.minutes)
      ) {
        const postWorkStart = setTimeInTimezone(current, workEnd.hours, workEnd.minutes, tz);
        const postWorkEnd = setTimeInTimezone(current, personalEnd.hours, personalEnd.minutes, tz);

        if (postWorkStart < postWorkEnd) {
          slots.push(clampSlot({ start: postWorkStart, end: postWorkEnd }, startDate, endDate));
        }
      }
    } else {
      // Weekend: only personal hours
      const pStart = setTimeInTimezone(current, personalStart.hours, personalStart.minutes, tz);
      const pEnd = setTimeInTimezone(current, personalEnd.hours, personalEnd.minutes, tz);

      if (pStart < pEnd) {
        slots.push(clampSlot({ start: pStart, end: pEnd }, startDate, endDate));
      }
    }

    // Next day (DST-safe)
    current = nextDayInTimezone(current, tz);
  }

  // Filter out any zero or negative duration slots
  return slots.filter((s) => s.start < s.end);
}

/**
 * Clamp a slot to be within [startDate, endDate].
 */
function clampSlot(slot: TimeSlot, startDate: Date, endDate: Date): TimeSlot {
  return {
    start: slot.start < startDate ? new Date(startDate) : new Date(slot.start),
    end: slot.end > endDate ? new Date(endDate) : new Date(slot.end),
  };
}
