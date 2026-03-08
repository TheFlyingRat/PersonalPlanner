import { Router } from 'express';
import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { scheduledEvents, habits } from '../db/pg-schema.js';
import type { AnalyticsData } from '@cadence/shared';

const router = Router();

const MAX_RANGE_DAYS = 365;

function getDateRange(req: import('express').Request): { fromDate: string; toDate: string } | { error: string } {
  const now = new Date();
  let toDate: string;
  let fromDate: string;

  if (typeof req.query.to === 'string') {
    if (isNaN(Date.parse(req.query.to))) return { error: 'Invalid "to" date format' };
    toDate = req.query.to;
  } else {
    toDate = now.toISOString();
  }

  if (typeof req.query.from === 'string') {
    if (isNaN(Date.parse(req.query.from))) return { error: 'Invalid "from" date format' };
    fromDate = req.query.from;
  } else {
    fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  const rangeMs = new Date(toDate).getTime() - new Date(fromDate).getTime();
  if (rangeMs < 0) return { error: '"from" must be before "to"' };
  if (rangeMs > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) return { error: `Date range must not exceed ${MAX_RANGE_DAYS} days` };

  return { fromDate, toDate };
}

// GET /api/analytics — compute analytics from scheduled_events
router.get('/', async (req, res) => {
  const userId = req.userId;
  const range = getDateRange(req);
  if ('error' in range) {
    res.status(400).json({ error: range.error });
    return;
  }
  const { fromDate, toDate } = range;

  const [events, allHabits] = await Promise.all([
    db.select().from(scheduledEvents).where(
      and(
        eq(scheduledEvents.userId, userId),
        gte(scheduledEvents.end, fromDate),
        lte(scheduledEvents.start, toDate),
      ),
    ),
    db.select().from(habits).where(eq(habits.userId, userId)),
  ]);

  let habitMinutes = 0;
  let taskMinutes = 0;
  let meetingMinutes = 0;
  let focusMinutes = 0;

  for (const event of events) {
    const minutes = computeMinutes(event.start, event.end);
    switch (event.itemType) {
      case 'habit':
        habitMinutes += minutes;
        break;
      case 'task':
        taskMinutes += minutes;
        break;
      case 'meeting':
        meetingMinutes += minutes;
        break;
      case 'focus':
        focusMinutes += minutes;
        break;
    }
  }

  // Habit completion rate: scheduled habit events / total enabled habits
  const enabledHabitsCount = allHabits.filter(h => h.enabled).length;
  const habitEventCount = events.filter(e => e.itemType === 'habit').length;
  const habitCompletionRate = enabledHabitsCount > 0 ? habitEventCount / enabledHabitsCount : 0;

  const analytics: AnalyticsData = {
    habitMinutes,
    taskMinutes,
    meetingMinutes,
    focusMinutes,
    habitCompletionRate: Math.min(habitCompletionRate, 1),
    weeklyBreakdown: [],
  };

  res.json(analytics);
});

// GET /api/analytics/weekly — weekly breakdown
router.get('/weekly', async (req, res) => {
  const userId = req.userId;
  const range = getDateRange(req);
  if ('error' in range) {
    res.status(400).json({ error: range.error });
    return;
  }
  const { fromDate, toDate } = range;
  const events = await db.select().from(scheduledEvents).where(
    and(
      eq(scheduledEvents.userId, userId),
      gte(scheduledEvents.end, fromDate),
      lte(scheduledEvents.start, toDate),
    ),
  );

  // Group events by date (day)
  const dayMap = new Map<string, { habitMinutes: number; taskMinutes: number; meetingMinutes: number; focusMinutes: number }>();

  for (const event of events) {
    if (!event.start) continue;
    const date = event.start.substring(0, 10); // YYYY-MM-DD
    const minutes = computeMinutes(event.start, event.end);

    if (!dayMap.has(date)) {
      dayMap.set(date, { habitMinutes: 0, taskMinutes: 0, meetingMinutes: 0, focusMinutes: 0 });
    }

    const day = dayMap.get(date)!;
    switch (event.itemType) {
      case 'habit':
        day.habitMinutes += minutes;
        break;
      case 'task':
        day.taskMinutes += minutes;
        break;
      case 'meeting':
        day.meetingMinutes += minutes;
        break;
      case 'focus':
        day.focusMinutes += minutes;
        break;
    }
  }

  // Sort by date and return
  const weeklyBreakdown = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));

  res.json({ weeklyBreakdown });
});

function computeMinutes(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();
  return Math.max(0, Math.round(diffMs / 60000));
}

export default router;
