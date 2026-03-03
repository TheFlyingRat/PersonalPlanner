import {
  ScheduleItem,
  TimeSlot,
  CandidateSlot,
  BufferConfig,
} from '@reclaim/shared';

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
 * 4. Return candidates with an initial score of 0 (scoring happens later).
 */
export function generateCandidateSlots(
  item: ScheduleItem,
  timeline: TimeSlot[],
  occupiedSlots: TimeSlot[],
  bufferConfig: BufferConfig,
): CandidateSlot[] {
  const candidates: CandidateSlot[] = [];
  const durationMs = item.duration * 60 * 1000;
  const stepMs = 15 * 60 * 1000; // 15-minute step for sliding window
  const bufferMs = bufferConfig.breakBetweenItemsMinutes * 60 * 1000;

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
      const candidateSlot: TimeSlot = {
        start: new Date(candidateStart),
        end: new Date(candidateEnd),
      };

      // Check for overlap with occupied slots (including buffer)
      const hasConflict = occupiedSlots.some((occupied) => {
        // Expand occupied slot by buffer on both sides
        const bufferedOccupied: TimeSlot = {
          start: new Date(occupied.start.getTime() - bufferMs),
          end: new Date(occupied.end.getTime() + bufferMs),
        };
        return slotsOverlap(candidateSlot, bufferedOccupied);
      });

      if (!hasConflict) {
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
