import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { habits, scheduledEvents } from '../db/schema.js';
import type { CreateHabitRequest, Habit, FrequencyConfig } from '@reclaim/shared';

const router = Router();

// GET /api/habits — list all habits
router.get('/', (_req, res) => {
  const rows = db.select().from(habits).all();
  const result: Habit[] = rows.map(toHabit);
  res.json(result);
});

// POST /api/habits — create a habit
router.post('/', (req, res) => {
  const body = req.body as CreateHabitRequest;

  if (!body.name || !body.windowStart || !body.windowEnd || !body.idealTime ||
      body.durationMin == null || body.durationMax == null || !body.frequency) {
    res.status(400).json({ error: 'Missing required fields: name, windowStart, windowEnd, idealTime, durationMin, durationMax, frequency' });
    return;
  }

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
    createdAt: now,
    updatedAt: now,
  };

  db.insert(habits).values(row).run();

  const created = db.select().from(habits).where(eq(habits.id, id)).get();
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

  const body = req.body;
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

  db.update(habits).set(updates).where(eq(habits.id, id)).run();

  const updated = db.select().from(habits).where(eq(habits.id, id)).get();
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

  const now = new Date().toISOString();
  db.update(habits)
    .set({ locked: !existing.locked, updatedAt: now })
    .where(eq(habits.id, id))
    .run();

  const updated = db.select().from(habits).where(eq(habits.id, id)).get();
  res.json(toHabit(updated!));
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
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

export default router;
