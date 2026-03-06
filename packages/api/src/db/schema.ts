import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// ============================================================
// Users
// ============================================================
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  googleRefreshToken: text('googleRefreshToken'),
  googleSyncToken: text('googleSyncToken'),
  settings: text('settings'), // JSON serialized UserSettings
  createdAt: text('createdAt'),
});

// ============================================================
// Calendars
// ============================================================
export const calendars = sqliteTable('calendars', {
  id: text('id').primaryKey(),
  googleCalendarId: text('googleCalendarId').notNull(),
  name: text('name').notNull(),
  color: text('color').default('#4285f4'),
  mode: text('mode').default('writable'),  // 'writable' | 'locked'
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  syncToken: text('syncToken'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
});

// ============================================================
// Habits
// ============================================================
export const habits = sqliteTable('habits', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  priority: integer('priority').default(3),
  windowStart: text('windowStart').notNull(), // HH:MM
  windowEnd: text('windowEnd').notNull(),     // HH:MM
  idealTime: text('idealTime').notNull(),     // HH:MM
  durationMin: integer('durationMin').notNull(),
  durationMax: integer('durationMax').notNull(),
  frequency: text('frequency').notNull(),
  frequencyConfig: text('frequencyConfig'),   // JSON
  schedulingHours: text('schedulingHours').default('working'),
  locked: integer('locked', { mode: 'boolean' }).default(false),
  autoDecline: integer('autoDecline', { mode: 'boolean' }).default(false),
  dependsOn: text('dependsOn'), // FK to habits.id (self-reference)
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  skipBuffer: integer('skipBuffer', { mode: 'boolean' }).default(false),
  calendarId: text('calendarId'),
  color: text('color'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
});

// ============================================================
// Tasks
// ============================================================
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  priority: integer('priority').default(2),
  totalDuration: integer('totalDuration').notNull(),
  remainingDuration: integer('remainingDuration').notNull(),
  dueDate: text('dueDate'),
  earliestStart: text('earliestStart'),
  chunkMin: integer('chunkMin').default(15),
  chunkMax: integer('chunkMax').default(120),
  schedulingHours: text('schedulingHours'),
  status: text('status').default('open'),
  isUpNext: integer('isUpNext', { mode: 'boolean' }).default(false),
  skipBuffer: integer('skipBuffer', { mode: 'boolean' }).default(false),
  calendarId: text('calendarId'),
  color: text('color'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
});

// ============================================================
// Smart Meetings
// ============================================================
export const smartMeetings = sqliteTable('smart_meetings', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  priority: integer('priority').default(2),
  attendees: text('attendees'),   // JSON array
  duration: integer('duration').notNull(),
  frequency: text('frequency').notNull(),
  idealTime: text('idealTime'),   // HH:MM
  windowStart: text('windowStart'),
  windowEnd: text('windowEnd'),
  location: text('location'),
  conferenceType: text('conferenceType'),
  skipBuffer: integer('skipBuffer', { mode: 'boolean' }).default(false),
  calendarId: text('calendarId'),
  color: text('color'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
});

// ============================================================
// Focus Time Rules
// ============================================================
export const focusTimeRules = sqliteTable('focus_time_rules', {
  id: text('id').primaryKey(),
  weeklyTargetMinutes: integer('weeklyTargetMinutes'),
  dailyTargetMinutes: integer('dailyTargetMinutes'),
  schedulingHours: text('schedulingHours'),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
});

// ============================================================
// Buffer Config
// ============================================================
export const bufferConfig = sqliteTable('buffer_config', {
  id: text('id').primaryKey(),
  travelTimeMinutes: integer('travelTimeMinutes').default(15),
  decompressionMinutes: integer('decompressionMinutes').default(10),
  breakBetweenItemsMinutes: integer('breakBetweenItemsMinutes').default(5),
  applyDecompressionTo: text('applyDecompressionTo').default('all'),
});

// ============================================================
// Scheduled Events
// ============================================================
export const scheduledEvents = sqliteTable('scheduled_events', {
  id: text('id').primaryKey(),
  itemType: text('itemType'),
  itemId: text('itemId'),
  title: text('title'),
  googleEventId: text('googleEventId'),
  calendarId: text('calendarId'),  // FK to calendars.id
  start: text('start'),
  end: text('end'),
  status: text('status').default('free'),
  isAllDay: integer('isAllDay', { mode: 'boolean' }).default(false),
  alternativeSlotsCount: integer('alternativeSlotsCount'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
});

// ============================================================
// Calendar Events (cached from external calendars)
// ============================================================
export const calendarEvents = sqliteTable('calendar_events', {
  id: text('id').primaryKey(),
  calendarId: text('calendarId').notNull(),       // FK to calendars.id
  googleEventId: text('googleEventId').notNull(),
  title: text('title').notNull(),
  start: text('start').notNull(),
  end: text('end').notNull(),
  status: text('status').default('busy'),
  location: text('location'),
  isAllDay: integer('isAllDay', { mode: 'boolean' }).default(false),
  updatedAt: text('updatedAt'),
});

// ============================================================
// Habit Completions
// ============================================================
export const habitCompletions = sqliteTable('habit_completions', {
  id: text('id').primaryKey(),
  habitId: text('habitId').notNull(),
  scheduledDate: text('scheduledDate').notNull(), // YYYY-MM-DD
  completedAt: text('completedAt').notNull(),
});

// ============================================================
// Subtasks
// ============================================================
export const subtasks = sqliteTable('subtasks', {
  id: text('id').primaryKey(),
  taskId: text('taskId').notNull(),
  name: text('name').notNull(),
  completed: integer('completed', { mode: 'boolean' }).default(false),
  sortOrder: integer('sortOrder').default(0),
  createdAt: text('createdAt'),
});

// ============================================================
// Activity Log
// ============================================================
export const activityLog = sqliteTable('activity_log', {
  id: text('id').primaryKey(),
  action: text('action').notNull(), // 'create' | 'update' | 'delete' | 'schedule'
  entityType: text('entityType').notNull(), // 'habit' | 'task' | 'meeting' | 'link' | 'schedule'
  entityId: text('entityId').notNull(),
  details: text('details'), // JSON
  createdAt: text('createdAt'),
});

// ============================================================
// Scheduling Links
// ============================================================
export const schedulingLinks = sqliteTable('scheduling_links', {
  id: text('id').primaryKey(),
  slug: text('slug').unique().notNull(),
  name: text('name').notNull(),
  durations: text('durations'),   // JSON array
  schedulingHours: text('schedulingHours'),
  priority: integer('priority').default(3),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
});
