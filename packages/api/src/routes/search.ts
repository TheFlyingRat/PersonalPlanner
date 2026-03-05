import { Router } from 'express';
import { like } from 'drizzle-orm';
import { db } from '../db/index.js';
import { habits, tasks, smartMeetings, calendarEvents } from '../db/schema.js';

const router = Router();

// GET /api/search?q=... — search across habits, tasks, meetings, and events
router.get('/', (_req, res) => {
  const q = _req.query.q;
  if (!q || typeof q !== 'string' || q.trim().length < 2) {
    res.json({ results: [] });
    return;
  }

  const pattern = `%${q.trim()}%`;

  const habitResults = db.select().from(habits).where(like(habits.name, pattern)).all();
  const taskResults = db.select().from(tasks).where(like(tasks.name, pattern)).all();
  const meetingResults = db.select().from(smartMeetings).where(like(smartMeetings.name, pattern)).all();
  const eventResults = db.select().from(calendarEvents).where(like(calendarEvents.title, pattern)).all();

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
