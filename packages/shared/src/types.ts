// ============================================================
// Priority System
// ============================================================

export enum Priority {
  Critical = 1,
  High = 2,
  Medium = 3,
  Low = 4,
}

// Within same priority: Meeting > Habit > Task > Focus
export enum ItemType {
  Meeting = 'meeting',
  Habit = 'habit',
  Task = 'task',
  Focus = 'focus',
}

export enum EventStatus {
  Free = 'free',
  Busy = 'busy',
  Locked = 'locked',
}

export enum TaskStatus {
  Open = 'open',
  DoneScheduling = 'done_scheduling',
  Completed = 'completed',
}

export enum Frequency {
  Daily = 'daily',
  Weekly = 'weekly',
  Monthly = 'monthly',
  Custom = 'custom',
}

export enum SchedulingHours {
  Working = 'working',
  Personal = 'personal',
  Custom = 'custom',
}

export enum DecompressionTarget {
  All = 'all',
  VideoOnly = 'video_only',
}

export enum CalendarMode {
  Writable = 'writable',
  Locked = 'locked',
}

// ============================================================
// Core Data Models
// ============================================================

export interface Habit {
  id: string;
  name: string;
  priority: Priority;
  windowStart: string; // HH:MM
  windowEnd: string;   // HH:MM
  idealTime: string;   // HH:MM
  durationMin: number; // minutes
  durationMax: number; // minutes
  frequency: Frequency;
  frequencyConfig: FrequencyConfig;
  schedulingHours: SchedulingHours;
  locked: boolean;
  autoDecline: boolean;
  dependsOn: string | null; // habit ID
  enabled: boolean;
  calendarId?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FrequencyConfig {
  days?: string[];           // ["mon", "tue", ...]
  weekInterval?: number;     // every N weeks
  monthDay?: number;         // day of month
  monthWeek?: number;        // nth week of month (1-5)
  monthWeekday?: string;     // day of that week
}

export interface Task {
  id: string;
  name: string;
  priority: Priority;
  totalDuration: number;     // minutes
  remainingDuration: number; // minutes
  dueDate: string;           // ISO datetime
  earliestStart: string;     // ISO datetime
  chunkMin: number;          // minutes
  chunkMax: number;          // minutes
  schedulingHours: SchedulingHours;
  status: TaskStatus;
  isUpNext: boolean;
  calendarId?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SmartMeeting {
  id: string;
  name: string;
  priority: Priority;
  attendees: string[];       // email addresses
  duration: number;          // minutes
  frequency: Frequency;
  frequencyConfig?: FrequencyConfig;
  idealTime: string;         // HH:MM
  windowStart: string;       // HH:MM
  windowEnd: string;         // HH:MM
  location: string;
  conferenceType: string;    // zoom | meet | teams | none
  calendarId?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FocusTimeRule {
  id: string;
  weeklyTargetMinutes: number;
  dailyTargetMinutes: number;
  schedulingHours: SchedulingHours;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BufferConfig {
  id: string;
  travelTimeMinutes: number;
  decompressionMinutes: number;
  breakBetweenItemsMinutes: number;
  applyDecompressionTo: DecompressionTarget;
}

export interface SchedulingLink {
  id: string;
  slug: string;
  name: string;
  durations: number[];      // [15, 30, 60]
  schedulingHours: SchedulingHours;
  priority: Priority;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Calendar {
  id: string;
  googleCalendarId: string;
  name: string;
  color: string;
  mode: CalendarMode;
  enabled: boolean;
  syncToken: string | null;
}

// ============================================================
// Habit Completions, Subtasks, Activity Log
// ============================================================

export interface HabitCompletion {
  id: string;
  habitId: string;
  scheduledDate: string;
  completedAt: string;
}

export interface Subtask {
  id: string;
  taskId: string;
  name: string;
  completed: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface ActivityLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string | null;
  createdAt: string;
}

// ============================================================
// Calendar Events
// ============================================================

export interface CalendarEvent {
  id: string;
  googleEventId: string;
  title: string;
  start: string;            // ISO datetime
  end: string;              // ISO datetime
  isManaged: boolean;       // created/managed by us
  itemType: ItemType | null;
  itemId: string | null;    // FK to habit/task/meeting/focus
  status: EventStatus;
  location?: string;
  description?: string;
  calendarId?: string;         // which calendar this event belongs to
}

// ============================================================
// Scheduling Engine Types
// ============================================================

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface ScheduleItem {
  id: string;
  name?: string;            // human-readable name for calendar titles
  type: ItemType;
  priority: Priority;
  timeWindow: TimeSlot;     // allowed scheduling window
  idealTime: string;        // HH:MM preferred time
  duration: number;         // minutes (preferred / max duration)
  durationMin?: number;     // minimum acceptable duration (for flexible items)
  locked: boolean;
  dependsOn: string | null;
}

export interface CandidateSlot extends TimeSlot {
  score: number;            // higher = better
}

export enum CalendarOpType {
  Create = 'create',
  Update = 'update',
  Delete = 'delete',
}

export interface CalendarOperation {
  type: CalendarOpType;
  eventId?: string;         // internal DB id for local operations
  googleEventId?: string;   // Google Calendar event id for API operations
  itemType: ItemType;
  itemId: string;
  title: string;
  start: string;            // ISO datetime
  end: string;              // ISO datetime
  status: EventStatus;
  extendedProperties: Record<string, string>;
  calendarId?: string;         // target calendar for this operation
}

export interface ScheduleResult {
  operations: CalendarOperation[];
  unschedulable: Array<{ itemId: string; itemType: ItemType; reason: string }>;
}

// ============================================================
// User Config
// ============================================================

export interface UserSettings {
  workingHours: { start: string; end: string }; // HH:MM
  personalHours: { start: string; end: string };
  timezone: string;
  schedulingWindowDays: number; // how far ahead to schedule
  defaultHabitCalendarId?: string;
  defaultTaskCalendarId?: string;
}

export interface UserConfig {
  id: string;
  settings: UserSettings;
  googleSyncToken: string | null;
  createdAt: string;
}

// ============================================================
// API Request/Response Types
// ============================================================

export interface CreateHabitRequest {
  name: string;
  priority?: Priority;
  windowStart: string;
  windowEnd: string;
  idealTime: string;
  durationMin: number;
  durationMax: number;
  frequency: Frequency;
  frequencyConfig?: FrequencyConfig;
  schedulingHours?: SchedulingHours;
  autoDecline?: boolean;
  dependsOn?: string | null;
  calendarId?: string;
  color?: string;
}

export interface CreateTaskRequest {
  name: string;
  priority?: Priority;
  totalDuration: number;
  dueDate: string;
  earliestStart?: string;
  chunkMin?: number;
  chunkMax?: number;
  schedulingHours?: SchedulingHours;
  calendarId?: string;
  color?: string;
}

export interface CreateMeetingRequest {
  name: string;
  priority?: Priority;
  attendees?: string[];
  duration: number;
  frequency: Frequency;
  idealTime: string;
  windowStart: string;
  windowEnd: string;
  location?: string;
  conferenceType?: string;
  calendarId?: string;
  color?: string;
}

export interface CreateLinkRequest {
  name: string;
  slug: string;
  durations: number[];
  schedulingHours?: SchedulingHours;
  priority?: Priority;
}

export interface AnalyticsData {
  habitMinutes: number;
  taskMinutes: number;
  meetingMinutes: number;
  focusMinutes: number;
  habitCompletionRate: number;
  weeklyBreakdown: Array<{
    date: string;
    habitMinutes: number;
    taskMinutes: number;
    meetingMinutes: number;
    focusMinutes: number;
  }>;
}
