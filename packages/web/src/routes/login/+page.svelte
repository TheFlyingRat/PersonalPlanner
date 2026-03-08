<script lang="ts">
  import { pageTitle, APP_NAME } from '$lib/brand';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { login, googleAuth } from '$lib/auth.svelte';
  import { ApiError } from '$lib/api';
  import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
  import GoogleLogo from '$lib/components/auth/GoogleLogo.svelte';
  import Mail from 'lucide-svelte/icons/mail';
  import Lock from 'lucide-svelte/icons/lock';
  import Eye from 'lucide-svelte/icons/eye';
  import EyeOff from 'lucide-svelte/icons/eye-off';
  import Loader from 'lucide-svelte/icons/loader';

  const oauthErrors: Record<string, string> = {
    oauth_failed: 'Google sign-in failed. Please try again.',
    missing_code: 'Google sign-in was cancelled or failed.',
    invalid_state: 'Google sign-in expired. Please try again.',
    state_expired: 'Google sign-in expired. Please try again.',
    no_email: 'Could not retrieve email from Google account.',
  };

  let email = $state('');
  let password = $state('');
  let showPassword = $state(false);
  let submitting = $state(false);
  let loginError = $state(oauthErrors[page.url.searchParams.get('error') ?? ''] ?? '');
  let emailError = $state('');
  let passwordError = $state('');

  // If redirected back because prompt=none failed, retry with account picker
  if (page.url.searchParams.get('google_retry') === '1') {
    googleAuth('select_account');
  }

  async function handleSignIn(e: SubmitEvent) {
    e.preventDefault();
    emailError = '';
    passwordError = '';
    loginError = '';

    if (!email.trim()) {
      emailError = 'Email is required.';
      return;
    }
    if (!password) {
      passwordError = 'Password is required.';
      return;
    }

    submitting = true;
    try {
      const user = await login(email, password);
      if (!user.onboardingCompleted) {
        await goto('/onboarding');
      } else {
        await goto('/');
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'GOOGLE_ACCOUNT') {
        loginError = 'This account uses Google sign-in. Redirecting...';
        googleAuth();
        return;
      }
      loginError = err instanceof Error ? err.message : 'Sign in failed. Please try again.';
    } finally {
      submitting = false;
    }
  }

  function togglePw() {
    showPassword = !showPassword;
  }

  function handleGoogleSignIn() {
    googleAuth();
  }
</script>

<svelte:head>
  <title>{pageTitle('Sign in')}</title>
</svelte:head>

<AuthLayout>
  <h1 class="auth-title">Welcome back</h1>
  <p class="auth-subtitle">Sign in to your {APP_NAME} account.</p>

  <button class="auth-btn-social" onclick={handleGoogleSignIn} type="button">
    <GoogleLogo />
    Continue with Google
  </button>

  <div class="auth-divider"><span>or</span></div>

  <form class="auth-form" onsubmit={handleSignIn}>
    <div class="auth-field">
      <label for="login-email">Email address</label>
      <div class="auth-input-wrap" class:has-error={!!emailError}>
        <Mail size={18} class="auth-input-icon" />
        <input
          id="login-email"
          type="email"
          placeholder="you@example.com"
          bind:value={email}
          required
          autocomplete="email"
        />
      </div>
      {#if emailError}
        <span class="auth-field-error" role="alert">{emailError}</span>
      {/if}
    </div>

    <div class="auth-field">
      <div class="auth-field-header">
        <label for="login-password">Password</label>
        <a href="/forgot-password" class="auth-link">Forgot password?</a>
      </div>
      <div class="auth-input-wrap" class:has-error={!!passwordError}>
        <Lock size={18} class="auth-input-icon" />
        <input
          id="login-password"
          type={showPassword ? 'text' : 'password'}
          placeholder="Enter password"
          bind:value={password}
          required
          autocomplete="current-password"
        />
        <button
          type="button"
          class="auth-toggle-pw"
          onclick={togglePw}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {#if showPassword}
            <EyeOff size={16} />
          {:else}
            <Eye size={16} />
          {/if}
        </button>
      </div>
      {#if passwordError}
        <span class="auth-field-error" role="alert">{passwordError}</span>
      {/if}
    </div>

    {#if loginError}
      <div class="alert-error" role="alert">{loginError}</div>
    {/if}

    <button type="submit" class="auth-btn-primary" disabled={submitting}>
      {#if submitting}
        <Loader size={16} class="spin" />
        Signing in...
      {:else}
        Sign in
      {/if}
    </button>
  </form>

  <p class="auth-switch">
    Don't have an account? <a href="/signup" class="auth-link">Sign up</a>
  </p>
</AuthLayout>
