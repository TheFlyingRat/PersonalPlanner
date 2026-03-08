import { Router } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { habits, scheduledEvents, habitCompletions } from '../db/pg-schema.js';
import type { CreateHabitRequest, Habit, FrequencyConfig, HabitCompletion } from '@cadence/shared';
import { createHabitSchema, updateHabitSchema, lockBodySchema } from '../validation.js';
import { logActivity } from './activity.js';
import { broadcastToUser } from '../ws.js';
import { triggerReschedule } from '../polling-ref.js';
import { sendValidationError, sendNotFound, sendError, validateUUID } from './helpers.js';

const router = Router();

// GET /api/habits — list all habits for the current user
router.get('/', async (req, res) => {
  const rows = await db.select().from(habits).where(eq(habits.userId, req.userId));
  const result: Habit[] = rows.map(toHabit);
  res.json(result);
});

// POST /api/habits — create a habit
router.post('/', async (req, res) => {
  const parsed = createHabitSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const body = parsed.data as CreateHabitRequest;

  // Validate dependsOn references an existing habit owned by this user
  if (body.dependsOn) {
    const depRows = await db.select().from(habits).where(and(eq(habits.id, body.dependsOn), eq(habits.userId, req.userId)));
    if (depRows.length === 0) {
      sendError(res, 400, 'Referenced habit not found');
      return;
    }
  }

  const row = {
    userId: req.userId,
    name: body.name,
    priority: body.priority ?? 3,
    windowStart: body.windowStart,
    windowEnd: body.windowEnd,
    idealTime: body.idealTime,
    durationMin: body.durationMin,
    durationMax: body.durationMax,
    frequency: body.frequency,
    frequencyConfig: body.frequencyConfig ?? null,
    schedulingHours: body.schedulingHours ?? 'working',
    locked: false,
    autoDecline: body.autoDecline ?? false,
    dependsOn: body.dependsOn ?? null,
    enabled: true,
    skipBuffer: body.skipBuffer ?? false,
    notifications: body.notifications ?? false,
    calendarId: body.calendarId ?? null,
    color: body.color ?? null,
  };

  const inserted = await db.insert(habits).values(row).returning();
  const created = inserted[0];
  await logActivity(req.userId, 'create', 'habit', created.id, { name: body.name });
  broadcastToUser(req.userId, 'schedule_updated', 'Habit created');
  triggerReschedule('Habit created', req.userId);
  res.status(201).json(toHabit(created));
});

// PUT /api/habits/:id — update a habit
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;
  const existing = await db.select().from(habits).where(and(eq(habits.id, id), eq(habits.userId, req.userId)));

  if (existing.length === 0) {
    sendNotFound(res, 'Habit');
    return;
  }

  const parsed = updateHabitSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const body = parsed.data;

  // Validate dependsOn references an existing habit and is not a self-reference
  if (body.dependsOn !== undefined && body.dependsOn !== null) {
    if (body.dependsOn === id) {
      sendError(res, 400, 'A habit cannot depend on itself');
      return;
    }
    const depRows = await db.select().from(habits).where(and(eq(habits.id, body.dependsOn), eq(habits.userId, req.userId)));
    if (depRows.length === 0) {
      sendError(res, 400, 'Referenced habit not found');
      return;
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (body.name !== undefined) updates.name = body.name;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.windowStart !== undefined) updates.windowStart = body.windowStart;
  if (body.windowEnd !== undefined) updates.windowEnd = body.windowEnd;
  if (body.idealTime !== undefined) updates.idealTime = body.idealTime;
  if (body.durationMin !== undefined) updates.durationMin = body.durationMin;
  if (body.durationMax !== undefined) updates.durationMax = body.durationMax;
  if (body.frequency !== undefined) updates.frequency = body.frequency;
  if (body.frequencyConfig !== undefined) updates.frequencyConfig = body.frequencyConfig;
  if (body.schedulingHours !== undefined) updates.schedulingHours = body.schedulingHours;
  if (body.locked !== undefined) updates.locked = body.locked;
  if (body.autoDecline !== undefined) updates.autoDecline = body.autoDecline;
  if (body.dependsOn !== undefined) updates.dependsOn = body.dependsOn;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.skipBuffer !== undefined) updates.skipBuffer = body.skipBuffer;
  if (body.notifications !== undefined) updates.notifications = body.notifications;
  if (body.calendarId !== undefined) updates.calendarId = body.calendarId;
  if (body.color !== undefined) updates.color = body.color;

  const updated = await db.update(habits).set(updates).where(and(eq(habits.id, id), eq(habits.userId, req.userId))).returning();
  await logActivity(req.userId, 'update', 'habit', id, { fields: Object.keys(updates) });
  broadcastToUser(req.userId, 'schedule_updated', 'Habit updated');
  triggerReschedule('Habit updated', req.userId);
  res.json(toHabit(updated[0]));
});

