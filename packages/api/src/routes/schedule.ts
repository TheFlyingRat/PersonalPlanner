import { Router } from 'express';
import { eq, and, gte, desc } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { scheduledEvents, calendarEvents, calendars, habits, tasks, smartMeetings, focusTimeRules, bufferConfig, users, scheduleChanges } from '../db/pg-schema.js';
import { reschedule, generateCandidateSlots, scoreSlot, buildTimeline, calculateScheduleQuality } from '@cadence/engine';
import type { Habit, Task, SmartMeeting, FocusTimeRule, BufferConfig, CalendarEvent, UserSettings, ScheduleItem, TimeSlot, ScheduleChange, CalendarOperation, QualityScore } from '@cadence/shared';
import { Priority, Frequency, SchedulingHours, TaskStatus, DecompressionTarget, EventStatus, ItemType, CalendarOpType, STATUS_PREFIX, EXTENDED_PROPS, ScheduleChangeType, BRAND } from '@cadence/shared';
import { triggerReschedule } from '../polling-ref.js';
import { broadcastToUser } from '../ws.js';
import { moveEventSchema, scheduleChangesQuerySchema } from '../validation.js';
import { schedulerRegistry } from '../scheduler-registry.js';
import { sendValidationError, sendNotFound, sendError } from './helpers.js';

const router = Router();

/**
 * Record schedule changes from a reschedule run.
 * Compares operations against existing scheduled_events to determine what changed.
 */
export async function recordScheduleChanges(
  operations: CalendarOperation[],
  existingEventsMap: Map<string, { start: string; end: string; title: string; itemType: string; itemId: string }>,
  userId?: string,
): Promise<ScheduleChange[]> {
  if (operations.length === 0) return [];

  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const changes: ScheduleChange[] = [];

  for (const op of operations) {
    const itemName = op.title || op.itemId;

    if (op.type === CalendarOpType.Create) {
      const change: ScheduleChange = {
        id: crypto.randomUUID(),
        operationType: ScheduleChangeType.Created,
        itemType: op.itemType,
        itemId: op.itemId,
        itemName,
        previousStart: null,
        previousEnd: null,
        newStart: op.start,
        newEnd: op.end,
        reason: null,
        batchId,
        createdAt: now,
      };
      changes.push(change);
    } else if (op.type === CalendarOpType.Update && op.eventId) {
      const existing = existingEventsMap.get(op.eventId);
      if (!existing) continue;

      const prevStart = new Date(existing.start).getTime();
      const prevEnd = new Date(existing.end).getTime();
      const newStart = new Date(op.start).getTime();
      const newEnd = new Date(op.end).getTime();

      const startMoved = Math.abs(prevStart - newStart) >= 60000;
      const durationChanged = Math.abs((prevEnd - prevStart) - (newEnd - newStart)) >= 60000;

      let opType: ScheduleChangeType;
      if (startMoved && durationChanged) {
        opType = ScheduleChangeType.Moved;
      } else if (durationChanged) {
        opType = ScheduleChangeType.Resized;
      } else if (startMoved) {
        opType = ScheduleChangeType.Moved;
      } else {
        continue; // No meaningful time change
      }

      const change: ScheduleChange = {
        id: crypto.randomUUID(),
        operationType: opType,
        itemType: op.itemType,
        itemId: op.itemId,
        itemName,
        previousStart: existing.start,
        previousEnd: existing.end,
        newStart: op.start,
        newEnd: op.end,
        reason: null,
        batchId,
        createdAt: now,
      };
      changes.push(change);
    } else if (op.type === CalendarOpType.Delete && op.eventId) {
      const existing = existingEventsMap.get(op.eventId);
      const change: ScheduleChange = {
        id: crypto.randomUUID(),
        operationType: ScheduleChangeType.Deleted,
        itemType: existing?.itemType || op.itemType,
        itemId: existing?.itemId || op.itemId,
        itemName: existing?.title || itemName,
        previousStart: existing?.start || null,
        previousEnd: existing?.end || null,
        newStart: null,
        newEnd: null,
        reason: null,
        batchId,
        createdAt: now,
      };
      changes.push(change);
    }
  }

  // Persist all changes
  if (!userId) return changes;
  for (const change of changes) {
    await db.insert(scheduleChanges).values({
      ...change,
      userId,
    });
  }

  // Broadcast changes via WebSocket
  if (changes.length > 0 && userId) {
    broadcastToUser(userId, 'schedule_changes', `${changes.length} changes in batch ${batchId}`, changes);
  }

  return changes;
}

