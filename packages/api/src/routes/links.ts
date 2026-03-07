import { Router } from 'express';
import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { schedulingLinks, scheduledEvents, users } from '../db/pg-schema.js';
import type { CreateLinkRequest, SchedulingLink, UserSettings } from '@cadence/shared';
import { SchedulingHours } from '@cadence/shared';
import { createLinkSchema, updateLinkSchema, linkBookingSchema } from '../validation.js';
import { sendValidationError, sendNotFound, sendError } from './helpers.js';

const router = Router();

// GET /api/links — list scheduling links for the current user
router.get('/', async (req, res) => {
  const rows = await db.select().from(schedulingLinks).where(eq(schedulingLinks.userId, req.userId));
  const result: SchedulingLink[] = rows.map(toLink);
  res.json(result);
});

// POST /api/links — create a scheduling link
router.post('/', async (req, res) => {
  const parsed = createLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const body = parsed.data as CreateLinkRequest;

  // Check for slug uniqueness
  const existingSlug = await db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, body.slug));
  if (existingSlug.length > 0) {
    sendError(res, 409, 'Slug already exists');
    return;
  }

  const row = {
    userId: req.userId,
    slug: body.slug,
    name: body.name,
    durations: body.durations,
    schedulingHours: body.schedulingHours ?? 'working',
    priority: body.priority ?? 3,
    enabled: true,
  };

  const inserted = await db.insert(schedulingLinks).values(row).returning();
  res.status(201).json(toLink(inserted[0]));
});

// PUT /api/links/:id — update a scheduling link
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const existing = await db.select().from(schedulingLinks).where(and(eq(schedulingLinks.id, id), eq(schedulingLinks.userId, req.userId)));

  if (existing.length === 0) {
    sendNotFound(res, 'Scheduling link');
    return;
  }

  const parsed = updateLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const body = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (body.name !== undefined) updates.name = body.name;
  if (body.slug !== undefined) {
    // Check slug uniqueness if changing
    if (body.slug !== existing[0].slug) {
      const existingSlug = await db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, body.slug));
      if (existingSlug.length > 0) {
        sendError(res, 409, 'Slug already exists');
        return;
      }
    }
    updates.slug = body.slug;
  }
  if (body.durations !== undefined) updates.durations = body.durations;
  if (body.schedulingHours !== undefined) updates.schedulingHours = body.schedulingHours;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  const updated = await db.update(schedulingLinks).set(updates).where(and(eq(schedulingLinks.id, id), eq(schedulingLinks.userId, req.userId))).returning();
  res.json(toLink(updated[0]));
});

// DELETE /api/links/:id — delete a scheduling link
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const existing = await db.select().from(schedulingLinks).where(and(eq(schedulingLinks.id, id), eq(schedulingLinks.userId, req.userId)));

  if (existing.length === 0) {
    sendNotFound(res, 'Scheduling link');
    return;
  }

  await db.delete(schedulingLinks).where(and(eq(schedulingLinks.id, id), eq(schedulingLinks.userId, req.userId)));

  res.status(204).send();
});

// GET /api/links/:slug/slots — return available time slots
router.get('/:slug/slots', async (req, res) => {
  const { slug } = req.params;
  const linkRows = await db.select().from(schedulingLinks).where(and(eq(schedulingLinks.slug, slug), eq(schedulingLinks.userId, req.userId)));

  if (linkRows.length === 0) {
    sendNotFound(res, 'Scheduling link');
    return;
  }

  const link = linkRows[0];

  if (!link.enabled) {
    sendError(res, 410, 'Scheduling link is disabled');
    return;
  }

  const durations: number[] = (link.durations as number[]) ?? [30];
  const schedulingHours = (link.schedulingHours ?? 'working') as SchedulingHours;

  // Load user settings for working/personal hours
  const userRows = await db.select().from(users).where(eq(users.id, req.userId));
  const userSettings: UserSettings = userRows.length > 0 && userRows[0].settings && typeof userRows[0].settings === 'object'
    ? userRows[0].settings as UserSettings
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

  // Load all existing scheduled events within the window for this user
  const existingEvents = await db.select().from(scheduledEvents)
    .where(
      and(
        eq(scheduledEvents.userId, req.userId),
        gte(scheduledEvents.end, now.toISOString()),
        lte(scheduledEvents.start, windowEnd.toISOString()),
      ),
    );

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
router.post('/:slug/book', async (req, res) => {
  const { slug } = req.params;
  const linkRows = await db.select().from(schedulingLinks).where(and(eq(schedulingLinks.slug, slug), eq(schedulingLinks.userId, req.userId)));

  if (linkRows.length === 0) {
    sendNotFound(res, 'Scheduling link');
    return;
  }

  const link = linkRows[0];

  if (!link.enabled) {
    sendError(res, 410, 'Scheduling link is disabled');
    return;
  }

  const parsed = linkBookingSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const { start, end, name, email } = parsed.data;
  const startDate = new Date(start);
  const endDate = new Date(end);

  // Validate that start is in the future
  if (startDate.getTime() <= Date.now()) {
    sendError(res, 400, 'Start time must be in the future');
    return;
  }

  // Validate that the booking duration matches one of the link's configured durations
  const bookingDurationMin = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
  const configuredDurations: number[] = (link.durations as number[]) ?? [];
  if (!configuredDurations.includes(bookingDurationMin)) {
    sendError(res, 400, 'Invalid duration');
    return;
  }

  // Verify the slot is still available (not taken since slots were listed)
  const conflicting = (await db.select().from(scheduledEvents)
    .where(
      and(
        eq(scheduledEvents.userId, req.userId),
        gte(scheduledEvents.end, start),
        lte(scheduledEvents.start, end),
      ),
    ))
    .filter((ev) => {
      // Check for actual overlap (not just touching boundaries)
      const evStart = new Date(ev.start!).getTime();
      const evEnd = new Date(ev.end!).getTime();
      return startDate.getTime() < evEnd && endDate.getTime() > evStart;
    });

  if (conflicting.length > 0) {
    sendError(res, 409, 'Slot is no longer available');
    return;
  }

  // Create a scheduled_event in the DB for this booking
  const now = new Date().toISOString();
  const durationMin = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
  const bookingTitle = name ? `Booking: ${name}` : `Booking via ${slug}`;

  const inserted = await db.insert(scheduledEvents).values({
    userId: req.userId,
    itemType: 'meeting',
    itemId: link.id,
    title: bookingTitle,
    googleEventId: null,
    start,
    end,
    status: 'busy',
    alternativeSlotsCount: null,
  }).returning();

  res.status(201).json({
    id: inserted[0].id,
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
    durations: (row.durations ?? []) as number[],
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
