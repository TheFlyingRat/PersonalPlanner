import { eq } from 'drizzle-orm';
import { db } from './db/pg-index.js';
import {
  users,
  habits,
  tasks,
  smartMeetings,
  focusTimeRules,
  bufferConfig,
  calendars,
  calendarEvents,
  scheduledEvents,
} from './db/pg-schema.js';
import { createOAuth2Client, setCredentials, GoogleCalendarClient, CalendarPollerManager } from './google/index.js';
import type { OAuth2Client } from './google/index.js';
import { decrypt } from './crypto.js';
import { reschedule } from '@cadence/engine';
import type {
  Habit,
  Task,
  SmartMeeting,
  FocusTimeRule,
  BufferConfig as BufferConfigType,
  CalendarEvent,
  UserSettings,
} from '@cadence/shared';
import {
  Priority,
  Frequency,
  SchedulingHours,
  TaskStatus,
  DecompressionTarget,
  EventStatus,
  ItemType,
  CalendarOpType,
  EXTENDED_PROPS,
} from '@cadence/shared';
import { recordScheduleChanges } from './routes/schedule.js';
import { broadcastToUser } from './ws.js';

// ============================================================
// Conversion helpers
// ============================================================

function toHabit(row: any): Habit {
  return {
    ...row,
    priority: row.priority as Priority,
    frequency: row.frequency as Frequency,
    frequencyConfig: row.frequencyConfig || {},
    schedulingHours: (row.schedulingHours || 'working') as SchedulingHours,
    locked: !!row.locked,
    autoDecline: !!row.autoDecline,
    enabled: row.enabled !== false && row.enabled !== 0,
    skipBuffer: !!row.skipBuffer,
    notifications: !!row.notifications,
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
    attendees: row.attendees || [],
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

function toBufConfig(row: any): BufferConfigType {
  return {
    ...row,
    applyDecompressionTo: (row.applyDecompressionTo || 'all') as DecompressionTarget,
  };
}

// ============================================================
// UserScheduler — per-user scheduling lifecycle
// ============================================================

export class UserScheduler {
  readonly userId: string;
  private oauth2Client: OAuth2Client;
  private calClient: GoogleCalendarClient;
  private pollerManager: CalendarPollerManager | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private isRescheduling = false;
  private pendingReschedule: { reason: string } | null = null;
  private started = false;

  constructor(userId: string, oauth2Client: OAuth2Client) {
    this.userId = userId;
    this.oauth2Client = oauth2Client;
    this.calClient = new GoogleCalendarClient(oauth2Client);
  }

  getCalClient(): GoogleCalendarClient {
    return this.calClient;
  }

  getPollerManager(): CalendarPollerManager | null {
    return this.pollerManager;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const manager = new CalendarPollerManager(
      this.calClient,
      async (calendarId, polledEvents) => {
        await this.handlePolledEvents(calendarId, polledEvents, manager);
      },
      this.userId,
    );

    this.pollerManager = manager;

    await manager.startAll();
    console.log(`[scheduler] User ${this.userId}: polling started`);

    // Periodic reschedule every 5 minutes
    this.periodicTimer = setInterval(async () => {
      try {
        const ops = await this.triggerReschedule('Periodic optimization');
        if (ops === 0) {
          console.log(`[scheduler] User ${this.userId}: periodic check — no changes`);
        }
      } catch (err) {
        console.error(`[scheduler] User ${this.userId}: periodic reschedule failed:`, err);
      }
    }, 5 * 60 * 1000);

    // Initial sync
    try {
      await this.triggerReschedule('Startup sync');
    } catch (err) {
      console.error(`[scheduler] User ${this.userId}: startup reschedule failed:`, err);
    }
  }

  async stop(): Promise<void> {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
    if (this.pollerManager) {
      this.pollerManager.stopAll();
      this.pollerManager = null;
    }
    this.started = false;
    console.log(`[scheduler] User ${this.userId}: stopped`);
  }

  async triggerReschedule(reason: string): Promise<number> {
    if (this.isRescheduling) {
      console.log(`[scheduler] User ${this.userId}: queuing reschedule: ${reason}`);
      this.pendingReschedule = { reason };
      return 0;
    }

    this.isRescheduling = true;
    try {
      return await this.doRescheduleAndApply(reason);
    } finally {
      this.isRescheduling = false;
      if (this.pendingReschedule) {
        const next = this.pendingReschedule;
        this.pendingReschedule = null;
        this.triggerReschedule(next.reason).catch((err) => {
          console.error(`[scheduler] User ${this.userId}: queued reschedule failed:`, err);
        });
      }
    }
  }

  private async doRescheduleAndApply(reason: string): Promise<number> {
    const userId = this.userId;
    const calClient = this.calClient;
    const manager = this.pollerManager;

    const allHabits = (await db.select().from(habits).where(eq(habits.userId, userId))).map(toHabit);
    const allTasks = (await db.select().from(tasks).where(eq(tasks.userId, userId))).map(toTask);
    const allMeetings = (await db.select().from(smartMeetings).where(eq(smartMeetings.userId, userId))).map(toMeeting);
    const allFocusRules = (await db.select().from(focusTimeRules).where(eq(focusTimeRules.userId, userId))).map(toFocusRule);
    const bufRows = await db.select().from(bufferConfig).where(eq(bufferConfig.userId, userId));
    const buf: BufferConfigType = bufRows.length > 0
      ? toBufConfig(bufRows[0])
      : {
          id: 'default',
          travelTimeMinutes: 15,
          decompressionMinutes: 10,
          breakBetweenItemsMinutes: 5,
          applyDecompressionTo: DecompressionTarget.All,
        };

    const currentUserRows = await db.select().from(users).where(eq(users.id, userId));
    const settingsRaw = currentUserRows[0]?.settings;
    const userSettings: UserSettings = settingsRaw && typeof settingsRaw === 'object'
      ? settingsRaw as UserSettings
      : {
          workingHours: { start: '09:00', end: '17:00' },
          personalHours: { start: '07:00', end: '22:00' },
          timezone: 'America/New_York',
          schedulingWindowDays: 14,
        };

    // Load existing managed events (future only), scoped to user
    const nowISO = new Date().toISOString();
    const rawRows = await db.select().from(scheduledEvents)
      .where(eq(scheduledEvents.userId, userId));
    const futureRows = rawRows.filter(r => r.end && r.end >= nowISO);

    // Deduplicate by itemId
    const byItemId = new Map<string, any[]>();
    for (const row of futureRows) {
      const key = row.itemId || row.id;
      const group = byItemId.get(key) || [];
      group.push(row);
      byItemId.set(key, group);
    }

    const dedupedRows: any[] = [];
    for (const [, group] of byItemId) {
      if (group.length === 1) {
        dedupedRows.push(group[0]);
        continue;
      }
      group.sort((a: any, b: any) => {
        if (a.googleEventId && !b.googleEventId) return -1;
        if (!a.googleEventId && b.googleEventId) return 1;
        return 0;
      });
      dedupedRows.push(group[0]);
      for (let i = 1; i < group.length; i++) {
        await db.delete(scheduledEvents).where(eq(scheduledEvents.id, group[i].id));
      }
    }

    const existingEvents: CalendarEvent[] = dedupedRows.map((row: any) => ({
      id: row.id,
      googleEventId: row.googleEventId || '',
      title: row.title || '',
      start: row.start,
      end: row.end,
      isManaged: true,
      itemType: row.itemType as ItemType,
      itemId: row.itemId,
      status: (row.status || 'free') as EventStatus,
      calendarId: row.calendarId || 'primary',
    }));

    // Merge cached external events, scoped to user
    const allCachedExternal = await db.select().from(calendarEvents).where(eq(calendarEvents.userId, userId));
    const enabledCals = await db.select().from(calendars)
      .where(eq(calendars.userId, userId));
    const enabledCalsList = enabledCals.filter(c => c.enabled);
    const calModeMap = new Map(enabledCalsList.map(c => [c.id, c.mode]));

    for (const row of allCachedExternal) {
      if (!row.start || !row.end) continue;
      const evEnd = new Date(row.end).getTime();
      if (isNaN(evEnd) || evEnd < Date.now()) continue;
      const mode = calModeMap.get(row.calendarId);
      if (!mode) continue;

      existingEvents.push({
        id: row.id,
        googleEventId: row.googleEventId || '',
        title: row.title || '',
        start: row.start,
        end: row.end,
        isManaged: false,
        itemType: null,
        itemId: null,
        status: mode === 'locked' ? EventStatus.Locked : EventStatus.Busy,
        calendarId: row.calendarId,
      });
    }

    // Determine default calendars
    const defaultHabitCalId = (userSettings as any).defaultHabitCalendarId || 'primary';
    const defaultTaskCalId = (userSettings as any).defaultTaskCalendarId || 'primary';

    const habitCal = await db.select().from(calendars).where(eq(calendars.id, defaultHabitCalId));
    const taskCal = await db.select().from(calendars).where(eq(calendars.id, defaultTaskCalId));

    const habitCalRow = habitCal[0];
    const habitGoogleCalId = (habitCalRow?.enabled && habitCalRow?.mode === 'writable')
      ? habitCalRow.googleCalendarId
      : 'primary';
    const taskCalRow = taskCal[0];
    const taskGoogleCalId = (taskCalRow?.enabled && taskCalRow?.mode === 'writable')
      ? taskCalRow.googleCalendarId
      : 'primary';

    // Run the scheduling engine
    const result = reschedule(allHabits, allTasks, allMeetings, allFocusRules, existingEvents, buf, userSettings);

    // Filter trivial updates
    const MIN_CHANGE_MS = 2 * 60 * 1000;
    result.operations = result.operations.filter((op) => {
      if (op.type !== CalendarOpType.Update || !op.eventId) return true;
      const existing = existingEvents.find((e) => e.id === op.eventId);
      if (!existing) return true;
      const startDiff = Math.abs(new Date(op.start).getTime() - new Date(existing.start).getTime());
      const endDiff = Math.abs(new Date(op.end).getTime() - new Date(existing.end).getTime());
      return startDiff >= MIN_CHANGE_MS || endDiff >= MIN_CHANGE_MS;
    });

    if (result.operations.length === 0) return 0;

    // Record schedule changes
    const existingEventsMap = new Map<string, { start: string; end: string; title: string; itemType: string; itemId: string }>();
    for (const ev of existingEvents) {
      if (ev.isManaged) {
        existingEventsMap.set(ev.id, {
          start: ev.start,
          end: ev.end,
          title: ev.title || '',
          itemType: ev.itemType || '',
          itemId: ev.itemId || '',
        });
      }
    }
    await recordScheduleChanges(result.operations, existingEventsMap, userId);

    // Habit notifications map
    const habitNotificationsMap = new Map<string, boolean>();
    for (const h of allHabits) {
      habitNotificationsMap.set(h.id, h.notifications);
    }

    // Tag operations with calendarId
    for (const op of result.operations) {
      if (!op.calendarId) {
        if (op.itemType === ItemType.Habit || op.itemType === ItemType.Focus) {
          op.calendarId = defaultHabitCalId;
        } else if (op.itemType === ItemType.Task) {
          op.calendarId = defaultTaskCalId;
        } else {
          op.calendarId = 'primary';
        }
      }

      if (op.itemType === ItemType.Habit) {
        const originalItemId = op.itemId.split('__')[0];
        op.useDefaultReminders = habitNotificationsMap.get(originalItemId) ?? false;
      }
    }

    // Group and apply operations by Google Calendar
    const opsByGoogleCal = new Map<string, typeof result.operations>();
    for (const op of result.operations) {
      const cal = await db.select().from(calendars).where(eq(calendars.id, op.calendarId!));
      const googleCalId = cal[0]?.googleCalendarId || 'primary';
      const existingOps = opsByGoogleCal.get(googleCalId) || [];
      existingOps.push(op);
      opsByGoogleCal.set(googleCalId, existingOps);
    }

    for (const [googleCalId, ops] of opsByGoogleCal) {
      await calClient.applyOperations(googleCalId, ops);
    }

    // Persist to DB
    const nowTs = new Date().toISOString();
    for (const op of result.operations) {
      if (op.type === CalendarOpType.Create) {
        await db.insert(scheduledEvents).values({
          userId,
          itemType: op.itemType,
          itemId: op.itemId,
          title: op.title,
          googleEventId: op.googleEventId || null,
          calendarId: op.calendarId || 'primary',
          start: op.start,
          end: op.end,
          status: op.status,
          alternativeSlotsCount: null,
          createdAt: nowTs,
          updatedAt: nowTs,
        });
      } else if (op.type === CalendarOpType.Update && op.eventId) {
        await db.update(scheduledEvents)
          .set({
            title: op.title,
            start: op.start,
            end: op.end,
            status: op.status,
            googleEventId: op.googleEventId || undefined,
            updatedAt: nowTs,
          })
          .where(eq(scheduledEvents.id, op.eventId));
      } else if (op.type === CalendarOpType.Delete && op.eventId) {
        await db.delete(scheduledEvents).where(eq(scheduledEvents.id, op.eventId));
      }
    }

    if (manager) manager.markAllWritten();
    for (const op of result.operations) {
      console.log(`[scheduler] User ${userId}: ${op.type} ${op.itemType}:${op.title} -> ${op.start} - ${op.end}`);
    }
    console.log(`[scheduler] User ${userId}: ${reason}: ${result.operations.length} operations applied`);
    broadcastToUser(userId, 'schedule_updated', reason);
    return result.operations.length;
  }

  private async handlePolledEvents(
    calendarId: string,
    polledEvents: CalendarEvent[],
    manager: CalendarPollerManager,
  ): Promise<void> {
    const userId = this.userId;
    const calClient = this.calClient;
    const now = new Date().toISOString();
    let managedEventsMoved = false;

    for (const ev of polledEvents) {
      if (!ev.googleEventId) continue;

      if (ev.isManaged) {
        if (!ev.start || !ev.end) continue;
        const localRows = await db.select().from(scheduledEvents)
          .where(eq(scheduledEvents.googleEventId, ev.googleEventId));
        const local = localRows[0];
        if (!local || !local.start || !local.end) continue;

        const startDiff = Math.abs(new Date(local.start).getTime() - new Date(ev.start).getTime());
        const endDiff = Math.abs(new Date(local.end).getTime() - new Date(ev.end).getTime());
        if (startDiff < 60000 && endDiff < 60000) continue;

        console.log(`[poller] User ${userId}: managed event moved: ${local.title}`);
        await db.update(scheduledEvents).set({
          start: ev.start,
          end: ev.end,
          status: EventStatus.Locked,
          updatedAt: now,
        }).where(eq(scheduledEvents.id, local.id));

        if (local.googleEventId) {
          const calRows = local.calendarId
            ? await db.select().from(calendars).where(eq(calendars.id, local.calendarId))
            : [];
          const googleCalId = calRows[0]?.googleCalendarId || 'primary';
          const op: import('@cadence/shared').CalendarOperation = {
            type: CalendarOpType.Update,
            eventId: local.id,
            googleEventId: local.googleEventId,
            itemType: (local.itemType || ItemType.Habit) as ItemType,
            itemId: local.itemId || '',
            title: local.title || '',
            start: ev.start,
            end: ev.end,
            status: EventStatus.Locked,
            extendedProperties: {
              [EXTENDED_PROPS.cadenceId]: local.id,
              [EXTENDED_PROPS.itemType]: local.itemType || ItemType.Habit,
              [EXTENDED_PROPS.itemId]: local.itemId?.split('__')[0] || '',
              [EXTENDED_PROPS.status]: EventStatus.Locked,
            },
          };
          await calClient.applyOperations(googleCalId, [op]);
        }

        managedEventsMoved = true;
        continue;
      }

      // Handle cancelled/deleted events
      if (!ev.start || !ev.end || !ev.title) {
        await db.delete(calendarEvents)
          .where(eq(calendarEvents.googleEventId, ev.googleEventId));
        continue;
      }

      const existing = await db.select().from(calendarEvents)
        .where(eq(calendarEvents.googleEventId, ev.googleEventId));

      if (existing.length > 0) {
        await db.update(calendarEvents)
          .set({
            title: ev.title,
            start: ev.start,
            end: ev.end,
            status: ev.status || 'busy',
            location: ev.location || null,
            isAllDay: !ev.start.includes('T'),
            updatedAt: now,
          })
          .where(eq(calendarEvents.googleEventId, ev.googleEventId));
      } else {
        await db.insert(calendarEvents).values({
          userId,
          calendarId,
          googleEventId: ev.googleEventId,
          title: ev.title,
          start: ev.start,
          end: ev.end,
          status: ev.status || 'busy',
          location: ev.location || null,
          isAllDay: !ev.start.includes('T'),
          updatedAt: now,
        });
      }
    }

    if (managedEventsMoved) {
      manager.markAllWritten();
      broadcastToUser(userId, 'schedule_updated', 'Event moved on Google Calendar');
      await this.triggerReschedule('Managed event moved on Google Calendar');
    }

    const externalOnly = polledEvents.filter((ev) => !ev.isManaged);
    if (externalOnly.length > 0) {
      broadcastToUser(userId, 'schedule_updated', 'External calendar events changed');

      const managedEvents = (await db.select().from(scheduledEvents)
        .where(eq(scheduledEvents.userId, userId)))
        .filter((r: any) => r.start && r.end);

      const changedTimed = externalOnly.filter(
        (ev) => ev.start && ev.end && ev.start.includes('T'),
      );

      const hasConflicts = changedTimed.some((ext) => {
        const extStart = new Date(ext.start!).getTime();
        const extEnd = new Date(ext.end!).getTime();
        return managedEvents.some((managed: any) => {
          const mStart = new Date(managed.start).getTime();
          const mEnd = new Date(managed.end).getTime();
          return extStart < mEnd && mStart < extEnd;
        });
      });

      if (hasConflicts) {
        await this.triggerReschedule('Conflict detected');
      } else {
        console.log(`[poller] User ${userId}: cached ${externalOnly.length} external event(s), no conflicts`);
      }
    }
  }
}

// ============================================================
// SchedulerRegistry — manages UserScheduler instances
// ============================================================

export class SchedulerRegistry {
  private schedulers = new Map<string, UserScheduler>();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async getOrCreate(userId: string): Promise<UserScheduler> {
    // Cancel any pending idle timeout
    const idleTimer = this.idleTimers.get(userId);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(userId);
    }

    const existing = this.schedulers.get(userId);
    if (existing) return existing;

    // Fetch user's Google refresh token
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user || !user.googleRefreshToken) {
      throw new Error(`User ${userId} has no Google connection`);
    }

    const oauth2Client = createOAuth2Client();
    const refreshToken = decrypt(user.googleRefreshToken);
    setCredentials(oauth2Client, refreshToken);

    const scheduler = new UserScheduler(userId, oauth2Client);
    this.schedulers.set(userId, scheduler);
    await scheduler.start();
    return scheduler;
  }

  get(userId: string): UserScheduler | undefined {
    return this.schedulers.get(userId);
  }

  async destroy(userId: string): Promise<void> {
    const scheduler = this.schedulers.get(userId);
    if (scheduler) {
      await scheduler.stop();
      this.schedulers.delete(userId);
    }
    const idleTimer = this.idleTimers.get(userId);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(userId);
    }
  }

  /** Schedule destruction after idle timeout (30 min) */
  scheduleIdle(userId: string): void {
    const existing = this.idleTimers.get(userId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.idleTimers.delete(userId);
      console.log(`[scheduler] User ${userId}: idle timeout, destroying scheduler`);
      this.destroy(userId).catch((err) => {
        console.error(`[scheduler] User ${userId}: idle destroy failed:`, err);
      });
    }, 30 * 60 * 1000);

    this.idleTimers.set(userId, timer);
  }

  /** Cancel idle timer (e.g., when a new WS connection comes in) */
  cancelIdle(userId: string): void {
    const timer = this.idleTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(userId);
    }
  }

  /** On server startup: start schedulers for recently active users with Google tokens */
  async startAll(): Promise<void> {
    const usersWithTokens = await db.select().from(users);
    const connected = usersWithTokens.filter(u => !!u.googleRefreshToken);

    console.log(`[scheduler] Starting schedulers for ${connected.length} connected user(s)`);
    for (const user of connected) {
      try {
        await this.getOrCreate(user.id);
      } catch (err) {
        console.error(`[scheduler] Failed to start scheduler for user ${user.id}:`, err);
      }
    }
  }

  /** On graceful shutdown: stop all schedulers */
  async stopAll(): Promise<void> {
    for (const [userId, scheduler] of this.schedulers) {
      await scheduler.stop();
    }
    this.schedulers.clear();
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
  }
}

// Singleton instance
export const schedulerRegistry = new SchedulerRegistry();
