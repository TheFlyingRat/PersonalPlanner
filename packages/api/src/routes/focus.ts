import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { focusTimeRules } from '../db/schema.js';
import type { FocusTimeRule } from '@cadence/shared';
import { updateFocusSchema } from '../validation.js';

const router = Router();

// GET /api/focus-time — get focus time rules
router.get('/', (_req, res) => {
  const row = db.select().from(focusTimeRules).where(eq(focusTimeRules.id, 'default')).get();

  if (!row) {
    res.status(404).json({ error: 'Focus time rules not found' });
    return;
  }

  res.json(toFocusTimeRule(row));
});

// PUT /api/focus-time — update (upsert single row)
router.put('/', (req, res) => {
  const parsed = updateFocusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }

  const body = parsed.data;
  const now = new Date().toISOString();

  const existing = db.select().from(focusTimeRules).where(eq(focusTimeRules.id, 'default')).get();

  if (existing) {
    const updates: Record<string, unknown> = { updatedAt: now };

    if (body.weeklyTargetMinutes !== undefined) updates.weeklyTargetMinutes = body.weeklyTargetMinutes;
    if (body.dailyTargetMinutes !== undefined) updates.dailyTargetMinutes = body.dailyTargetMinutes;
    if (body.schedulingHours !== undefined) updates.schedulingHours = body.schedulingHours;
    if (body.enabled !== undefined) updates.enabled = body.enabled;

    db.update(focusTimeRules).set(updates).where(eq(focusTimeRules.id, 'default')).run();
  } else {
    db.insert(focusTimeRules).values({
      id: 'default',
      weeklyTargetMinutes: body.weeklyTargetMinutes ?? 600,
      dailyTargetMinutes: body.dailyTargetMinutes ?? 120,
      schedulingHours: body.schedulingHours ?? 'working',
      enabled: body.enabled ?? false,
      createdAt: now,
      updatedAt: now,
    }).run();
  }

  const updated = db.select().from(focusTimeRules).where(eq(focusTimeRules.id, 'default')).get();
  res.json(toFocusTimeRule(updated!));
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
