import {
  EventStatus,
  TimeSlot,
  CandidateSlot,
} from '@cadence/shared';
import { FLIP_THRESHOLDS } from '@cadence/shared';
import { slotsOverlap } from './slots.js';

/**
 * Compute the Free/Busy/Locked status for a placed schedule item.
 *
 * Logic:
 * 1. If item is locked: return Locked
 * 2. Count remaining alternative slots (candidates that don't overlap
 *    the current placement)
 * 3. If alternatives < FLIP_THRESHOLDS.minAlternativeSlots: return Busy
 * 4. If time until start < FLIP_THRESHOLDS.hoursBeforeStart hours: return Busy
 * 5. Otherwise: return Free
 */
export function computeFreeBusyStatus(
  _itemId: string,
  currentPlacement: TimeSlot,
  allCandidateSlots: CandidateSlot[],
  now: Date,
  locked: boolean = false,
): EventStatus {
  // 1. Locked items stay locked
  if (locked) {
    return EventStatus.Locked;
  }

  // 2. Count remaining alternatives (candidates that don't overlap current placement)
  const alternatives = allCandidateSlots.filter(
    (candidate) => !slotsOverlap(candidate, currentPlacement),
  );

  // 3. Few alternatives -> Busy
  if (alternatives.length < FLIP_THRESHOLDS.minAlternativeSlots) {
    return EventStatus.Busy;
  }

  // 4. Close to start time -> Busy
  const hoursUntilStart =
    (currentPlacement.start.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hoursUntilStart < FLIP_THRESHOLDS.hoursBeforeStart) {
    return EventStatus.Busy;
  }

  // 5. Otherwise -> Free (can be moved)
  return EventStatus.Free;
}
