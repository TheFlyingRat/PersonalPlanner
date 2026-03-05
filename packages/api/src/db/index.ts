import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const dbPath = process.env.DB_PATH || './data/cadence.db';

// Ensure the data directory exists
const dbDir = dirname(dbPath);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');

// Auto-create tables if they don't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    googleRefreshToken TEXT,
    googleSyncToken TEXT,
    settings TEXT,
    createdAt TEXT
  );
  CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    priority INTEGER DEFAULT 3,
    windowStart TEXT NOT NULL,
    windowEnd TEXT NOT NULL,
    idealTime TEXT NOT NULL,
    durationMin INTEGER NOT NULL,
    durationMax INTEGER NOT NULL,
    frequency TEXT NOT NULL,
    frequencyConfig TEXT,
    schedulingHours TEXT DEFAULT 'working',
    locked INTEGER DEFAULT 0,
    autoDecline INTEGER DEFAULT 0,
    dependsOn TEXT,
    enabled INTEGER DEFAULT 1,
    calendarId TEXT,
    color TEXT,
    createdAt TEXT,
    updatedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    priority INTEGER DEFAULT 2,
    totalDuration INTEGER NOT NULL,
    remainingDuration INTEGER NOT NULL,
    dueDate TEXT,
    earliestStart TEXT,
    chunkMin INTEGER DEFAULT 15,
    chunkMax INTEGER DEFAULT 120,
    schedulingHours TEXT,
    status TEXT DEFAULT 'open',
    isUpNext INTEGER DEFAULT 0,
    calendarId TEXT,
    color TEXT,
    createdAt TEXT,
    updatedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS smart_meetings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    priority INTEGER DEFAULT 2,
    attendees TEXT,
    duration INTEGER NOT NULL,
    frequency TEXT NOT NULL,
    idealTime TEXT,
    windowStart TEXT,
    windowEnd TEXT,
    location TEXT,
    conferenceType TEXT,
    calendarId TEXT,
    color TEXT,
    createdAt TEXT,
    updatedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS focus_time_rules (
    id TEXT PRIMARY KEY,
    weeklyTargetMinutes INTEGER,
    dailyTargetMinutes INTEGER,
    schedulingHours TEXT,
    enabled INTEGER DEFAULT 1,
    createdAt TEXT,
    updatedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS buffer_config (
    id TEXT PRIMARY KEY,
    travelTimeMinutes INTEGER DEFAULT 15,
    decompressionMinutes INTEGER DEFAULT 10,
    breakBetweenItemsMinutes INTEGER DEFAULT 5,
    applyDecompressionTo TEXT DEFAULT 'all'
  );
  CREATE TABLE IF NOT EXISTS calendars (
    id TEXT PRIMARY KEY,
    googleCalendarId TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#4285f4',
    mode TEXT DEFAULT 'writable',
    enabled INTEGER DEFAULT 1,
    syncToken TEXT,
    createdAt TEXT,
    updatedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS scheduled_events (
    id TEXT PRIMARY KEY,
    itemType TEXT,
    itemId TEXT,
    googleEventId TEXT,
    calendarId TEXT,
    start TEXT,
    end TEXT,
    status TEXT DEFAULT 'free',
    isAllDay INTEGER DEFAULT 0,
    alternativeSlotsCount INTEGER,
    createdAt TEXT,
    updatedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    calendarId TEXT NOT NULL,
    googleEventId TEXT NOT NULL,
    title TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    status TEXT DEFAULT 'busy',
    location TEXT,
    isAllDay INTEGER DEFAULT 0,
    updatedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS habit_completions (
    id TEXT PRIMARY KEY,
    habitId TEXT NOT NULL,
    scheduledDate TEXT NOT NULL,
    completedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subtasks (
    id TEXT PRIMARY KEY,
    taskId TEXT NOT NULL,
    name TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    sortOrder INTEGER DEFAULT 0,
    createdAt TEXT
  );
  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    entityType TEXT NOT NULL,
    entityId TEXT NOT NULL,
    details TEXT,
    createdAt TEXT
  );
  CREATE TABLE IF NOT EXISTS scheduling_links (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    durations TEXT,
    schedulingHours TEXT,
    priority INTEGER DEFAULT 3,
    enabled INTEGER DEFAULT 1,
    createdAt TEXT,
    updatedAt TEXT
  );
`);

// Migrations for existing databases
const migrations = [
  `ALTER TABLE scheduled_events ADD COLUMN calendarId TEXT`,
  `ALTER TABLE scheduled_events ADD COLUMN isAllDay INTEGER DEFAULT 0`,
  `ALTER TABLE habits ADD COLUMN calendarId TEXT`,
  `ALTER TABLE habits ADD COLUMN color TEXT`,
  `ALTER TABLE tasks ADD COLUMN calendarId TEXT`,
  `ALTER TABLE tasks ADD COLUMN color TEXT`,
  `ALTER TABLE smart_meetings ADD COLUMN calendarId TEXT`,
  `ALTER TABLE smart_meetings ADD COLUMN color TEXT`,
];
for (const sql of migrations) {
  try { sqlite.exec(sql); } catch { /* Column already exists */ }
}

export const db = drizzle(sqlite, { schema });
