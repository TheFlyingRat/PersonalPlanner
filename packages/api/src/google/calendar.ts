import { google, calendar_v3, Auth } from 'googleapis';
import { EXTENDED_PROPS, STATUS_PREFIX } from '@reclaim/shared';
import {
  CalendarOpType,
  EventStatus,
  ItemType,
} from '@reclaim/shared';
import type { CalendarEvent, CalendarOperation } from '@reclaim/shared';

/** Status prefix map keyed by EventStatus enum values */
const STATUS_EMOJI: Record<EventStatus, string> = {
  [EventStatus.Free]: STATUS_PREFIX.free,
  [EventStatus.Busy]: STATUS_PREFIX.busy,
  [EventStatus.Locked]: STATUS_PREFIX.locked,
};

/** Reverse-lookup: strip a known status prefix from a title and return the clean name + status */
function parseStatusPrefix(title: string): { cleanTitle: string; status: EventStatus } {
  for (const [statusKey, emoji] of Object.entries(STATUS_EMOJI)) {
    if (title.startsWith(emoji)) {
      return {
        cleanTitle: title.slice(emoji.length).trimStart(),
        status: statusKey as EventStatus,
      };
    }
  }
  // No known prefix found; default to Busy
  return { cleanTitle: title, status: EventStatus.Busy };
}

export class GoogleCalendarClient {
  private calendar: calendar_v3.Calendar;

  constructor(auth: Auth.OAuth2Client) {
    this.calendar = google.calendar({ version: 'v3', auth });
  }

  // ---------- Sync ----------------------------------------------------------

  /**
   * Fetch events using Google's incremental sync mechanism.
   *
   * When `syncToken` is provided an incremental sync is attempted.
   * If the token is expired (HTTP 410 Gone) we transparently fall back to a
   * full sync over the next 90 days.
   */
  async syncEvents(
    calendarId: string = 'primary',
    syncToken?: string | null,
  ): Promise<{
    events: CalendarEvent[];
    nextSyncToken: string;
    fullSync: boolean;
  }> {
    let fullSync = !syncToken;
    let allEvents: CalendarEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken = '';

    try {
      do {
        const params: calendar_v3.Params$Resource$Events$List = {
          calendarId,
          maxResults: 2500,
          singleEvents: true,
          ...(pageToken ? { pageToken } : {}),
        };

        if (syncToken && !fullSync) {
          params.syncToken = syncToken;
        } else {
          // Full sync: look 90 days ahead from now
          params.timeMin = new Date().toISOString();
          const timeMax = new Date();
          timeMax.setDate(timeMax.getDate() + 90);
          params.timeMax = timeMax.toISOString();
          params.orderBy = 'startTime';
        }

        const response = await this.calendar.events.list(params);
        const items = response.data.items ?? [];

        for (const item of items) {
          // Cancelled events come through in incremental sync
          if (item.status === 'cancelled') {
            // Represent as a minimal CalendarEvent so the consumer can detect deletions
            allEvents.push({
              id: item.id ?? '',
              googleEventId: item.id ?? '',
              title: '',
              start: '',
              end: '',
              isManaged: false,
              itemType: null,
              itemId: null,
              status: EventStatus.Free,
            });
            continue;
          }

          allEvents.push(this.parseGoogleEvent(item));
        }

        pageToken = response.data.nextPageToken ?? undefined;
        if (response.data.nextSyncToken) {
          nextSyncToken = response.data.nextSyncToken;
        }
      } while (pageToken);
    } catch (err: unknown) {
      // 410 Gone means the syncToken expired; do a full sync instead
      if (isGoogleApiError(err) && err.code === 410) {
        return this.syncEvents(calendarId, null);
      }
      throw err;
    }

    return { events: allEvents, nextSyncToken, fullSync };
  }

  // ---------- CRUD ----------------------------------------------------------

  /**
   * Create a calendar event from a CalendarOperation and return the new
   * Google event ID.
   */
  async createEvent(
    calendarId: string = 'primary',
    op: CalendarOperation,
  ): Promise<string> {
    const body = this.buildEventBody(op);
    const response = await this.calendar.events.insert({
      calendarId,
      requestBody: body,
    });
    return response.data.id ?? '';
  }

  /** Update an existing calendar event. */
  async updateEvent(
    calendarId: string = 'primary',
    eventId: string,
    op: CalendarOperation,
  ): Promise<void> {
    const body = this.buildEventBody(op);
    await this.calendar.events.patch({
      calendarId,
      eventId,
      requestBody: body,
    });
  }

