import { Router } from 'express';
import { eq, and, gte, lte } from 'drizzle-orm';
import rateLimit from 'express-rate-limit';
import { db } from '../db/pg-index.js';
import { schedulingLinks, scheduledEvents, calendarEvents, calendars, users } from '../db/pg-schema.js';
import type { UserSettings, BookingSlot, BookingConfirmation, BookingLinkInfo } from '@cadence/shared';
import { SchedulingHours } from '@cadence/shared';
import { bookingAvailabilitySchema, bookingRequestSchema } from '../validation.js';
import { sendValidationError, sendNotFound, sendError } from './helpers.js';
import { DEFAULT_USER_SETTINGS, getHoursWindow } from './defaults.js';

const router = Router();

const bookingAvailabilityLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many availability requests, please try again later.' },
});

async function getUserSettingsForLink(linkUserId: string): Promise<UserSettings> {
  const userRows = await db.select().from(users).where(eq(users.id, linkUserId));
  if (userRows.length > 0 && userRows[0].settings && typeof userRows[0].settings === 'object') {
    return userRows[0].settings as UserSettings;
  }
  return DEFAULT_USER_SETTINGS;
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

/**
 * Convert a time string (HH:MM) to a Date in the given timezone for a specific date.
 */
function timeToDateInTimezone(dateStr: string, timeStr: string, timezone: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  // Create a date string in the target timezone and parse it
  const dateInTz = new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);
  // Use Intl to get the UTC offset for this timezone at this date
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  // Get the timezone offset by comparing local interpretation
  const parts = formatter.formatToParts(new Date(`${dateStr}T12:00:00Z`));
  const tzYear = Number(parts.find(p => p.type === 'year')?.value);
  const tzMonth = Number(parts.find(p => p.type === 'month')?.value);
  const tzDay = Number(parts.find(p => p.type === 'day')?.value);
  const tzHour = Number(parts.find(p => p.type === 'hour')?.value);
  const tzMinute = Number(parts.find(p => p.type === 'minute')?.value);

  // Reference: what UTC time corresponds to noon in the target timezone
  const utcNoon = new Date(`${dateStr}T12:00:00Z`);
  const localNoonMs = new Date(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, 0).getTime();
  const offsetMs = utcNoon.getTime() - localNoonMs + (12 * 60 * 60 * 1000 - (tzHour * 60 + tzMinute) * 60 * 1000);

  // Target time in the user's timezone, converted to UTC
  const targetLocalMs = new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`).getTime();
  // Simpler approach: compute the offset from a known reference point
  const refUtc = new Date(`${dateStr}T00:00:00Z`);
  const refLocal = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(refUtc));

  // Fallback to simpler approach: use Date with timezone offset
  const isoStr = `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  // Create a temporary date to find the offset
  const temp = new Date(isoStr + 'Z');
  const localStr = temp.toLocaleString('en-US', { timeZone: timezone });
  const localDate = new Date(localStr);
  const utcMs = temp.getTime();
  const diff = utcMs - localDate.getTime();
  // The actual UTC time for the desired local time
  return new Date(new Date(isoStr).getTime() + diff);
}

/**
 * Get day boundaries in the user's timezone as UTC ISO strings.
 */
function getDayBoundariesInTimezone(dateStr: string, timezone: string): { dayStart: string; dayEnd: string } {
  // Create midnight in the user's timezone
  const midnightLocal = `${dateStr}T00:00:00`;
  const endLocal = `${dateStr}T23:59:59.999`;

  // Use a reliable method: construct dates and adjust for timezone
  const tempMidnight = new Date(midnightLocal + 'Z');
  const tempEnd = new Date(endLocal + 'Z');

  // Find the offset: what UTC time is midnight in this timezone?
  const midnightStr = tempMidnight.toLocaleString('en-US', { timeZone: timezone });
  const midnightInTz = new Date(midnightStr);
  const offsetMs = tempMidnight.getTime() - midnightInTz.getTime();

  const dayStartUtc = new Date(tempMidnight.getTime() + offsetMs);
  const dayEndUtc = new Date(tempEnd.getTime() + offsetMs);

  return {
    dayStart: dayStartUtc.toISOString(),
    dayEnd: dayEndUtc.toISOString(),
  };
}

