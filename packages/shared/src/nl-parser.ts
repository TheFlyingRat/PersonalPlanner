// Natural language quick-add parser
// Pure function — no dependencies, fully testable

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface ParsedHabit {
  type: 'habit';
  name: string;
  days?: DayOfWeek[];
  idealTime?: string;  // HH:MM
  duration?: number;   // minutes
}

export interface ParsedTask {
  type: 'task';
  name: string;
  dueDate?: string;       // ISO datetime
  totalDuration?: number; // minutes
}

export interface ParsedMeeting {
  type: 'meeting';
  name: string;
  frequency?: 'daily' | 'weekly';
  day?: DayOfWeek;
  idealTime?: string;  // HH:MM
  duration?: number;   // minutes
}

export type ParsedItem = ParsedHabit | ParsedTask | ParsedMeeting;

const DAY_ABBREVS: Record<string, DayOfWeek> = {
  m: 'mon', mo: 'mon', mon: 'mon', monday: 'mon',
  t: 'tue', tu: 'tue', tue: 'tue', tuesday: 'tue',
  w: 'wed', we: 'wed', wed: 'wed', wednesday: 'wed',
  th: 'thu', thu: 'thu', thursday: 'thu',
  f: 'fri', fr: 'fri', fri: 'fri', friday: 'fri',
  sa: 'sat', sat: 'sat', saturday: 'sat',
  su: 'sun', sun: 'sun', sunday: 'sun',
  s: 'sat',
  r: 'thu',
};

const FULL_DAY_NAMES: Record<string, DayOfWeek> = {
  monday: 'mon', tuesday: 'tue', wednesday: 'wed',
  thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun',
};

const DAY_ORDER: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * Parse a time string like "7am", "2pm", "14:00", "2:30pm" into "HH:MM" format.
 * Returns null if not a valid time.
 */
function parseTime(token: string): string | null {
  // 24h format: "14:00", "9:30"
  const match24 = token.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const h = parseInt(match24[1]);
    const m = parseInt(match24[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }
    return null;
  }

  // 12h format: "7am", "2pm", "2:30pm", "12am", "12pm"
  const match12 = token.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/i);
  if (match12) {
    let h = parseInt(match12[1]);
    const m = match12[2] ? parseInt(match12[2]) : 0;
    const period = match12[3].toLowerCase();
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    if (period === 'am') {
      if (h === 12) h = 0;
    } else {
      if (h !== 12) h += 12;
    }
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  return null;
}

/**
 * Parse a duration string like "1h", "30m", "1.5h", "90m" into minutes.
 * Returns null if not a valid duration.
 */
function parseDuration(token: string): number | null {
  const matchH = token.match(/^(\d+(?:\.\d+)?)h$/i);
  if (matchH) {
    const hours = parseFloat(matchH[1]);
    if (hours > 0 && hours <= 24) return Math.round(hours * 60);
    return null;
  }

  const matchM = token.match(/^(\d+)m$/i);
  if (matchM) {
    const mins = parseInt(matchM[1]);
    if (mins > 0 && mins <= 1440) return mins;
    return null;
  }

  return null;
}

/**
 * Parse a compact day string like "MWF", "TTh", "MTWThF" into an array of DayOfWeek.
 * Returns null if not recognized.
 */
function parseDayString(token: string): DayOfWeek[] | null {
  const lower = token.toLowerCase();

  // Special keywords
  if (lower === 'daily' || lower === 'everyday') {
    return [...DAY_ORDER];
  }
  if (lower === 'weekdays') {
    return ['mon', 'tue', 'wed', 'thu', 'fri'];
  }
  if (lower === 'weekends') {
    return ['sat', 'sun'];
  }

  // Full day name (single)
  if (FULL_DAY_NAMES[lower]) {
    return [FULL_DAY_NAMES[lower]];
  }

  // Compact abbreviation string: "MWF", "TTh", "MTWThF", "MoWeF"
  // Try to greedily parse from left to right
  const days: DayOfWeek[] = [];
  let pos = 0;
  while (pos < lower.length) {
    let matched = false;
    // Try longest match first (up to 3 chars for "thu", "sat", "sun", etc.)
    for (let len = Math.min(3, lower.length - pos); len >= 1; len--) {
      const substr = lower.substring(pos, pos + len);
      if (DAY_ABBREVS[substr]) {
        const day = DAY_ABBREVS[substr];
        if (!days.includes(day)) {
          days.push(day);
        }
        pos += len;
        matched = true;
        break;
      }
    }
    if (!matched) return null; // Unrecognized character
  }

  return days.length > 0 ? days : null;
}

/**
 * Resolve a day name to the next occurrence of that day as an ISO date string.
 */
function nextDayOfWeek(dayName: DayOfWeek, referenceDate?: Date): string {
  const ref = referenceDate ?? new Date();
  const dayIndex = DAY_ORDER.indexOf(dayName);
  // JS: 0=Sun, 1=Mon ... 6=Sat
  // Our index: 0=Mon ... 6=Sun
  const targetJsDay = dayIndex === 6 ? 0 : dayIndex + 1;
  const currentJsDay = ref.getDay();
  let daysAhead = targetJsDay - currentJsDay;
  if (daysAhead <= 0) daysAhead += 7;
  const target = new Date(ref);
  target.setDate(target.getDate() + daysAhead);
  target.setHours(23, 59, 0, 0);
  return target.toISOString();
}

/**
 * Try to parse a date expression from the tokens after "by".
 * Supports: day names ("Friday"), "March 15", "2026-03-15".
 * Returns ISO datetime or null.
 */
