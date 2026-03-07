<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { goto } from '$app/navigation';
  import { signup, googleAuth } from '$lib/auth.svelte';
  import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
  import GoogleLogo from '$lib/components/auth/GoogleLogo.svelte';
  import User from 'lucide-svelte/icons/user';
  import Mail from 'lucide-svelte/icons/mail';
  import Lock from 'lucide-svelte/icons/lock';
  import Eye from 'lucide-svelte/icons/eye';
  import EyeOff from 'lucide-svelte/icons/eye-off';
  import Loader from 'lucide-svelte/icons/loader';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let showPassword = $state(false);
  let agreedToTerms = $state(false);
  let submitting = $state(false);
  let formError = $state('');

  function getPasswordStrength(pw: string): 'weak' | 'fair' | 'strong' {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^a-zA-Z\d]/.test(pw)) score++;
    if (score <= 2) return 'weak';
    if (score <= 3) return 'fair';
    return 'strong';
  }

  let strength = $derived(password ? getPasswordStrength(password) : 'weak');
  let strengthPercent = $derived(
    !password ? 0 : strength === 'weak' ? 33 : strength === 'fair' ? 66 : 100
  );

  async function handleSignUp(e: SubmitEvent) {
    e.preventDefault();
    formError = '';

    if (!name.trim()) {
      formError = 'Name is required.';
      return;
    }
    if (!email.trim()) {
      formError = 'Email is required.';
      return;
    }
    if (password.length < 8) {
      formError = 'Password must be at least 8 characters.';
      return;
    }
    if (!agreedToTerms) {
      formError = 'You must agree to the Terms and Privacy Policy.';
      return;
    }

    submitting = true;
    try {
      const result = await signup(name.trim(), email.trim(), password);
      if (result.requiresVerification) {
        await goto(`/verify-email?email=${encodeURIComponent(email.trim())}`);
      } else {
        await goto('/onboarding');
      }
    } catch (err) {
      formError = err instanceof Error ? err.message : 'Sign up failed. Please try again.';
    } finally {
      submitting = false;
    }
  }

  function togglePw() {
    showPassword = !showPassword;
  }

  function handleGoogleSignUp() {
    googleAuth();
  }
</script>

<svelte:head>
  <title>{pageTitle('Sign up')}</title>
</svelte:head>

<AuthLayout>
  <h1 class="auth-title">Create your account</h1>
  <p class="auth-subtitle">Start scheduling smarter in minutes.</p>

  <button class="auth-btn-social" onclick={handleGoogleSignUp} type="button">
    <GoogleLogo />
    Continue with Google
  </button>

  <div class="auth-divider"><span>or</span></div>

  <form class="auth-form" onsubmit={handleSignUp}>
    <div class="auth-field">
      <label for="signup-name">Full name</label>
      <div class="auth-input-wrap">
        <User size={18} class="auth-input-icon" />
        <input
          id="signup-name"
          type="text"
          placeholder="Jane Doe"
          bind:value={name}
          required
          autocomplete="name"
        />
      </div>
    </div>

    <div class="auth-field">
      <label for="signup-email">Email address</label>
      <div class="auth-input-wrap">
        <Mail size={18} class="auth-input-icon" />
        <input
          id="signup-email"
          type="email"
          placeholder="you@example.com"
          bind:value={email}
          required
          autocomplete="email"
        />
      </div>
    </div>

    <div class="auth-field">
      <label for="signup-password">Password</label>
      <div class="auth-input-wrap">
        <Lock size={18} class="auth-input-icon" />
        <input
          id="signup-password"
          type={showPassword ? 'text' : 'password'}
          placeholder="Min. 8 characters"
          bind:value={password}
          required
          minlength={8}
          autocomplete="new-password"
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
      {#if password}
        <div class="password-strength">
          <div
            class="password-strength-bar"
            style:width="{strengthPercent}%"
            class:weak={strength === 'weak'}
            class:fair={strength === 'fair'}
            class:strong={strength === 'strong'}
          />
        </div>
      {/if}
    </div>

    <label class="auth-checkbox">
      <input type="checkbox" bind:checked={agreedToTerms} required />
      <span>I agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a></span>
    </label>

    {#if formError}
      <div class="alert-error" role="alert">{formError}</div>
    {/if}

    <button type="submit" class="auth-btn-primary" disabled={submitting}>
      {#if submitting}
        <Loader size={16} class="spin" />
        Creating account...
      {:else}
        Create account
      {/if}
    </button>
  </form>

  <p class="auth-switch">
    Already have an account? <a href="/login" class="auth-link">Sign in</a>
  </p>
</AuthLayout>
