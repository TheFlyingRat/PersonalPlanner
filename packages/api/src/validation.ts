import { z } from 'zod/v4';

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const createHabitSchema = z.object({
  name: z.string().min(1).max(200),
  priority: z.number().int().min(1).max(4).optional(),
  windowStart: z.string().regex(timeRegex, 'Must be HH:MM format'),
  windowEnd: z.string().regex(timeRegex, 'Must be HH:MM format'),
  idealTime: z.string().regex(timeRegex, 'Must be HH:MM format'),
  durationMin: z.number().int().positive(),
  durationMax: z.number().int().positive(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'custom']),
  frequencyConfig: z.record(z.string(), z.unknown()).optional(),
  schedulingHours: z.enum(['working', 'personal', 'custom']).optional(),
  autoDecline: z.boolean().optional(),
  dependsOn: z.string().nullable().optional(),
});

export const createTaskSchema = z.object({
  name: z.string().min(1).max(200),
  priority: z.number().int().min(1).max(4).optional(),
  totalDuration: z.number().int().positive(),
  dueDate: z.string().datetime({ offset: true }),
  earliestStart: z.string().datetime({ offset: true }).optional(),
  chunkMin: z.number().int().positive().optional(),
  chunkMax: z.number().int().positive().optional(),
  schedulingHours: z.enum(['working', 'personal', 'custom']).optional(),
});

export const createMeetingSchema = z.object({
  name: z.string().min(1).max(200),
  priority: z.number().int().min(1).max(4).optional(),
  attendees: z.array(z.string()).optional(),
  duration: z.number().int().positive(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'custom']),
  idealTime: z.string().regex(timeRegex, 'Must be HH:MM format'),
  windowStart: z.string().regex(timeRegex, 'Must be HH:MM format'),
  windowEnd: z.string().regex(timeRegex, 'Must be HH:MM format'),
  location: z.string().optional(),
  conferenceType: z.string().optional(),
});

export const createFocusSchema = z.object({
  weeklyTargetMinutes: z.number().int().positive(),
  dailyTargetMinutes: z.number().int().positive(),
  schedulingHours: z.enum(['working', 'personal', 'custom']).optional(),
  enabled: z.boolean().optional(),
});

export const createBufferSchema = z.object({
  travelTimeMinutes: z.number().int().min(0),
  decompressionMinutes: z.number().int().min(0),
  breakBetweenItemsMinutes: z.number().int().min(0),
  applyDecompressionTo: z.enum(['all', 'meetings', 'none']).optional(),
});

export const updateHabitSchema = createHabitSchema.extend({
  locked: z.boolean().optional(),
  enabled: z.boolean().optional(),
}).partial();

export const updateTaskSchema = createTaskSchema.extend({
  remainingDuration: z.number().int().positive().optional(),
  status: z.enum(['open', 'completed', 'cancelled']).optional(),
  isUpNext: z.boolean().optional(),
}).partial();

export const updateMeetingSchema = createMeetingSchema.partial();
export const updateFocusSchema = createFocusSchema.partial();
export const updateBufferSchema = createBufferSchema.partial();

export const createLinkSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
  durations: z.array(z.number().int().positive()).min(1),
  schedulingHours: z.enum(['working', 'personal', 'custom']).optional(),
  priority: z.number().int().min(1).max(4).optional(),
});
