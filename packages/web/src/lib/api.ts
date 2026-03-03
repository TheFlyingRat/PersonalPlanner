// API Client - Typed fetch wrapper for all endpoints

import type {
  Habit,
  CreateHabitRequest,
  Task,
  CreateTaskRequest,
  SmartMeeting,
  CreateMeetingRequest,
  FocusTimeRule,
  BufferConfig,
  CalendarEvent,
  SchedulingLink,
  CreateLinkRequest,
  AnalyticsData,
  UserConfig,
  UserSettings,
  ScheduleResult,
} from '../../../shared/src/types';

const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const habits = {
  list: () => request<Habit[]>('/habits'),
  get: (id: string) => request<Habit>(`/habits/${id}`),
  create: (data: CreateHabitRequest) =>
    request<Habit>('/habits', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<CreateHabitRequest>) =>
    request<Habit>(`/habits/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/habits/${id}`, { method: 'DELETE' }),
  lock: (id: string, locked: boolean) =>
    request<Habit>(`/habits/${id}/lock`, {
      method: 'PUT',
      body: JSON.stringify({ locked }),
    }),
};

export const tasks = {
  list: () => request<Task[]>('/tasks'),
  get: (id: string) => request<Task>(`/tasks/${id}`),
  create: (data: CreateTaskRequest) =>
    request<Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<CreateTaskRequest>) =>
    request<Task>(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  complete: (id: string) =>
    request<Task>(`/tasks/${id}/complete`, { method: 'PUT' }),
  setUpNext: (id: string, isUpNext: boolean) =>
    request<Task>(`/tasks/${id}/up-next`, {
      method: 'PUT',
      body: JSON.stringify({ isUpNext }),
    }),
};

export const meetings = {
  list: () => request<SmartMeeting[]>('/meetings'),
  get: (id: string) => request<SmartMeeting>(`/meetings/${id}`),
  create: (data: CreateMeetingRequest) =>
    request<SmartMeeting>('/meetings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<CreateMeetingRequest>) =>
    request<SmartMeeting>(`/meetings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/meetings/${id}`, { method: 'DELETE' }),
};

export const focusTime = {
  get: () => request<FocusTimeRule>('/focus'),
  update: (data: Partial<FocusTimeRule>) =>
    request<FocusTimeRule>('/focus', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

export const buffers = {
  get: () => request<BufferConfig>('/buffers'),
  update: (data: Partial<BufferConfig>) =>
    request<BufferConfig>('/buffers', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

export const schedule = {
  getEvents: (start: string, end: string) =>
    request<CalendarEvent[]>(`/schedule/events?start=${start}&end=${end}`),
  run: () => request<ScheduleResult>('/schedule/run', { method: 'POST' }),
};

export const links = {
  list: () => request<SchedulingLink[]>('/links'),
  get: (id: string) => request<SchedulingLink>(`/links/${id}`),
  create: (data: CreateLinkRequest) =>
    request<SchedulingLink>('/links', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<CreateLinkRequest>) =>
    request<SchedulingLink>(`/links/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/links/${id}`, { method: 'DELETE' }),
  getBySlug: (slug: string) =>
    request<SchedulingLink>(`/links/slug/${slug}`),
};

export const analytics = {
  get: (start?: string, end?: string) => {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const query = params.toString();
    return request<AnalyticsData>(`/analytics${query ? `?${query}` : ''}`);
  },
};

export const settings = {
  get: () => request<UserConfig>('/settings'),
  update: (data: Partial<UserSettings>) =>
    request<UserConfig>('/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  connectGoogle: () =>
    request<{ url: string }>('/settings/google/connect'),
  disconnectGoogle: () =>
    request<void>('/settings/google/disconnect', { method: 'POST' }),
};