// DELETE /api/habits/:id — delete habit and its scheduled events
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;
  const existing = await db.select().from(habits).where(and(eq(habits.id, id), eq(habits.userId, req.userId)));

  if (existing.length === 0) {
    sendNotFound(res, 'Habit');
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(scheduledEvents).where(and(eq(scheduledEvents.itemId, id), eq(scheduledEvents.userId, req.userId)));
    await tx.delete(habits).where(and(eq(habits.id, id), eq(habits.userId, req.userId)));
  });
  await logActivity(req.userId, 'delete', 'habit', id, { name: existing[0].name });
  broadcastToUser(req.userId, 'schedule_updated', 'Habit deleted');
  triggerReschedule('Habit deleted', req.userId);

  res.status(204).send();
});

// POST /api/habits/:id/lock — toggle locked field
router.post('/:id/lock', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;
  const existing = await db.select().from(habits).where(and(eq(habits.id, id), eq(habits.userId, req.userId)));

  if (existing.length === 0) {
    sendNotFound(res, 'Habit');
    return;
  }

  const lockParsed = lockBodySchema.safeParse(req.body);
  if (!lockParsed.success) {
    sendValidationError(res, lockParsed.error);
    return;
  }

  const newLocked = lockParsed.data.locked;

  const updated = await db.update(habits)
    .set({ locked: newLocked, updatedAt: new Date().toISOString() })
    .where(and(eq(habits.id, id), eq(habits.userId, req.userId)))
    .returning();

  broadcastToUser(req.userId, 'schedule_updated', 'Habit lock toggled');
  triggerReschedule('Habit lock toggled', req.userId);
  res.json(toHabit(updated[0]));
});

// GET /api/habits/:id/completions — list completions for a habit
router.get('/:id/completions', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;
  const existing = await db.select().from(habits).where(and(eq(habits.id, id), eq(habits.userId, req.userId)));
  if (existing.length === 0) {
    sendNotFound(res, 'Habit');
    return;
  }

  const rows = await db.select().from(habitCompletions)
    .where(and(eq(habitCompletions.habitId, id), eq(habitCompletions.userId, req.userId)))
    .orderBy(desc(habitCompletions.scheduledDate));

  const result: HabitCompletion[] = rows.map((row) => ({
    id: row.id,
    habitId: row.habitId,
    scheduledDate: row.scheduledDate,
    completedAt: row.completedAt,
  }));

  res.json(result);
});

// POST /api/habits/:id/completions — record a completion
router.post('/:id/completions', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;
  const existing = await db.select().from(habits).where(and(eq(habits.id, id), eq(habits.userId, req.userId)));
  if (existing.length === 0) {
    sendNotFound(res, 'Habit');
    return;
  }

  const { scheduledDate } = req.body;
  if (!scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    sendError(res, 400, 'scheduledDate must be YYYY-MM-DD');
    return;
  }

  const now = new Date().toISOString();

  const inserted = await db.insert(habitCompletions).values({
    userId: req.userId,
    habitId: id,
    scheduledDate,
    completedAt: now,
  }).returning();

  await logActivity(req.userId, 'create', 'habit', id, { completion: scheduledDate });
  broadcastToUser(req.userId, 'schedule_updated', 'Habit completed');

  res.status(201).json({
    id: inserted[0].id,
    habitId: id,
    scheduledDate,
    completedAt: now,
  });
});

// GET /api/habits/:id/streak — compute current streak
router.get('/:id/streak', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;
  const existing = await db.select().from(habits).where(and(eq(habits.id, id), eq(habits.userId, req.userId)));
  if (existing.length === 0) {
    sendNotFound(res, 'Habit');
    return;
  }

  const rows = await db.select().from(habitCompletions)
    .where(and(eq(habitCompletions.habitId, id), eq(habitCompletions.userId, req.userId)))
    .orderBy(desc(habitCompletions.scheduledDate));

  const completedDates = new Set(rows.map((r) => r.scheduledDate));

  let streak = 0;
  const today = new Date();
  // Walk backward from today counting consecutive days with completions
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    if (completedDates.has(dateStr)) {
      streak++;
    } else {
      break;
    }
  }

  res.json({ habitId: id, currentStreak: streak });
});

function toHabit(row: typeof habits.$inferSelect): Habit {
  return {
    id: row.id,
    name: row.name,
    priority: row.priority ?? 3,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    idealTime: row.idealTime,
    durationMin: row.durationMin,
    durationMax: row.durationMax,
    frequency: row.frequency as Habit['frequency'],
    frequencyConfig: (row.frequencyConfig ?? {}) as FrequencyConfig,
    schedulingHours: (row.schedulingHours ?? 'working') as Habit['schedulingHours'],
    locked: row.locked ?? false,
    autoDecline: row.autoDecline ?? false,
    dependsOn: row.dependsOn ?? null,
    enabled: row.enabled ?? true,
    skipBuffer: row.skipBuffer ?? false,
    notifications: row.notifications ?? false,
    calendarId: row.calendarId ?? undefined,
    color: row.color ?? undefined,
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

export default router;
