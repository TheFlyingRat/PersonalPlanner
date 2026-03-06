import {
  Habit,
  Task,
  SmartMeeting,
  FocusTimeRule,
  CalendarEvent,
  BufferConfig,
  UserSettings,
  ScheduleResult,
  ScheduleItem,
  TimeSlot,
  CandidateSlot,
  CalendarOperation,
  CalendarOpType,
  ItemType,
  Priority,
  EventStatus,
  Frequency,
  TaskStatus,
} from '@cadence/shared';
import { TYPE_ORDER, STATUS_PREFIX, EXTENDED_PROPS } from '@cadence/shared';
import { buildTimeline, getSchedulingWindow } from './timeline.js';
import { generateCandidateSlots, slotsOverlap } from './slots.js';
import { scoreSlot } from './scoring.js';
import { computeFreeBusyStatus } from './free-busy.js';
import {
  parseTime,
  setTimeInTimezone,
  getDayOfWeekInTimezone,
  startOfDayInTimezone,
  nextDayInTimezone,
  getDatePartsInTimezone,
  toLocalDateStr,
} from './utils.js';

// ============================================================
// Day-of-week helpers
// ============================================================

function getDayAbbrev(date: Date, tz: string): string {
  const dayIndex = getDayOfWeekInTimezone(date, tz);
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return days[dayIndex];
}

