import { Router } from 'express';
import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { schedulingLinks, scheduledEvents, calendarEvents, calendars, users } from '../db/pg-schema.js';
import type { UserSettings, BookingSlot, BookingConfirmation, BookingLinkInfo } from '@cadence/shared';
import { SchedulingHours } from '@cadence/shared';
import { bookingAvailabilitySchema, bookingRequestSchema } from '../validation.js';
import { sendValidationError, sendNotFound, sendError } from './helpers.js';

const router = Router();

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

async function getUserSettingsForLink(linkUserId: string): Promise<UserSettings> {
  const userRows = await db.select().from(users).where(eq(users.id, linkUserId));
  if (userRows.length > 0 && userRows[0].settings && typeof userRows[0].settings === 'object') {
    return userRows[0].settings as UserSettings;
  }
  return {
    workingHours: { start: '09:00', end: '17:00' },
    personalHours: { start: '07:00', end: '22:00' },
    timezone: 'America/New_York',
    schedulingWindowDays: 14,
  };
}

async function getOccupiedIntervals(linkUserId: string, dayStart: string, dayEnd: string): Promise<Array<{ start: number; end: number }>> {
  // Scheduled (managed) events for the link owner
  const managed = await db.select().from(scheduledEvents)
    .where(
      and(
        eq(scheduledEvents.userId, linkUserId),
        gte(scheduledEvents.end, dayStart),
        lte(scheduledEvents.start, dayEnd),
      ),
    );

  // External calendar events for the link owner
  const enabledCals = await db.select().from(calendars)
    .where(and(eq(calendars.userId, linkUserId), eq(calendars.enabled, true)));
  const calIds = new Set(enabledCals.map(c => c.id));

  const external = (await db.select().from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.userId, linkUserId),
        gte(calendarEvents.end, dayStart),
        lte(calendarEvents.start, dayEnd),
      ),
    ))
    .filter(ev => calIds.has(ev.calendarId) && !ev.isAllDay);

  const occupied: Array<{ start: number; end: number }> = [];

  for (const ev of managed) {
    if (!ev.start || !ev.end) continue;
    occupied.push({ start: new Date(ev.start).getTime(), end: new Date(ev.end).getTime() });
  }
  for (const ev of external) {
    if (!ev.start || !ev.end) continue;
    occupied.push({ start: new Date(ev.start).getTime(), end: new Date(ev.end).getTime() });
  }

  return occupied;
}

// GET /api/book/:slug — public link info (no auth required)
router.get('/:slug', async (req, res) => {
  const { slug } = req.params;
  const linkRows = await db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, slug));

  if (linkRows.length === 0) {
    sendNotFound(res, 'Booking link');
    return;
  }
  const link = linkRows[0];
  if (!link.enabled) {
    sendError(res, 410, 'This booking link is no longer available');
    return;
  }

  const info: BookingLinkInfo = {
    slug: link.slug,
    name: link.name,
    durations: (link.durations ?? [30]) as number[],
    enabled: true,
  };
  res.json(info);
});

