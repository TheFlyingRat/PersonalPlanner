import { Router } from 'express';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { tasks, scheduledEvents, subtasks } from '../db/pg-schema.js';
import type { CreateTaskRequest, Task, Subtask } from '@cadence/shared';
import { createTaskSchema, updateTaskSchema, updateSubtaskSchema, upNextBodySchema } from '../validation.js';
import { logActivity } from './activity.js';
import { broadcastToUser } from '../ws.js';
import { triggerReschedule } from '../polling-ref.js';
import { sendValidationError, sendNotFound, sendError, validateUUID } from './helpers.js';

const router = Router();

// GET /api/tasks — list all tasks for the current user
router.get('/', async (req, res) => {
  const rows = await db.select().from(tasks).where(eq(tasks.userId, req.userId));
  const result: Task[] = rows.map(toTask);
  res.json(result);
});

// POST /api/tasks — create a task
router.post('/', async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const body = parsed.data as CreateTaskRequest;

  const now = new Date().toISOString();

  const row = {
    userId: req.userId,
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
    skipBuffer: body.skipBuffer ?? false,
    calendarId: body.calendarId ?? null,
    color: body.color ?? null,
  };

  const inserted = await db.insert(tasks).values(row).returning();
  const created = inserted[0];
  await logActivity(req.userId, 'create', 'task', created.id, { name: body.name });
  broadcastToUser(req.userId, 'schedule_updated', 'Task created');
  triggerReschedule('Task created', req.userId);
  res.status(201).json(toTask(created));
});

// PUT /api/tasks/:id — update a task
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;
  const existing = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)));

  if (existing.length === 0) {
    sendNotFound(res, 'Task');
    return;
  }

  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const body = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

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
  if (body.skipBuffer !== undefined) updates.skipBuffer = body.skipBuffer;
  if (body.calendarId !== undefined) updates.calendarId = body.calendarId;
  if (body.color !== undefined) updates.color = body.color;

  const updated = await db.update(tasks).set(updates).where(and(eq(tasks.id, id), eq(tasks.userId, req.userId))).returning();
  await logActivity(req.userId, 'update', 'task', id, { fields: Object.keys(updates) });
  broadcastToUser(req.userId, 'schedule_updated', 'Task updated');
  triggerReschedule('Task updated', req.userId);
  res.json(toTask(updated[0]));
});

// DELETE /api/tasks/:id — delete task and scheduled events
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;
  const existing = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)));

  if (existing.length === 0) {
    sendNotFound(res, 'Task');
    return;
  }

  await db.delete(scheduledEvents).where(and(eq(scheduledEvents.itemId, id), eq(scheduledEvents.userId, req.userId)));
  await db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)));
  await logActivity(req.userId, 'delete', 'task', id, { name: existing[0].name });
  broadcastToUser(req.userId, 'schedule_updated', 'Task deleted');
  triggerReschedule('Task deleted', req.userId);

  res.status(204).send();
});

// POST /api/tasks/:id/complete — set status to 'completed'
router.post('/:id/complete', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;
  const existing = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)));

  if (existing.length === 0) {
    sendNotFound(res, 'Task');
    return;
  }

  const updated = await db.update(tasks)
    .set({ status: 'completed', updatedAt: new Date().toISOString() })
    .where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)))
    .returning();

  broadcastToUser(req.userId, 'schedule_updated', 'Task completed');
  triggerReschedule('Task completed', req.userId);
  res.json(toTask(updated[0]));
});

// POST /api/tasks/:id/up-next — toggle isUpNext
router.post('/:id/up-next', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;
  const existing = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)));

  if (existing.length === 0) {
    sendNotFound(res, 'Task');
    return;
  }

  const upNextParsed = upNextBodySchema.safeParse(req.body);
  if (!upNextParsed.success) {
    sendValidationError(res, upNextParsed.error);
    return;
  }

  const newIsUpNext = upNextParsed.data.isUpNext;

  const updated = await db.update(tasks)
    .set({ isUpNext: newIsUpNext, updatedAt: new Date().toISOString() })
    .where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)))
    .returning();

  broadcastToUser(req.userId, 'schedule_updated', 'Task priority changed');
  triggerReschedule('Task priority changed', req.userId);
  res.json(toTask(updated[0]));
});

// GET /api/tasks/:id/subtasks — list subtasks ordered by sortOrder
router.get('/:id/subtasks', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;
  const existing = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)));
  if (existing.length === 0) {
    sendNotFound(res, 'Task');
    return;
  }

  const rows = await db.select().from(subtasks)
    .where(and(eq(subtasks.taskId, id), eq(subtasks.userId, req.userId)))
    .orderBy(asc(subtasks.sortOrder));

  const result: Subtask[] = rows.map(toSubtask);
  res.json(result);
});

// POST /api/tasks/:id/subtasks — create a subtask
router.post('/:id/subtasks', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;
  const existing = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)));
  if (existing.length === 0) {
    sendNotFound(res, 'Task');
    return;
  }

  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    sendError(res, 400, 'name is required');
    return;
  }
  if (name.trim().length > 200) {
    sendError(res, 400, 'name must be 200 characters or fewer');
    return;
  }

  // Auto-assign sortOrder to be after existing subtasks
  const existingSubtasks = await db.select().from(subtasks)
    .where(and(eq(subtasks.taskId, id), eq(subtasks.userId, req.userId)));
  const maxSort = existingSubtasks.reduce((max, s) => Math.max(max, s.sortOrder ?? 0), -1);

  const inserted = await db.insert(subtasks).values({
    userId: req.userId,
    taskId: id,
    name: name.trim(),
    completed: false,
    sortOrder: maxSort + 1,
  }).returning();

  await logActivity(req.userId, 'create', 'task', id, { subtask: name.trim() });
  res.status(201).json(toSubtask(inserted[0]));
});

// PUT /api/tasks/:id/subtasks/:subtaskId — update a subtask
router.put('/:id/subtasks/:subtaskId', async (req, res) => {
  const { id, subtaskId } = req.params;
  if (!validateUUID(id, res)) return;
  if (!validateUUID(subtaskId, res)) return;
  const existing = await db.select().from(subtasks).where(and(eq(subtasks.id, subtaskId), eq(subtasks.userId, req.userId)));
  if (existing.length === 0 || existing[0].taskId !== id) {
    sendNotFound(res, 'Subtask');
    return;
  }

  const parsed = updateSubtaskSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const body = parsed.data;
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.completed !== undefined) updates.completed = body.completed;
  if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;

  if (Object.keys(updates).length === 0) {
    sendError(res, 400, 'No fields to update');
    return;
  }

  const updated = await db.update(subtasks).set(updates).where(and(eq(subtasks.id, subtaskId), eq(subtasks.userId, req.userId))).returning();
  res.json(toSubtask(updated[0]));
});

// DELETE /api/tasks/:id/subtasks/:subtaskId — delete a subtask
router.delete('/:id/subtasks/:subtaskId', async (req, res) => {
  const { id, subtaskId } = req.params;
  if (!validateUUID(id, res)) return;
  if (!validateUUID(subtaskId, res)) return;
  const existing = await db.select().from(subtasks).where(and(eq(subtasks.id, subtaskId), eq(subtasks.userId, req.userId)));
  if (existing.length === 0 || existing[0].taskId !== id) {
    sendNotFound(res, 'Subtask');
    return;
  }

  await db.delete(subtasks).where(and(eq(subtasks.id, subtaskId), eq(subtasks.userId, req.userId)));
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
    skipBuffer: row.skipBuffer ?? false,
    calendarId: row.calendarId ?? undefined,
    color: row.color ?? undefined,
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

export default router;
