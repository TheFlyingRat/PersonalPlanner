import {
  ScheduleItem,
  CalendarEvent,
  FocusTimeRule,
  BufferConfig,
  ItemType,
  Priority,
  QualityScore,
  QualityComponent,
  TimeSlot,
} from '@cadence/shared';
import { getFormatter } from './utils.js';

/**
 * Parse "HH:MM" into minutes since midnight.
 */
function parseTimeToMinutes(hhmm: string): number {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Get minutes-since-midnight from a Date in a specific timezone.
 */
function dateToMinutesSinceMidnight(d: Date, tz: string): number {
  const fmt = getFormatter(tz, { hour: 'numeric', minute: 'numeric', hour12: false });
  const parts = fmt.formatToParts(d);
  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0');
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0');
  return (h === 24 ? 0 : h) * 60 + m;
}

/**
 * Calculate a schedule quality score from placed items and context.
 *
 * Pure function — no side effects or DB access.
 *
 * @param items        All ScheduleItems that were candidates for scheduling
 * @param placements   Map of itemId -> placed TimeSlot (items that got scheduled)
 * @param focusRules   Active focus time rules
 * @param bufferConfig Buffer/decompression settings
 * @param focusMinutesPlaced Actual focus minutes placed this period
 * @param tz           IANA timezone string
 */
export function calculateScheduleQuality(
  items: ScheduleItem[],
  placements: Map<string, TimeSlot>,
  focusRules: FocusTimeRule[],
  bufferConfig: BufferConfig,
  focusMinutesPlaced: number,
  tz: string,
): QualityScore {
  const breakdown: string[] = [];

  // 1. Placement rate (30%)
  const placement = scorePlacement(items, placements, breakdown);

  // 2. Ideal time proximity (25%)
  const idealTime = scoreIdealTime(items, placements, tz, breakdown);

  // 3. Focus time achievement (20%)
  const focusTime = scoreFocusTime(focusRules, focusMinutesPlaced, breakdown);

  // 4. Buffer compliance (15%)
  const buffers = scoreBuffers(items, placements, bufferConfig, tz, breakdown);

  // 5. Priority respect (10%)
  const priorities = scorePriorities(items, placements, breakdown);

  const overall = Math.round(
    placement.score * placement.weight +
    idealTime.score * idealTime.weight +
    focusTime.score * focusTime.weight +
    buffers.score * buffers.weight +
    priorities.score * priorities.weight,
  );

  return {
    overall,
    components: { placement, idealTime, focusTime, buffers, priorities },
    breakdown,
  };
}

function scorePlacement(
  items: ScheduleItem[],
  placements: Map<string, TimeSlot>,
  breakdown: string[],
): QualityComponent {
  const total = items.length;
  if (total === 0) {
    return { score: 100, weight: 0.3, label: 'Placement Rate' };
  }

  const placed = items.filter(item => placements.has(item.id)).length;
  const unplaced = total - placed;
  const score = Math.round((placed / total) * 100);

  if (unplaced > 0) {
    const byType = new Map<ItemType, number>();
    for (const item of items) {
      if (!placements.has(item.id)) {
        byType.set(item.type, (byType.get(item.type) ?? 0) + 1);
      }
    }
    for (const [type, count] of byType) {
      breakdown.push(`${count} ${type}${count > 1 ? 's' : ''} couldn't be scheduled`);
    }
  } else {
    breakdown.push('All items successfully scheduled');
  }

  return { score, weight: 0.3, label: 'Placement Rate' };
}

function scoreIdealTime(
  items: ScheduleItem[],
  placements: Map<string, TimeSlot>,
  tz: string,
  breakdown: string[],
): QualityComponent {
  const placedItems = items.filter(item => placements.has(item.id) && item.idealTime);
  if (placedItems.length === 0) {
    return { score: 100, weight: 0.25, label: 'Ideal Time' };
  }

  let totalScore = 0;
  let closeCount = 0;
  let farCount = 0;

  for (const item of placedItems) {
    const slot = placements.get(item.id)!;
    const idealMin = parseTimeToMinutes(item.idealTime);
    const slotMin = dateToMinutesSinceMidnight(slot.start, tz);
    const diff = Math.abs(slotMin - idealMin);

    // Linear scale: 0 diff = 100, 120+ min diff = 0
    const itemScore = Math.max(0, 100 - (diff / 120) * 100);
    totalScore += itemScore;

    if (diff <= 30) closeCount++;
    if (diff > 120) farCount++;
  }

  const score = Math.round(totalScore / placedItems.length);

  if (closeCount > 0) {
    breakdown.push(`${closeCount} item${closeCount > 1 ? 's' : ''} placed within 30 min of ideal time`);
  }
  if (farCount > 0) {
    breakdown.push(`${farCount} item${farCount > 1 ? 's' : ''} placed >2h from ideal time`);
  }

  return { score, weight: 0.25, label: 'Ideal Time' };
}

function scoreFocusTime(
  focusRules: FocusTimeRule[],
  focusMinutesPlaced: number,
  breakdown: string[],
): QualityComponent {
  const activeRules = focusRules.filter(r => r.enabled);
  if (activeRules.length === 0) {
    // No focus rule configured — full marks, not applicable
    return { score: 100, weight: 0.2, label: 'Focus Time' };
  }

  const targetDaily = activeRules.reduce((sum, r) => sum + r.dailyTargetMinutes, 0);
  if (targetDaily === 0) {
    return { score: 100, weight: 0.2, label: 'Focus Time' };
  }

  const ratio = focusMinutesPlaced / targetDaily;
  const score = Math.min(100, Math.round(ratio * 100));
  const pct = Math.round(ratio * 100);
  breakdown.push(`Focus time ${pct}% of daily target`);

  return { score, weight: 0.2, label: 'Focus Time' };
}

function scoreBuffers(
  items: ScheduleItem[],
  placements: Map<string, TimeSlot>,
  bufferConfig: BufferConfig,
  tz: string,
  breakdown: string[],
): QualityComponent {
  const meetingItems = items.filter(
    item => item.type === ItemType.Meeting && placements.has(item.id) && !item.skipBuffer,
  );

  if (meetingItems.length === 0 || bufferConfig.breakBetweenItemsMinutes === 0) {
    return { score: 100, weight: 0.15, label: 'Buffer Compliance' };
  }

  const requiredBufferMs = bufferConfig.breakBetweenItemsMinutes * 60 * 1000;
  let compliant = 0;

  for (const meeting of meetingItems) {
    const slot = placements.get(meeting.id)!;
    let hasAdequateBuffer = true;

    for (const other of placements.values()) {
      if (other.start.getTime() === slot.start.getTime() && other.end.getTime() === slot.end.getTime()) {
        continue; // same slot
      }

      // Check gap before meeting
      if (other.end.getTime() <= slot.start.getTime()) {
        const gap = slot.start.getTime() - other.end.getTime();
        if (gap > 0 && gap < requiredBufferMs) {
          hasAdequateBuffer = false;
          break;
        }
      }

      // Check gap after meeting
      if (slot.end.getTime() <= other.start.getTime()) {
        const gap = other.start.getTime() - slot.end.getTime();
        if (gap > 0 && gap < requiredBufferMs) {
          hasAdequateBuffer = false;
          break;
        }
      }
    }

    if (hasAdequateBuffer) compliant++;
  }

  const score = Math.round((compliant / meetingItems.length) * 100);
  const noncompliant = meetingItems.length - compliant;
  if (noncompliant > 0) {
    breakdown.push(`${noncompliant} meeting${noncompliant > 1 ? 's' : ''} missing buffer time`);
  } else {
    breakdown.push('All meetings have proper buffer time');
  }

  return { score, weight: 0.15, label: 'Buffer Compliance' };
}

/**
 * Count inversions and total differing-priority pairs using a modified merge sort.
 * O(n log n) instead of O(n²). An inversion is when a lower-priority item
 * (higher number) appears before a higher-priority item (lower number).
 */
function countInversions(arr: number[]): { inversions: number; totalPairs: number } {
  // Count total differing-priority pairs (this is always n*(n-1)/2 minus same-priority pairs)
  const freqMap = new Map<number, number>();
  for (const v of arr) {
    freqMap.set(v, (freqMap.get(v) ?? 0) + 1);
  }
  const n = arr.length;
  const totalAllPairs = (n * (n - 1)) / 2;
  let samePriorityPairs = 0;
  for (const count of freqMap.values()) {
    samePriorityPairs += (count * (count - 1)) / 2;
  }
  const totalPairs = totalAllPairs - samePriorityPairs;

  // Merge sort to count inversions (where left[i] > right[j])
  function mergeSortCount(a: number[]): { sorted: number[]; inv: number } {
    if (a.length <= 1) return { sorted: a, inv: 0 };
    const mid = Math.floor(a.length / 2);
    const left = mergeSortCount(a.slice(0, mid));
    const right = mergeSortCount(a.slice(mid));
    let inv = left.inv + right.inv;
    const sorted: number[] = [];
    let i = 0, j = 0;
    while (i < left.sorted.length && j < right.sorted.length) {
      if (left.sorted[i] <= right.sorted[j]) {
        sorted.push(left.sorted[i++]);
      } else {
        // left.sorted[i] > right.sorted[j]: all remaining left elements are inversions
        // But we only count pairs where priorities differ
        // Since we want inversions where left > right (higher number = lower priority before higher priority),
        // count how many left elements are strictly greater than right[j]
        inv += left.sorted.length - i;
        sorted.push(right.sorted[j++]);
      }
    }
    while (i < left.sorted.length) sorted.push(left.sorted[i++]);
    while (j < right.sorted.length) sorted.push(right.sorted[j++]);
    return { sorted, inv };
  }

  // The merge sort counts all pairs where left > right (including same-priority).
  // We need to subtract same-priority "inversions" which aren't real inversions.
  // However, same-priority elements with left > right doesn't happen since they're equal.
  // Merge sort counts left[i] > right[j], and equal elements go left-first (<=),
  // so same-priority pairs are never counted. This is correct as-is.
  const { inv: inversions } = mergeSortCount(arr);

  return { inversions, totalPairs };
}

function scorePriorities(
  items: ScheduleItem[],
  placements: Map<string, TimeSlot>,
  breakdown: string[],
): QualityComponent {
  const placedItems = items
    .filter(item => placements.has(item.id))
    .map(item => ({
      priority: item.priority,
      startMs: placements.get(item.id)!.start.getTime(),
    }))
    .sort((a, b) => a.startMs - b.startMs);

  if (placedItems.length <= 1) {
    return { score: 100, weight: 0.1, label: 'Priority Respect' };
  }

  // Use O(n log n) merge sort inversion count (PERF-H3)
  const priorities = placedItems.map(p => p.priority);
  const { inversions, totalPairs } = countInversions(priorities);

  if (totalPairs === 0) {
    return { score: 100, weight: 0.1, label: 'Priority Respect' };
  }

  const inversionRate = inversions / totalPairs;
  const score = Math.round((1 - inversionRate) * 100);

  if (inversions > 0) {
    breakdown.push(`${inversions} priority inversion${inversions > 1 ? 's' : ''} detected`);
  } else {
    breakdown.push('Priority order fully respected');
  }

  return { score, weight: 0.1, label: 'Priority Respect' };
}