  /** Delete a calendar event by its Google event ID. */
  async deleteEvent(
    calendarId: string = 'primary',
    eventId: string,
  ): Promise<void> {
    try {
      await this.calendar.events.delete({ calendarId, eventId });
    } catch (err: unknown) {
      // 404 / 410 means the event is already gone; treat as success
      if (isGoogleApiError(err) && (err.code === 404 || err.code === 410)) {
        return;
      }
      throw err;
    }
  }

  // ---------- Batch operations ----------------------------------------------

  /**
   * Apply an ordered list of CalendarOperations.
   * Individual failures are logged but do not abort the batch.
   */
  async applyOperations(
    calendarId: string = 'primary',
    operations: CalendarOperation[],
  ): Promise<void> {
    for (const op of operations) {
      try {
        switch (op.type) {
          case CalendarOpType.Create:
            await this.createEvent(calendarId, op);
            break;
          case CalendarOpType.Update:
            if (!op.eventId) {
              console.warn('[calendar] Update op missing eventId, skipping:', op.itemId);
              continue;
            }
            await this.updateEvent(calendarId, op.eventId, op);
            break;
          case CalendarOpType.Delete:
            if (!op.eventId) {
              console.warn('[calendar] Delete op missing eventId, skipping:', op.itemId);
              continue;
            }
            await this.deleteEvent(calendarId, op.eventId);
            break;
        }
      } catch (err) {
        console.error(`[calendar] Failed to apply ${op.type} for item ${op.itemId}:`, err);
      }
    }
  }

  // ---------- Internal helpers ----------------------------------------------

  /** Convert a raw Google Calendar event into our CalendarEvent shape. */
  private parseGoogleEvent(event: calendar_v3.Schema$Event): CalendarEvent {
    const privateProps = event.extendedProperties?.private ?? {};

    const reclaimId = privateProps[EXTENDED_PROPS.reclaimId] ?? '';
    const isManaged = Boolean(reclaimId);

    const rawTitle = event.summary ?? '(No title)';
    const { cleanTitle, status: parsedStatus } = parseStatusPrefix(rawTitle);

    // Use the status stored in extendedProperties if available; fall back to
    // the one inferred from the emoji prefix.
    const storedStatus = privateProps[EXTENDED_PROPS.status] as EventStatus | undefined;
    const status = storedStatus && Object.values(EventStatus).includes(storedStatus)
      ? storedStatus
      : parsedStatus;

    const itemTypeRaw = privateProps[EXTENDED_PROPS.itemType] as ItemType | undefined;
    const itemType = itemTypeRaw && Object.values(ItemType).includes(itemTypeRaw)
      ? itemTypeRaw
      : null;

    const itemId = privateProps[EXTENDED_PROPS.itemId] ?? null;

    // Handle all-day events (date) vs timed events (dateTime)
    const start = event.start?.dateTime ?? event.start?.date ?? '';
    const end = event.end?.dateTime ?? event.end?.date ?? '';

    return {
      id: reclaimId || event.id || '',
      googleEventId: event.id ?? '',
      title: cleanTitle,
      start,
      end,
      isManaged,
      itemType,
      itemId,
      status,
      location: event.location ?? undefined,
      description: event.description ?? undefined,
    };
  }

  /** Build a Google Calendar event body from a CalendarOperation. */
  private buildEventBody(op: CalendarOperation): calendar_v3.Schema$Event {
    const prefixedTitle = `${STATUS_EMOJI[op.status]} ${op.title}`;

    // Merge any extra extended properties from the operation with our standard ones
    const privateProperties: Record<string, string> = {
      ...op.extendedProperties,
      [EXTENDED_PROPS.reclaimId]: op.itemId,
      [EXTENDED_PROPS.itemType]: op.itemType,
      [EXTENDED_PROPS.itemId]: op.itemId,
      [EXTENDED_PROPS.status]: op.status,
      [EXTENDED_PROPS.lastModifiedByUs]: new Date().toISOString(),
    };

    return {
      summary: prefixedTitle,
      start: { dateTime: op.start },
      end: { dateTime: op.end },
      transparency: op.status === EventStatus.Free ? 'transparent' : 'opaque',
      extendedProperties: {
        private: privateProperties,
      },
    };
  }
}

// ---------- Utility ---------------------------------------------------------

interface GoogleApiError {
  code: number;
  message?: string;
}

function isGoogleApiError(err: unknown): err is GoogleApiError {
  return typeof err === 'object' && err !== null && 'code' in err;
}