function getWeekNumber(date: Date, tz?: string): number {
  // Use timezone-aware date parts when available, otherwise fallback to UTC
  const parts = tz ? getDatePartsInTimezone(date, tz) : null;
  const year = parts ? parts.year : date.getFullYear();
  const month = parts ? parts.month - 1 : date.getMonth(); // Date.UTC uses 0-indexed month
  const day = parts ? parts.day : date.getDate();

  const d = new Date(Date.UTC(year, month, day));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ============================================================
// Conversion helpers: domain objects -> ScheduleItems
// ============================================================

/**
 * Build a time window for a given day using HH:MM start/end strings.
 */
function buildDayWindow(
  day: Date,
  windowStart: string,
  windowEnd: string,
  tz: string,
): TimeSlot {
  const start = parseTime(windowStart);
  const end = parseTime(windowEnd);
  const s = setTimeInTimezone(day, start.hours, start.minutes, tz);
  const e = setTimeInTimezone(day, end.hours, end.minutes, tz);
  // Handle midnight crossover
  if (e <= s) {
    return { start: s, end: new Date(e.getTime() + 86400000) };
  }
  return { start: s, end: e };
}

/**
 * Enumerate all days in [startDate, endDate] inclusive.
 */
function enumerateDays(startDate: Date, endDate: Date, tz: string): Date[] {
  const days: Date[] = [];
  let current = startOfDayInTimezone(startDate, tz);
  const endMidnight = startOfDayInTimezone(endDate, tz);
  // Include end day
  const endBound = new Date(endMidnight.getTime() + 86400000);
  while (current < endBound) {
    days.push(new Date(current));
    current = nextDayInTimezone(current, tz);
  }
  return days;
}

/**
 * Convert Habits into ScheduleItems (one per applicable day/week).
 */
function habitsToScheduleItems(
  habits: Habit[],
  scheduleStart: Date,
  scheduleEnd: Date,
  windowStart: Date,
  tz: string,
): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  const days = enumerateDays(scheduleStart, scheduleEnd, tz);

  for (const habit of habits) {
    if (!habit.enabled) continue;

    // Choose ideal duration (midpoint of min/max)
    const duration = Math.round((habit.durationMin + habit.durationMax) / 2);

    if (habit.frequency === Frequency.Daily) {
      const applicableDays = habit.frequencyConfig?.days ?? [
        'mon', 'tue', 'wed', 'thu', 'fri',
      ];

      for (const day of days) {
        const dayAbbrev = getDayAbbrev(day, tz);
        if (!applicableDays.includes(dayAbbrev)) continue;

        const timeWindow = buildDayWindow(day, habit.windowStart, habit.windowEnd, tz);
        items.push({
          id: `${habit.id}__${toLocalDateStr(day, tz)}`,
          name: habit.name,
          type: ItemType.Habit,
          priority: habit.priority,
          timeWindow,
          idealTime: habit.idealTime,
          duration,
          locked: habit.locked,
          dependsOn: habit.dependsOn
            ? `${habit.dependsOn}__${toLocalDateStr(day, tz)}`
            : null,
        });
      }
    } else if (habit.frequency === Frequency.Weekly) {
      // One instance per week - pick the first applicable day in each week
      const weekInterval = habit.frequencyConfig?.weekInterval ?? 1;
      const applicableDays = habit.frequencyConfig?.days ?? ['mon'];

      const windowStartWeek = getWeekNumber(windowStart, tz);
      const scheduledWeeks = new Set<number>();
      for (const day of days) {
        const dayAbbrev = getDayAbbrev(day, tz);
        if (!applicableDays.includes(dayAbbrev)) continue;

        const weekNum = getWeekNumber(day, tz);
        if (scheduledWeeks.has(weekNum)) continue;
        let weeksSinceStart = weekNum - windowStartWeek;
        if (weeksSinceStart < 0) {
          // Handle year boundary properly (ISO years can have 52 or 53 weeks)
          const { year: localYear } = getDatePartsInTimezone(day, tz);
          const lastDayPrevYear = new Date(Date.UTC(localYear - 1, 11, 28));
          weeksSinceStart += getWeekNumber(lastDayPrevYear, tz);
        }
        if (weekInterval > 1 && weeksSinceStart % weekInterval !== 0) continue;

        scheduledWeeks.add(weekNum);
        const dayStr = toLocalDateStr(day, tz);
        const timeWindow = buildDayWindow(day, habit.windowStart, habit.windowEnd, tz);
        items.push({
          id: `${habit.id}__${dayStr}`,
          name: habit.name,
          type: ItemType.Habit,
          priority: habit.priority,
          timeWindow,
          idealTime: habit.idealTime,
          duration,
          locked: habit.locked,
          dependsOn: habit.dependsOn
            ? `${habit.dependsOn}__${dayStr}`
            : null,
        });
      }
    } else if (habit.frequency === Frequency.Monthly) {
      // Fix 8: Monthly frequency support
      const config = habit.frequencyConfig;

      for (const day of days) {
        let isTargetDay = false;
        const localDay = getDatePartsInTimezone(day, tz).day;

        if (config?.monthDay != null) {
          // Schedule on a specific day of the month
          isTargetDay = localDay === config.monthDay;
        } else if (config?.monthWeek != null && config?.monthWeekday != null) {
          // Schedule on the nth weekday of the month
          const dayAbbrev = getDayAbbrev(day, tz);
          if (dayAbbrev === config.monthWeekday) {
            const weekOfMonth = Math.ceil(localDay / 7);
            isTargetDay = weekOfMonth === config.monthWeek;
          }
        } else {
          // Default: schedule on the 1st of each month
          isTargetDay = localDay === 1;
        }

        if (!isTargetDay) continue;

        const dayStr = toLocalDateStr(day, tz);
        const timeWindow = buildDayWindow(day, habit.windowStart, habit.windowEnd, tz);
        items.push({
          id: `${habit.id}__${dayStr}`,
          name: habit.name,
          type: ItemType.Habit,
          priority: habit.priority,
          timeWindow,
          idealTime: habit.idealTime,
          duration,
          locked: habit.locked,
          dependsOn: habit.dependsOn
            ? `${habit.dependsOn}__${dayStr}`
            : null,
        });
      }
    }
  }

  return items;
}

/**
 * Convert Tasks into ScheduleItems (chunked).
 */
