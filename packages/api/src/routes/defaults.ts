import type { UserSettings } from '@cadence/shared';
import { SchedulingHours } from '@cadence/shared';

export const DEFAULT_USER_SETTINGS: UserSettings = {
  workingHours: { start: '09:00', end: '17:00' },
  personalHours: { start: '07:00', end: '22:00' },
  timezone: 'America/New_York',
  schedulingWindowDays: 14,
};

export function getHoursWindow(
  schedulingHours: SchedulingHours,
  userSettings: UserSettings,
): { start: string; end: string } {
  switch (schedulingHours) {
    case SchedulingHours.Working:
      return userSettings.workingHours;
    case SchedulingHours.Personal:
      return userSettings.personalHours;
    case SchedulingHours.Custom:
      return userSettings.personalHours;
    default:
      return userSettings.workingHours;
  }
}
