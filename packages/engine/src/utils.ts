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