function tasksToScheduleItems(
  tasks: Task[],
  scheduleStart: Date,
  scheduleEnd: Date,
  userSettings: UserSettings,
): ScheduleItem[] {
  const items: ScheduleItem[] = [];

  for (const task of tasks) {
    // Skip completed or done-scheduling tasks
    if (task.status === TaskStatus.Completed || task.status === TaskStatus.DoneScheduling) continue;

    const remaining = task.remainingDuration;
    if (remaining <= 0) continue;

    // Determine chunk size (prefer chunkMax, but don't exceed remaining)
    const chunkSize = Math.min(task.chunkMax, remaining);
    let numChunks = Math.ceil(remaining / chunkSize);

    // Fix: ensure no chunk is smaller than chunkMin.
    // If the last chunk would be < chunkMin, reduce numChunks by 1 so the
    // remaining time is distributed into fewer (slightly larger) chunks.
    if (numChunks > 1) {
      const lastChunkSize = remaining - (numChunks - 1) * chunkSize;
      if (lastChunkSize < task.chunkMin) {
        numChunks = numChunks - 1;
      }
    }

    const earliest = new Date(task.earliestStart);
    const due = new Date(task.dueDate);
    const windowEnd = due < scheduleEnd ? due : scheduleEnd;

    // Determine scheduling hours
    const { start: hourStart } = getSchedulingWindow(
      task.schedulingHours,
      userSettings,
    );

    // Override priority if isUpNext
    const priority = task.isUpNext ? Priority.Critical : task.priority;

    // Compute the actual chunk size for each chunk. When numChunks was reduced,
    // divide remaining evenly (ceiling) so that all chunks are >= chunkMin.
    let effectiveChunkSize = Math.ceil(remaining / numChunks);
    if (effectiveChunkSize > task.chunkMax) {
      effectiveChunkSize = task.chunkMax;
      numChunks = Math.ceil(remaining / effectiveChunkSize);
    }

    for (let i = 0; i < numChunks; i++) {
      const thisChunkSize = Math.min(effectiveChunkSize, remaining - i * effectiveChunkSize);
      if (thisChunkSize <= 0) break;

      // Each chunk is its own ScheduleItem with the full time window
      const timeWindow: TimeSlot = {
        start: earliest < scheduleStart ? new Date(scheduleStart) : new Date(earliest),
        end: new Date(windowEnd),
      };

      items.push({
        id: `${task.id}__chunk${i}`,
        name: task.name,
        type: ItemType.Task,
        priority,
        timeWindow,
        idealTime: hourStart, // prefer early in scheduling window
        duration: thisChunkSize,
        locked: false,
        dependsOn: i > 0 ? `${task.id}__chunk${i - 1}` : null,
      });
    }
  }

  return items;
}

/**
 * Convert SmartMeetings into ScheduleItems.
 */
