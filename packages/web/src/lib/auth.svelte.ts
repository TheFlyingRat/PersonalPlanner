// Client-side auth state management using Svelte 5 runes
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { PUBLIC_API_URL } from '$env/static/public';
import { ApiError } from '$lib/api';

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  emailVerified: boolean;
  onboardingCompleted: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const API_BASE = PUBLIC_API_URL || '/api';

async function authRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'include',
  });
  if (!res.ok) {
    let message = `Auth error: ${res.status}`;
    let code: string | undefined;
    try {
      const body = await res.json();
      message = body.error ?? body.message ?? message;
      code = body.code;
    } catch (_e) { /* no JSON body */ }
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Module-level reactive state
let authState = $state<AuthState>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
});

function setAuth(user: User | null) {
  authState.user = user;
  authState.isAuthenticated = !!user;
  authState.isLoading = false;
}

export function getAuthState(): AuthState {
  return authState;
}

export async function checkAuth(): Promise<User | null> {
  if (!browser) return null;
  try {
    authState.isLoading = true;
    const result = await authRequest<{ user: User }>('/auth/me');
    setAuth(result.user);
    return result.user;
  } catch {
    setAuth(null);
    return null;
  }
}

export async function login(email: string, password: string): Promise<User> {
  const result = await authRequest<{ user: User }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setAuth(result.user);
  return result.user;
}

export async function signup(name: string, email: string, password: string, gdprConsent = true): Promise<{ user: User; requiresVerification: boolean }> {
  const result = await authRequest<{ user: User; requiresVerification: boolean }>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ name, email, password, gdprConsent }),
  });
  setAuth(result.user);
  return result;
}

export async function logout(): Promise<void> {
  try {
    await authRequest<void>('/auth/logout', { method: 'POST' });
  } catch {
    // Even if server call fails, clear local state
  }
  setAuth(null);
  if (browser) {
    await goto('/login');
  }
}

export async function refreshToken(): Promise<boolean> {
  try {
    await authRequest<{ success: boolean }>('/auth/refresh', { method: 'POST' });
    // Refresh succeeded — re-fetch user profile with new access token
    await checkAuth();
    return true;
  } catch {
    setAuth(null);
    return false;
  }
}

export async function googleAuth(prompt?: 'select_account'): Promise<void> {
  if (browser) {
    const params = prompt ? `?prompt=${prompt}` : '';
    const res = await fetch(`${API_BASE}/auth/google${params}`, { credentials: 'include' });
    if (!res.ok) {
      throw new Error('Too many requests. Please try again in a few minutes.');
    }
    const { redirectUrl } = await res.json();
    if (!redirectUrl || !redirectUrl.startsWith('https://accounts.google.com/')) {
      throw new Error('Invalid OAuth redirect URL');
    }
    window.location.href = redirectUrl;
  }
}

export async function verifyEmail(token: string): Promise<void> {
  await authRequest<void>(`/auth/verify-email?token=${encodeURIComponent(token)}`, {
    method: 'GET',
  });
}

export async function resendVerification(email: string): Promise<void> {
  await authRequest<void>('/auth/resend-verification-email', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function forgotPassword(email: string): Promise<void> {
  await authRequest<void>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await authRequest<void>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}
