import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { scheduledEvents, habits, tasks, smartMeetings, focusTimeRules, bufferConfig, users } from '../db/schema.js';
import { reschedule } from '@reclaim/engine';
import type { Habit, Task, SmartMeeting, FocusTimeRule, BufferConfig, CalendarEvent, UserSettings } from '@reclaim/shared';
import { Priority, Frequency, SchedulingHours, TaskStatus, DecompressionTarget, EventStatus, ItemType, CalendarOpType } from '@reclaim/shared';

const router = Router();

// GET /api/schedule — return all scheduled events
router.get('/', (_req, res) => {
  const rows = db.select().from(scheduledEvents).all();
  res.json(rows.map((row: any) => ({
    ...row,
    calendarId: row.calendarId || 'primary',
  })));
});

function toHabit(row: any): Habit {
  return {
    ...row,
    priority: row.priority as Priority,
    frequency: row.frequency as Frequency,
    frequencyConfig: row.frequencyConfig ? JSON.parse(row.frequencyConfig) : {},
    schedulingHours: (row.schedulingHours || 'working') as SchedulingHours,
    locked: !!row.locked,
    autoDecline: !!row.autoDecline,
    enabled: row.enabled !== false && row.enabled !== 0,
  };
}

function toTask(row: any): Task {
  return {
    ...row,
    priority: row.priority as Priority,
    schedulingHours: (row.schedulingHours || 'working') as SchedulingHours,
    status: (row.status || 'open') as TaskStatus,
    isUpNext: !!row.isUpNext,
  };
}

function toMeeting(row: any): SmartMeeting {
  return {
    ...row,
    priority: row.priority as Priority,
    frequency: row.frequency as Frequency,
    attendees: row.attendees ? JSON.parse(row.attendees) : [],
  };
}

function toFocusRule(row: any): FocusTimeRule {
  return {
    ...row,
    schedulingHours: (row.schedulingHours || 'working') as SchedulingHours,
    enabled: !!row.enabled,
  };
}

function toBufConfig(row: any): BufferConfig {
  return {
    ...row,
    applyDecompressionTo: (row.applyDecompressionTo || 'all') as DecompressionTarget,
  };
}

// POST /api/schedule/reschedule — run the scheduling engine
router.post('/reschedule', (_req, res) => {
  try {
    const allHabits = db.select().from(habits).all().map(toHabit);
    const allTasks = db.select().from(tasks).all().map(toTask);
    const allMeetings = db.select().from(smartMeetings).all().map(toMeeting);
    const allFocusRules = db.select().from(focusTimeRules).all().map(toFocusRule);
    const bufRows = db.select().from(bufferConfig).all();
    const buf = bufRows.length > 0 ? toBufConfig(bufRows[0]) : {
      id: 'default',
      travelTimeMinutes: 15,
      decompressionMinutes: 10,
      breakBetweenItemsMinutes: 5,
      applyDecompressionTo: DecompressionTarget.All,
    };

    const userRows = db.select().from(users).all();
    const userSettings: UserSettings = userRows.length > 0 && userRows[0].settings
      ? JSON.parse(userRows[0].settings)
      : {
          workingHours: { start: '09:00', end: '17:00' },
          personalHours: { start: '07:00', end: '22:00' },
          timezone: 'America/New_York',
          schedulingWindowDays: 14,
        };

    // Get existing managed calendar events from our DB
    const existingEvents: CalendarEvent[] = db.select().from(scheduledEvents).all().map((row: any) => ({
      id: row.id,
      googleEventId: row.googleEventId || '',
      title: '',
      start: row.start,
      end: row.end,
      isManaged: true,
      itemType: row.itemType as ItemType,
      itemId: row.itemId,
      status: (row.status || 'free') as EventStatus,
    }));

    const result = reschedule(
      allHabits,
      allTasks,
      allMeetings,
      allFocusRules,
      existingEvents,
      buf,
      userSettings,
    );

    // Apply operations to our local scheduled_events table
    for (const op of result.operations) {
      const now = new Date().toISOString();
      if (op.type === CalendarOpType.Create) {
        db.insert(scheduledEvents).values({
          id: crypto.randomUUID(),
          itemType: op.itemType,
          itemId: op.itemId,
          googleEventId: op.eventId || null,
          start: op.start,
          end: op.end,
          status: op.status,
          alternativeSlotsCount: null,
          createdAt: now,
          updatedAt: now,
        }).run();
      } else if (op.type === CalendarOpType.Update && op.eventId) {
        db.update(scheduledEvents)
          .set({ start: op.start, end: op.end, status: op.status, updatedAt: now })
          .where(eq(scheduledEvents.id, op.eventId))
          .run();
      } else if (op.type === CalendarOpType.Delete && op.eventId) {
        db.delete(scheduledEvents)
          .where(eq(scheduledEvents.id, op.eventId))
          .run();
      }
    }

    res.json({
      message: 'Reschedule complete',
      operationsApplied: result.operations.length,
      unschedulable: result.unschedulable,
    });
  } catch (error: any) {
    console.error('Reschedule error:', error);
    res.status(500).json({ error: 'Reschedule failed' });
  }
});

export default router;
