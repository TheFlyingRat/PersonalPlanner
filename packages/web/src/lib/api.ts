// API Client - Typed fetch wrapper for all endpoints

import { env } from '$env/dynamic/public';
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
  ParsedItem,
  QualityScore,
  ScheduleChange,
} from '@cadence/shared';
import { CalendarMode } from '@cadence/shared';

const API_BASE = env.PUBLIC_API_URL || '/api';

export interface RescheduleResult {
  message: string;
  operationsApplied: number;
  unschedulable: Array<{ itemId: string; itemType: string; reason: string }>;
}

export interface AlternativesResult {
  alternatives: Array<{ start: string; end: string; score: number }>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    // 401 interceptor: try refresh, then redirect to login
    if (res.status === 401 && !path.startsWith('/auth/')) {
      try {
        const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'same-origin',
        });
        if (refreshRes.ok) {
          // Retry the original request
          return request<T>(path, options);
        }
      } catch {
        // refresh failed
      }
      // Redirect to login if refresh failed
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    let message = `API error: ${res.status}`;
    try {
      const body = await res.json();
      message = body.error ?? body.message ?? message;
    } catch (_e) { /* no JSON body */ }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const habits = {
  list: () => request<Habit[]>('/habits'),
  create: (data: CreateHabitRequest) =>
    request<Habit>('/habits', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<CreateHabitRequest & { locked: boolean; enabled: boolean }>) =>
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
    request<{ habitId: string; currentStreak: number }>(`/habits/${id}/streak`),
};

export const tasks = {
  list: () => request<Task[]>('/tasks'),
  create: (data: CreateTaskRequest) =>
    request<Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<CreateTaskRequest & { remainingDuration: number; status: string; isUpNext: boolean }>) =>
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
  run: () => request<RescheduleResult>('/schedule/reschedule', { method: 'POST' }),
  export: async (start?: string, end?: string) => {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const qs = params.toString();
    const res = await fetch(`${API_BASE}/schedule/export${qs ? '?' + qs : ''}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) {
      throw new ApiError(`Export failed: ${res.status}`, res.status);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cadence-schedule.ics';
    a.click();
    URL.revokeObjectURL(url);
  },
  getAlternatives: (itemId: string) =>
    request<AlternativesResult>(`/schedule/${itemId}/alternatives`),
  deleteAllManaged: () =>
    request<{ message: string; googleEventsDeleted: number; localEventsDeleted: number }>(
      '/schedule/managed-events',
      { method: 'DELETE' },
    ),
  moveEvent: (eventId: string, start: string, end: string) =>
    request<{ message: string; eventId: string; start: string; end: string }>(
      `/schedule/${eventId}/move`,
      { method: 'POST', body: JSON.stringify({ start, end }) },
    ),
  getQuality: (date?: string) => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    const qs = params.toString();
    return request<QualityScore>(`/schedule/quality${qs ? '?' + qs : ''}`);
  },
  getChanges: (limit?: number, since?: string) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (since) params.set('since', since);
    const qs = params.toString();
    return request<ScheduleChange[]>(`/schedule/changes${qs ? '?' + qs : ''}`);
  },
};

export const links = {
  list: () => request<SchedulingLink[]>('/links'),
  create: (data: CreateLinkRequest) =>
    request<SchedulingLink>('/links', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<CreateLinkRequest & { enabled: boolean }>) =>
    request<SchedulingLink>(`/links/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/links/${id}`, { method: 'DELETE' }),
  getBySlug: (slug: string) =>
    request<{ slug: string; slots: Array<{ start: string; end: string; duration: number }> }>(`/links/${slug}/slots`),
};

export const analytics = {
  get: (start?: string, end?: string) => {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const query = params.toString();
    return request<AnalyticsData>(`/analytics${query ? `?${query}` : ''}`);
  },
  weekly: () =>
    request<{ weeklyBreakdown: AnalyticsData['weeklyBreakdown'] }>('/analytics/weekly'),
};

export const calendars = {
  list: () => request<Calendar[]>('/calendars'),
  discover: () => request<Calendar[]>('/calendars/discover'),
  update: (id: string, data: { mode?: CalendarMode; enabled?: boolean }) =>
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

export interface QuickAddResult {
  created: boolean;
  type: 'habit' | 'task' | 'meeting';
  item?: unknown;
  parsed: ParsedItem;
  error?: string;
}

export const quickAdd = {
  parse: (input: string) =>
    request<QuickAddResult>('/quick-add', {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),
};

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export const auth = {
  login: (email: string, password: string) =>
    request<{ user: { id: string; name: string; email: string; emailVerified: boolean; onboardingCompleted: boolean } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  signup: (name: string, email: string, password: string) =>
    request<{ user: { id: string; name: string; email: string; emailVerified: boolean; onboardingCompleted: boolean }; requiresVerification: boolean }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),
  logout: () =>
    request<void>('/auth/logout', { method: 'POST' }),
  refresh: () =>
    request<{ user: { id: string; name: string; email: string; emailVerified: boolean; onboardingCompleted: boolean } }>('/auth/refresh', { method: 'POST' }),
  me: () =>
    request<{ user: { id: string; name: string; email: string; avatarUrl: string | null; emailVerified: boolean; hasPassword: boolean; plan: string; onboardingCompleted: boolean } }>('/auth/me'),
  google: () => {
    window.location.href = `${API_BASE}/auth/google`;
  },
  verifyEmail: (token: string) =>
    request<void>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  resendVerification: (email: string) =>
    request<void>('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  forgotPassword: (email: string) =>
    request<void>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request<void>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: boolean; message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  exportData: async () => {
    const res = await fetch(`${API_BASE}/auth/export`, {
      credentials: 'same-origin',
    });
    if (!res.ok) {
      throw new ApiError(`Export failed: ${res.status}`, res.status);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cadence-data-export.json';
    a.click();
    URL.revokeObjectURL(url);
  },
  deleteAccount: (password?: string) =>
    request<{ success: boolean; message: string }>('/auth/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true, password }),
    }),
  getSessions: () =>
    request<{ sessions: SessionInfo[] }>('/auth/sessions'),
  revokeSession: (id: string) =>
    request<{ success: boolean; message: string }>(`/auth/sessions/${id}`, {
      method: 'DELETE',
    }),
  revokeOtherSessions: () =>
    request<{ success: boolean; message: string }>('/auth/sessions', {
      method: 'DELETE',
    }),
};
