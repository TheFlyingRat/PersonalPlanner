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
  Calendar,
  HabitCompletion,
  Subtask,
} from '@cadence/shared';

const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const habits = {
  list: () => request<Habit[]>('/habits'),
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
      method: 'POST',
      body: JSON.stringify({ locked }),
    }),
  getCompletions: (id: string) =>
    request<HabitCompletion[]>(`/habits/${id}/completions`),
  markComplete: (id: string, scheduledDate: string) =>
    request<HabitCompletion>(`/habits/${id}/completions`, {
      method: 'POST',
      body: JSON.stringify({ scheduledDate }),
    }),
  getStreak: (id: string) =>
    request<{ streak: number }>(`/habits/${id}/streak`),
};

export const tasks = {
  list: () => request<Task[]>('/tasks'),
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
    request<Task>(`/tasks/${id}/complete`, { method: 'POST' }),
  setUpNext: (id: string, isUpNext: boolean) =>
    request<Task>(`/tasks/${id}/up-next`, {
      method: 'POST',
      body: JSON.stringify({ isUpNext }),
    }),
  getSubtasks: (id: string) =>
    request<Subtask[]>(`/tasks/${id}/subtasks`),
  createSubtask: (id: string, name: string) =>
    request<Subtask>(`/tasks/${id}/subtasks`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  updateSubtask: (id: string, subtaskId: string, data: Partial<{ name: string; completed: boolean; sortOrder: number }>) =>
    request<Subtask>(`/tasks/${id}/subtasks/${subtaskId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteSubtask: (id: string, subtaskId: string) =>
    request<void>(`/tasks/${id}/subtasks/${subtaskId}`, { method: 'DELETE' }),
};

export const meetings = {
  list: () => request<SmartMeeting[]>('/meetings'),
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
  get: () => request<FocusTimeRule>('/focus-time'),
  update: (data: Partial<FocusTimeRule>) =>
    request<FocusTimeRule>('/focus-time', {
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
  getEvents: (start?: string, end?: string) => {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const qs = params.toString();
    return request<CalendarEvent[]>(`/schedule${qs ? '?' + qs : ''}`);
  },
  run: () => request<{ message: string; operationsApplied: number; unschedulable: any[] }>('/schedule/reschedule', { method: 'POST' }),
  export: (start?: string, end?: string) => {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const qs = params.toString();
    window.location.href = `${API_BASE}/schedule/export${qs ? '?' + qs : ''}`;
  },
  getAlternatives: (itemId: string) =>
    request<{ alternatives: Array<{ start: string; end: string; score: number }> }>(`/schedule/${itemId}/alternatives`),
  deleteAllManaged: () =>
    request<{ message: string; googleEventsDeleted: number; localEventsDeleted: number }>(
      '/schedule/managed-events',
      { method: 'DELETE' },
    ),
};

export const links = {
  list: () => request<SchedulingLink[]>('/links'),
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
    request<{ slug: string; slots: any[] }>(`/links/${slug}/slots`),
};

export const analytics = {
  get: (start?: string, end?: string) => {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const query = params.toString();
    return request<AnalyticsData>(`/analytics${query ? `?${query}` : ''}`);
  },
  weekly: () => request<any>('/analytics/weekly'),
};

export const calendars = {
  list: () => request<Calendar[]>('/calendars'),
  discover: () => request<Calendar[]>('/calendars/discover'),
  update: (id: string, data: { mode?: string; enabled?: boolean }) =>
    request<Calendar>(`/calendars/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};

export const search = {
  query: (q: string) =>
    request<{ results: Array<{ type: string; id: string; name: string; href: string }> }>(
      `/search?q=${encodeURIComponent(q)}`,
    ),
};

export const settings = {
  get: () => request<UserConfig>('/settings'),
  update: (data: Partial<UserSettings>) =>
    request<UserConfig>('/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  connectGoogle: () =>
    request<{ redirectUrl: string }>('/auth/google', { method: 'POST' }),
  disconnectGoogle: () =>
    request<void>('/settings/google/disconnect', { method: 'POST' }),
  getGoogleStatus: () =>
    request<{ connected: boolean }>('/auth/google/status'),
};
