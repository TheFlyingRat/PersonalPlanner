import { Router } from 'express';
import { like, and, eq } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { habits, tasks, smartMeetings, calendarEvents } from '../db/pg-schema.js';
import { sendError } from './helpers.js';

const router = Router();

// GET /api/search?q=... — search across habits, tasks, meetings, and events
router.get('/', async (req, res) => {
  const q = req.query.q;
  if (!q || typeof q !== 'string' || q.trim().length < 2) {
    res.json({ results: [] });
    return;
  }
  if (q.length > 100) {
    sendError(res, 400, 'Search query too long');
    return;
  }

  const pattern = `%${q.trim()}%`;
  const userId = req.userId;

  const [habitResults, taskResults, meetingResults, eventResults] = await Promise.all([
    db.select().from(habits).where(and(eq(habits.userId, userId), like(habits.name, pattern))),
    db.select().from(tasks).where(and(eq(tasks.userId, userId), like(tasks.name, pattern))),
    db.select().from(smartMeetings).where(and(eq(smartMeetings.userId, userId), like(smartMeetings.name, pattern))),
    db.select().from(calendarEvents).where(and(eq(calendarEvents.userId, userId), like(calendarEvents.title, pattern))),
  ]);

  res.json({
    results: [
      ...habitResults.map((h) => ({ type: 'habit', id: h.id, name: h.name, href: '/habits' })),
      ...taskResults.map((t) => ({ type: 'task', id: t.id, name: t.name, href: '/tasks' })),
      ...meetingResults.map((m) => ({ type: 'meeting', id: m.id, name: m.name, href: '/meetings' })),
      ...eventResults.map((e) => ({ type: 'event', id: e.id, name: e.title, href: '/' })),
    ],
  });
});

export default router;