function meetingsToScheduleItems(
  meetings: SmartMeeting[],
  scheduleStart: Date,
  scheduleEnd: Date,
  windowStart: Date,
  tz: string,
): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  const days = enumerateDays(scheduleStart, scheduleEnd, tz);

  for (const meeting of meetings) {
    if (meeting.frequency === Frequency.Daily) {
      for (const day of days) {
        // Skip weekends for meetings
        const dow = getDayOfWeekInTimezone(day, tz);
        if (dow === 0 || dow === 6) continue;

        const timeWindow = buildDayWindow(day, meeting.windowStart, meeting.windowEnd, tz);
        items.push({
          id: `${meeting.id}__${toLocalDateStr(day, tz)}`,
          name: meeting.name,
          type: ItemType.Meeting,
          priority: meeting.priority,
          timeWindow,
          idealTime: meeting.idealTime,
          duration: meeting.duration,
          locked: false,
          dependsOn: null,
        });
      }
    } else if (meeting.frequency === Frequency.Weekly) {
      const weekInterval = meeting.frequencyConfig?.weekInterval ?? 1;
      const windowStartWeek = getWeekNumber(windowStart, tz);
      const scheduledWeeks = new Set<number>();
      for (const day of days) {
        const dow = getDayOfWeekInTimezone(day, tz);
        if (dow === 0 || dow === 6) continue;
        const weekNum = getWeekNumber(day, tz);
        if (scheduledWeeks.has(weekNum)) continue;
        let weeksSinceStart = weekNum - windowStartWeek;
        if (weeksSinceStart < 0) {
          // Handle year boundary properly (ISO years can have 52 or 53 weeks)
          const { year: localYear } = getDatePartsInTimezone(day, tz);
          const lastDayPrevYear = new Date(Date.UTC(localYear - 1, 11, 28));
          weeksSinceStart += getWeekNumber(lastDayPrevYear, tz);
        }
        if (weekInterval > 1 && weeksSinceStart % weekInterval !== 0) continue;

        scheduledWeeks.add(weekNum);
        const dayStr = toLocalDateStr(day, tz);
        const timeWindow = buildDayWindow(day, meeting.windowStart, meeting.windowEnd, tz);
        items.push({
          id: `${meeting.id}__${dayStr}`,
          name: meeting.name,
          type: ItemType.Meeting,
          priority: meeting.priority,
          timeWindow,
          idealTime: meeting.idealTime,
          duration: meeting.duration,
          locked: false,
          dependsOn: null,
        });
      }
    } else if (meeting.frequency === Frequency.Monthly) {
      // Fix 8: Monthly frequency support for meetings
      for (const day of days) {
        const dow = getDayOfWeekInTimezone(day, tz);
        if (dow === 0 || dow === 6) continue;

        let isTargetDay = false;
        const localDay = getDatePartsInTimezone(day, tz).day;

        if (meeting.frequencyConfig?.monthDay != null) {
          isTargetDay = localDay === meeting.frequencyConfig.monthDay;
        } else if (meeting.frequencyConfig?.monthWeek != null && meeting.frequencyConfig?.monthWeekday != null) {
          const dayAbbrev = getDayAbbrev(day, tz);
          if (dayAbbrev === meeting.frequencyConfig.monthWeekday) {
            const weekOfMonth = Math.ceil(localDay / 7);
            isTargetDay = weekOfMonth === meeting.frequencyConfig.monthWeek;
          }
        } else {
          isTargetDay = localDay === 1;
        }

        if (!isTargetDay) continue;

        const dayStr = toLocalDateStr(day, tz);
        const timeWindow = buildDayWindow(day, meeting.windowStart, meeting.windowEnd, tz);
        items.push({
          id: `${meeting.id}__${dayStr}`,
          name: meeting.name,
          type: ItemType.Meeting,
          priority: meeting.priority,
          timeWindow,
          idealTime: meeting.idealTime,
          duration: meeting.duration,
          locked: false,
          dependsOn: null,
        });
      }
    }
  }

  return items;
}

/**
 * Sort ScheduleItems by priority (ascending) then by TYPE_ORDER.
 * For tasks at same priority, sort by due date ascending.
 */
function sortScheduleItems(items: ScheduleItem[]): ScheduleItem[] {
  return [...items].sort((a, b) => {
    // Priority first (lower number = higher priority)
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }

    // Type order second
    const typeA = TYPE_ORDER[a.type];
    const typeB = TYPE_ORDER[b.type];
    if (typeA !== typeB) {
      return typeA - typeB;
    }

    // For same type and priority, sort by time window end (earlier due date first)
    const timeDiff = a.timeWindow.end.getTime() - b.timeWindow.end.getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }

    // Tiebreaker: sort by id for deterministic ordering (preserves chunk order)
    return a.id.localeCompare(b.id);
  });
}

// ============================================================
// Circular dependency detection
// ============================================================

