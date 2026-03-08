import pg from 'pg';
import * as schema from './pg-schema.js';

const { Pool } = pg;

/**
 * Run PostgreSQL schema creation with versioned migrations.
 * Uses CREATE TABLE IF NOT EXISTS for idempotent execution.
 * Tracks applied migrations via schema_migrations table.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query('SELECT 1'); // verify connection
    console.log('[migrate] Connected to PostgreSQL');

    // INFRA-H3: Create schema_migrations table for version tracking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        description TEXT
      );
    `);

    // Get already-applied versions
    const appliedResult = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
    const appliedVersions = new Set(appliedResult.rows.map((r: { version: number }) => r.version));

    // Define versioned migrations
    const migrations: Array<{ version: number; description: string; sql: string }> = [
      {
        version: 1,
        description: 'Initial schema creation',
        sql: `
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      -- Users
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        password_hash TEXT,
        name TEXT,
        avatar_url TEXT,
        google_id TEXT UNIQUE,
        google_refresh_token TEXT,
        google_sync_token TEXT,
        settings JSONB,
        plan TEXT NOT NULL DEFAULT 'free',
        onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
        gdpr_consent_at TIMESTAMPTZ,
        consent_version TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Sessions
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_token_hash TEXT NOT NULL,
        user_agent TEXT,
        ip_address TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

      -- Email Verifications
      CREATE TABLE IF NOT EXISTS email_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_email_verifications_user_id ON email_verifications(user_id);

      -- Password Resets
      CREATE TABLE IF NOT EXISTS password_resets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);

      -- Calendars
      CREATE TABLE IF NOT EXISTS calendars (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        google_calendar_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#4285f4',
        mode TEXT DEFAULT 'writable',
        enabled BOOLEAN DEFAULT TRUE,
        sync_token TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_calendars_user_id ON calendars(user_id);

      -- Habits
      CREATE TABLE IF NOT EXISTS habits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        priority INTEGER DEFAULT 3,
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        ideal_time TEXT NOT NULL,
        duration_min INTEGER NOT NULL,
        duration_max INTEGER NOT NULL,
        frequency TEXT NOT NULL,
        frequency_config JSONB,
        scheduling_hours TEXT DEFAULT 'working',
        locked BOOLEAN DEFAULT FALSE,
        auto_decline BOOLEAN DEFAULT FALSE,
        depends_on TEXT,
        enabled BOOLEAN DEFAULT TRUE,
        skip_buffer BOOLEAN DEFAULT FALSE,
        notifications BOOLEAN DEFAULT FALSE,
        calendar_id TEXT,
        color TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_habits_user_id ON habits(user_id);

      -- Tasks
      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        priority INTEGER DEFAULT 2,
        total_duration INTEGER NOT NULL,
        remaining_duration INTEGER NOT NULL,
        due_date TEXT,
        earliest_start TEXT,
        chunk_min INTEGER DEFAULT 15,
        chunk_max INTEGER DEFAULT 120,
        scheduling_hours TEXT,
        status TEXT DEFAULT 'open',
        is_up_next BOOLEAN DEFAULT FALSE,
        skip_buffer BOOLEAN DEFAULT FALSE,
        calendar_id TEXT,
        color TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);

      -- Smart Meetings
      CREATE TABLE IF NOT EXISTS smart_meetings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        priority INTEGER DEFAULT 2,
        attendees JSONB,
        duration INTEGER NOT NULL,
        frequency TEXT NOT NULL,
        ideal_time TEXT,
        window_start TEXT,
        window_end TEXT,
        location TEXT,
        conference_type TEXT,
        skip_buffer BOOLEAN DEFAULT FALSE,
        calendar_id TEXT,
        color TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_smart_meetings_user_id ON smart_meetings(user_id);

      -- Focus Time Rules
      CREATE TABLE IF NOT EXISTS focus_time_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        weekly_target_minutes INTEGER,
        daily_target_minutes INTEGER,
        scheduling_hours TEXT,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_focus_time_rules_user_id ON focus_time_rules(user_id);

      -- Buffer Config
      CREATE TABLE IF NOT EXISTS buffer_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        travel_time_minutes INTEGER DEFAULT 15,
        decompression_minutes INTEGER DEFAULT 10,
        break_between_items_minutes INTEGER DEFAULT 5,
        apply_decompression_to TEXT DEFAULT 'all'
      );
      CREATE INDEX IF NOT EXISTS idx_buffer_config_user_id ON buffer_config(user_id);

      -- Scheduled Events
      CREATE TABLE IF NOT EXISTS scheduled_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_type TEXT,
        item_id TEXT,
        title TEXT,
        google_event_id TEXT,
        calendar_id TEXT,
        start TEXT,
        "end" TEXT,
        status TEXT DEFAULT 'free',
        is_all_day BOOLEAN DEFAULT FALSE,
        alternative_slots_count INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_events_user_id ON scheduled_events(user_id);

      -- Calendar Events (cached from external calendars)
      CREATE TABLE IF NOT EXISTS calendar_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        calendar_id TEXT NOT NULL,
        google_event_id TEXT NOT NULL,
        title TEXT NOT NULL,
        start TEXT NOT NULL,
        "end" TEXT NOT NULL,
        status TEXT DEFAULT 'busy',
        location TEXT,
        is_all_day BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id ON calendar_events(user_id);

      -- Habit Completions
      CREATE TABLE IF NOT EXISTS habit_completions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        habit_id TEXT NOT NULL,
        scheduled_date TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_habit_completions_user_id ON habit_completions(user_id);

      -- Subtasks
      CREATE TABLE IF NOT EXISTS subtasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        name TEXT NOT NULL,
        completed BOOLEAN DEFAULT FALSE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_subtasks_user_id ON subtasks(user_id);

      -- Activity Log
      CREATE TABLE IF NOT EXISTS activity_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        details JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);

      -- Schedule Changes
      CREATE TABLE IF NOT EXISTS schedule_changes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        operation_type TEXT NOT NULL,
        item_type TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_name TEXT NOT NULL,
        previous_start TEXT,
        previous_end TEXT,
        new_start TEXT,
        new_end TEXT,
        reason TEXT,
        batch_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_schedule_changes_user_id ON schedule_changes(user_id);

      -- Scheduling Links
      CREATE TABLE IF NOT EXISTS scheduling_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        durations JSONB,
        scheduling_hours TEXT,
        priority INTEGER DEFAULT 3,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_scheduling_links_user_id ON scheduling_links(user_id);
    `,
      },
      {
        version: 2,
        description: 'Add skip_buffer columns',
        sql: `
      ALTER TABLE habits ADD COLUMN IF NOT EXISTS skip_buffer BOOLEAN DEFAULT FALSE;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS skip_buffer BOOLEAN DEFAULT FALSE;
      ALTER TABLE smart_meetings ADD COLUMN IF NOT EXISTS skip_buffer BOOLEAN DEFAULT FALSE;
    `,
      },
      {
        version: 3,
        description: 'Add composite indexes on (userId, end) for scheduled_events and calendar_events',
        sql: `
      CREATE INDEX IF NOT EXISTS idx_scheduled_events_user_id_end ON scheduled_events(user_id, "end");
      CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id_end ON calendar_events(user_id, "end");
    `,
      },
      {
        version: 4,
        description: 'Add oauth_states table, unique constraints, and missing indexes',
        sql: `
      -- OAuth States
      CREATE TABLE IF NOT EXISTS oauth_states (
        state_hash TEXT PRIMARY KEY,
        expires_at TIMESTAMPTZ NOT NULL
      );

      -- Unique constraints for singleton-per-user tables
      CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_time_rules_user_id_unique ON focus_time_rules(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_buffer_config_user_id_unique ON buffer_config(user_id);

      -- Unique constraint to prevent duplicate external calendar events
      CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_user_google_event ON calendar_events(user_id, google_event_id);

      -- Performance indexes
      CREATE INDEX IF NOT EXISTS idx_schedule_changes_batch_id ON schedule_changes(batch_id);
      CREATE INDEX IF NOT EXISTS idx_habit_completions_habit_user ON habit_completions(habit_id, user_id);
    `,
      },
      {
        version: 5,
        description: 'Add index on oauth_states.expires_at and unique constraint on habit_completions',
        sql: `
      CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_completions_unique ON habit_completions(habit_id, scheduled_date, user_id);
    `,
      },
    ];

    // INFRA-H1: Run each pending migration in a transaction
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }

      console.log(`[migrate] Applying migration v${migration.version}: ${migration.description}`);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, description) VALUES ($1, $2)',
          [migration.version, migration.description],
        );
        await client.query('COMMIT');
        console.log(`[migrate] Migration v${migration.version} applied successfully`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    console.log('[migrate] All migrations up to date');
  } finally {
    await pool.end();
  }
}
