import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { calendars } from '../db/pg-schema.js';
import { schedulerRegistry } from '../scheduler-registry.js';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const router = Router();

/**
 * Google Calendar push notification webhook.
 * Google sends POST with headers only (empty body).
 * Must respond 200 quickly; actual sync happens async.
 */
router.post('/google-calendar', (req, res) => {
  // Always respond 200 immediately — Google retries on 5xx
  res.status(200).end();

  const channelId = req.headers['x-goog-channel-id'] as string | undefined;
  const resourceId = req.headers['x-goog-resource-id'] as string | undefined;
  const resourceState = req.headers['x-goog-resource-state'] as string | undefined;
  const token = req.headers['x-goog-channel-token'] as string | undefined;

  if (!channelId || !resourceId) {
    console.warn('[webhook] Missing channel/resource ID headers');
    return;
  }

  // "sync" is the initial notification when a channel is created — no action needed
  if (resourceState === 'sync') {
    console.log(`[webhook] Sync notification for channel ${channelId}`);
    return;
  }

  // "not_exists" means the resource (calendar) was deleted — nothing to sync
  if (resourceState === 'not_exists') {
    console.log(`[webhook] Resource deleted notification for channel ${channelId}`);
    return;
  }

  // Process async — don't block the response
  void (async () => {
    try {
      // Look up the calendar by watch channel ID
      const rows = await db.select().from(calendars)
        .where(eq(calendars.watchChannelId, channelId));
      const cal = rows[0];

      if (!cal) {
        console.warn(`[webhook] Unknown channel ID: ${channelId}`);
        return;
      }

      // Verify token matches (constant-time to prevent timing oracle)
      if (cal.watchToken && (!token || !safeEqual(cal.watchToken, token))) {
        console.warn(`[webhook] Token mismatch for channel ${channelId}`);
        return;
      }

      // Verify resource ID matches
      if (cal.watchResourceId && cal.watchResourceId !== resourceId) {
        console.warn(`[webhook] Resource ID mismatch for channel ${channelId}`);
        return;
      }

      console.log(`[webhook] Calendar change notification for user ${cal.userId}, calendar ${cal.id}`);

      // Trigger sync via the scheduler registry
      await schedulerRegistry.handleWebhookNotification(cal.userId, cal.id);
    } catch (err) {
      console.error(`[webhook] Error processing notification for channel ${channelId}:`, err);
    }
  })();
});

export default router;
