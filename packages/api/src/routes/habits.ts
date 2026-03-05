import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { habits, scheduledEvents, habitCompletions } from '../db/schema.js';
import type { CreateHabitRequest, Habit, FrequencyConfig, HabitCompletion } from '@cadence/shared';
import { createHabitSchema, updateHabitSchema } from '../validation.js';
import { logActivity } from './activity.js';

const router = Router();

// GET /api/habits — list all habits
router.get('/', (_req, res) => {
  const rows = db.select().from(habits).all();
  const result: Habit[] = rows.map(toHabit);
  res.json(result);
});

// POST /api/habits — create a habit
router.post('/', (req, res) => {
  const parsed = createHabitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }
  const body = parsed.data as CreateHabitRequest;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const row = {
    id,
    name: body.name,
    priority: body.priority ?? 3,
    windowStart: body.windowStart,
    windowEnd: body.windowEnd,
    idealTime: body.idealTime,
    durationMin: body.durationMin,
    durationMax: body.durationMax,
    frequency: body.frequency,
    frequencyConfig: body.frequencyConfig ? JSON.stringify(body.frequencyConfig) : null,
    schedulingHours: body.schedulingHours ?? 'working',
    locked: false,
    autoDecline: body.autoDecline ?? false,
    dependsOn: body.dependsOn ?? null,
    enabled: true,
    calendarId: body.calendarId ?? null,
    color: body.color ?? null,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(habits).values(row).run();

  const created = db.select().from(habits).where(eq(habits.id, id)).get();
  logActivity('create', 'habit', id, { name: body.name });
  res.status(201).json(toHabit(created!));
});

// PUT /api/habits/:id — update a habit
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(habits).where(eq(habits.id, id)).get();

  if (!existing) {
    res.status(404).json({ error: 'Habit not found' });
    return;
  }

  const parsed = updateHabitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }

  const body = parsed.data;
  const now = new Date().toISOString();

  const updates: Record<string, unknown> = { updatedAt: now };

  if (body.name !== undefined) updates.name = body.name;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.windowStart !== undefined) updates.windowStart = body.windowStart;
  if (body.windowEnd !== undefined) updates.windowEnd = body.windowEnd;
  if (body.idealTime !== undefined) updates.idealTime = body.idealTime;
  if (body.durationMin !== undefined) updates.durationMin = body.durationMin;
  if (body.durationMax !== undefined) updates.durationMax = body.durationMax;
  if (body.frequency !== undefined) updates.frequency = body.frequency;
  if (body.frequencyConfig !== undefined) updates.frequencyConfig = JSON.stringify(body.frequencyConfig);
  if (body.schedulingHours !== undefined) updates.schedulingHours = body.schedulingHours;
  if (body.locked !== undefined) updates.locked = body.locked;
  if (body.autoDecline !== undefined) updates.autoDecline = body.autoDecline;
  if (body.dependsOn !== undefined) updates.dependsOn = body.dependsOn;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.calendarId !== undefined) updates.calendarId = body.calendarId;
  if (body.color !== undefined) updates.color = body.color;

  db.update(habits).set(updates).where(eq(habits.id, id)).run();

  const updated = db.select().from(habits).where(eq(habits.id, id)).get();
  logActivity('update', 'habit', id, { fields: Object.keys(updates) });
  res.json(toHabit(updated!));
});

// DELETE /api/habits/:id — delete habit and its scheduled events
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(habits).where(eq(habits.id, id)).get();

  if (!existing) {
    res.status(404).json({ error: 'Habit not found' });
    return;
  }

  db.delete(scheduledEvents).where(eq(scheduledEvents.itemId, id)).run();
  db.delete(habits).where(eq(habits.id, id)).run();
  logActivity('delete', 'habit', id, { name: existing.name });

  res.status(204).send();
});

// POST /api/habits/:id/lock — toggle locked field
router.post('/:id/lock', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(habits).where(eq(habits.id, id)).get();

  if (!existing) {
    res.status(404).json({ error: 'Habit not found' });
    return;
  }

  const { locked } = req.body;
  const newLocked = locked !== undefined ? !!locked : !existing.locked;

  const now = new Date().toISOString();
  db.update(habits)
    .set({ locked: newLocked, updatedAt: now })
    .where(eq(habits.id, id))
    .run();

  const updated = db.select().from(habits).where(eq(habits.id, id)).get();
  res.json(toHabit(updated!));
});

// GET /api/habits/:id/completions — list completions for a habit
router.get('/:id/completions', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(habits).where(eq(habits.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: 'Habit not found' });
    return;
  }

  const rows = db.select().from(habitCompletions)
    .where(eq(habitCompletions.habitId, id))
    .orderBy(desc(habitCompletions.scheduledDate))
    .all();

  const result: HabitCompletion[] = rows.map((row) => ({
    id: row.id,
    habitId: row.habitId,
    scheduledDate: row.scheduledDate,
    completedAt: row.completedAt,
  }));

  res.json(result);
});

// POST /api/habits/:id/completions — record a completion
router.post('/:id/completions', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(habits).where(eq(habits.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: 'Habit not found' });
    return;
  }

  const { scheduledDate } = req.body;
  if (!scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    res.status(400).json({ error: 'scheduledDate must be YYYY-MM-DD' });
    return;
  }

  const completionId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(habitCompletions).values({
    id: completionId,
    habitId: id,
    scheduledDate,
    completedAt: now,
  }).run();

  logActivity('create', 'habit', id, { completion: scheduledDate });

  res.status(201).json({
    id: completionId,
    habitId: id,
    scheduledDate,
    completedAt: now,
  });
});

// GET /api/habits/:id/streak — compute current streak
router.get('/:id/streak', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(habits).where(eq(habits.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: 'Habit not found' });
    return;
  }

  const rows = db.select().from(habitCompletions)
    .where(eq(habitCompletions.habitId, id))
    .orderBy(desc(habitCompletions.scheduledDate))
    .all();

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
    frequencyConfig: row.frequencyConfig ? JSON.parse(row.frequencyConfig) as FrequencyConfig : {} as FrequencyConfig,
    schedulingHours: (row.schedulingHours ?? 'working') as Habit['schedulingHours'],
    locked: row.locked ?? false,
    autoDecline: row.autoDecline ?? false,
    dependsOn: row.dependsOn ?? null,
    enabled: row.enabled ?? true,
    calendarId: row.calendarId ?? undefined,
    color: row.color ?? undefined,
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

export default router;