function parseDateExpr(tokens: string[], startIdx: number, referenceDate?: Date): { date: string; consumed: number } | null {
  if (startIdx >= tokens.length) return null;
  const token = tokens[startIdx].toLowerCase();

  // ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    const d = new Date(token + 'T23:59:00');
    if (!isNaN(d.getTime())) return { date: d.toISOString(), consumed: 1 };
  }

  // Day name
  if (FULL_DAY_NAMES[token]) {
    return { date: nextDayOfWeek(FULL_DAY_NAMES[token], referenceDate), consumed: 1 };
  }
  // Short day name
  const shortDay = DAY_ABBREVS[token];
  if (shortDay && token.length >= 3) {
    return { date: nextDayOfWeek(shortDay, referenceDate), consumed: 1 };
  }

  // Month + day: "March 15" or "march 15"
  const months: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  if (months[token] !== undefined && startIdx + 1 < tokens.length) {
    const dayNum = parseInt(tokens[startIdx + 1]);
    if (dayNum >= 1 && dayNum <= 31) {
      const ref = referenceDate ?? new Date();
      let year = ref.getFullYear();
      const d = new Date(year, months[token], dayNum, 23, 59, 0);
      // If date is in the past, use next year
      if (d < ref) {
        d.setFullYear(year + 1);
      }
      return { date: d.toISOString(), consumed: 2 };
    }
  }

  return null;
}

/**
 * Parse a natural language quick-add input string into a structured item.
 *
 * Patterns:
 *   Habit:   "Gym MWF 7am 1h"
 *   Task:    "Finish report by Friday 3h"
 *   Meeting: "Call with Sarah weekly Thu 2pm 30m"
 */
export function parseQuickAdd(input: string, referenceDate?: Date): ParsedItem | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0) return null;

  // Classify tokens
  let time: string | null = null;
  let duration: number | null = null;
  let days: DayOfWeek[] | null = null;
  let dueDate: string | null = null;
  let frequency: 'daily' | 'weekly' | null = null;
  let singleDay: DayOfWeek | null = null;

  // Track which tokens are "consumed" by structural parsing
  const consumed = new Set<number>();

  // First pass: find "by" keyword for tasks
  let byIndex = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].toLowerCase() === 'by' && i > 0) {
      byIndex = i;
      break;
    }
  }

  // Parse date after "by"
  if (byIndex >= 0) {
    const dateResult = parseDateExpr(tokens, byIndex + 1, referenceDate);
    if (dateResult) {
      dueDate = dateResult.date;
      consumed.add(byIndex);
      for (let j = 0; j < dateResult.consumed; j++) {
        consumed.add(byIndex + 1 + j);
      }
    }
  }

  // Second pass: classify remaining tokens
  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    const t = tokens[i];
    const lower = t.toLowerCase();

    // Frequency keywords
    if (lower === 'weekly') {
      frequency = 'weekly';
      consumed.add(i);
      continue;
    }
    if (lower === 'daily') {
      // "daily" could be a frequency or a day pattern
      frequency = 'daily';
      days = [...DAY_ORDER];
      consumed.add(i);
      continue;
    }

    // Time
    const parsedTime = parseTime(t);
    if (parsedTime) {
      time = parsedTime;
      consumed.add(i);
      continue;
    }

    // Duration
    const parsedDuration = parseDuration(t);
    if (parsedDuration !== null) {
      duration = parsedDuration;
      consumed.add(i);
      continue;
    }

    // Day pattern (only if not already found via "by")
    if (!dueDate) {
      const parsedDays = parseDayString(t);
      if (parsedDays) {
        if (parsedDays.length === 1) {
          singleDay = parsedDays[0];
        } else {
          days = parsedDays;
        }
        consumed.add(i);
        continue;
      }
    }
  }

  // Extract the name from unconsumed tokens
  const nameTokens: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!consumed.has(i)) {
      nameTokens.push(tokens[i]);
    }
  }
  const name = nameTokens.join(' ').trim();

  if (!name) return null;

  // Determine item type based on what we found

  // Task: has "by" + dueDate
  if (dueDate) {
    const result: ParsedTask = { type: 'task', name, dueDate };
    if (duration !== null) result.totalDuration = duration;
    return result;
  }

  // Habit: has multi-day pattern (MWF, weekdays, daily, etc.)
  if (days && days.length > 1) {
    const result: ParsedHabit = { type: 'habit', name, days };
    if (time) result.idealTime = time;
    if (duration !== null) result.duration = duration;
    return result;
  }

  // Meeting: has "weekly" frequency + single day and/or time
  if (frequency === 'weekly' && (time || singleDay)) {
    const result: ParsedMeeting = { type: 'meeting', name, frequency };
    if (singleDay) result.day = singleDay;
    if (time) result.idealTime = time;
    if (duration !== null) result.duration = duration;
    return result;
  }

  // Habit: has a single day + time (recurring pattern without explicit frequency)
  if (singleDay && time) {
    const result: ParsedHabit = { type: 'habit', name, days: [singleDay], idealTime: time };
    if (duration !== null) result.duration = duration;
    return result;
  }

  // Habit: has a single day pattern
  if (days && days.length === 1) {
    const result: ParsedHabit = { type: 'habit', name, days };
    if (time) result.idealTime = time;
    if (duration !== null) result.duration = duration;
    return result;
  }

  // Fallback: if we have a duration but nothing else, treat as task
  if (duration !== null) {
    const result: ParsedTask = { type: 'task', name, totalDuration: duration };
    return result;
  }

  // Cannot determine type
  return null;
}