function detectCircularDependencies(habits: Habit[]): string[] {
  const errors: string[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(id: string): boolean {
    if (inStack.has(id)) return true; // cycle found
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    const habit = habits.find(h => h.id === id);
    if (habit?.dependsOn) {
      if (dfs(habit.dependsOn)) {
        errors.push(`Circular dependency detected involving habit "${habit.name}" (${id})`);
        return true;
      }
    }
    inStack.delete(id);
    return false;
  }

  for (const habit of habits) {
    dfs(habit.id);
  }
  return errors;
}

// ============================================================
// Main scheduler
// ============================================================

export function reschedule(
  habits: Habit[],
  tasks: Task[],
  meetings: SmartMeeting[],
  focusRules: FocusTimeRule[],
  calendarEvents: CalendarEvent[],
  bufferConfig: BufferConfig,
  userSettings: UserSettings,
  now?: Date,
): ScheduleResult {
  const currentTime = now ?? new Date();
  const tz = userSettings.timezone || 'UTC';

  // 0. Detect circular dependencies in habits
  const circularErrors = detectCircularDependencies(habits);
  const circularHabitIds = new Set<string>();
  if (circularErrors.length > 0) {
    // Collect IDs of habits that are part of a cycle
    for (const habit of habits) {
      if (habit.dependsOn) {
        // Check if this habit's dependency chain forms a cycle
        const seen = new Set<string>();
        let current: string | null = habit.id;
        let isCyclic = false;
        while (current) {
          if (seen.has(current)) { isCyclic = true; break; }
          seen.add(current);
          const h = habits.find(hh => hh.id === current);
          current = h?.dependsOn ?? null;
        }
        if (isCyclic) {
          circularHabitIds.add(habit.id);
        }
      }
    }
  }

  // 1. Define the scheduling window
  const scheduleStart = new Date(currentTime);
  const scheduleEnd = new Date(currentTime);
  scheduleEnd.setDate(scheduleEnd.getDate() + userSettings.schedulingWindowDays);

  // 2. Build timeline
  const timeline = buildTimeline(scheduleStart, scheduleEnd, userSettings);

  // 3. Separate fixed events from flexible items
  const fixedEvents: TimeSlot[] = [];
  const existingManagedEvents = new Map<string, CalendarEvent>();
  const lockedPlacements = new Map<string, TimeSlot>();
  const lockedExistingIds = new Set<string>();

  for (const event of calendarEvents) {
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);

    if (!event.isManaged || event.status === EventStatus.Locked) {
      // Fixed: external events or locked managed events
      fixedEvents.push({ start: eventStart, end: eventEnd });
    }

    if (event.isManaged && event.itemId) {
      existingManagedEvents.set(event.itemId, event);

      // Fix: locked managed events must also be tracked as placed so
      // generateCalendarOperations does not delete them
      if (event.status === EventStatus.Locked) {
        lockedPlacements.set(event.itemId, { start: eventStart, end: eventEnd });
        lockedExistingIds.add(event.itemId);
      }
    }
  }

  // 4. Convert domain objects to ScheduleItems
  const habitItems = habitsToScheduleItems(habits, scheduleStart, scheduleEnd, scheduleStart, tz);
  const taskItems = tasksToScheduleItems(tasks, scheduleStart, scheduleEnd, userSettings);
  const meetingItems = meetingsToScheduleItems(meetings, scheduleStart, scheduleEnd, scheduleStart, tz);

  // 4b. Handle circular dependencies: add errors and strip dependsOn
  const unschedulable: Array<{ itemId: string; itemType: ItemType; reason: string }> = [];

  for (const error of circularErrors) {
    // Extract habit ID from the error message
    const match = error.match(/\(([^)]+)\)$/);
    const habitId = match ? match[1] : 'unknown';
    unschedulable.push({
      itemId: habitId,
      itemType: ItemType.Habit,
      reason: error,
    });
  }

  // Strip dependsOn from schedule items that belong to cyclic habits
  if (circularHabitIds.size > 0) {
    for (const item of habitItems) {
      const baseId = item.id.split('__')[0];
      if (circularHabitIds.has(baseId)) {
        item.dependsOn = null;
      }
    }
  }

  // 5. Sort flexible items by priority
  const flexibleItems = sortScheduleItems([...habitItems, ...taskItems, ...meetingItems]);

  // 6. Greedy placement
  const occupiedSlots: TimeSlot[] = [...fixedEvents];
  const placements = new Map<string, TimeSlot>();
  const candidateSlotsMap = new Map<string, CandidateSlot[]>();
  const itemMap = new Map<string, ScheduleItem>();

  // Seed placements with locked managed events so they are not deleted
  for (const [itemId, slot] of lockedPlacements) {
    placements.set(itemId, slot);
  }

  for (const item of flexibleItems) {
    itemMap.set(item.id, item);
  }

  for (const item of flexibleItems) {
    // Generate candidates (pass placements and dependsOn for hard dependency constraint)
    const candidates = generateCandidateSlots(
      item, timeline, occupiedSlots, bufferConfig, placements, item.dependsOn, tz,
    );
    candidateSlotsMap.set(item.id, candidates);

    if (candidates.length === 0) {
      unschedulable.push({
        itemId: item.id,
        itemType: item.type,
        reason: 'No available slots in the scheduling window',
      });
      continue;
    }

    // Score each candidate
    const scoredCandidates = candidates.map((candidate) => ({
      ...candidate,
      score: scoreSlot(candidate, item, placements, bufferConfig, tz),
    }));

    // Sort by score descending
    scoredCandidates.sort((a, b) => b.score - a.score);

    // Place in best slot
    const bestSlot = scoredCandidates[0];
    const placement: TimeSlot = {
      start: new Date(bestSlot.start),
      end: new Date(bestSlot.end),
    };
    placements.set(item.id, placement);
    occupiedSlots.push(placement);

    // Store scored candidates for free/busy computation
    candidateSlotsMap.set(item.id, scoredCandidates);
  }

  // 7. Handle Focus Time
  const activeFocusRules = focusRules.filter((r) => r.enabled);
  if (activeFocusRules.length > 0) {
    // Build a type map from the schedule items for meeting detection
    const itemTypeMap = new Map<string, ItemType>();
    for (const item of flexibleItems) {
      itemTypeMap.set(item.id, item.type);
    }

    placeFocusTime(
      activeFocusRules,
      timeline,
      occupiedSlots,
      placements,
      candidateSlotsMap,
      itemMap,
      unschedulable,
      bufferConfig,
      userSettings,
      scheduleStart,
      scheduleEnd,
      currentTime,
      itemTypeMap,
    );
  }

  // 8. Compute Free/Busy status for each placed item
  const statuses = new Map<string, EventStatus>();
  for (const [itemId, placement] of placements) {
    const item = itemMap.get(itemId);
    const candidates = candidateSlotsMap.get(itemId) ?? [];
    const isLocked = item?.locked ?? false;

    const status = computeFreeBusyStatus(
      itemId,
      placement,
      candidates,
      currentTime,
      isLocked,
    );
    statuses.set(itemId, status);
  }

  // 9. Generate calendar operations (diff against existing)
  const operations = generateCalendarOperations(
    placements,
    statuses,
    itemMap,
    existingManagedEvents,
    lockedExistingIds,
  );

  return { operations, unschedulable };
}

