import { Router } from 'express';
import { desc, eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { activityLog } from '../db/schema.js';
import type { ActivityLogEntry } from '@cadence/shared';

const router = Router();

// GET /api/activity?limit=50&entityType=habit
router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
  const entityType = req.query.entityType as string | undefined;

  let rows;
  if (entityType) {
    rows = db.select().from(activityLog)
      .where(eq(activityLog.entityType, entityType))
      .orderBy(desc(activityLog.createdAt))
      .limit(limit)
      .all();
  } else {
    rows = db.select().from(activityLog)
      .orderBy(desc(activityLog.createdAt))
      .limit(limit)
      .all();
  }

  const result: ActivityLogEntry[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    details: row.details,
    createdAt: row.createdAt ?? '',
  }));

  res.json(result);
});

export default router;

export function logActivity(
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>,
): void {
  db.insert(activityLog).values({
    id: crypto.randomUUID(),
    action,
    entityType,
    entityId,
    details: details ? JSON.stringify(details) : null,
    createdAt: new Date().toISOString(),
  }).run();
}
