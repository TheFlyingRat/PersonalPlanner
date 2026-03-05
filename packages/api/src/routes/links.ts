import { Router } from 'express';
import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { schedulingLinks, scheduledEvents, users } from '../db/schema.js';
import type { CreateLinkRequest, SchedulingLink, UserSettings } from '@cadence/shared';
import { SchedulingHours } from '@cadence/shared';
import { createLinkSchema, updateLinkSchema } from '../validation.js';

const router = Router();

// GET /api/links — list scheduling links
router.get('/', (_req, res) => {
  const rows = db.select().from(schedulingLinks).all();
  const result: SchedulingLink[] = rows.map(toLink);
  res.json(result);
});

// POST /api/links — create a scheduling link
router.post('/', (req, res) => {
  const parsed = createLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }
  const body = parsed.data as CreateLinkRequest;

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

// PUT /api/links/:id — update a scheduling link
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(schedulingLinks).where(eq(schedulingLinks.id, id)).get();

  if (!existing) {
    res.status(404).json({ error: 'Scheduling link not found' });
    return;
  }

  const parsed = updateLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }

  const body = parsed.data;
  const now = new Date().toISOString();

  const updates: Record<string, unknown> = { updatedAt: now };

  if (body.name !== undefined) updates.name = body.name;
  if (body.slug !== undefined) {
    // Check slug uniqueness if changing
    if (body.slug !== existing.slug) {
      const existingSlug = db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, body.slug)).get();
      if (existingSlug) {
        res.status(409).json({ error: 'Slug already exists' });
        return;
      }
    }
    updates.slug = body.slug;
  }
  if (body.durations !== undefined) updates.durations = JSON.stringify(body.durations);
  if (body.schedulingHours !== undefined) updates.schedulingHours = body.schedulingHours;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  db.update(schedulingLinks).set(updates).where(eq(schedulingLinks.id, id)).run();

  const updated = db.select().from(schedulingLinks).where(eq(schedulingLinks.id, id)).get();
  res.json(toLink(updated!));
});

// DELETE /api/links/:id — delete a scheduling link
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.select().from(schedulingLinks).where(eq(schedulingLinks.id, id)).get();

  if (!existing) {
    res.status(404).json({ error: 'Scheduling link not found' });
    return;
  }

  db.delete(schedulingLinks).where(eq(schedulingLinks.id, id)).run();

  res.status(204).send();
});

// GET /api/links/:slug/slots — return available time slots
router.get('/:slug/slots', (req, res) => {
  const { slug } = req.params;
  const link = db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, slug)).get();

  if (!link) {
    res.status(404).json({ error: 'Scheduling link not found' });
    return;
  }

  if (!link.enabled) {
    res.status(410).json({ error: 'Scheduling link is disabled' });
    return;
  }

  const durations: number[] = link.durations ? JSON.parse(link.durations) : [30];
  const schedulingHours = (link.schedulingHours ?? 'working') as SchedulingHours;

  // Load user settings for working/personal hours
  const userRows = db.select().from(users).all();
  const userSettings: UserSettings = userRows.length > 0 && userRows[0].settings
    ? JSON.parse(userRows[0].settings)
    : {
        workingHours: { start: '09:00', end: '17:00' },
        personalHours: { start: '07:00', end: '22:00' },
        timezone: 'America/New_York',
        schedulingWindowDays: 14,
      };

  // Determine the scheduling hours window
  const hoursWindow = getHoursWindow(schedulingHours, userSettings);

  // Compute slots for the next 7 days
  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + 7);

  // Load all existing scheduled events within the window
  const existingEvents = db.select().from(scheduledEvents)
    .where(
      and(
        gte(scheduledEvents.end, now.toISOString()),
        lte(scheduledEvents.start, windowEnd.toISOString()),
      ),
    )
    .all();

  // Build occupied intervals from existing events
  const occupied: Array<{ start: number; end: number }> = existingEvents.map((ev) => ({
    start: new Date(ev.start!).getTime(),
    end: new Date(ev.end!).getTime(),
  }));

  // Generate available slots for each duration
  const slots: Array<{ start: string; end: string; duration: number }> = [];

  for (const duration of durations) {
    const durationMs = duration * 60 * 1000;
    const slotStepMs = 15 * 60 * 1000; // 15-minute increments

    for (let d = 0; d < 7; d++) {
      const day = new Date(now);
      day.setDate(now.getDate() + d);
      day.setHours(0, 0, 0, 0);

      // Parse scheduling hours for this day
      const windowStartParts = hoursWindow.start.split(':').map(Number);
      const windowEndParts = hoursWindow.end.split(':').map(Number);

      const dayWindowStart = new Date(day);
      dayWindowStart.setHours(windowStartParts[0], windowStartParts[1], 0, 0);

      const dayWindowEnd = new Date(day);
      dayWindowEnd.setHours(windowEndParts[0], windowEndParts[1], 0, 0);

      // For the first day, don't offer slots in the past (add 30 min buffer)
      const effectiveStart = d === 0
        ? new Date(Math.max(dayWindowStart.getTime(), now.getTime() + 30 * 60 * 1000))
        : dayWindowStart;

      // Round effectiveStart up to the next 15-minute boundary
      const startMs = Math.ceil(effectiveStart.getTime() / slotStepMs) * slotStepMs;

      for (let slotStart = startMs; slotStart + durationMs <= dayWindowEnd.getTime(); slotStart += slotStepMs) {
        const slotEnd = slotStart + durationMs;

        // Check if this slot overlaps with any occupied interval
        const overlaps = occupied.some(
          (occ) => slotStart < occ.end && slotEnd > occ.start,
        );

        if (!overlaps) {
          slots.push({
            start: new Date(slotStart).toISOString(),
            end: new Date(slotEnd).toISOString(),
            duration,
          });
        }
      }
    }
  }

  res.json({ slug, slots });
});

