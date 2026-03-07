import { Router } from 'express';
import { desc, eq, and } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { activityLog } from '../db/pg-schema.js';
import type { ActivityLogEntry } from '@cadence/shared';
import { sendError } from './helpers.js';

const router = Router();

const VALID_ENTITY_TYPES = ['habit', 'task', 'meeting', 'link', 'schedule'] as const;

// GET /api/activity?limit=50&entityType=habit
router.get('/', async (req, res) => {
  const limit = Math.min(Math.max(1, parseInt(req.query.limit as string, 10) || 50), 200);
  const entityType = req.query.entityType as string | undefined;

  if (entityType && !VALID_ENTITY_TYPES.includes(entityType as any)) {
    sendError(res, 400, 'Invalid entity type');
    return;
  }

  const userId = req.userId;

  let rows;
  if (entityType) {
    rows = await db.select().from(activityLog)
      .where(and(eq(activityLog.userId, userId), eq(activityLog.entityType, entityType)))
      .orderBy(desc(activityLog.createdAt))
      .limit(limit);
  } else {
    rows = await db.select().from(activityLog)
      .where(eq(activityLog.userId, userId))
      .orderBy(desc(activityLog.createdAt))
      .limit(limit);
  }

  const result: ActivityLogEntry[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    details: (row.details as string | null) ?? null,
    createdAt: row.createdAt ?? '',
  }));

  res.json(result);
});

export default router;

export async function logActivity(
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await db.insert(activityLog).values({
    userId,
    action,
    entityType,
    entityId,
    details: details ?? null,
  });
}
