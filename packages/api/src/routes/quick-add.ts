import { Router } from 'express';
import { z } from 'zod/v4';
import { db } from '../db/pg-index.js';
import { habits, tasks, smartMeetings } from '../db/pg-schema.js';
import { parseQuickAdd } from '@cadence/shared';
import type { ParsedHabit, ParsedTask, ParsedMeeting } from '@cadence/shared';
import { logActivity } from './activity.js';
import { broadcastToUser } from '../ws.js';
import { triggerReschedule } from '../polling-ref.js';
import { sendValidationError, sendError } from './helpers.js';

const router = Router();

const quickAddSchema = z.object({
  input: z.string().min(1).max(500),
});

// POST /api/quick-add — parse natural language input and create item
router.post('/', async (req, res) => {
  const parsed = quickAddSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const { input } = parsed.data;
  const result = parseQuickAdd(input);

  if (!result) {
    res.status(400).json({
      error: 'Could not parse input. Try formats like "Gym MWF 7am 1h" or "Finish report by Friday 3h"',
      parsed: null,
    });
    return;
  }

  const userId = req.userId;

  if (result.type === 'habit') {
    const p = result as ParsedHabit;
    if (p.days && p.days.length > 0 && p.duration) {
      // Fully parseable — create the habit
      const idealTime = p.idealTime ?? '09:00';
      const row = {
        userId,
        name: p.name,
        priority: 3,
        windowStart: '07:00',
        windowEnd: '22:00',
        idealTime,
        durationMin: p.duration,
        durationMax: p.duration,
        frequency: p.days.length === 7 ? 'daily' : 'custom',
        frequencyConfig: { days: p.days },
        schedulingHours: 'personal',
        locked: false,
        autoDecline: false,
        dependsOn: null,
        enabled: true,
        skipBuffer: false,
        notifications: false,
        calendarId: null,
        color: null,
      };
      const inserted = await db.insert(habits).values(row).returning();
      const created = inserted[0];
      await logActivity(userId, 'create', 'habit', created.id, { name: p.name, source: 'quick-add' });
      broadcastToUser(userId, 'schedule_updated', 'Habit created via quick-add');
      triggerReschedule('Habit created via quick-add', userId);
      res.status(201).json({ created: true, type: 'habit', item: created, parsed: result });
      return;
    }
    // Partial — return parsed fields for form pre-fill
    res.json({ created: false, type: 'habit', parsed: result });
    return;
  }

  if (result.type === 'task') {
    const p = result as ParsedTask;
    if (p.totalDuration && p.dueDate) {
      // Fully parseable — create the task
      const now = new Date().toISOString();
      const row = {
        userId,
        name: p.name,
        priority: 2,
        totalDuration: p.totalDuration,
        remainingDuration: p.totalDuration,
        dueDate: p.dueDate,
        earliestStart: now,
        chunkMin: 15,
        chunkMax: 120,
        schedulingHours: 'working',
        status: 'open',
        isUpNext: false,
        skipBuffer: false,
        calendarId: null,
        color: null,
      };
      const inserted = await db.insert(tasks).values(row).returning();
      const created = inserted[0];
      await logActivity(userId, 'create', 'task', created.id, { name: p.name, source: 'quick-add' });
      broadcastToUser(userId, 'schedule_updated', 'Task created via quick-add');
      triggerReschedule('Task created via quick-add', userId);
      res.status(201).json({ created: true, type: 'task', item: created, parsed: result });
      return;
    }
    // Partial — return parsed fields
    res.json({ created: false, type: 'task', parsed: result });
    return;
  }

  if (result.type === 'meeting') {
    const p = result as ParsedMeeting;
    if (p.duration && p.idealTime) {
      // Fully parseable — create the meeting
      const frequency = p.frequency ?? 'weekly';
      const row = {
        userId,
        name: p.name,
        priority: 2,
        attendees: [],
        duration: p.duration,
        frequency,
        idealTime: p.idealTime,
        windowStart: '09:00',
        windowEnd: '17:00',
        location: '',
        conferenceType: 'none',
        skipBuffer: false,
        calendarId: null,
        color: null,
      };
      const inserted = await db.insert(smartMeetings).values(row).returning();
      const created = inserted[0];
      await logActivity(userId, 'create', 'meeting', created.id, { name: p.name, source: 'quick-add' });
      broadcastToUser(userId, 'schedule_updated', 'Meeting created via quick-add');
      triggerReschedule('Meeting created via quick-add', userId);
      res.status(201).json({ created: true, type: 'meeting', item: created, parsed: result });
      return;
    }
    // Partial — return parsed fields
    res.json({ created: false, type: 'meeting', parsed: result });
    return;
  }

  sendError(res, 400, 'Unknown item type');
});

export default router;