// POST /api/links/:slug/book — book a slot
router.post('/:slug/book', (req, res) => {
  const { slug } = req.params;
  const link = db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, slug)).get();

  if (!link) {
    res.status(404).json({ error: 'Scheduling link not found' });
    return;
  }

  if (!link.enabled) {
    res.status(410).json({ error: 'Scheduling link is disabled' });
    return;
  }

  const { start, end, name, email } = req.body as {
    start?: string;
    end?: string;
    name?: string;
    email?: string;
  };

  if (!start || !end) {
    res.status(400).json({ error: 'Missing required fields: start, end' });
    return;
  }

  const startDate = new Date(start);
  const endDate = new Date(end);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    res.status(400).json({ error: 'Invalid date format for start or end' });
    return;
  }

  if (endDate <= startDate) {
    res.status(400).json({ error: 'End must be after start' });
    return;
  }

  // Validate that start is in the future
  if (startDate.getTime() <= Date.now()) {
    res.status(400).json({ error: 'Start time must be in the future' });
    return;
  }

  // Validate that the booking duration matches one of the link's configured durations
  const bookingDurationMin = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
  const configuredDurations: number[] = link.durations ? JSON.parse(link.durations) : [];
  if (!configuredDurations.includes(bookingDurationMin)) {
    res.status(400).json({ error: `Duration ${bookingDurationMin} minutes is not one of the allowed durations: ${configuredDurations.join(', ')}` });
    return;
  }

  // Validate name (max 200 chars)
  if (name !== undefined && name.length > 200) {
    res.status(400).json({ error: 'Name must be 200 characters or fewer' });
    return;
  }

  // Validate email format if provided
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (email !== undefined && email !== '' && !emailRegex.test(email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }

  // Verify the slot is still available (not taken since slots were listed)
  const conflicting = db.select().from(scheduledEvents)
    .where(
      and(
        gte(scheduledEvents.end, start),
        lte(scheduledEvents.start, end),
      ),
    )
    .all()
    .filter((ev) => {
      // Check for actual overlap (not just touching boundaries)
      const evStart = new Date(ev.start!).getTime();
      const evEnd = new Date(ev.end!).getTime();
      return startDate.getTime() < evEnd && endDate.getTime() > evStart;
    });

  if (conflicting.length > 0) {
    res.status(409).json({ error: 'Slot is no longer available' });
    return;
  }

  // Create a scheduled_event in the DB for this booking
  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const durationMin = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
  const bookingTitle = name ? `Booking: ${name}` : `Booking via ${slug}`;

  db.insert(scheduledEvents).values({
    id: eventId,
    itemType: 'meeting',
    itemId: link.id,
    googleEventId: null,
    start,
    end,
    status: 'busy',
    alternativeSlotsCount: null,
    createdAt: now,
    updatedAt: now,
  }).run();

  res.status(201).json({
    id: eventId,
    slug,
    title: bookingTitle,
    start,
    end,
    duration: durationMin,
    name: name || null,
    email: email || null,
    createdAt: now,
  });
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

function getHoursWindow(
  schedulingHours: SchedulingHours,
  userSettings: UserSettings,
): { start: string; end: string } {
  switch (schedulingHours) {
    case SchedulingHours.Working:
      return userSettings.workingHours;
    case SchedulingHours.Personal:
      return userSettings.personalHours;
    case SchedulingHours.Custom:
      return userSettings.personalHours;
    default:
      return userSettings.workingHours;
  }
}

export default router;
