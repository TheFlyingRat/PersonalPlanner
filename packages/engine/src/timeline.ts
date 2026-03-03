import {
  TimeSlot,
  UserSettings,
  SchedulingHours,
} from '@reclaim/shared';

/**
 * Parse an "HH:MM" string into { hours, minutes }.
 */
function parseTime(hhmm: string): { hours: number; minutes: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return { hours: h, minutes: m };
}

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

  const workStart = parseTime(userSettings.workingHours.start);
  const workEnd = parseTime(userSettings.workingHours.end);
  const personalStart = parseTime(userSettings.personalHours.start);
  const personalEnd = parseTime(userSettings.personalHours.end);

  // Iterate day by day
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const endBound = new Date(endDate);
  endBound.setHours(23, 59, 59, 999);

  while (current <= endBound) {
    const dayOfWeek = current.getDay(); // 0=Sun, 6=Sat

    // Skip weekends for working hours, but personal hours are every day
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

    if (isWeekday) {
      // Pre-work personal time (if personal starts before work)
      if (
        personalStart.hours < workStart.hours ||
        (personalStart.hours === workStart.hours && personalStart.minutes < workStart.minutes)
      ) {
        const preWorkStart = new Date(current);
        preWorkStart.setHours(personalStart.hours, personalStart.minutes, 0, 0);
        const preWorkEnd = new Date(current);
        preWorkEnd.setHours(workStart.hours, workStart.minutes, 0, 0);

        if (preWorkStart < preWorkEnd) {
          slots.push(clampSlot({ start: preWorkStart, end: preWorkEnd }, startDate, endDate));
        }
      }

      // Working hours
      const wStart = new Date(current);
      wStart.setHours(workStart.hours, workStart.minutes, 0, 0);
      const wEnd = new Date(current);
      wEnd.setHours(workEnd.hours, workEnd.minutes, 0, 0);

      if (wStart < wEnd) {
        slots.push(clampSlot({ start: wStart, end: wEnd }, startDate, endDate));
      }

      // Post-work personal time (if personal ends after work)
      if (
        personalEnd.hours > workEnd.hours ||
        (personalEnd.hours === workEnd.hours && personalEnd.minutes > workEnd.minutes)
      ) {
        const postWorkStart = new Date(current);
        postWorkStart.setHours(workEnd.hours, workEnd.minutes, 0, 0);
        const postWorkEnd = new Date(current);
        postWorkEnd.setHours(personalEnd.hours, personalEnd.minutes, 0, 0);

        if (postWorkStart < postWorkEnd) {
          slots.push(clampSlot({ start: postWorkStart, end: postWorkEnd }, startDate, endDate));
        }
      }
    } else {
      // Weekend: only personal hours
      const pStart = new Date(current);
      pStart.setHours(personalStart.hours, personalStart.minutes, 0, 0);
      const pEnd = new Date(current);
      pEnd.setHours(personalEnd.hours, personalEnd.minutes, 0, 0);

      if (pStart < pEnd) {
        slots.push(clampSlot({ start: pStart, end: pEnd }, startDate, endDate));
      }
    }

    // Next day
    current.setDate(current.getDate() + 1);
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
