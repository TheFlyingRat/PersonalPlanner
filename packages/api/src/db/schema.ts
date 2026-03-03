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
  googleEventId: text('googleEventId'),
  start: text('start'),
  end: text('end'),
  status: text('status').default('free'),
  alternativeSlotsCount: integer('alternativeSlotsCount'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
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
