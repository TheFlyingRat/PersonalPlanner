// Client-side auth state management using Svelte 5 runes
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { PUBLIC_API_URL } from '$env/static/public';
import { auth as authApi } from '$lib/api';

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
    const result = await authApi.me();
    setAuth(result.user as User);
    return result.user as User;
  } catch {
    setAuth(null);
    return null;
  }
}

export async function login(email: string, password: string): Promise<User> {
  const result = await authApi.login(email, password);
  setAuth(result.user as User);
  return result.user as User;
}

export async function signup(name: string, email: string, password: string, gdprConsent = true): Promise<{ user: User; requiresVerification: boolean }> {
  const result = await authApi.signup(name, email, password, gdprConsent);
  setAuth(result.user as User);
  return result as { user: User; requiresVerification: boolean };
}

export async function logout(): Promise<void> {
  try {
    await authApi.logout();
  } catch {
    // Even if server call fails, clear local state
  }
  setAuth(null);
  if (browser) {
    await goto('/login');
  }
}

// Calls /auth/refresh then /auth/me — two round trips required because
// the refresh endpoint returns only a success flag, not the user object.
export async function refreshToken(): Promise<boolean> {
  try {
    await authApi.refresh();
    await checkAuth();
    return true;
  } catch {
    setAuth(null);
    return false;
  }
}

export async function googleAuth(prompt?: 'select_account'): Promise<void> {
  if (browser) {
    const API_BASE = PUBLIC_API_URL || '/api';
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
  await authApi.verifyEmail(token);
}

export async function resendVerification(email: string): Promise<void> {
  await authApi.resendVerification(email);
}

export async function forgotPassword(email: string): Promise<void> {
  await authApi.forgotPassword(email);
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await authApi.resetPassword(token, password);
}
