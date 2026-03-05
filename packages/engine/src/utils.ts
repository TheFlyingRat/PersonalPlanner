/**
 * Parse an "HH:MM" string into { hours, minutes }.
 */
export function parseTime(hhmm: string): { hours: number; minutes: number } {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) {
    return { hours: 0, minutes: 0 };
  }
  const [h, m] = hhmm.split(':').map(Number);
  return { hours: h, minutes: m };
}

/**
 * Check if two dates are on the same calendar day.
 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Create a Date representing a specific time on a specific calendar day in a timezone.
 * Uses Intl.DateTimeFormat to resolve the correct UTC offset for that timezone on that date.
 */
export function setTimeInTimezone(date: Date, hours: number, minutes: number, tz: string): Date {
  // Create a rough date in the target day
  const rough = new Date(date);
  rough.setHours(hours, minutes, 0, 0);

  // Get the timezone offset for this date in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  // Parse what `rough` looks like in the target timezone
  const parts = formatter.formatToParts(rough);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0');

  const tzHour = get('hour') === 24 ? 0 : get('hour');
  const tzMinute = get('minute');

  // Calculate offset between what we want and what we got
  const diffMinutes = (hours * 60 + minutes) - (tzHour * 60 + tzMinute);

  // Adjust — handle day boundary
  const result = new Date(rough.getTime() + diffMinutes * 60000);

  // Verify the result matches the target day — if formatter shows wrong day, adjust
  const resultParts = formatter.formatToParts(result);
  const resultDay = parseInt(resultParts.find(p => p.type === 'day')?.value ?? '0');
  const targetParts = formatter.formatToParts(date);
  const targetDay = parseInt(targetParts.find(p => p.type === 'day')?.value ?? '0');

  if (resultDay !== targetDay) {
    // Day shifted, adjust by 24h in the appropriate direction
    return new Date(result.getTime() + (targetDay > resultDay ? 86400000 : -86400000));
  }

  return result;
}

/**
 * Get the day-of-week (0=Sun, 6=Sat) for a date in a specific timezone.
 */
export function getDayOfWeekInTimezone(date: Date, tz: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  const weekday = formatter.format(date);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday] ?? 0;
}

/**
 * Get midnight (start of day) in a specific timezone.
 */
export function startOfDayInTimezone(date: Date, tz: string): Date {
  return setTimeInTimezone(date, 0, 0, tz);
}

/**
 * Advance one calendar day in a timezone (DST-safe).
 */
export function nextDayInTimezone(date: Date, tz: string): Date {
  // Jump forward ~26 hours to ensure we're in the next calendar day in any timezone
  const rough = new Date(date.getTime() + 26 * 3600000);
  return startOfDayInTimezone(rough, tz);
}

/**
 * Get the date components (year, month, day) in a timezone.
 */
export function getDatePartsInTimezone(date: Date, tz: string): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}