// GET /api/schedule — return scheduled + external calendar events, filtered by date range
router.get('/', async (req, res) => {
  const userId = req.userId;
  let startFilter: number | null = null;
  let endFilter: number | null = null;

  if (req.query.start) {
    const parsed = new Date(req.query.start as string).getTime();
    if (isNaN(parsed)) {
      sendError(res, 400, 'Invalid start date format');
      return;
    }
    startFilter = parsed;
  }
  if (req.query.end) {
    const parsed = new Date(req.query.end as string).getTime();
    if (isNaN(parsed)) {
      sendError(res, 400, 'Invalid end date format');
      return;
    }
    endFilter = parsed;
  }

  function isInRange(eventStart: string, eventEnd: string): boolean {
    if (!startFilter || !endFilter) return true;
    const evStart = new Date(eventStart).getTime();
    const evEnd = new Date(eventEnd).getTime();
    if (isNaN(evStart) || isNaN(evEnd)) return false;
    return evEnd > startFilter && evStart < endFilter;
  }

  // Build color lookup from source items
  const [habitRows, taskRows, meetingRows] = await Promise.all([
    db.select().from(habits).where(eq(habits.userId, userId)),
    db.select().from(tasks).where(eq(tasks.userId, userId)),
    db.select().from(smartMeetings).where(eq(smartMeetings.userId, userId)),
  ]);
  const itemColorMap = new Map<string, string>();
  for (const h of habitRows) { if (h.color) itemColorMap.set(h.id, h.color); }
  for (const t of taskRows) { if (t.color) itemColorMap.set(t.id, t.color); }
  for (const m of meetingRows) { if (m.color) itemColorMap.set(m.id, m.color); }

  // Managed events from the scheduling engine
  const allManaged = await db.select().from(scheduledEvents).where(eq(scheduledEvents.userId, userId));
  const managed = allManaged
    .map((row: any) => {
      const originalId = row.itemId?.split('__')[0] || row.itemId;
      return {
        ...row,
        calendarId: row.calendarId || 'primary',
        itemColor: originalId ? itemColorMap.get(originalId) || null : null,
      };
    })
    .filter((row: any) => row.start && row.end && isInRange(row.start, row.end));

  // External events from enabled calendars
  const enabledCals = await db.select().from(calendars)
    .where(and(eq(calendars.userId, userId), eq(calendars.enabled, true)));
  const enabledCalIds = new Set(enabledCals.map(c => c.id));
  const calColorMap = new Map(enabledCals.map(c => [c.id, c.color]));
  const calNameMap = new Map(enabledCals.map(c => [c.id, c.name]));

  const allExternal = await db.select().from(calendarEvents).where(eq(calendarEvents.userId, userId));
  const externalAll = allExternal
    .filter((row: any) => enabledCalIds.has(row.calendarId))
    .filter((row: any) => row.start && row.end && isInRange(row.start, row.end))
    .map((row: any) => ({
      id: row.id,
      googleEventId: row.googleEventId,
      title: row.title,
      start: row.start,
      end: row.end,
      status: row.status || 'busy',
      itemType: 'external',
      itemId: null,
      calendarId: row.calendarId,
      calendarName: calNameMap.get(row.calendarId) || '',
      calendarColor: calColorMap.get(row.calendarId) || '#4285f4',
      location: row.location,
      isAllDay: row.isAllDay,
    }));

  // Deduplicate events that appear in multiple calendars
  const seenKeys = new Set<string>();
  const external = externalAll.filter((ev) => {
    const startMs = new Date(ev.start).getTime();
    const endMs = new Date(ev.end).getTime();
    const key = ev.googleEventId
      ? ev.googleEventId
      : `${ev.title}|${startMs}|${endMs}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  res.json([...managed, ...external]);
});

function toHabit(row: any): Habit {
  return {
    ...row,
    priority: row.priority as Priority,
    frequency: row.frequency as Frequency,
    frequencyConfig: row.frequencyConfig || {},
    schedulingHours: (row.schedulingHours || 'working') as SchedulingHours,
    locked: !!row.locked,
    autoDecline: !!row.autoDecline,
    enabled: row.enabled !== false && row.enabled !== 0,
    skipBuffer: !!row.skipBuffer,
    notifications: !!row.notifications,
  };
}

function toTask(row: any): Task {
  return {
    ...row,
    priority: row.priority as Priority,
    schedulingHours: (row.schedulingHours || 'working') as SchedulingHours,
    status: (row.status || 'open') as TaskStatus,
    isUpNext: !!row.isUpNext,
    skipBuffer: !!row.skipBuffer,
  };
}

function toMeeting(row: any): SmartMeeting {
  return {
    ...row,
    priority: row.priority as Priority,
    frequency: row.frequency as Frequency,
    attendees: row.attendees || [],
    skipBuffer: !!row.skipBuffer,
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

async function getUserSettings(userId: string): Promise<UserSettings> {
  const userRows = await db.select().from(users).where(eq(users.id, userId));
  const settingsRaw = userRows[0]?.settings;
  if (settingsRaw && typeof settingsRaw === 'object') {
    return settingsRaw as UserSettings;
  }
  return {
    workingHours: { start: '09:00', end: '17:00' },
    personalHours: { start: '07:00', end: '22:00' },
    timezone: 'America/New_York',
    schedulingWindowDays: 14,
  };
}

// POST /api/schedule/reschedule — run the scheduling engine
router.post('/reschedule', async (req, res) => {
  try {
    const userId = req.userId;

    // Try the per-user scheduler (Google connected)
    const scheduler = schedulerRegistry.get(userId);
    if (scheduler) {
      const ops = await scheduler.triggerReschedule('Manual reschedule');
      broadcastToUser(userId, 'schedule_updated', 'Manual reschedule');
      res.json({ message: 'Reschedule complete', operationsApplied: ops, unschedulable: [] });
      return;
    }

    // Google not connected — run local-only reschedule
    const [allHabitsRaw, allTasksRaw, allMeetingsRaw, allFocusRulesRaw, bufRows] = await Promise.all([
      db.select().from(habits).where(eq(habits.userId, userId)),
      db.select().from(tasks).where(eq(tasks.userId, userId)),
      db.select().from(smartMeetings).where(eq(smartMeetings.userId, userId)),
      db.select().from(focusTimeRules).where(eq(focusTimeRules.userId, userId)),
      db.select().from(bufferConfig).where(eq(bufferConfig.userId, userId)),
    ]);

    const allHabits = allHabitsRaw.map(toHabit);
    const allTasks = allTasksRaw.map(toTask);
    const allMeetings = allMeetingsRaw.map(toMeeting);
    const allFocusRules = allFocusRulesRaw.map(toFocusRule);
    const buf = bufRows.length > 0 ? toBufConfig(bufRows[0]) : {
      id: 'default',
      travelTimeMinutes: 15,
      decompressionMinutes: 10,
      breakBetweenItemsMinutes: 5,
      applyDecompressionTo: DecompressionTarget.All,
    };

    const userSettings = await getUserSettings(userId);

    const nowISO = new Date().toISOString();
    const scheduledRows = await db.select().from(scheduledEvents)
      .where(and(eq(scheduledEvents.userId, userId), gte(scheduledEvents.end, nowISO)));

    const existingEvents: CalendarEvent[] = scheduledRows.map((row: any) => ({
      id: row.id,
      googleEventId: row.googleEventId || '',
      title: row.title || '',
      start: row.start,
      end: row.end,
      isManaged: true,
      itemType: row.itemType as ItemType,
      itemId: row.itemId,
      status: (row.status || 'free') as EventStatus,
    }));

    const result = reschedule(allHabits, allTasks, allMeetings, allFocusRules, existingEvents, buf, userSettings);

    // Build existing events map for change tracking
    const existingEventsMap = new Map<string, { start: string; end: string; title: string; itemType: string; itemId: string }>();
    for (const ev of existingEvents) {
      existingEventsMap.set(ev.id, {
        start: ev.start,
        end: ev.end,
        title: ev.title || '',
        itemType: ev.itemType || '',
        itemId: ev.itemId || '',
      });
    }

    // Record changes before applying
    await recordScheduleChanges(result.operations, existingEventsMap, userId);

    for (const op of result.operations) {
      const now = new Date().toISOString();
      if (op.type === CalendarOpType.Create) {
        await db.insert(scheduledEvents).values({
          userId,
          itemType: op.itemType,
          itemId: op.itemId,
          title: op.title,
          googleEventId: null,
          start: op.start,
          end: op.end,
          status: op.status,
          alternativeSlotsCount: null,
          createdAt: now,
          updatedAt: now,
        });
      } else if (op.type === CalendarOpType.Update && op.eventId) {
        await db.update(scheduledEvents)
          .set({ title: op.title, start: op.start, end: op.end, status: op.status, updatedAt: now })
          .where(and(eq(scheduledEvents.id, op.eventId), eq(scheduledEvents.userId, userId)));
      } else if (op.type === CalendarOpType.Delete && op.eventId) {
        await db.delete(scheduledEvents)
          .where(and(eq(scheduledEvents.id, op.eventId), eq(scheduledEvents.userId, userId)));
      }
    }

    broadcastToUser(userId, 'schedule_updated', 'Manual reschedule');
    res.json({ message: 'Reschedule complete', operationsApplied: result.operations.length, unschedulable: result.unschedulable });
  } catch (error: any) {
    console.error('Reschedule error:', error);
    sendError(res, 500, 'Reschedule failed');
  }
});

// GET /api/schedule/export — ICS calendar export
router.get('/export', async (req, res) => {
  try {
    const userId = req.userId;
    const startParam = req.query.start as string | undefined;
    const endParam = req.query.end as string | undefined;

    let startFilter: number | null = null;
    let endFilter: number | null = null;

    if (startParam) {
      const parsed = new Date(startParam).getTime();
      if (isNaN(parsed)) {
        sendError(res, 400, 'Invalid start date');
        return;
      }
      startFilter = parsed;
    }
    if (endParam) {
      const parsed = new Date(endParam).getTime();
      if (isNaN(parsed)) {
        sendError(res, 400, 'Invalid end date');
        return;
      }
      endFilter = parsed;
    }

    function inRange(evStart: string, evEnd: string): boolean {
      if (!startFilter || !endFilter) return true;
      const s = new Date(evStart).getTime();
      const e = new Date(evEnd).getTime();
      if (isNaN(s) || isNaN(e)) return false;
      return e > startFilter! && s < endFilter!;
    }

    function toICSDate(isoStr: string): string {
      const d = new Date(isoStr);
      return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    }

    const [allManaged, allExternal] = await Promise.all([
      db.select().from(scheduledEvents).where(eq(scheduledEvents.userId, userId)),
      db.select().from(calendarEvents).where(eq(calendarEvents.userId, userId)),
    ]);

    const managed = allManaged.filter((r: any) => r.start && r.end && inRange(r.start, r.end));
    const external = allExternal.filter((r: any) => r.start && r.end && inRange(r.start, r.end));

    function escapeIcsValue(value: string): string {
      return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n').replace(/\r/g, '');
    }

    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//${BRAND.name}//EN`,
      'CALSCALE:GREGORIAN',
    ];

    for (const ev of managed) {
      lines.push('BEGIN:VEVENT');
      lines.push(`DTSTART:${toICSDate(ev.start!)}`);
      lines.push(`DTEND:${toICSDate(ev.end!)}`);
      lines.push(`SUMMARY:${escapeIcsValue(ev.title || ev.itemType || 'Event')}`);
      lines.push(`UID:${ev.id}@cadence`);
      lines.push(`DTSTAMP:${toICSDate(ev.createdAt || new Date().toISOString())}`);
      lines.push('END:VEVENT');
    }

    for (const ev of external) {
      lines.push('BEGIN:VEVENT');
      lines.push(`DTSTART:${toICSDate(ev.start)}`);
      lines.push(`DTEND:${toICSDate(ev.end)}`);
      lines.push(`SUMMARY:${escapeIcsValue(ev.title)}`);
      lines.push(`UID:${ev.id}@cadence`);
      lines.push(`DTSTAMP:${toICSDate(ev.updatedAt || new Date().toISOString())}`);
      if (ev.location) lines.push(`LOCATION:${escapeIcsValue(ev.location)}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');

    const icsContent = lines.join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cadence-schedule.ics"');
    res.send(icsContent);
  } catch (error: any) {
    console.error('ICS export error:', error);
    sendError(res, 500, 'Export failed');
  }
});

// GET /api/schedule/changes — return recent schedule changes
router.get('/changes', async (req, res) => {
  try {
    const userId = req.userId;
    const parsed = scheduleChangesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, 400, parsed.error.issues[0]?.message || 'Invalid query parameters');
      return;
    }

    const { limit, since } = parsed.data;

    let rows;
    if (since) {
      rows = await db.select().from(scheduleChanges)
        .where(and(eq(scheduleChanges.userId, userId), gte(scheduleChanges.createdAt, since)))
        .orderBy(desc(scheduleChanges.createdAt))
        .limit(limit);
    } else {
      rows = await db.select().from(scheduleChanges)
        .where(eq(scheduleChanges.userId, userId))
        .orderBy(desc(scheduleChanges.createdAt))
        .limit(limit);
    }

    res.json(rows);
  } catch (error: any) {
    console.error('Schedule changes query error:', error);
    sendError(res, 500, 'Failed to fetch schedule changes');
  }
});

// GET /api/schedule/quality — calculate schedule quality score
router.get('/quality', async (req, res) => {
  try {
    const userId = req.userId;
    const userSettings = await getUserSettings(userId);

    const tz = userSettings.timezone || 'UTC';
    const dateParam = req.query.date as string | undefined;
    const targetDate = dateParam ? new Date(dateParam) : new Date();
    if (isNaN(targetDate.getTime())) {
      sendError(res, 400, 'Invalid date');
      return;
    }

    // Compute day boundaries
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Load all domain objects
    const [allHabitsRaw, allTasksRaw, allMeetingsRaw, allFocusRulesRaw, bufRows] = await Promise.all([
      db.select().from(habits).where(eq(habits.userId, userId)),
      db.select().from(tasks).where(eq(tasks.userId, userId)),
      db.select().from(smartMeetings).where(eq(smartMeetings.userId, userId)),
      db.select().from(focusTimeRules).where(eq(focusTimeRules.userId, userId)),
      db.select().from(bufferConfig).where(eq(bufferConfig.userId, userId)),
    ]);

    const allHabits = allHabitsRaw.map(toHabit).filter(h => h.enabled);
    const allTasks = allTasksRaw.map(toTask).filter(t => t.status === TaskStatus.Open);
    const allMeetings = allMeetingsRaw.map(toMeeting);
    const allFocusRules = allFocusRulesRaw.map(toFocusRule).filter(r => r.enabled);
    const buf = bufRows.length > 0 ? toBufConfig(bufRows[0]) : {
      id: 'default',
      travelTimeMinutes: 15,
      decompressionMinutes: 10,
      breakBetweenItemsMinutes: 5,
      applyDecompressionTo: DecompressionTarget.All,
    };

    // Build ScheduleItems for the target day
    const scheduleItems: ScheduleItem[] = [];

    for (const h of allHabits) {
      scheduleItems.push({
        id: h.id,
        name: h.name,
        type: ItemType.Habit,
        priority: h.priority,
        timeWindow: { start: dayStart, end: dayEnd },
        idealTime: h.idealTime,
        duration: h.durationMax,
        durationMin: h.durationMin,
        skipBuffer: h.skipBuffer,
        locked: h.locked,
        dependsOn: h.dependsOn,
      });
    }

    for (const t of allTasks) {
      if (t.remainingDuration <= 0) continue;
      scheduleItems.push({
        id: t.id,
        name: t.name,
        type: ItemType.Task,
        priority: t.isUpNext ? Priority.Critical : t.priority,
        timeWindow: { start: dayStart, end: dayEnd },
        idealTime: userSettings.workingHours.start,
        duration: Math.min(t.remainingDuration, t.chunkMax),
        skipBuffer: t.skipBuffer,
        locked: false,
        dependsOn: null,
      });
    }

    for (const m of allMeetings) {
      scheduleItems.push({
        id: m.id,
        name: m.name,
        type: ItemType.Meeting,
        priority: m.priority,
        timeWindow: { start: dayStart, end: dayEnd },
        idealTime: m.idealTime,
        duration: m.duration,
        skipBuffer: m.skipBuffer,
        locked: false,
        dependsOn: null,
      });
    }

    // Build placements map from scheduled events for the target day
    const allScheduled = await db.select().from(scheduledEvents).where(eq(scheduledEvents.userId, userId));
    const scheduledRows = allScheduled.filter((r: any) => {
      if (!r.start || !r.end) return false;
      const evEnd = new Date(r.end).getTime();
      const evStart = new Date(r.start).getTime();
      return evEnd > dayStart.getTime() && evStart < dayEnd.getTime();
    });

    const placements = new Map<string, TimeSlot>();
    let focusMinutesPlaced = 0;

    for (const row of scheduledRows) {
      const slot: TimeSlot = {
        start: new Date(row.start!),
        end: new Date(row.end!),
      };
      const originalId = row.itemId?.split('__')[0] || row.itemId || '';
      placements.set(originalId, slot);

      if (row.itemType === ItemType.Focus) {
        focusMinutesPlaced += (slot.end.getTime() - slot.start.getTime()) / 60000;
      }
    }

    const quality = calculateScheduleQuality(
      scheduleItems,
      placements,
      allFocusRules,
      buf,
      focusMinutesPlaced,
      tz,
    );

    res.json(quality);
  } catch (error: any) {
    console.error('Quality score error:', error);
    sendError(res, 500, 'Failed to calculate quality score');
  }
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/schedule/:itemId/alternatives — find alternative time slots
router.get('/:itemId/alternatives', async (req, res) => {
  try {
    const userId = req.userId;
    const { itemId } = req.params;

    if (!UUID_REGEX.test(itemId)) {
      sendError(res, 400, 'Invalid itemId format');
      return;
    }

    // Look up the item across habits, tasks, meetings (scoped to user)
    const [habitRows, taskRows, meetingRows] = await Promise.all([
      db.select().from(habits).where(and(eq(habits.id, itemId), eq(habits.userId, userId))),
      db.select().from(tasks).where(and(eq(tasks.id, itemId), eq(tasks.userId, userId))),
      db.select().from(smartMeetings).where(and(eq(smartMeetings.id, itemId), eq(smartMeetings.userId, userId))),
    ]);

    const habit = habitRows[0] ?? null;
    const task = taskRows[0] ?? null;
    const meeting = meetingRows[0] ?? null;

    if (!habit && !task && !meeting) {
      sendNotFound(res, 'Item');
      return;
    }

    const userSettings = await getUserSettings(userId);

    // Load buffer config
    const bufRows = await db.select().from(bufferConfig).where(eq(bufferConfig.userId, userId));
    const buf: BufferConfig = bufRows.length > 0 ? toBufConfig(bufRows[0]) : {
      id: 'default',
      travelTimeMinutes: 15,
      decompressionMinutes: 10,
      breakBetweenItemsMinutes: 5,
      applyDecompressionTo: DecompressionTarget.All,
    };

    // Build occupied slots from existing scheduled events
    const allScheduled = await db.select().from(scheduledEvents).where(eq(scheduledEvents.userId, userId));
    const occupiedSlots: TimeSlot[] = allScheduled
      .filter((r: any) => r.start && r.end)
      .map((r: any) => ({
        start: new Date(r.start),
        end: new Date(r.end),
      }));

    // Build existing placements map
    const existingPlacements = new Map<string, TimeSlot>();
    for (const ev of allScheduled) {
      if (ev.itemId && ev.start && ev.end) {
        existingPlacements.set(ev.itemId, {
          start: new Date(ev.start),
          end: new Date(ev.end),
        });
      }
    }

    // Build the schedule item
    const now = new Date();
    const windowEnd = new Date(now.getTime() + userSettings.schedulingWindowDays * 86400000);

    let scheduleItem: ScheduleItem;
    if (habit) {
      const h = toHabit(habit);
      scheduleItem = {
        id: h.id,
        type: ItemType.Habit,
        priority: h.priority,
        timeWindow: { start: now, end: windowEnd },
        idealTime: h.idealTime,
        duration: h.durationMax,
        durationMin: h.durationMin,
        skipBuffer: h.skipBuffer,
        locked: h.locked,
        dependsOn: h.dependsOn,
      };
    } else if (task) {
      const t = toTask(task);
      scheduleItem = {
        id: t.id,
        type: ItemType.Task,
        priority: t.priority,
        timeWindow: { start: now, end: t.dueDate ? new Date(t.dueDate) : windowEnd },
        idealTime: '10:00',
        duration: Math.min(t.remainingDuration, t.chunkMax),
        skipBuffer: t.skipBuffer,
        locked: false,
        dependsOn: null,
      };
    } else {
      const m = toMeeting(meeting!);
      scheduleItem = {
        id: m.id,
        type: ItemType.Meeting,
        priority: m.priority,
        timeWindow: { start: now, end: windowEnd },
        idealTime: m.idealTime || '10:00',
        duration: m.duration,
        skipBuffer: m.skipBuffer,
        locked: false,
        dependsOn: null,
      };
    }

    // Build timeline and generate candidates
    const timeline = buildTimeline(now, windowEnd, userSettings);
    const tz = userSettings.timezone || 'UTC';
    const candidates = generateCandidateSlots(
      scheduleItem,
      timeline,
      occupiedSlots,
      buf,
      existingPlacements,
      scheduleItem.dependsOn,
      tz,
    );

    // Score and sort
    const scored = candidates.map((slot) => ({
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
      score: scoreSlot(slot, scheduleItem, existingPlacements, buf, tz),
    }));

    scored.sort((a, b) => b.score - a.score);

    res.json({ alternatives: scored.slice(0, 5) });
  } catch (error: any) {
    console.error('Alternatives error:', error);
    sendError(res, 500, 'Failed to compute alternatives');
  }
});

// DELETE /api/schedule/managed-events — delete ALL Cadence-managed events from Google Calendar and local DB
router.delete('/managed-events', async (req, res) => {
  try {
    const userId = req.userId;
    const scheduler = schedulerRegistry.get(userId);
    const calClient = scheduler?.getCalClient() ?? null;
    const manager = scheduler?.getPollerManager() ?? null;
    let googleDeleted = 0;

    if (calClient) {
      // Delete from all enabled writable calendars
      const enabledCals = await db.select().from(calendars)
        .where(and(eq(calendars.userId, userId), eq(calendars.enabled, true)));

      for (const cal of enabledCals) {
        const count = await calClient.deleteAllManagedEvents(cal.googleCalendarId);
        googleDeleted += count;
      }

      // Also delete from primary calendar
      const primaryCount = await calClient.deleteAllManagedEvents('primary');
      googleDeleted += primaryCount;
    }

    // Clear all local scheduled events for this user
    const localRows = await db.select().from(scheduledEvents).where(eq(scheduledEvents.userId, userId));
    const localCount = localRows.length;
    await db.delete(scheduledEvents).where(eq(scheduledEvents.userId, userId));

    // Mark all pollers as written to skip the next poll cycle
    manager?.markAllWritten();

    broadcastToUser(userId, 'schedule_updated', 'Managed events cleared');
    res.json({
      message: 'All managed events deleted',
      googleEventsDeleted: googleDeleted,
      localEventsDeleted: localCount,
    });
  } catch (error: any) {
    console.error('Nuke managed events error:', error);
    sendError(res, 500, 'Failed to delete managed events');
  }
});

// POST /api/schedule/:eventId/move — move event to a new time and lock it
router.post('/:eventId/move', async (req, res) => {
  try {
    const userId = req.userId;
    const { eventId } = req.params;
    const parsed = moveEventSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, parsed.error.issues[0]?.message || 'Invalid input');
      return;
    }
    const { start, end } = parsed.data;

    // Find the scheduled event (scoped to user)
    const rows = await db.select().from(scheduledEvents).where(and(eq(scheduledEvents.id, eventId), eq(scheduledEvents.userId, userId)));
    if (rows.length === 0) {
      sendNotFound(res, 'Scheduled event');
      return;
    }
    const row = rows[0];

    const now = new Date().toISOString();

    // Update local DB: new time + locked status
    await db.update(scheduledEvents)
      .set({ start, end, status: EventStatus.Locked, updatedAt: now })
      .where(and(eq(scheduledEvents.id, eventId), eq(scheduledEvents.userId, userId)));

    // Update Google Calendar event if connected
    const scheduler = schedulerRegistry.get(userId);
    const calClient = scheduler?.getCalClient() ?? null;
    const manager = scheduler?.getPollerManager() ?? null;

    if (calClient && row.googleEventId) {
      const calRows = row.calendarId
        ? await db.select().from(calendars).where(and(eq(calendars.id, row.calendarId), eq(calendars.userId, userId)))
        : [];
      const googleCalId = calRows[0]?.googleCalendarId || 'primary';

      const op = {
        type: CalendarOpType.Update as const,
        eventId: row.id,
        googleEventId: row.googleEventId,
        itemType: (row.itemType || ItemType.Habit) as ItemType,
        itemId: row.itemId || '',
        title: row.title || '',
        start,
        end,
        status: EventStatus.Locked,
        extendedProperties: {
          [EXTENDED_PROPS.cadenceId]: row.id,
          [EXTENDED_PROPS.itemType]: row.itemType || ItemType.Habit,
          [EXTENDED_PROPS.itemId]: row.itemId?.split('__')[0] || '',
          [EXTENDED_PROPS.status]: EventStatus.Locked,
        },
      };
      await calClient.applyOperations(googleCalId, [op]);
    }

    // Prevent poller echo
    manager?.markAllWritten();

    // Trigger reschedule so other events move around the locked one
    triggerReschedule('Event moved and locked', userId);

    broadcastToUser(userId, 'schedule_updated', 'Event moved');
    res.json({ message: 'Event moved and locked', eventId, start, end });
  } catch (error: any) {
    console.error('Move event error:', error);
    sendError(res, 500, 'Failed to move event');
  }
});

export default router;
