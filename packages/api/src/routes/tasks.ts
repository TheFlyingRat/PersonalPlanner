import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks, scheduledEvents } from '../db/schema.js';
import type { CreateTaskRequest, Task } from '@reclaim/shared';

const router = Router();

// GET /api/tasks — list all tasks
router.get('/', (_req, res) => {
  const rows = db.select().from(tasks).all();
  const result: Task[] = rows.map(toTask);
  res.json(result);
});

// POST /api/tasks — create a task
router.post('/', (req, res) => {
  const body = req.body as CreateTaskRequest;

  if (!body.name || body.totalDuration == null || !body.dueDate) {
    res.status(400).json({ error: 'Missing required fields: name, totalDuration, dueDate' });
    return;
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const row = {
    id,
    name: body.name,
    priority: body.priority ?? 2,
    totalDuration: body.totalDuration,
    remainingDuration: body.totalDuration,
    dueDate: body.dueDate,
    earliestStart: body.earliestStart ?? now,
    chunkMin: body.chunkMin ?? 15,
    chunkMax: body.chunkMax ?? 120,
    schedulingHours: body.schedulingHours ?? 'working',
    status: 'open',
    isUpNext: false,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(tasks).values(row).run();

  const created = db.select().from(tasks).where(eq(tasks.id, id)).get();
  res.status(201).json(toTask(created!));
});

// PUT /api/tasks/:id — update a task
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();

  if (!existing) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const body = req.body;
  const now = new Date().toISOString();

  const updates: Record<string, unknown> = { updatedAt: now };

  if (body.name !== undefined) updates.name = body.name;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.totalDuration !== undefined) updates.totalDuration = body.totalDuration;
  if (body.remainingDuration !== undefined) updates.remainingDuration = body.remainingDuration;
  if (body.dueDate !== undefined) updates.dueDate = body.dueDate;
  if (body.earliestStart !== undefined) updates.earliestStart = body.earliestStart;
  if (body.chunkMin !== undefined) updates.chunkMin = body.chunkMin;
  if (body.chunkMax !== undefined) updates.chunkMax = body.chunkMax;
  if (body.schedulingHours !== undefined) updates.schedulingHours = body.schedulingHours;
  if (body.status !== undefined) updates.status = body.status;
  if (body.isUpNext !== undefined) updates.isUpNext = body.isUpNext;

  db.update(tasks).set(updates).where(eq(tasks.id, id)).run();

  const updated = db.select().from(tasks).where(eq(tasks.id, id)).get();
  res.json(toTask(updated!));
});

// DELETE /api/tasks/:id — delete task and scheduled events
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();

  if (!existing) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  db.delete(scheduledEvents).where(eq(scheduledEvents.itemId, id)).run();
  db.delete(tasks).where(eq(tasks.id, id)).run();

  res.status(204).send();
});

// POST /api/tasks/:id/complete — set status to 'completed'
router.post('/:id/complete', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();

  if (!existing) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const now = new Date().toISOString();
  db.update(tasks)
    .set({ status: 'completed', updatedAt: now })
    .where(eq(tasks.id, id))
    .run();

  const updated = db.select().from(tasks).where(eq(tasks.id, id)).get();
  res.json(toTask(updated!));
});

// POST /api/tasks/:id/up-next — toggle isUpNext
router.post('/:id/up-next', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();

  if (!existing) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const now = new Date().toISOString();
  db.update(tasks)
    .set({ isUpNext: !existing.isUpNext, updatedAt: now })
    .where(eq(tasks.id, id))
    .run();

  const updated = db.select().from(tasks).where(eq(tasks.id, id)).get();
  res.json(toTask(updated!));
});

function toTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    name: row.name,
    priority: row.priority ?? 2,
    totalDuration: row.totalDuration,
    remainingDuration: row.remainingDuration,
    dueDate: row.dueDate ?? '',
    earliestStart: row.earliestStart ?? '',
    chunkMin: row.chunkMin ?? 15,
    chunkMax: row.chunkMax ?? 120,
    schedulingHours: (row.schedulingHours ?? 'working') as Task['schedulingHours'],
    status: (row.status ?? 'open') as Task['status'],
    isUpNext: row.isUpNext ?? false,
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

export default router;
