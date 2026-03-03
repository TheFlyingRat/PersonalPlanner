import { db } from './index.js';
import { users, bufferConfig, focusTimeRules } from './schema.js';

export function seed() {
  const now = new Date().toISOString();

  // Insert default user
  db.insert(users)
    .values({
      id: 'default-user',
      googleRefreshToken: null,
      googleSyncToken: null,
      settings: JSON.stringify({
        workingHours: { start: '09:00', end: '17:00' },
        personalHours: { start: '07:00', end: '22:00' },
        timezone: 'America/New_York',
        schedulingWindowDays: 14,
      }),
      createdAt: now,
    })
    .onConflictDoNothing()
    .run();

  // Insert default buffer config
  db.insert(bufferConfig)
    .values({
      id: 'default',
      travelTimeMinutes: 15,
      decompressionMinutes: 10,
      breakBetweenItemsMinutes: 5,
      applyDecompressionTo: 'all',
    })
    .onConflictDoNothing()
    .run();

  // Insert default focus time rules (disabled)
  db.insert(focusTimeRules)
    .values({
      id: 'default',
      weeklyTargetMinutes: 600,
      dailyTargetMinutes: 120,
      schedulingHours: 'working',
      enabled: false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
}
