import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { focusTimeRules } from '../db/pg-schema.js';
import type { FocusTimeRule } from '@cadence/shared';
import { updateFocusSchema } from '../validation.js';
import { broadcastToUser } from '../ws.js';
import { triggerReschedule } from '../polling-ref.js';
import { sendValidationError, sendNotFound } from './helpers.js';

const router = Router();

// GET /api/focus-time — get focus time rules for the current user
router.get('/', async (req, res) => {
  const userId = req.userId;
  const rows = await db.select().from(focusTimeRules).where(eq(focusTimeRules.userId, userId));

  if (rows.length === 0) {
    sendNotFound(res, 'Focus time rules');
    return;
  }

  res.json(toFocusTimeRule(rows[0]));
});

// PUT /api/focus-time — update (upsert single row per user)
router.put('/', async (req, res) => {
  const parsed = updateFocusSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const userId = req.userId;
  const body = parsed.data;

  const existing = await db.select().from(focusTimeRules).where(eq(focusTimeRules.userId, userId));

  if (existing.length > 0) {
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (body.weeklyTargetMinutes !== undefined) updates.weeklyTargetMinutes = body.weeklyTargetMinutes;
    if (body.dailyTargetMinutes !== undefined) updates.dailyTargetMinutes = body.dailyTargetMinutes;
    if (body.schedulingHours !== undefined) updates.schedulingHours = body.schedulingHours;
    if (body.enabled !== undefined) updates.enabled = body.enabled;

    await db.update(focusTimeRules).set(updates).where(eq(focusTimeRules.userId, userId));
  } else {
    await db.insert(focusTimeRules).values({
      userId,
      weeklyTargetMinutes: body.weeklyTargetMinutes ?? 600,
      dailyTargetMinutes: body.dailyTargetMinutes ?? 120,
      schedulingHours: body.schedulingHours ?? 'working',
      enabled: body.enabled ?? false,
    });
  }

  const updated = await db.select().from(focusTimeRules).where(eq(focusTimeRules.userId, userId));
  broadcastToUser(req.userId, 'schedule_updated', 'Focus time updated');
  triggerReschedule('Focus time updated', req.userId);
  res.json(toFocusTimeRule(updated[0]));
});

function toFocusTimeRule(row: typeof focusTimeRules.$inferSelect): FocusTimeRule {
  return {
    id: row.id,
    weeklyTargetMinutes: row.weeklyTargetMinutes ?? 600,
    dailyTargetMinutes: row.dailyTargetMinutes ?? 120,
    schedulingHours: (row.schedulingHours ?? 'working') as FocusTimeRule['schedulingHours'],
    enabled: row.enabled ?? true,
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

export default router;
