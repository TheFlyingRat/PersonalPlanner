import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { schedulingLinks } from '../db/schema.js';
import type { CreateLinkRequest, SchedulingLink } from '@reclaim/shared';

const router = Router();

// GET /api/links — list scheduling links
router.get('/', (_req, res) => {
  const rows = db.select().from(schedulingLinks).all();
  const result: SchedulingLink[] = rows.map(toLink);
  res.json(result);
});

// POST /api/links — create a scheduling link
router.post('/', (req, res) => {
  const body = req.body as CreateLinkRequest;

  if (!body.name || !body.slug || !body.durations || !Array.isArray(body.durations)) {
    res.status(400).json({ error: 'Missing required fields: name, slug, durations' });
    return;
  }

  // Check for slug uniqueness
  const existingSlug = db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, body.slug)).get();
  if (existingSlug) {
    res.status(409).json({ error: 'Slug already exists' });
    return;
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const row = {
    id,
    slug: body.slug,
    name: body.name,
    durations: JSON.stringify(body.durations),
    schedulingHours: body.schedulingHours ?? 'working',
    priority: body.priority ?? 3,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(schedulingLinks).values(row).run();

  const created = db.select().from(schedulingLinks).where(eq(schedulingLinks.id, id)).get();
  res.status(201).json(toLink(created!));
});

// GET /api/links/:slug/slots — return available time slots (placeholder)
router.get('/:slug/slots', (req, res) => {
  const { slug } = req.params;
  const link = db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, slug)).get();

  if (!link) {
    res.status(404).json({ error: 'Scheduling link not found' });
    return;
  }

  // Placeholder: will compute available slots from calendar
  res.json({ slug, slots: [] });
});

// POST /api/links/:slug/book — book a slot (placeholder)
router.post('/:slug/book', (req, res) => {
  const { slug } = req.params;
  const link = db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, slug)).get();

  if (!link) {
    res.status(404).json({ error: 'Scheduling link not found' });
    return;
  }

  // Placeholder: will book a calendar slot
  res.json({ message: 'Booking placeholder', slug, requestedSlot: req.body });
});

function toLink(row: typeof schedulingLinks.$inferSelect): SchedulingLink {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    durations: row.durations ? JSON.parse(row.durations) as number[] : [],
    schedulingHours: (row.schedulingHours ?? 'working') as SchedulingLink['schedulingHours'],
    priority: row.priority ?? 3,
    enabled: row.enabled ?? true,
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

export default router;
