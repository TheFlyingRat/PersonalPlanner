// ============================================================
// Intl.DateTimeFormat cache — avoids repeated allocations (PERF-M1)
// ============================================================

const MAX_FORMATTER_CACHE_SIZE = 500;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function getFormatter(tz: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(options);
  let fmt = formatterCache.get(key);
  if (!fmt) {
    if (formatterCache.size >= MAX_FORMATTER_CACHE_SIZE) {
      // Evict oldest entry (first inserted)
      const firstKey = formatterCache.keys().next().value;
      if (firstKey !== undefined) formatterCache.delete(firstKey);
    }
    fmt = new Intl.DateTimeFormat('en-US', { ...options, timeZone: tz });
    formatterCache.set(key, fmt);
  }
  return fmt;
}

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
 * Check if two dates are on the same calendar day in a specific timezone.
 * Falls back to UTC comparison when no timezone is provided.
 */
export function isSameDay(a: Date, b: Date, tz?: string): boolean {
  if (tz) {
    const pa = getDatePartsInTimezone(a, tz);
    const pb = getDatePartsInTimezone(b, tz);
    return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
  }
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
  const formatter = getFormatter(tz, {
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
  const rGet = (type: string) => parseInt(resultParts.find(p => p.type === type)?.value ?? '0');
  const targetParts = formatter.formatToParts(date);
  const tGet = (type: string) => parseInt(targetParts.find(p => p.type === type)?.value ?? '0');

  const resultDate = Date.UTC(rGet('year'), rGet('month') - 1, rGet('day'));
  const targetDate = Date.UTC(tGet('year'), tGet('month') - 1, tGet('day'));

  if (resultDate !== targetDate) {
    // Day shifted — use the actual date difference for the correction
    const diffMs = targetDate - resultDate;
    return new Date(result.getTime() + diffMs);
  }

  // DST ambiguity: during a fall-back transition (e.g., 2:00 AM occurs twice),
  // the result hour may not match the target hour. During spring-forward, a
  // requested hour may be skipped entirely (e.g., 2:30 AM doesn't exist).
  // Handle both by nudging toward the target time.
  const resultHour = rGet('hour') === 24 ? 0 : rGet('hour');
  if (resultHour !== hours) {
    const hourDiffMin = (hours * 60 + minutes) - (resultHour * 60 + rGet('minute'));
    const adjusted = new Date(result.getTime() + hourDiffMin * 60000);
    // Verify the adjustment landed on the right hour; if not (spring-forward
    // skipped the target hour), return the adjusted time as the nearest valid time
    const adjParts = formatter.formatToParts(adjusted);
    const adjGet = (type: string) => parseInt(adjParts.find(p => p.type === type)?.value ?? '0');
    const adjHour = adjGet('hour') === 24 ? 0 : adjGet('hour');
    if (adjHour !== hours) {
      // Target hour doesn't exist (spring-forward gap) — return the post-gap time
      return adjusted;
    }
    return adjusted;
  }

  return result;
}

/**
 * Get the day-of-week (0=Sun, 6=Sat) for a date in a specific timezone.
 */
export function getDayOfWeekInTimezone(date: Date, tz: string): number {
  const formatter = getFormatter(tz, { weekday: 'short' });
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
  const formatter = getFormatter(tz, {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * Format a Date as "YYYY-MM-DD" in a specific timezone.
 * Unlike toISOString().slice(0,10), this returns the correct local date.
 */
export function toLocalDateStr(date: Date, tz: string): string {
  const { year, month, day } = getDatePartsInTimezone(date, tz);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