// ============================================================
// Focus Time placement
// ============================================================

function placeFocusTime(
  focusRules: FocusTimeRule[],
  timeline: TimeSlot[],
  occupiedSlots: TimeSlot[],
  placements: Map<string, TimeSlot>,
  candidateSlotsMap: Map<string, CandidateSlot[]>,
  itemMap: Map<string, ScheduleItem>,
  _unschedulable: Array<{ itemId: string; itemType: ItemType; reason: string }>,
  bufferConfig: BufferConfig,
  userSettings: UserSettings,
  _scheduleStart: Date,
  scheduleEnd: Date,
  now: Date,
  itemTypeMap: Map<string, ItemType> = new Map(),
): void {
  const tz = userSettings.timezone || 'UTC';

  for (const rule of focusRules) {
    // Calculate how much focus time is already placed this week
    const dayOfWeek = getDayOfWeekInTimezone(now, tz);
    const weekStart = startOfDayInTimezone(
      new Date(now.getTime() - dayOfWeek * 86400000), tz,
    );
    const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);

    // Count all placed items except meetings toward focus time.
    // Habits, tasks, and focus blocks all contribute to deep work time.
    let placedFocusMinutesThisWeek = 0;
    for (const [id, slot] of placements) {
      if (slot.start >= weekStart && slot.start < weekEnd) {
        // Skip meetings - they don't count as focus/deep work time
        const isMeeting = itemTypeMap.get(id) === ItemType.Meeting;
        if (!isMeeting) {
          placedFocusMinutesThisWeek += (slot.end.getTime() - slot.start.getTime()) / 60000;
        }
      }
    }

    // Calculate remaining available time this week (in the timeline minus occupied)
    // Merge overlapping occupied slots first to prevent double-subtraction
    const sortedOccupied = [...occupiedSlots].sort((a, b) => a.start.getTime() - b.start.getTime());
    const mergedOccupied: TimeSlot[] = [];
    for (const slot of sortedOccupied) {
      const last = mergedOccupied[mergedOccupied.length - 1];
      if (last && slot.start.getTime() <= last.end.getTime()) {
        mergedOccupied[mergedOccupied.length - 1] = {
          start: last.start,
          end: new Date(Math.max(last.end.getTime(), slot.end.getTime())),
        };
      } else {
        mergedOccupied.push({ start: new Date(slot.start), end: new Date(slot.end) });
      }
    }

    let remainingAvailableMinutes = 0;
    for (const slot of timeline) {
      if (slot.start < weekStart || slot.start >= weekEnd) continue;

      let availableMs = slot.end.getTime() - slot.start.getTime();
      for (const occupied of mergedOccupied) {
        if (slotsOverlap(slot, occupied)) {
          const overlapStart = Math.max(slot.start.getTime(), occupied.start.getTime());
          const overlapEnd = Math.min(slot.end.getTime(), occupied.end.getTime());
          availableMs -= overlapEnd - overlapStart;
        }
      }
      remainingAvailableMinutes += Math.max(0, availableMs) / (1000 * 60);
    }

    const targetRemaining = rule.weeklyTargetMinutes - placedFocusMinutesThisWeek;
    if (targetRemaining <= 0) continue;

    // Only place focus time if remaining available time is at risk
    // Risk: remaining available time < 1.5x the target remaining
    if (remainingAvailableMinutes > targetRemaining * 1.5) continue;

    // Place focus blocks (daily target size)
    const blockSize = rule.dailyTargetMinutes > 0
      ? rule.dailyTargetMinutes
      : Math.min(60, targetRemaining); // default 60 min blocks

    let placedTotal = 0;
    const days = enumerateDays(now, scheduleEnd, tz);

    for (const day of days) {
      if (placedTotal >= targetRemaining) break;

      // Build a focus schedule item for this day
      const { start: hourStart, end: hourEnd } = getSchedulingWindow(
        rule.schedulingHours,
        userSettings,
      );

      const focusItem: ScheduleItem = {
        id: `focus_${rule.id}__${toLocalDateStr(day, tz)}`,
        type: ItemType.Focus,
        priority: Priority.Low,
        timeWindow: buildDayWindow(day, hourStart, hourEnd, tz),
        idealTime: hourStart,
        duration: Math.min(blockSize, targetRemaining - placedTotal),
        locked: false,
        dependsOn: null,
      };

      itemMap.set(focusItem.id, focusItem);

      const candidates = generateCandidateSlots(focusItem, timeline, occupiedSlots, bufferConfig, undefined, undefined, tz);
      candidateSlotsMap.set(focusItem.id, candidates);

      if (candidates.length === 0) continue;

      const scored = candidates.map((c) => ({
        ...c,
        score: scoreSlot(c, focusItem, placements, bufferConfig, tz),
      }));
      scored.sort((a, b) => b.score - a.score);

      const best = scored[0];
      const placement: TimeSlot = { start: new Date(best.start), end: new Date(best.end) };
      placements.set(focusItem.id, placement);
      occupiedSlots.push(placement);
      placedTotal += focusItem.duration;
    }
  }
}

