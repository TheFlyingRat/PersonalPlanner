import {
  CandidateSlot,
  ScheduleItem,
  TimeSlot,
  BufferConfig,
} from '@cadence/shared';
import { isSameDay, getDatePartsInTimezone } from './utils.js';

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
 * Get minutes-since-midnight from a Date in a specific timezone.
 */
function dateToMinutesSinceMidnight(d: Date, tz?: string): number {
  if (tz) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0');
    const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0');
    return (h === 24 ? 0 : h) * 60 + m;
  }
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Score a candidate slot for a given schedule item.
 *
 * When idealTime is explicitly set by the user, ideal-time proximity
 * dominates (55 pts) and the generic time-of-day bias is suppressed.
 * Otherwise the original balanced weights apply.
 *
 * Scoring factors (total 0-100):
 *  With idealTime:       Without idealTime:
 *  - Ideal time: 55      - Ideal time: 40
 *  - Buffer:     20      - Buffer:     25
 *  - Continuity: 20      - Continuity: 20
 *  - Time-of-day: 5      - Time-of-day: 15
 */
export function scoreSlot(
  slot: CandidateSlot,
  item: ScheduleItem,
  existingPlacements: Map<string, TimeSlot>,
  bufferConfig: BufferConfig,
  tz?: string,
): number {
  let score = 0;

  const hasIdealTime = !!item.idealTime && /^\d{1,2}:\d{2}$/.test(item.idealTime);
  const wIdeal = hasIdealTime ? 55 : 40;
  const wBuffer = hasIdealTime ? 20 : 25;
  const wContinuity = 20;
  const wTimeOfDay = hasIdealTime ? 5 : 15;

  // 1. Proximity to ideal time
  score += scoreIdealTimeProximity(slot, item, tz) * wIdeal;

  // 2. Buffer compliance
  score += scoreBufferCompliance(slot, existingPlacements, bufferConfig, tz) * wBuffer;

  // 3. Continuity with related/dependent items
  score += scoreContinuity(slot, item, existingPlacements, tz) * wContinuity;

  // 4. Time-of-day preference
  score += scoreTimeOfDay(slot, item) * wTimeOfDay;

  return Math.round(score * 100) / 100;
}

/**
 * Score proximity to ideal time (0-1 scale).
 * Ideal time is an HH:MM preference. The closer the slot start is, the better.
 *
 * Uses a Gaussian decay so that being right on the ideal time scores ~1.0,
 * 30 min away scores ~0.70, 60 min away scores ~0.24, and 2h+ away is near 0.
 * This makes the ideal time a strong attractor when explicitly set.
 */
function scoreIdealTimeProximity(slot: CandidateSlot, item: ScheduleItem, tz?: string): number {
  const idealMinutes = parseTimeToMinutes(item.idealTime);
  const slotMinutes = dateToMinutesSinceMidnight(slot.start, tz);

  const diff = Math.abs(slotMinutes - idealMinutes);

  // Gaussian decay: sigma = 75 min
  // On-target: 1.0, 30min off: 0.92, 60min off: 0.73, 2h off: 0.28
  const sigma = 75;
  return Math.exp(-(diff * diff) / (2 * sigma * sigma));
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
  tz?: string,
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
    if (!isSameDay(slot.start, placement.start, tz)) {
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
  tz?: string,
): number {
  if (!item.dependsOn) {
    return 0.5; // Neutral — no dependency
  }

  const dependency = existingPlacements.get(item.dependsOn);
  if (!dependency) {
    return 0.5; // Dependency not yet placed — neutral
  }

  // Must be on the same day
  if (!isSameDay(slot.start, dependency.start, tz)) {
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

