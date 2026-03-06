import { Router } from 'express';
import { eq, gte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { scheduledEvents, calendarEvents, calendars, habits, tasks, smartMeetings, focusTimeRules, bufferConfig, users } from '../db/schema.js';
import { reschedule, generateCandidateSlots, scoreSlot, buildTimeline } from '@cadence/engine';
import type { Habit, Task, SmartMeeting, FocusTimeRule, BufferConfig, CalendarEvent, UserSettings, ScheduleItem, TimeSlot } from '@cadence/shared';
import { Priority, Frequency, SchedulingHours, TaskStatus, DecompressionTarget, EventStatus, ItemType, CalendarOpType } from '@cadence/shared';
import { pollingRef } from '../polling-ref.js';
import { broadcast } from '../ws.js';

const router = Router();

// GET /api/schedule — return scheduled + external calendar events, filtered by date range
router.get('/', (req, res) => {
  let startFilter: number | null = null;
  let endFilter: number | null = null;

  if (req.query.start) {
    const parsed = new Date(req.query.start as string).getTime();
    if (isNaN(parsed)) {
      res.status(400).json({ error: 'Invalid start date format' });
      return;
    }
    startFilter = parsed;
  }
  if (req.query.end) {
    const parsed = new Date(req.query.end as string).getTime();
    if (isNaN(parsed)) {
      res.status(400).json({ error: 'Invalid end date format' });
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
  const habitRows = db.select().from(habits).all();
  const taskRows = db.select().from(tasks).all();
  const meetingRows = db.select().from(smartMeetings).all();
  const itemColorMap = new Map<string, string>();
  for (const h of habitRows) { if (h.color) itemColorMap.set(h.id, h.color); }
  for (const t of taskRows) { if (t.color) itemColorMap.set(t.id, t.color); }
  for (const m of meetingRows) { if (m.color) itemColorMap.set(m.id, m.color); }

  // Managed events from the scheduling engine
  const managed = db.select().from(scheduledEvents).all()
    .map((row: any) => {
      // itemId may be composite (e.g. habitId__2026-03-06); extract original for color lookup
      const originalId = row.itemId?.split('__')[0] || row.itemId;
      return {
        ...row,
        calendarId: row.calendarId || 'primary',
        itemColor: originalId ? itemColorMap.get(originalId) || null : null,
      };
    })
    .filter((row: any) => row.start && row.end && isInRange(row.start, row.end));

  // External events from enabled calendars
  const enabledCals = db.select().from(calendars)
    .where(eq(calendars.enabled, true))
    .all();
  const enabledCalIds = new Set(enabledCals.map(c => c.id));
  const calColorMap = new Map(enabledCals.map(c => [c.id, c.color]));
  const calNameMap = new Map(enabledCals.map(c => [c.id, c.name]));

  const externalAll = db.select().from(calendarEvents).all()
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

  // Deduplicate events that appear in multiple calendars (e.g. accepted invites).
  // Cross-calendar copies have different googleEventIds and possibly different
  // timezone representations of the same instant, so dedup by title + parsed timestamps.
  const seenKeys = new Set<string>();
  const external = externalAll.filter((ev) => {
    const startMs = new Date(ev.start).getTime();
    const endMs = new Date(ev.end).getTime();
    const key = `${ev.title}|${startMs}|${endMs}`;
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
    frequencyConfig: row.frequencyConfig ? JSON.parse(row.frequencyConfig) : {},
    schedulingHours: (row.schedulingHours || 'working') as SchedulingHours,
    locked: !!row.locked,
    autoDecline: !!row.autoDecline,
    enabled: row.enabled !== false && row.enabled !== 0,
    skipBuffer: !!row.skipBuffer,
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
    attendees: row.attendees ? JSON.parse(row.attendees) : [],
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

// POST /api/schedule/reschedule — run the scheduling engine
router.post('/reschedule', async (_req, res) => {
  try {
    if (pollingRef.runReschedule) {
      const ops = await pollingRef.runReschedule('Manual reschedule');
      broadcast('schedule_updated', 'Manual reschedule');
      res.json({ message: 'Reschedule complete', operationsApplied: ops, unschedulable: [] });
    } else {
      // Google not connected — run local-only reschedule
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

      const nowISO = new Date().toISOString();
      const existingEvents: CalendarEvent[] = db.select().from(scheduledEvents)
        .where(gte(scheduledEvents.end, nowISO)).all().map((row: any) => ({
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

      for (const op of result.operations) {
        const now = new Date().toISOString();
        if (op.type === CalendarOpType.Create) {
          db.insert(scheduledEvents).values({
            id: crypto.randomUUID(),
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
          }).run();
        } else if (op.type === CalendarOpType.Update && op.eventId) {
          db.update(scheduledEvents)
            .set({ title: op.title, start: op.start, end: op.end, status: op.status, updatedAt: now })
            .where(eq(scheduledEvents.id, op.eventId))
            .run();
        } else if (op.type === CalendarOpType.Delete && op.eventId) {
          db.delete(scheduledEvents)
            .where(eq(scheduledEvents.id, op.eventId))
            .run();
        }
      }

      broadcast('schedule_updated', 'Manual reschedule');
      res.json({ message: 'Reschedule complete', operationsApplied: result.operations.length, unschedulable: result.unschedulable });
    }
  } catch (error: any) {
    console.error('Reschedule error:', error);
    res.status(500).json({ error: 'Reschedule failed' });
  }
});

// GET /api/schedule/export — ICS calendar export
router.get('/export', (req, res) => {
  try {
    const startParam = req.query.start as string | undefined;
    const endParam = req.query.end as string | undefined;

    let startFilter: number | null = null;
    let endFilter: number | null = null;

    if (startParam) {
      const parsed = new Date(startParam).getTime();
      if (isNaN(parsed)) {
        res.status(400).json({ error: 'Invalid start date' });
        return;
      }
      startFilter = parsed;
    }
    if (endParam) {
      const parsed = new Date(endParam).getTime();
      if (isNaN(parsed)) {
        res.status(400).json({ error: 'Invalid end date' });
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

    const managed = db.select().from(scheduledEvents).all()
      .filter((r: any) => r.start && r.end && inRange(r.start, r.end));

    const external = db.select().from(calendarEvents).all()
      .filter((r: any) => r.start && r.end && inRange(r.start, r.end));

    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Cadence//EN',
      'CALSCALE:GREGORIAN',
    ];

    for (const ev of managed) {
      lines.push('BEGIN:VEVENT');
      lines.push(`DTSTART:${toICSDate(ev.start!)}`);
      lines.push(`DTEND:${toICSDate(ev.end!)}`);
      lines.push(`SUMMARY:${ev.title || ev.itemType || 'Event'}`);
      lines.push(`UID:${ev.id}@cadence`);
      lines.push(`DTSTAMP:${toICSDate(ev.createdAt || new Date().toISOString())}`);
      lines.push('END:VEVENT');
    }

    for (const ev of external) {
      lines.push('BEGIN:VEVENT');
      lines.push(`DTSTART:${toICSDate(ev.start)}`);
      lines.push(`DTEND:${toICSDate(ev.end)}`);
      lines.push(`SUMMARY:${ev.title}`);
      lines.push(`UID:${ev.id}@cadence`);
      lines.push(`DTSTAMP:${toICSDate(ev.updatedAt || new Date().toISOString())}`);
      if (ev.location) lines.push(`LOCATION:${ev.location}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');

    const icsContent = lines.join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cadence-schedule.ics"');
    res.send(icsContent);
  } catch (error: any) {
    console.error('ICS export error:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

// GET /api/schedule/:itemId/alternatives — find alternative time slots
router.get('/:itemId/alternatives', (req, res) => {
  try {
    const { itemId } = req.params;

    // Look up the item across habits, tasks, meetings
    const habit = db.select().from(habits).where(eq(habits.id, itemId)).get();
    const task = !habit ? db.select().from(tasks).where(eq(tasks.id, itemId)).get() : null;
    const meeting = (!habit && !task) ? db.select().from(smartMeetings).where(eq(smartMeetings.id, itemId)).get() : null;

    if (!habit && !task && !meeting) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    // Load user settings
    const userRows = db.select().from(users).all();
    const userSettings: UserSettings = userRows.length > 0 && userRows[0].settings
      ? JSON.parse(userRows[0].settings)
      : {
          workingHours: { start: '09:00', end: '17:00' },
          personalHours: { start: '07:00', end: '22:00' },
          timezone: 'America/New_York',
          schedulingWindowDays: 14,
        };

    // Load buffer config
    const bufRows = db.select().from(bufferConfig).all();
    const buf: BufferConfig = bufRows.length > 0 ? toBufConfig(bufRows[0]) : {
      id: 'default',
      travelTimeMinutes: 15,
      decompressionMinutes: 10,
      breakBetweenItemsMinutes: 5,
      applyDecompressionTo: DecompressionTarget.All,
    };

    // Build occupied slots from existing scheduled events
    const allScheduled = db.select().from(scheduledEvents).all();
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
    res.status(500).json({ error: 'Failed to compute alternatives' });
  }
});

// DELETE /api/schedule/managed-events — delete ALL Cadence-managed events from Google Calendar and local DB
router.delete('/managed-events', async (_req, res) => {
  try {
    const calClient = pollingRef.calClient;
    let googleDeleted = 0;

    if (calClient) {
      // Delete from all enabled writable calendars
      const enabledCals = db.select().from(calendars)
        .where(eq(calendars.enabled, true))
        .all();

      for (const cal of enabledCals) {
        const count = await calClient.deleteAllManagedEvents(cal.googleCalendarId);
        googleDeleted += count;
      }

      // Also delete from primary calendar
      const primaryCount = await calClient.deleteAllManagedEvents('primary');
      googleDeleted += primaryCount;
    }

    // Clear all local scheduled events
    const localRows = db.select().from(scheduledEvents).all();
    const localCount = localRows.length;
    for (const row of localRows) {
      db.delete(scheduledEvents).where(eq(scheduledEvents.id, row.id)).run();
    }

    // Mark all pollers as written to skip the next poll cycle
    pollingRef.manager?.markAllWritten();

    broadcast('schedule_updated', 'Managed events cleared');
    res.json({
      message: 'All managed events deleted',
      googleEventsDeleted: googleDeleted,
      localEventsDeleted: localCount,
    });
  } catch (error: any) {
    console.error('Nuke managed events error:', error);
    res.status(500).json({ error: 'Failed to delete managed events' });
  }
});

export default router;
