import {
  CandidateSlot,
  ScheduleItem,
  TimeSlot,
  BufferConfig,
} from '@reclaim/shared';

/**
 * Parse "HH:MM" into minutes since midnight.
 */
function parseTimeToMinutes(hhmm: string): number {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) {
    return 0;
  }
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Get minutes-since-midnight from a Date.
 */
function dateToMinutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Score a candidate slot for a given schedule item.
 *
 * Scoring factors (total 0-100):
 *  - Proximity to ideal time: 40% (40 points max)
 *  - Buffer compliance: 25% (25 points max)
 *  - Continuity with related items: 20% (20 points max)
 *  - Time-of-day preference: 15% (15 points max)
 */
export function scoreSlot(
  slot: CandidateSlot,
  item: ScheduleItem,
  existingPlacements: Map<string, TimeSlot>,
  bufferConfig: BufferConfig,
): number {
  let score = 0;

  // 1. Proximity to ideal time (40 points)
  score += scoreIdealTimeProximity(slot, item) * 40;

  // 2. Buffer compliance (25 points)
  score += scoreBufferCompliance(slot, existingPlacements, bufferConfig) * 25;

  // 3. Continuity with related/dependent items (20 points)
  score += scoreContinuity(slot, item, existingPlacements) * 20;

  // 4. Time-of-day preference (15 points)
  score += scoreTimeOfDay(slot, item) * 15;

  return Math.round(score * 100) / 100;
}

/**
 * Score proximity to ideal time (0-1 scale).
 * Ideal time is an HH:MM preference. The closer the slot start is, the better.
 * We measure distance in minutes and normalize by half a day (720 minutes).
 */
function scoreIdealTimeProximity(slot: CandidateSlot, item: ScheduleItem): number {
  const idealMinutes = parseTimeToMinutes(item.idealTime);
  const slotMinutes = dateToMinutesSinceMidnight(slot.start);

  const diff = Math.abs(slotMinutes - idealMinutes);
  const maxDiff = 720; // half day
  const normalized = Math.min(diff, maxDiff) / maxDiff;

  return 1 - normalized;
}

/**
 * Score buffer compliance (0-1 scale).
 * Checks how well the candidate respects buffers around existing placements.
 * Full score if the nearest neighbor is more than double the required buffer.
 * Proportional score otherwise.
 */
function scoreBufferCompliance(
  slot: CandidateSlot,
  existingPlacements: Map<string, TimeSlot>,
  bufferConfig: BufferConfig,
): number {
  if (existingPlacements.size === 0) {
    return 1; // No neighbors, full compliance
  }

  const requiredBufferMs = bufferConfig.breakBetweenItemsMinutes * 60 * 1000;
  if (requiredBufferMs === 0) {
    return 1;
  }

  let nearestGapMs = Infinity;

  for (const [, placement] of existingPlacements) {
    // Only consider placements on the same day
    if (!isSameDay(slot.start, placement.start)) {
      continue;
    }

    // Gap before: placement ends before slot starts
    if (placement.end.getTime() <= slot.start.getTime()) {
      const gap = slot.start.getTime() - placement.end.getTime();
      nearestGapMs = Math.min(nearestGapMs, gap);
    }

    // Gap after: slot ends before placement starts
    if (slot.end.getTime() <= placement.start.getTime()) {
      const gap = placement.start.getTime() - slot.end.getTime();
      nearestGapMs = Math.min(nearestGapMs, gap);
    }
  }

  if (nearestGapMs === Infinity) {
    return 1; // No same-day neighbors
  }

  // Perfect score if gap >= 2x required buffer, proportional otherwise
  const idealGap = requiredBufferMs * 2;
  return Math.min(nearestGapMs / idealGap, 1);
}

/**
 * Score continuity with related/dependent items (0-1 scale).
 * If the item depends on another item, it should be placed after it
 * on the same day, ideally close to it.
 */
function scoreContinuity(
  slot: CandidateSlot,
  item: ScheduleItem,
  existingPlacements: Map<string, TimeSlot>,
): number {
  if (!item.dependsOn) {
    return 0.5; // Neutral — no dependency
  }

  const dependency = existingPlacements.get(item.dependsOn);
  if (!dependency) {
    return 0.5; // Dependency not yet placed — neutral
  }

  // Must be on the same day
  if (!isSameDay(slot.start, dependency.start)) {
    return 0; // Wrong day — worst score
  }

  // Must be after the dependency
  if (slot.start.getTime() < dependency.end.getTime()) {
    return 0; // Before dependency — worst score
  }

  // Score by proximity: closer is better (within 4 hours = 240 min)
  const gapMinutes = (slot.start.getTime() - dependency.end.getTime()) / (1000 * 60);
  const maxDesiredGap = 240;
  const proximity = 1 - Math.min(gapMinutes / maxDesiredGap, 1);

  return proximity;
}

/**
 * Score time-of-day preference (0-1 scale).
 * Items scheduled within the middle of their allowed window get slightly
 * higher scores than those at the edges.
 */
function scoreTimeOfDay(slot: CandidateSlot, item: ScheduleItem): number {
  const windowStart = item.timeWindow.start.getTime();
  const windowEnd = item.timeWindow.end.getTime();
  const windowDuration = windowEnd - windowStart;

  if (windowDuration <= 0) {
    return 0.5;
  }

  // Prefer the first third of the scheduling window (earlier in the day)
  // but with ideal time being the strongest signal (handled in ideal time score)
  const slotStart = slot.start.getTime();
  const position = (slotStart - windowStart) / windowDuration;

  // Bell curve centered at 0.3 (slightly favor early in window)
  const center = 0.3;
  const spread = 0.5;
  const normalized = Math.exp(-Math.pow(position - center, 2) / (2 * spread * spread));

  return normalized;
}

/**
 * Check if two dates are on the same calendar day.
 */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
