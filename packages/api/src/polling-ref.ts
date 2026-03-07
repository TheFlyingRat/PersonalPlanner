import { schedulerRegistry } from './scheduler-registry.js';

/**
 * Trigger a reschedule for a specific user.
 * Fire-and-forget -- errors are logged, not thrown.
 */
export function triggerReschedule(reason: string, userId?: string): void {
  if (!userId) return;

  const scheduler = schedulerRegistry.get(userId);
  if (scheduler) {
    scheduler.triggerReschedule(reason).catch((err) => {
      console.error(`[scheduler] Background reschedule failed for user ${userId} (${reason}):`, err);
    });
  }
}