// GET /api/book/:slug/availability?date=YYYY-MM-DD&duration=30
router.get('/:slug/availability', async (req, res) => {
  const { slug } = req.params;
  const linkRows = await db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, slug));

  if (linkRows.length === 0) {
    sendNotFound(res, 'Booking link');
    return;
  }
  const link = linkRows[0];
  if (!link.enabled) {
    sendError(res, 410, 'This booking link is no longer available');
    return;
  }

  const parsed = bookingAvailabilitySchema.safeParse(req.query);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const { date, duration } = parsed.data;
  const configuredDurations: number[] = (link.durations ?? [30]) as number[];
  if (!configuredDurations.includes(duration)) {
    sendError(res, 400, 'Invalid duration for this link');
    return;
  }

  const userSettings = await getUserSettingsForLink(link.userId);
  const schedulingHours = (link.schedulingHours ?? 'working') as SchedulingHours;
  const hoursWindow = getHoursWindow(schedulingHours, userSettings);

  // Build day boundaries using the requested date
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  const occupied = await getOccupiedIntervals(link.userId, dayStart, dayEnd);

  // Parse scheduling hours for this day
  const windowStartParts = hoursWindow.start.split(':').map(Number);
  const windowEndParts = hoursWindow.end.split(':').map(Number);

  const day = new Date(`${date}T00:00:00`);
  const dayWindowStart = new Date(day);
  dayWindowStart.setHours(windowStartParts[0], windowStartParts[1], 0, 0);
  const dayWindowEnd = new Date(day);
  dayWindowEnd.setHours(windowEndParts[0], windowEndParts[1], 0, 0);

  const now = Date.now();
  const durationMs = duration * 60 * 1000;
  const slotStepMs = 15 * 60 * 1000;

  // Don't offer slots in the past (30 min buffer)
  const effectiveStart = new Date(Math.max(dayWindowStart.getTime(), now + 30 * 60 * 1000));
  const startMs = Math.ceil(effectiveStart.getTime() / slotStepMs) * slotStepMs;

  const slots: BookingSlot[] = [];

  for (let slotStart = startMs; slotStart + durationMs <= dayWindowEnd.getTime(); slotStart += slotStepMs) {
    const slotEnd = slotStart + durationMs;
    const overlaps = occupied.some(occ => slotStart < occ.end && slotEnd > occ.start);
    if (!overlaps) {
      slots.push({
        start: new Date(slotStart).toISOString(),
        end: new Date(slotEnd).toISOString(),
      });
    }
  }

  res.json({ slug, date, duration, slots });
});

// POST /api/book/:slug — book a slot (public, no auth required)
router.post('/:slug', async (req, res) => {
  const { slug } = req.params;
  const linkRows = await db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, slug));

  if (linkRows.length === 0) {
    sendNotFound(res, 'Booking link');
    return;
  }
  const link = linkRows[0];
  if (!link.enabled) {
    sendError(res, 410, 'This booking link is no longer available');
    return;
  }

  const parsed = bookingRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const { start, end, name, email, notes } = parsed.data;
  const startDate = new Date(start);
  const endDate = new Date(end);

  // Must be in the future
  if (startDate.getTime() <= Date.now()) {
    sendError(res, 400, 'Start time must be in the future');
    return;
  }

  // Duration must match configured durations
  const bookingDurationMin = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
  const configuredDurations: number[] = (link.durations ?? []) as number[];
  if (!configuredDurations.includes(bookingDurationMin)) {
    sendError(res, 400, 'Invalid duration');
    return;
  }

  // Race condition check: verify slot is still available
  const dayStart = new Date(startDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(startDate);
  dayEnd.setHours(23, 59, 59, 999);

  const occupied = await getOccupiedIntervals(link.userId, dayStart.toISOString(), dayEnd.toISOString());
  const hasConflict = occupied.some(
    occ => startDate.getTime() < occ.end && endDate.getTime() > occ.start,
  );

  if (hasConflict) {
    sendError(res, 409, 'This time slot is no longer available. Please choose another.');
    return;
  }

  // Create the booking as a scheduled event owned by the link owner
  const now = new Date().toISOString();
  const bookingTitle = `Booking: ${name}`;

  const inserted = await db.insert(scheduledEvents).values({
    userId: link.userId,
    itemType: 'meeting',
    itemId: link.id,
    title: bookingTitle,
    googleEventId: null,
    start,
    end,
    status: 'busy',
    alternativeSlotsCount: null,
  }).returning();

  const confirmation: BookingConfirmation = {
    id: inserted[0].id,
    slug,
    title: bookingTitle,
    start,
    end,
    duration: bookingDurationMin,
    name,
    email,
    createdAt: now,
  };

  res.status(201).json(confirmation);
});

export default router;
