import {
  ScheduleItem,
  TimeSlot,
  CandidateSlot,
  BufferConfig,
} from '@cadence/shared';
import { isSameDay } from './utils.js';

/**
 * Check whether two time slots overlap.
 */
export function slotsOverlap(a: TimeSlot, b: TimeSlot): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Generate candidate placement slots for a given ScheduleItem.
 *
 * 1. Walk the timeline and find slots that fall within the item's timeWindow.
 * 2. Within each available slot, slide a window of `item.duration` minutes
 *    to produce candidate placements.
 * 3. Filter out candidates that overlap with any occupied slot (including buffers).
 * 4. If dependsOn is set and the dependency is placed, filter out candidates
 *    that start before the dependency ends on the same day (hard constraint).
 * 5. Return candidates with an initial score of 0 (scoring happens later).
 */
export function generateCandidateSlots(
  item: ScheduleItem,
  timeline: TimeSlot[],
  occupiedSlots: TimeSlot[],
  bufferConfig: BufferConfig,
  existingPlacements?: Map<string, TimeSlot>,
  dependsOn?: string | null,
  tz?: string,
): CandidateSlot[] {
  const candidates: CandidateSlot[] = [];
  const durationMs = item.duration * 60 * 1000;
  if (durationMs <= 0) return candidates; // Prevent infinite loop on 0-duration items
  const stepMs = 15 * 60 * 1000; // 15-minute step for sliding window
  const bufferMs = item.skipBuffer ? 0 : bufferConfig.breakBetweenItemsMinutes * 60 * 1000;

  // PERF-H1: Pre-sort occupied slots by start time for binary search
  const sortedOccupied = occupiedSlots
    .map(s => ({
      startMs: s.start.getTime() - bufferMs,
      endMs: s.end.getTime() + bufferMs,
    }))
    .sort((a, b) => a.startMs - b.startMs);

  // Resolve dependency placement for hard constraint
  const depPlacement = (dependsOn && existingPlacements)
    ? existingPlacements.get(dependsOn) ?? null
    : null;

  for (const slot of timeline) {
    // The candidate must fall within the item's allowed time window
    const windowStart = Math.max(slot.start.getTime(), item.timeWindow.start.getTime());
    const windowEnd = Math.min(slot.end.getTime(), item.timeWindow.end.getTime());

    if (windowEnd - windowStart < durationMs) {
      continue; // slot too short for this item
    }

    // Slide a window across the available slot
    let candidateStart = windowStart;
    while (candidateStart + durationMs <= windowEnd) {
      const candidateEnd = candidateStart + durationMs;

      // PERF-H1: Use binary search to find first potentially overlapping occupied slot.
      // A buffered occupied slot overlaps candidate [candidateStart, candidateEnd]
      // iff occupied.startMs < candidateEnd AND occupied.endMs > candidateStart.
      // Binary search for the first slot where startMs < candidateEnd.
      let hasConflict = false;
      let lo = 0, hi = sortedOccupied.length;
      // Find first index where startMs >= candidateEnd (all before could overlap)
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sortedOccupied[mid].startMs < candidateEnd) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      // All slots at indices [0, lo) have startMs < candidateEnd.
      // Check backwards from lo-1 for any with endMs > candidateStart.
      // Cannot break early on endMs <= candidateStart because earlier slots
      // (sorted by startMs) may have longer durations with endMs > candidateStart.
      for (let i = lo - 1; i >= 0; i--) {
        if (sortedOccupied[i].endMs > candidateStart) {
          hasConflict = true;
          break;
        }
      }

      // Hard dependency constraint: candidate must start after
      // the dependency ends on the same day
      let violatesDependency = false;
      if (depPlacement) {
        if (
          candidateStart < depPlacement.end.getTime() &&
          isSameDay(new Date(candidateStart), depPlacement.start, tz)
        ) {
          violatesDependency = true;
        }
      }

      if (!hasConflict && !violatesDependency) {
        candidates.push({
          start: new Date(candidateStart),
          end: new Date(candidateEnd),
          score: 0,
        });
      }

      candidateStart += stepMs;
    }
  }

  return candidates;
}