// GET /api/book/:slug — public link info (no auth required)
router.get('/:slug', async (req, res) => {
  const { slug } = req.params;
  const linkRows = await db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, slug));

  if (linkRows.length === 0) {
    // SEC-L4: Return 404 for non-existent slugs
    sendNotFound(res, 'Booking link');
    return;
  }
  const link = linkRows[0];
  if (!link.enabled) {
    // SEC-L4: Return 404 for disabled slugs too (prevent enumeration)
    sendNotFound(res, 'Booking link');
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
router.get('/:slug/availability', bookingAvailabilityLimiter, async (req, res) => {
  const { slug } = req.params;
  const linkRows = await db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, slug));

  if (linkRows.length === 0) {
    sendNotFound(res, 'Booking link');
    return;
  }
  const link = linkRows[0];
  if (!link.enabled) {
    // SEC-L4: Return 404 for disabled slugs
    sendNotFound(res, 'Booking link');
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
  const userTimezone = userSettings.timezone || 'America/New_York';
  const schedulingHours = (link.schedulingHours ?? 'working') as SchedulingHours;
  const hoursWindow = getHoursWindow(schedulingHours, userSettings);

  // EDGE-H7: Build day boundaries using the link owner's timezone instead of UTC
  const { dayStart, dayEnd } = getDayBoundariesInTimezone(date, userTimezone);

  const occupied = await getOccupiedIntervals(link.userId, dayStart, dayEnd);

  // Parse scheduling hours for this day in the owner's timezone
  const windowStartParts = hoursWindow.start.split(':').map(Number);
  const windowEndParts = hoursWindow.end.split(':').map(Number);

  // Compute window boundaries in UTC using the owner's timezone
  const dayWindowStartLocal = `${date}T${String(windowStartParts[0]).padStart(2, '0')}:${String(windowStartParts[1] || 0).padStart(2, '0')}:00`;
  const dayWindowEndLocal = `${date}T${String(windowEndParts[0]).padStart(2, '0')}:${String(windowEndParts[1] || 0).padStart(2, '0')}:00`;

  // Convert local times to UTC timestamps
  // Use the Intl API to determine timezone offset
  const sampleUtc = new Date(`${date}T12:00:00Z`);
  const localStr = sampleUtc.toLocaleString('sv-SE', { timeZone: userTimezone });
  const localParsed = new Date(localStr + 'Z');
  const tzOffsetMs = sampleUtc.getTime() - localParsed.getTime();

  const dayWindowStartMs = new Date(dayWindowStartLocal + 'Z').getTime() + tzOffsetMs;
  const dayWindowEndMs = new Date(dayWindowEndLocal + 'Z').getTime() + tzOffsetMs;

  const now = Date.now();
  const durationMs = duration * 60 * 1000;
  const slotStepMs = 15 * 60 * 1000;

  // Don't offer slots in the past (30 min buffer)
  const effectiveStartMs = Math.max(dayWindowStartMs, now + 30 * 60 * 1000);
  const startMs = Math.ceil(effectiveStartMs / slotStepMs) * slotStepMs;

  const slots: BookingSlot[] = [];

  for (let slotStart = startMs; slotStart + durationMs <= dayWindowEndMs; slotStart += slotStepMs) {
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
    // SEC-L4: Return 404 for disabled slugs
    sendNotFound(res, 'Booking link');
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

  // SEC-M2: Validate booking slot falls within configured hours window
  const userSettings = await getUserSettingsForLink(link.userId);
  const schedulingHours = (link.schedulingHours ?? 'working') as SchedulingHours;
  const hoursWindow = getHoursWindow(schedulingHours, userSettings);
  const userTimezone = userSettings.timezone || 'America/New_York';

  const startLocalStr = startDate.toLocaleString('sv-SE', { timeZone: userTimezone });
  const endLocalStr = endDate.toLocaleString('sv-SE', { timeZone: userTimezone });
  const startLocalTime = startLocalStr.split(' ')[1]; // HH:MM:SS
  const endLocalTime = endLocalStr.split(' ')[1];

  if (startLocalTime < hoursWindow.start + ':00' || endLocalTime > hoursWindow.end + ':00') {
    sendError(res, 400, 'Requested slot is outside available booking hours');
    return;
  }

  // EDGE-C1: Wrap availability check + insert in a transaction to prevent double-booking
  const now = new Date().toISOString();
  const bookingTitle = `Booking: ${name}`;
  // SEC-L5: Include notes in description if provided
  const description = notes
    ? `Booked by ${name} (${email})\nNotes: ${notes}`
    : `Booked by ${name} (${email})`;

  try {
    const inserted = await db.transaction(async (tx) => {
      // Re-check availability inside the transaction using link owner's timezone
      const dateStr = startDate.toLocaleDateString('sv-SE', { timeZone: userTimezone });
      const { dayStart: dayStartISO, dayEnd: dayEndISO } = getDayBoundariesInTimezone(dateStr, userTimezone);

      // Check managed events for conflicts
      const managed = await tx.select().from(scheduledEvents)
        .where(
          and(
            eq(scheduledEvents.userId, link.userId),
            gte(scheduledEvents.end, dayStartISO),
            lte(scheduledEvents.start, dayEndISO),
          ),
        );

      const hasManagedConflict = managed.some(ev => {
        if (!ev.start || !ev.end) return false;
        return startDate.getTime() < new Date(ev.end).getTime() &&
               endDate.getTime() > new Date(ev.start).getTime();
      });

      // Also check external calendar events for conflicts
      const external = await tx.select().from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.userId, link.userId),
            gte(calendarEvents.end, dayStartISO),
            lte(calendarEvents.start, dayEndISO),
          ),
        );

      const hasExternalConflict = external.some(ev => {
        if (!ev.start || !ev.end || ev.isAllDay) return false;
        return startDate.getTime() < new Date(ev.end).getTime() &&
               endDate.getTime() > new Date(ev.start).getTime();
      });

      if (hasManagedConflict || hasExternalConflict) {
        throw new Error('SLOT_CONFLICT');
      }

      // Create the booking as a scheduled event owned by the link owner
      return await tx.insert(scheduledEvents).values({
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
    });

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
  } catch (err: any) {
    if (err.message === 'SLOT_CONFLICT') {
      sendError(res, 409, 'This time slot is no longer available. Please choose another.');
      return;
    }
    throw err;
  }
});

export default router;
