import { Router } from 'express';
import { eq, and, like } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { smartMeetings, scheduledEvents } from '../db/pg-schema.js';
import type { CreateMeetingRequest, SmartMeeting } from '@cadence/shared';
import { createMeetingSchema, updateMeetingSchema } from '../validation.js';
import { logActivity } from './activity.js';
import { broadcastToUser } from '../ws.js';
import { triggerReschedule } from '../polling-ref.js';
import { sendValidationError, sendNotFound, validateUUID } from './helpers.js';

const router = Router();

// GET /api/meetings — list all meetings for the current user
router.get('/', async (req, res) => {
  const rows = await db.select().from(smartMeetings).where(eq(smartMeetings.userId, req.userId));
  const result: SmartMeeting[] = rows.map(toMeeting);
  res.json(result);
});

// POST /api/meetings — create a meeting
router.post('/', async (req, res) => {
  const parsed = createMeetingSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const body = parsed.data as CreateMeetingRequest;

  const row = {
    userId: req.userId,
    name: body.name,
    priority: body.priority ?? 2,
    attendees: body.attendees ?? [],
    duration: body.duration,
    frequency: body.frequency,
    idealTime: body.idealTime,
    windowStart: body.windowStart,
    windowEnd: body.windowEnd,
    location: body.location ?? '',
    conferenceType: body.conferenceType ?? 'none',
    skipBuffer: body.skipBuffer ?? false,
    calendarId: body.calendarId ?? null,
    color: body.color ?? null,
  };

  const inserted = await db.insert(smartMeetings).values(row).returning();
  const created = inserted[0];
  await logActivity(req.userId, 'create', 'meeting', created.id, { name: body.name });
  broadcastToUser(req.userId, 'schedule_updated', 'Meeting created');
  triggerReschedule('Meeting created', req.userId);
  res.status(201).json(toMeeting(created));
});

// PUT /api/meetings/:id — update a meeting
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;
  const existing = await db.select().from(smartMeetings).where(and(eq(smartMeetings.id, id), eq(smartMeetings.userId, req.userId)));

  if (existing.length === 0) {
    sendNotFound(res, 'Meeting');
    return;
  }

  const parsed = updateMeetingSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const body = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (body.name !== undefined) updates.name = body.name;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.attendees !== undefined) updates.attendees = body.attendees;
  if (body.duration !== undefined) updates.duration = body.duration;
  if (body.frequency !== undefined) updates.frequency = body.frequency;
  if (body.idealTime !== undefined) updates.idealTime = body.idealTime;
  if (body.windowStart !== undefined) updates.windowStart = body.windowStart;
  if (body.windowEnd !== undefined) updates.windowEnd = body.windowEnd;
  if (body.location !== undefined) updates.location = body.location;
  if (body.conferenceType !== undefined) updates.conferenceType = body.conferenceType;
  if (body.skipBuffer !== undefined) updates.skipBuffer = body.skipBuffer;
  if (body.calendarId !== undefined) updates.calendarId = body.calendarId;
  if (body.color !== undefined) updates.color = body.color;

  const updated = await db.update(smartMeetings).set(updates).where(and(eq(smartMeetings.id, id), eq(smartMeetings.userId, req.userId))).returning();
  await logActivity(req.userId, 'update', 'meeting', id, { fields: Object.keys(updates) });
  broadcastToUser(req.userId, 'schedule_updated', 'Meeting updated');
  triggerReschedule('Meeting updated', req.userId);
  res.json(toMeeting(updated[0]));
});

// DELETE /api/meetings/:id — delete a meeting
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;
  const existing = await db.select().from(smartMeetings).where(and(eq(smartMeetings.id, id), eq(smartMeetings.userId, req.userId)));

  if (existing.length === 0) {
    sendNotFound(res, 'Meeting');
    return;
  }

  await db.transaction(async (tx) => {
    // Delete scheduled events that use meetingId__dateStr format
    await tx.delete(scheduledEvents).where(
      and(like(scheduledEvents.itemId, `${id}%`), eq(scheduledEvents.userId, req.userId))
    );
    await tx.delete(smartMeetings).where(and(eq(smartMeetings.id, id), eq(smartMeetings.userId, req.userId)));
  });
  await logActivity(req.userId, 'delete', 'meeting', id, { name: existing[0].name });
  broadcastToUser(req.userId, 'schedule_updated', 'Meeting deleted');
  triggerReschedule('Meeting deleted', req.userId);

  res.status(204).send();
});

function toMeeting(row: typeof smartMeetings.$inferSelect): SmartMeeting {
  return {
    id: row.id,
    name: row.name,
    priority: row.priority ?? 2,
    attendees: (row.attendees ?? []) as string[],
    duration: row.duration,
    frequency: row.frequency as SmartMeeting['frequency'],
    idealTime: row.idealTime ?? '',
    windowStart: row.windowStart ?? '',
    windowEnd: row.windowEnd ?? '',
    location: row.location ?? '',
    conferenceType: row.conferenceType ?? 'none',
    skipBuffer: row.skipBuffer ?? false,
    calendarId: row.calendarId ?? undefined,
    color: row.color ?? undefined,
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

export default router;
