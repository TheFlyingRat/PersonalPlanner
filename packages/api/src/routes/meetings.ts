import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { smartMeetings } from '../db/schema.js';
import type { CreateMeetingRequest, SmartMeeting } from '@reclaim/shared';
import { createMeetingSchema, updateMeetingSchema } from '../validation.js';

const router = Router();

// GET /api/meetings — list all meetings
router.get('/', (_req, res) => {
  const rows = db.select().from(smartMeetings).all();
  const result: SmartMeeting[] = rows.map(toMeeting);
  res.json(result);
});

// POST /api/meetings — create a meeting
router.post('/', (req, res) => {
  const parsed = createMeetingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }
  const body = parsed.data as CreateMeetingRequest;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const row = {
    id,
    name: body.name,
    priority: body.priority ?? 2,
    attendees: body.attendees ? JSON.stringify(body.attendees) : JSON.stringify([]),
    duration: body.duration,
    frequency: body.frequency,
    idealTime: body.idealTime,
    windowStart: body.windowStart,
    windowEnd: body.windowEnd,
    location: body.location ?? '',
    conferenceType: body.conferenceType ?? 'none',
    createdAt: now,
    updatedAt: now,
  };

  db.insert(smartMeetings).values(row).run();

  const created = db.select().from(smartMeetings).where(eq(smartMeetings.id, id)).get();
  res.status(201).json(toMeeting(created!));
});

// PUT /api/meetings/:id — update a meeting
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(smartMeetings).where(eq(smartMeetings.id, id)).get();

  if (!existing) {
    res.status(404).json({ error: 'Meeting not found' });
    return;
  }

  const parsed = updateMeetingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }

  const body = parsed.data;
  const now = new Date().toISOString();

  const updates: Record<string, unknown> = { updatedAt: now };

  if (body.name !== undefined) updates.name = body.name;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.attendees !== undefined) updates.attendees = JSON.stringify(body.attendees);
  if (body.duration !== undefined) updates.duration = body.duration;
  if (body.frequency !== undefined) updates.frequency = body.frequency;
  if (body.idealTime !== undefined) updates.idealTime = body.idealTime;
  if (body.windowStart !== undefined) updates.windowStart = body.windowStart;
  if (body.windowEnd !== undefined) updates.windowEnd = body.windowEnd;
  if (body.location !== undefined) updates.location = body.location;
  if (body.conferenceType !== undefined) updates.conferenceType = body.conferenceType;

  db.update(smartMeetings).set(updates).where(eq(smartMeetings.id, id)).run();

  const updated = db.select().from(smartMeetings).where(eq(smartMeetings.id, id)).get();
  res.json(toMeeting(updated!));
});

// DELETE /api/meetings/:id — delete a meeting
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(smartMeetings).where(eq(smartMeetings.id, id)).get();

  if (!existing) {
    res.status(404).json({ error: 'Meeting not found' });
    return;
  }

  db.delete(smartMeetings).where(eq(smartMeetings.id, id)).run();

  res.status(204).send();
});

function toMeeting(row: typeof smartMeetings.$inferSelect): SmartMeeting {
  return {
    id: row.id,
    name: row.name,
    priority: row.priority ?? 2,
    attendees: row.attendees ? JSON.parse(row.attendees) as string[] : [],
    duration: row.duration,
    frequency: row.frequency as SmartMeeting['frequency'],
    idealTime: row.idealTime ?? '',
    windowStart: row.windowStart ?? '',
    windowEnd: row.windowEnd ?? '',
    location: row.location ?? '',
    conferenceType: row.conferenceType ?? 'none',
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

export default router;
