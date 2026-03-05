import { Router } from 'express';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks, scheduledEvents, subtasks } from '../db/schema.js';
import type { CreateTaskRequest, Task, Subtask } from '@cadence/shared';
import { createTaskSchema, updateTaskSchema } from '../validation.js';
import { logActivity } from './activity.js';

const router = Router();

// GET /api/tasks — list all tasks
router.get('/', (_req, res) => {
  const rows = db.select().from(tasks).all();
  const result: Task[] = rows.map(toTask);
  res.json(result);
});

// POST /api/tasks — create a task
router.post('/', (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }
  const body = parsed.data as CreateTaskRequest;

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
    calendarId: body.calendarId ?? null,
    color: body.color ?? null,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(tasks).values(row).run();

  const created = db.select().from(tasks).where(eq(tasks.id, id)).get();
  logActivity('create', 'task', id, { name: body.name });
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

  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }

  const body = parsed.data;
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
  if (body.calendarId !== undefined) updates.calendarId = body.calendarId;
  if (body.color !== undefined) updates.color = body.color;

  db.update(tasks).set(updates).where(eq(tasks.id, id)).run();

  const updated = db.select().from(tasks).where(eq(tasks.id, id)).get();
  logActivity('update', 'task', id, { fields: Object.keys(updates) });
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
  logActivity('delete', 'task', id, { name: existing.name });

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

  const { isUpNext } = req.body;
  const newIsUpNext = isUpNext !== undefined ? !!isUpNext : !existing.isUpNext;

  const now = new Date().toISOString();
  db.update(tasks)
    .set({ isUpNext: newIsUpNext, updatedAt: now })
    .where(eq(tasks.id, id))
    .run();

  const updated = db.select().from(tasks).where(eq(tasks.id, id)).get();
  res.json(toTask(updated!));
});

// GET /api/tasks/:id/subtasks — list subtasks ordered by sortOrder
router.get('/:id/subtasks', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const rows = db.select().from(subtasks)
    .where(eq(subtasks.taskId, id))
    .orderBy(asc(subtasks.sortOrder))
    .all();

  const result: Subtask[] = rows.map(toSubtask);
  res.json(result);
});

// POST /api/tasks/:id/subtasks — create a subtask
router.post('/:id/subtasks', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  // Auto-assign sortOrder to be after existing subtasks
  const existingSubtasks = db.select().from(subtasks)
    .where(eq(subtasks.taskId, id))
    .all();
  const maxSort = existingSubtasks.reduce((max, s) => Math.max(max, s.sortOrder ?? 0), -1);

  const subtaskId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(subtasks).values({
    id: subtaskId,
    taskId: id,
    name: name.trim(),
    completed: false,
    sortOrder: maxSort + 1,
    createdAt: now,
  }).run();

  const created = db.select().from(subtasks).where(eq(subtasks.id, subtaskId)).get();
  logActivity('create', 'task', id, { subtask: name.trim() });
  res.status(201).json(toSubtask(created!));
});

// PUT /api/tasks/:id/subtasks/:subtaskId — update a subtask
router.put('/:id/subtasks/:subtaskId', (req, res) => {
  const { id, subtaskId } = req.params;
  const existing = db.select().from(subtasks).where(eq(subtasks.id, subtaskId)).get();
  if (!existing || existing.taskId !== id) {
    res.status(404).json({ error: 'Subtask not found' });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.completed !== undefined) updates.completed = !!req.body.completed;
  if (req.body.sortOrder !== undefined) updates.sortOrder = req.body.sortOrder;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  db.update(subtasks).set(updates).where(eq(subtasks.id, subtaskId)).run();

  const updated = db.select().from(subtasks).where(eq(subtasks.id, subtaskId)).get();
  res.json(toSubtask(updated!));
});

// DELETE /api/tasks/:id/subtasks/:subtaskId — delete a subtask
router.delete('/:id/subtasks/:subtaskId', (req, res) => {
  const { id, subtaskId } = req.params;
  const existing = db.select().from(subtasks).where(eq(subtasks.id, subtaskId)).get();
  if (!existing || existing.taskId !== id) {
    res.status(404).json({ error: 'Subtask not found' });
    return;
  }

  db.delete(subtasks).where(eq(subtasks.id, subtaskId)).run();
  res.status(204).send();
});

function toSubtask(row: typeof subtasks.$inferSelect): Subtask {
  return {
    id: row.id,
    taskId: row.taskId,
    name: row.name,
    completed: row.completed ?? false,
    sortOrder: row.sortOrder ?? 0,
    createdAt: row.createdAt ?? '',
  };
}

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
    calendarId: row.calendarId ?? undefined,
    color: row.color ?? undefined,
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

export default router;
