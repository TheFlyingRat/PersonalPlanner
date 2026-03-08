import { schedulerRegistry } from './scheduler-registry.js';

/**
 * Trigger a reschedule for a specific user.
 * Lazily starts the user's scheduler if not already running.
 * Fire-and-forget -- errors are logged, not thrown.
 */
export function triggerReschedule(reason: string, userId?: string): void {
  if (!userId) return;

  schedulerRegistry.getOrCreate(userId).then((scheduler) => {
    return scheduler.triggerReschedule(reason);
  }).catch((err) => {
    console.error(`[scheduler] Background reschedule failed for user ${userId} (${reason}):`, err);
  });
}
