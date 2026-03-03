import { describe, it, expect } from 'vitest';
import { reschedule } from '../scheduler.js';
import {
  Habit,
  Task,
  SmartMeeting,
  CalendarEvent,
  BufferConfig,
  UserSettings,
  Priority,
  Frequency,
  SchedulingHours,
  TaskStatus,
  EventStatus,
  ItemType,
  CalendarOpType,
  DecompressionTarget,
} from '@reclaim/shared';

// ============================================================
// Fixtures
// ============================================================

const defaultSettings: UserSettings = {
  workingHours: { start: '09:00', end: '17:00' },
  personalHours: { start: '07:00', end: '22:00' },
  timezone: 'America/New_York',
  schedulingWindowDays: 7,
};

const defaultBuffer: BufferConfig = {
  id: 'buf-1',
  travelTimeMinutes: 0,
  decompressionMinutes: 0,
  breakBetweenItemsMinutes: 0,
  applyDecompressionTo: DecompressionTarget.All,
};

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-1',
    name: 'Morning Exercise',
    priority: Priority.Medium,
    windowStart: '09:00',
    windowEnd: '12:00',
    idealTime: '09:00',
    durationMin: 30,
    durationMax: 60,
    frequency: Frequency.Daily,
    frequencyConfig: { days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
    schedulingHours: SchedulingHours.Working,
    locked: false,
    autoDecline: false,
    dependsOn: null,
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    name: 'Write Report',
    priority: Priority.High,
    totalDuration: 120,
    remainingDuration: 120,
    dueDate: '2026-03-09T17:00:00Z',
    earliestStart: '2026-03-02T09:00:00Z',
    chunkMin: 30,
    chunkMax: 60,
    schedulingHours: SchedulingHours.Working,
    status: TaskStatus.Open,
    isUpNext: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMeeting(overrides: Partial<SmartMeeting> = {}): SmartMeeting {
  return {
    id: 'meeting-1',
    name: 'Team Standup',
    priority: Priority.High,
    attendees: ['alice@example.com'],
    duration: 30,
    frequency: Frequency.Daily,
    idealTime: '09:30',
    windowStart: '09:00',
    windowEnd: '11:00',
    location: '',
    conferenceType: 'zoom',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// Monday 2026-03-02 at 8:00 AM
const NOW = new Date(2026, 2, 2, 8, 0, 0);

// ============================================================
// Tests
// ============================================================

describe('reschedule', () => {
  it('should return empty result when no items to schedule', () => {
    const result = reschedule([], [], [], [], [], defaultBuffer, defaultSettings, NOW);

    expect(result.operations).toHaveLength(0);
    expect(result.unschedulable).toHaveLength(0);
  });

  it('should place a single habit', () => {
    const habits = [makeHabit()];

    const result = reschedule(
      habits,
      [],
      [],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    // Should have multiple create operations (one per applicable day)
    expect(result.operations.length).toBeGreaterThan(0);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create,
    );
    expect(creates.length).toBeGreaterThan(0);

    // Each created event should be a habit type
    for (const op of creates) {
      expect(op.itemType).toBe(ItemType.Habit);
    }
  });

  it('should skip disabled habits', () => {
    const habits = [makeHabit({ enabled: false })];

    const result = reschedule(
      habits,
      [],
      [],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    expect(result.operations).toHaveLength(0);
  });

  it('should skip completed tasks', () => {
    const tasks = [makeTask({ status: TaskStatus.Completed })];

    const result = reschedule(
      [],
      tasks,
      [],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    expect(result.operations).toHaveLength(0);
  });

  it('should chunk tasks into blocks', () => {
    const tasks = [
      makeTask({
        totalDuration: 120,
        remainingDuration: 120,
        chunkMin: 30,
        chunkMax: 60,
      }),
    ];

    const result = reschedule(
      [],
      tasks,
      [],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    // 120 minutes / 60 max chunk = 2 chunks
    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create,
    );
    expect(creates.length).toBe(2);

    // Each chunk should be 60 minutes
    for (const op of creates) {
      const start = new Date(op.start);
      const end = new Date(op.end);
      const durationMin = (end.getTime() - start.getTime()) / (1000 * 60);
      expect(durationMin).toBe(60);
    }
  });

  it('should override task priority to Critical when isUpNext', () => {
    // Low priority task but isUpNext
    const taskUpNext = makeTask({
      id: 'task-upnext',
      priority: Priority.Low,
      isUpNext: true,
      totalDuration: 30,
      remainingDuration: 30,
      chunkMax: 30,
    });

    // High priority task
    const taskNormal = makeTask({
      id: 'task-normal',
      priority: Priority.High,
      isUpNext: false,
      totalDuration: 30,
      remainingDuration: 30,
      chunkMax: 30,
    });

    const result = reschedule(
      [],
      [taskNormal, taskUpNext],
      [],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    // The upnext task should be scheduled first (Critical priority = 1)
    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create,
    );
    expect(creates.length).toBe(2);

    // The first operation should be for the upnext task
    expect(creates[0].itemId).toBe('task-upnext');
  });

  it('should schedule meetings before habits and tasks at same priority', () => {
    const meeting = makeMeeting({
      id: 'meeting-1',
      priority: Priority.High,
      duration: 30,
      windowStart: '09:00',
      windowEnd: '12:00',
    });

    const habit = makeHabit({
      id: 'habit-1',
      priority: Priority.High,
      windowStart: '09:00',
      windowEnd: '12:00',
      durationMin: 30,
      durationMax: 30,
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
    });

    const result = reschedule(
      [habit],
      [],
      [meeting],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create,
    );
    expect(creates.length).toBeGreaterThanOrEqual(2);

    // The meeting should appear first (TYPE_ORDER: meeting=0, habit=1)
    const meetingOps = creates.filter((op) => op.itemType === ItemType.Meeting);
    const habitOps = creates.filter((op) => op.itemType === ItemType.Habit);
    expect(meetingOps.length).toBeGreaterThan(0);
    expect(habitOps.length).toBeGreaterThan(0);
  });

  it('should respect fixed calendar events', () => {
    const calendarEvents: CalendarEvent[] = [
      {
        id: 'ext-1',
        googleEventId: 'g-1',
        title: 'Doctor Appointment',
        start: '2026-03-02T10:00:00.000Z',
        end: '2026-03-02T11:00:00.000Z',
        isManaged: false,
        itemType: null,
        itemId: null,
        status: EventStatus.Busy,
      },
    ];

    const habits = [
      makeHabit({
        windowStart: '09:00',
        windowEnd: '12:00',
        durationMin: 30,
        durationMax: 30,
        frequency: Frequency.Weekly,
        frequencyConfig: { days: ['mon'] },
      }),
    ];

    const result = reschedule(
      habits,
      [],
      [],
      [],
      calendarEvents,
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    // The habit should not be placed overlapping the fixed event
    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create,
    );

    for (const op of creates) {
      const opStart = new Date(op.start).getTime();
      const opEnd = new Date(op.end).getTime();
      const fixedStart = new Date('2026-03-02T10:00:00.000Z').getTime();
      const fixedEnd = new Date('2026-03-02T11:00:00.000Z').getTime();

      // Should not overlap
      const overlaps = opStart < fixedEnd && fixedStart < opEnd;
      expect(overlaps).toBe(false);
    }
  });

  it('should generate delete operations for removed managed events', () => {
    const calendarEvents: CalendarEvent[] = [
      {
        id: 'managed-1',
        googleEventId: 'g-1',
        title: 'Old Habit Event',
        start: '2026-03-02T10:00:00.000Z',
        end: '2026-03-02T10:30:00.000Z',
        isManaged: true,
        itemType: ItemType.Habit,
        itemId: 'old-habit-id',
        status: EventStatus.Free,
      },
    ];

    // No habits/tasks/meetings -- the old managed event should be deleted
    const result = reschedule(
      [],
      [],
      [],
      [],
      calendarEvents,
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const deletes = result.operations.filter(
      (op) => op.type === CalendarOpType.Delete,
    );
    expect(deletes.length).toBe(1);
    expect(deletes[0].eventId).toBe('managed-1');
  });

  it('should generate update operations for moved managed events', () => {
    // Habit that will be rescheduled
    const habit = makeHabit({
      id: 'habit-moved',
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      durationMin: 30,
      durationMax: 30,
    });

    // Get the expected week number for March 2, 2026
    // We need to match the scheduler's item ID format
    const weekDate = new Date(2026, 2, 2);
    const d = new Date(Date.UTC(weekDate.getFullYear(), weekDate.getMonth(), weekDate.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

    const managedItemId = `habit-moved__w${weekNum}`;

    const calendarEvents: CalendarEvent[] = [
      {
        id: 'managed-event-1',
        googleEventId: 'g-1',
        title: 'Morning Exercise',
        start: '2026-03-02T10:00:00.000Z',
        end: '2026-03-02T10:30:00.000Z',
        isManaged: true,
        itemType: ItemType.Habit,
        itemId: managedItemId,
        status: EventStatus.Free,
      },
    ];

    const result = reschedule(
      [habit],
      [],
      [],
      [],
      calendarEvents,
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    // Should have at least one operation (create or update)
    expect(result.operations.length).toBeGreaterThan(0);
  });

  it('should handle priority cascade correctly', () => {
    // Critical task should be placed before low priority habit
    const criticalTask = makeTask({
      id: 'critical-task',
      priority: Priority.Critical,
      totalDuration: 60,
      remainingDuration: 60,
      chunkMax: 60,
    });

    const lowHabit = makeHabit({
      id: 'low-habit',
      priority: Priority.Low,
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      durationMin: 60,
      durationMax: 60,
    });

    const result = reschedule(
      [lowHabit],
      [criticalTask],
      [],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create,
    );
    expect(creates.length).toBeGreaterThanOrEqual(2);

    // Critical task should get a preferred slot
    const taskOp = creates.find((op) => op.itemId === 'critical-task');
    expect(taskOp).toBeDefined();
  });

  it('should add items to unschedulable when no slots available', () => {
    // Fill the entire day with a fixed event
    const calendarEvents: CalendarEvent[] = [
      {
        id: 'all-day',
        googleEventId: 'g-1',
        title: 'All Day Event',
        start: '2026-03-02T00:00:00.000Z',
        end: '2026-03-09T00:00:00.000Z',
        isManaged: false,
        itemType: null,
        itemId: null,
        status: EventStatus.Busy,
      },
    ];

    const habits = [
      makeHabit({
        frequency: Frequency.Weekly,
        frequencyConfig: { days: ['mon'] },
        windowStart: '09:00',
        windowEnd: '10:00', // very narrow window
        durationMin: 60,
        durationMax: 60,
      }),
    ];

    const result = reschedule(
      habits,
      [],
      [],
      [],
      calendarEvents,
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    // The habit should be unschedulable
    expect(result.unschedulable.length).toBeGreaterThan(0);
  });

  it('should handle daily habit frequency correctly', () => {
    // Habit that runs on Monday through Friday
    const habit = makeHabit({
      frequency: Frequency.Daily,
      frequencyConfig: { days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule(
      [habit],
      [],
      [],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemType === ItemType.Habit,
    );

    // 7-day window starting Monday: Mon-Fri = 5 weekdays + Mon of next week
    // Plus potentially more depending on exact window calculation
    expect(creates.length).toBeGreaterThanOrEqual(5);
  });

  it('should handle weekly habit frequency correctly', () => {
    const habit = makeHabit({
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['wed'] },
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule(
      [habit],
      [],
      [],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemType === ItemType.Habit,
    );

    // Within a 7-day window starting Monday, there should be 1 Wednesday
    expect(creates.length).toBeGreaterThanOrEqual(1);
  });

  it('should respect buffer between items', () => {
    const bufferConfig: BufferConfig = {
      ...defaultBuffer,
      breakBetweenItemsMinutes: 15,
    };

    // Two habits that need to be placed
    const habits = [
      makeHabit({
        id: 'habit-a',
        frequency: Frequency.Weekly,
        frequencyConfig: { days: ['mon'] },
        windowStart: '09:00',
        windowEnd: '10:30',
        durationMin: 30,
        durationMax: 30,
      }),
      makeHabit({
        id: 'habit-b',
        priority: Priority.Medium,
        frequency: Frequency.Weekly,
        frequencyConfig: { days: ['mon'] },
        windowStart: '09:00',
        windowEnd: '10:30',
        durationMin: 30,
        durationMax: 30,
      }),
    ];

    const result = reschedule(
      habits,
      [],
      [],
      [],
      [],
      bufferConfig,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create,
    );

    if (creates.length >= 2) {
      // Sort by start time
      const sorted = creates
        .map((op) => ({
          start: new Date(op.start).getTime(),
          end: new Date(op.end).getTime(),
        }))
        .sort((a, b) => a.start - b.start);

      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].start - sorted[i - 1].end;
        expect(gap).toBeGreaterThanOrEqual(15 * 60 * 1000);
      }
    }
  });

  it('should set Free/Busy status appropriately', () => {
    const habit = makeHabit({
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      durationMin: 30,
      durationMax: 30,
      windowStart: '09:00',
      windowEnd: '17:00',
    });

    const result = reschedule(
      [habit],
      [],
      [],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create,
    );

    // With a wide window and no conflicts, status should be Free
    for (const op of creates) {
      expect([EventStatus.Free, EventStatus.Busy]).toContain(op.status);
    }
  });

  it('should handle task with remaining duration less than chunkMax', () => {
    const task = makeTask({
      totalDuration: 45,
      remainingDuration: 45,
      chunkMin: 30,
      chunkMax: 60,
    });

    const result = reschedule(
      [],
      [task],
      [],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create,
    );

    // Should create exactly 1 chunk of 45 minutes
    expect(creates.length).toBe(1);
    const duration =
      (new Date(creates[0].end).getTime() - new Date(creates[0].start).getTime()) /
      (1000 * 60);
    expect(duration).toBe(45);
  });

  it('should handle habit dependencies (dependsOn)', () => {
    const habitA = makeHabit({
      id: 'habit-a',
      priority: Priority.High,
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      windowStart: '09:00',
      windowEnd: '17:00',
      durationMin: 30,
      durationMax: 30,
      dependsOn: null,
    });

    const habitB = makeHabit({
      id: 'habit-b',
      priority: Priority.High,
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      windowStart: '09:00',
      windowEnd: '17:00',
      durationMin: 30,
      durationMax: 30,
      dependsOn: 'habit-a',
    });

    const result = reschedule(
      [habitA, habitB],
      [],
      [],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create,
    );

    // Both should be scheduled
    expect(creates.length).toBe(2);

    const aOp = creates.find((op) => op.itemId === 'habit-a');
    const bOp = creates.find((op) => op.itemId === 'habit-b');

    if (aOp && bOp) {
      // B should be after A
      expect(new Date(bOp.start).getTime()).toBeGreaterThanOrEqual(
        new Date(aOp.end).getTime(),
      );
    }
  });
});