// ============================================================
// Calendar operation diffing
// ============================================================

function generateCalendarOperations(
  placements: Map<string, TimeSlot>,
  statuses: Map<string, EventStatus>,
  itemMap: Map<string, ScheduleItem>,
  existingManagedEvents: Map<string, CalendarEvent>,
  lockedExistingIds: Set<string> = new Set(),
): CalendarOperation[] {
  const operations: CalendarOperation[] = [];
  const processedExistingIds = new Set<string>(lockedExistingIds);

  for (const [itemId, placement] of placements) {
    const item = itemMap.get(itemId);
    if (!item) continue;

    const status = statuses.get(itemId) ?? EventStatus.Free;
    const existingEvent = existingManagedEvents.get(itemId);

    // Extract the original item id (before __ suffix)
    const originalItemId = itemId.split('__')[0];
    // Title uses human-readable name; status emoji is added by calendar client
    const title = item.name || `${item.type}: ${originalItemId}`;

    if (existingEvent) {
      processedExistingIds.add(itemId);
      // Check if the event needs to be updated
      const existingStart = new Date(existingEvent.start);
      const existingEnd = new Date(existingEvent.end);

      if (
        existingStart.getTime() !== placement.start.getTime() ||
        existingEnd.getTime() !== placement.end.getTime() ||
        existingEvent.status !== status ||
        existingEvent.title !== title
      ) {
        operations.push({
          type: CalendarOpType.Update,
          eventId: existingEvent.id,
          googleEventId: existingEvent.googleEventId || undefined,
          itemType: item.type,
          itemId,
          title,
          start: placement.start.toISOString(),
          end: placement.end.toISOString(),
          status,
          extendedProperties: {
            [EXTENDED_PROPS.cadenceId]: existingEvent.id,
            [EXTENDED_PROPS.itemType]: item.type,
            [EXTENDED_PROPS.itemId]: originalItemId,
            [EXTENDED_PROPS.status]: status,
          },
        });
      }
      // No change: skip
    } else {
      // New placement: create
      operations.push({
        type: CalendarOpType.Create,
        itemType: item.type,
        itemId,
        title,
        start: placement.start.toISOString(),
        end: placement.end.toISOString(),
        status,
        extendedProperties: {
          [EXTENDED_PROPS.itemType]: item.type,
          [EXTENDED_PROPS.itemId]: originalItemId,
          [EXTENDED_PROPS.status]: status,
        },
      });
    }
  }

  // Delete events that are no longer placed
  for (const [itemId, event] of existingManagedEvents) {
    if (!processedExistingIds.has(itemId)) {
      const originalItemId = itemId.split('__')[0];
      operations.push({
        type: CalendarOpType.Delete,
        eventId: event.id,
        googleEventId: event.googleEventId || undefined,
        itemType: event.itemType ?? ItemType.Task,
        itemId,
        title: event.title,
        start: event.start,
        end: event.end,
        status: event.status,
        extendedProperties: {
          [EXTENDED_PROPS.cadenceId]: event.id,
          [EXTENDED_PROPS.itemType]: event.itemType ?? ItemType.Task,
          [EXTENDED_PROPS.itemId]: originalItemId,
          [EXTENDED_PROPS.status]: event.status,
        },
      });
    }
  }

  return operations;
}
