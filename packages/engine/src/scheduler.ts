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
} from '@reclaim/shared';
import { TYPE_ORDER, STATUS_PREFIX, EXTENDED_PROPS } from '@reclaim/shared';
import { buildTimeline, getSchedulingWindow } from './timeline.js';
import { generateCandidateSlots, slotsOverlap } from './slots.js';
import { scoreSlot } from './scoring.js';
import { computeFreeBusyStatus } from './free-busy.js';

// ============================================================
// Day-of-week helpers
// ============================================================

function getDayAbbrev(date: Date): string {
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return days[date.getDay()];
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ============================================================
// Conversion helpers: domain objects -> ScheduleItems
// ============================================================

function parseTime(hhmm: string): { hours: number; minutes: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return { hours: h, minutes: m };
}

/**
 * Build a time window for a given day using HH:MM start/end strings.
 */
function buildDayWindow(
  day: Date,
  windowStart: string,
  windowEnd: string,
): TimeSlot {
  const start = parseTime(windowStart);
  const end = parseTime(windowEnd);
  const s = new Date(day);
  s.setHours(start.hours, start.minutes, 0, 0);
  const e = new Date(day);
  e.setHours(end.hours, end.minutes, 0, 0);
  return { start: s, end: e };
}

/**
 * Enumerate all days in [startDate, endDate] inclusive.
 */
function enumerateDays(startDate: Date, endDate: Date): Date[] {
  const days: Date[] = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  while (current <= end) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
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
): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  const days = enumerateDays(scheduleStart, scheduleEnd);

  for (const habit of habits) {
    if (!habit.enabled) continue;

    // Choose ideal duration (midpoint of min/max)
    const duration = Math.round((habit.durationMin + habit.durationMax) / 2);

    if (habit.frequency === Frequency.Daily) {
      const applicableDays = habit.frequencyConfig?.days ?? [
        'mon', 'tue', 'wed', 'thu', 'fri',
      ];

      for (const day of days) {
        const dayAbbrev = getDayAbbrev(day);
        if (!applicableDays.includes(dayAbbrev)) continue;

        const timeWindow = buildDayWindow(day, habit.windowStart, habit.windowEnd);
        items.push({
          id: `${habit.id}__${day.toISOString().slice(0, 10)}`,
          type: ItemType.Habit,
          priority: habit.priority,
          timeWindow,
          idealTime: habit.idealTime,
          duration,
          locked: habit.locked,
          dependsOn: habit.dependsOn
            ? `${habit.dependsOn}__${day.toISOString().slice(0, 10)}`
            : null,
        });
      }
    } else if (habit.frequency === Frequency.Weekly) {
      // One instance per week - pick the first applicable day in each week
      const weekInterval = habit.frequencyConfig?.weekInterval ?? 1;
      const applicableDays = habit.frequencyConfig?.days ?? ['mon'];

      const scheduledWeeks = new Set<number>();
      for (const day of days) {
        const dayAbbrev = getDayAbbrev(day);
        if (!applicableDays.includes(dayAbbrev)) continue;

        const weekNum = getWeekNumber(day);
        if (scheduledWeeks.has(weekNum)) continue;
        if (weekInterval > 1 && weekNum % weekInterval !== 0) continue;

        scheduledWeeks.add(weekNum);
        const timeWindow = buildDayWindow(day, habit.windowStart, habit.windowEnd);
        items.push({
          id: `${habit.id}__w${weekNum}`,
          type: ItemType.Habit,
          priority: habit.priority,
          timeWindow,
          idealTime: habit.idealTime,
          duration,
          locked: habit.locked,
          dependsOn: habit.dependsOn
            ? `${habit.dependsOn}__w${weekNum}`
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
    // Skip completed tasks
    if (task.status === TaskStatus.Completed) continue;

    const remaining = task.remainingDuration;
    if (remaining <= 0) continue;

    // Determine chunk size (prefer chunkMax, but don't exceed remaining)
    const chunkSize = Math.min(task.chunkMax, remaining);
    const numChunks = Math.ceil(remaining / chunkSize);

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

    for (let i = 0; i < numChunks; i++) {
      const thisChunkSize = Math.min(chunkSize, remaining - i * chunkSize);
      if (thisChunkSize <= 0) break;

      // Each chunk is its own ScheduleItem with the full time window
      const timeWindow: TimeSlot = {
        start: earliest < scheduleStart ? new Date(scheduleStart) : new Date(earliest),
        end: new Date(windowEnd),
      };

      items.push({
        id: `${task.id}__chunk${i}`,
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
): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  const days = enumerateDays(scheduleStart, scheduleEnd);

  for (const meeting of meetings) {
    if (meeting.frequency === Frequency.Daily) {
      for (const day of days) {
        // Skip weekends for meetings
        if (day.getDay() === 0 || day.getDay() === 6) continue;

        const timeWindow = buildDayWindow(day, meeting.windowStart, meeting.windowEnd);
        items.push({
          id: `${meeting.id}__${day.toISOString().slice(0, 10)}`,
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
      const scheduledWeeks = new Set<number>();
      for (const day of days) {
        if (day.getDay() === 0 || day.getDay() === 6) continue;
        const weekNum = getWeekNumber(day);
        if (scheduledWeeks.has(weekNum)) continue;

        scheduledWeeks.add(weekNum);
        const timeWindow = buildDayWindow(day, meeting.windowStart, meeting.windowEnd);
        items.push({
          id: `${meeting.id}__w${weekNum}`,
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
    return a.timeWindow.end.getTime() - b.timeWindow.end.getTime();
  });
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

  // 1. Define the scheduling window
  const scheduleStart = new Date(currentTime);
  const scheduleEnd = new Date(currentTime);
  scheduleEnd.setDate(scheduleEnd.getDate() + userSettings.schedulingWindowDays);

  // 2. Build timeline
  const timeline = buildTimeline(scheduleStart, scheduleEnd, userSettings);

  // 3. Separate fixed events from flexible items
  const fixedEvents: TimeSlot[] = [];
  const existingManagedEvents = new Map<string, CalendarEvent>();

  for (const event of calendarEvents) {
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);

    if (!event.isManaged || event.status === EventStatus.Locked) {
      // Fixed: external events or locked managed events
      fixedEvents.push({ start: eventStart, end: eventEnd });
    }

    if (event.isManaged && event.itemId) {
      existingManagedEvents.set(event.itemId, event);
    }
  }

  // 4. Convert domain objects to ScheduleItems
  const habitItems = habitsToScheduleItems(habits, scheduleStart, scheduleEnd);
  const taskItems = tasksToScheduleItems(tasks, scheduleStart, scheduleEnd, userSettings);
  const meetingItems = meetingsToScheduleItems(meetings, scheduleStart, scheduleEnd);

  // 5. Sort flexible items by priority
  const flexibleItems = sortScheduleItems([...habitItems, ...taskItems, ...meetingItems]);

  // 6. Greedy placement
  const occupiedSlots: TimeSlot[] = [...fixedEvents];
  const placements = new Map<string, TimeSlot>();
  const candidateSlotsMap = new Map<string, CandidateSlot[]>();
  const unschedulable: Array<{ itemId: string; itemType: ItemType; reason: string }> = [];
  const itemMap = new Map<string, ScheduleItem>();

  for (const item of flexibleItems) {
    itemMap.set(item.id, item);
  }

  for (const item of flexibleItems) {
    // Generate candidates
    const candidates = generateCandidateSlots(item, timeline, occupiedSlots, bufferConfig);
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
      score: scoreSlot(candidate, item, placements, bufferConfig),
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
): void {
  for (const rule of focusRules) {
    // Calculate how much focus time is already placed this week
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    let placedFocusMinutesThisWeek = 0;
    for (const [id, slot] of placements) {
      if (id.startsWith('focus_') && slot.start >= weekStart && slot.start < weekEnd) {
        const durationMs = slot.end.getTime() - slot.start.getTime();
        placedFocusMinutesThisWeek += durationMs / (1000 * 60);
      }
    }

    // Calculate remaining available time this week (in the timeline minus occupied)
    let remainingAvailableMinutes = 0;
    for (const slot of timeline) {
      if (slot.start < weekStart || slot.start >= weekEnd) continue;

      let availableMs = slot.end.getTime() - slot.start.getTime();
      // Subtract occupied overlaps
      for (const occupied of occupiedSlots) {
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
    const days = enumerateDays(now, scheduleEnd);

    for (const day of days) {
      if (placedTotal >= targetRemaining) break;

      // Build a focus schedule item for this day
      const { start: hourStart, end: hourEnd } = getSchedulingWindow(
        rule.schedulingHours,
        userSettings,
      );

      const focusItem: ScheduleItem = {
        id: `focus_${rule.id}__${day.toISOString().slice(0, 10)}`,
        type: ItemType.Focus,
        priority: Priority.Low,
        timeWindow: buildDayWindow(day, hourStart, hourEnd),
        idealTime: hourStart,
        duration: Math.min(blockSize, targetRemaining - placedTotal),
        locked: false,
        dependsOn: null,
      };

      itemMap.set(focusItem.id, focusItem);

      const candidates = generateCandidateSlots(focusItem, timeline, occupiedSlots, bufferConfig);
      candidateSlotsMap.set(focusItem.id, candidates);

      if (candidates.length === 0) continue;

      const scored = candidates.map((c) => ({
        ...c,
        score: scoreSlot(c, focusItem, placements, bufferConfig),
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
): CalendarOperation[] {
  const operations: CalendarOperation[] = [];
  const processedExistingIds = new Set<string>();

  for (const [itemId, placement] of placements) {
    const item = itemMap.get(itemId);
    if (!item) continue;

    const status = statuses.get(itemId) ?? EventStatus.Free;
    const existingEvent = existingManagedEvents.get(itemId);

    // Extract the original item id (before __ suffix)
    const originalItemId = itemId.split('__')[0];
    const title = `${STATUS_PREFIX[status]} ${item.type}: ${itemId}`;

    if (existingEvent) {
      processedExistingIds.add(itemId);
      // Check if the event needs to be updated
      const existingStart = new Date(existingEvent.start);
      const existingEnd = new Date(existingEvent.end);

      if (
        existingStart.getTime() !== placement.start.getTime() ||
        existingEnd.getTime() !== placement.end.getTime() ||
        existingEvent.status !== status
      ) {
        operations.push({
          type: CalendarOpType.Update,
          eventId: existingEvent.id,
          itemType: item.type,
          itemId: originalItemId,
          title,
          start: placement.start.toISOString(),
          end: placement.end.toISOString(),
          status,
          extendedProperties: {
            [EXTENDED_PROPS.reclaimId]: existingEvent.id,
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
        itemId: originalItemId,
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
        itemType: event.itemType ?? ItemType.Task,
        itemId: originalItemId,
        title: event.title,
        start: event.start,
        end: event.end,
        status: event.status,
        extendedProperties: {
          [EXTENDED_PROPS.reclaimId]: event.id,
          [EXTENDED_PROPS.itemType]: event.itemType ?? ItemType.Task,
          [EXTENDED_PROPS.itemId]: originalItemId,
          [EXTENDED_PROPS.status]: event.status,
        },
      });
    }
  }

  return operations;
}
