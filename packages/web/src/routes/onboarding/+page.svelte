<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { getAuthState, googleAuth } from '$lib/auth.svelte';
  import { settings as settingsApi, habits as habitsApi, calendars as calendarsApi } from '$lib/api';
  import { Frequency, CalendarMode } from '@cadence/shared';
  import type { Calendar } from '@cadence/shared';
  import GoogleLogo from '$lib/components/auth/GoogleLogo.svelte';
  import CalendarIcon from 'lucide-svelte/icons/calendar';
  import Check from 'lucide-svelte/icons/check';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import ArrowRight from 'lucide-svelte/icons/arrow-right';
  import Lock from 'lucide-svelte/icons/lock';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import Dumbbell from 'lucide-svelte/icons/dumbbell';
  import BookOpen from 'lucide-svelte/icons/book-open';
  import Brain from 'lucide-svelte/icons/brain';
  import ClipboardList from 'lucide-svelte/icons/clipboard-list';
  import Languages from 'lucide-svelte/icons/languages';

  const TOTAL_STEPS = 6;

  // Resume at a specific step (e.g. ?step=2 after Google OAuth callback)
  // Clamped to valid range; actual auth is verified in onMount via getGoogleStatus()
  const resumeStep = page.url.searchParams.get('step');
  const parsedStep = resumeStep ? Math.max(0, Math.min(parseInt(resumeStep, 10) || 0, TOTAL_STEPS - 1)) : 0;
  let currentStep = $state(parsedStep);
  let stepKey = $state(0);
  let stepDirection = $state<'forward' | 'back'>('forward');

  // Step 1: Calendar connection
  let calendarConnected = $state(false);

  // Step 2: Calendar selection
  let calendarList = $state<Calendar[]>([]);
  let discoveringCalendars = $state(false);
  let calendarsLoaded = $state(false);

  async function discoverCalendars() {
    discoveringCalendars = true;
    try {
      calendarList = await calendarsApi.discover();
      calendarsLoaded = true;
    } catch {
      // ignore
    } finally {
      discoveringCalendars = false;
    }
  }

  async function loadCalendars() {
    try {
      calendarList = await calendarsApi.list();
      calendarsLoaded = calendarList.length > 0;
      if (!calendarsLoaded) {
        await discoverCalendars();
      }
    } catch {
      await discoverCalendars();
    }
  }

  async function toggleCalendar(cal: Calendar) {
    try {
      const updated = await calendarsApi.update(cal.id, { enabled: !cal.enabled });
      calendarList = calendarList.map((c: Calendar) => c.id === cal.id ? updated : c);
    } catch { /* ignore */ }
  }

  async function setCalendarMode(cal: Calendar, mode: CalendarMode) {
    try {
      const updated = await calendarsApi.update(cal.id, { mode });
      calendarList = calendarList.map((c: Calendar) => c.id === cal.id ? updated : c);
    } catch { /* ignore */ }
  }

  onMount(async () => {
    // Auth guard: redirect to login if not authenticated
    const auth = getAuthState();
    if (!auth.isAuthenticated && !auth.isLoading) {
      goto('/login');
      return;
    }
    if (auth.isLoading) {
      const { checkAuth } = await import('$lib/auth.svelte');
      const user = await checkAuth();
      if (!user) {
        goto('/login');
        return;
      }
    }

    try {
      const status = await settingsApi.getGoogleStatus();
      calendarConnected = status.connected;
      // Skip welcome + connect steps if already connected via Google sign-in
      if (calendarConnected && currentStep < 2) {
        currentStep = 2;
        stepKey += 1;
      }
      // Auto-discover calendars when landing on or skipping to the calendar step
      if (calendarConnected && currentStep === 2 && !calendarsLoaded) {
        loadCalendars();
      }
    } catch {
      // ignore
    }
  });

  // Step 3: Working hours
  let workStart = $state('09:00');
  let workEnd = $state('17:00');
  let timezone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Step 4: First habit
  let habitName = $state('');
  let habitDuration = $state(30);
  let habitFrequency = $state('daily');
  let selectedSuggestion = $state('');

  const suggestions = [
    { name: 'Morning workout', icon: Dumbbell, duration: 45, frequency: 'daily' },
    { name: 'Read', icon: BookOpen, duration: 30, frequency: 'daily' },
    { name: 'Meditate', icon: Brain, duration: 15, frequency: 'daily' },
    { name: 'Plan my day', icon: ClipboardList, duration: 15, frequency: 'weekdays' },
    { name: 'Learn a language', icon: Languages, duration: 30, frequency: '3x_week' },
  ];

  interface TimezoneGroup {
    label: string;
    zones: string[];
  }

  function groupTimezones(): TimezoneGroup[] {
    const allZones = Intl.supportedValuesOf('timeZone');
    const groups = new Map<string, string[]>();
    for (const tz of allZones) {
      const slashIdx = tz.indexOf('/');
      if (slashIdx > 0) {
        const region = tz.substring(0, slashIdx);
        const existing = groups.get(region);
        if (existing) {
          existing.push(tz);
        } else {
          groups.set(region, [tz]);
        }
      }
    }
    const result: TimezoneGroup[] = [];
    for (const [label, zones] of groups) {
      result.push({ label, zones: zones.sort() });
    }
    return result.sort((a, b) => a.label.localeCompare(b.label));
  }

  const timezoneGroups = groupTimezones();

  let canProceed = $derived(
    currentStep === 0 ? true :
    currentStep === 1 ? true : // calendar is optional
    currentStep === 2 ? true : // calendar selection is optional
    currentStep === 3 ? workStart < workEnd :
    currentStep === 4 ? habitName.trim().length > 0 :
    true
  );

  let stepCtaLabel = $derived(
    currentStep === 0 ? "Let's go" :
    currentStep === 1 ? (calendarConnected ? 'Continue' : 'Skip for now') :
    currentStep === 2 ? 'Continue' :
    currentStep === 3 ? 'Continue' :
    currentStep === 4 ? 'Create habit' :
    'Continue'
  );

  function selectSuggestion(s: typeof suggestions[number]) {
    selectedSuggestion = s.name;
    habitName = s.name;
    habitDuration = s.duration;
    habitFrequency = s.frequency;
  }

  async function nextStep() {
    // Load calendars when entering the calendar selection step
    if (currentStep === 1 && calendarConnected && !calendarsLoaded) {
      loadCalendars();
    }

    // Save data on specific steps
    if (currentStep === 3) {
      try {
        await settingsApi.update({
          workingHours: { start: workStart, end: workEnd },
          timezone,
        });
      } catch {
        // Continue even if save fails
      }
    }

    if (currentStep === 4 && habitName.trim()) {
      try {
        const daysMap: Record<string, string[]> = {
          daily: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
          weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
          '3x_week': ['mon', 'wed', 'fri'],
        };
        await habitsApi.create({
          name: habitName.trim(),
          durationMin: habitDuration,
          durationMax: habitDuration,
          frequency: Frequency.Daily,
          frequencyConfig: { days: daysMap[habitFrequency] ?? daysMap.weekdays },
          priority: 2,
          windowStart: '06:00',
          windowEnd: '12:00',
          idealTime: '08:00',
        });
      } catch {
        // Continue even if create fails
      }
    }

    if (currentStep < TOTAL_STEPS - 1) {
      stepDirection = 'forward';
      currentStep += 1;
      stepKey += 1;
    }
  }

  function prevStep() {
    const minStep = calendarConnected ? 2 : 0;
    if (currentStep > minStep) {
      stepDirection = 'back';
      currentStep -= 1;
      stepKey += 1;
    }
  }

  async function completeOnboarding() {
    try {
      await settingsApi.completeOnboarding();
    } catch {
      // Continue to dashboard even if the API call fails
    }
  }

  async function skipOnboarding() {
    await completeOnboarding();
    goto('/');
  }

  async function goToDashboard() {
    await completeOnboarding();
    goto('/');
  }

  async function connectGoogle() {
    // Check if already connected via the existing Google OAuth flow
    try {
      const response = await settingsApi.connectGoogle();
      if (response.redirectUrl && response.redirectUrl.startsWith('https://accounts.google.com/')) {
        window.location.href = response.redirectUrl;
      } else if (response.redirectUrl) {
        throw new Error('Invalid OAuth redirect URL');
      }
    } catch {
      // fallback
      return googleAuth();
    }
  }
</script>

<svelte:head>
  <title>{pageTitle('Get started')}</title>
</svelte:head>

<div class="wizard">
  <div class="wizard-header">
    <span class="sidebar-logo">C</span>
    <div class="wizard-progress" role="group" aria-label="Onboarding progress">
      {#each Array(TOTAL_STEPS) as _, i}
        <div
          class="wizard-dot"
          class:active={i === currentStep}
          class:completed={i < currentStep}
          role="img"
          aria-label="Step {i + 1} of {TOTAL_STEPS}"
          aria-current={i === currentStep ? 'step' : undefined}
        ></div>
        {#if i < TOTAL_STEPS - 1}
          <div class="wizard-track" class:filled={i < currentStep}></div>
        {/if}
      {/each}
    </div>
    <button class="wizard-skip" onclick={skipOnboarding}>
      Skip
    </button>
  </div>

  <div class="wizard-body">
    {#key stepKey}
      <div class="wizard-step" class:wizard-step--back={stepDirection === 'back'}>
        {#if currentStep === 0}
          <!-- Step 1: Welcome -->
          <div class="wizard-welcome">
            <div class="wizard-welcome-icon">
              <CalendarIcon size={32} />
            </div>
            <h1>Welcome to Cadence</h1>
            <p>
              Cadence automatically places your habits, tasks, and focus time
              on your calendar -- so you can stop planning and start doing.
            </p>
            <p class="wizard-welcome-time">This takes about 2 minutes.</p>
          </div>

        {:else if currentStep === 1}
          <!-- Step 2: Connect Calendar -->
          <div class="wizard-calendar">
            <h2>Connect your calendar</h2>
            <p>Cadence needs access to your Google Calendar to read events and schedule new ones.</p>

            {#if !calendarConnected}
              <button class="auth-btn-social wizard-google-btn" onclick={connectGoogle} type="button">
                <GoogleLogo />
                Connect Google Calendar
              </button>
              <p class="wizard-privacy-note">
                <Lock size={14} />
                We only read and create events. We never share your data.
              </p>
            {:else}
              <div class="wizard-success-card">
                <Check size={20} />
                <span>Google Calendar connected</span>
              </div>
            {/if}
          </div>

        {:else if currentStep === 2}
          <!-- Step 3: Choose Calendars -->
          <div class="wizard-calendars">
            <h2>Choose your calendars</h2>
            <p>Select which calendars Cadence can see and schedule on.</p>

            {#if !calendarConnected}
              <p class="text-hint">Connect Google Calendar first to manage your calendars.</p>
            {:else if discoveringCalendars}
              <div class="wizard-calendars-loading">
                <RefreshCw size={18} class="spinning" />
                <span>Discovering your calendars...</span>
              </div>
            {:else if calendarList.length === 0}
              <p class="text-hint">No calendars found.</p>
              <button class="wizard-btn-refresh" onclick={discoverCalendars} type="button">
                <RefreshCw size={14} />
                Discover calendars
              </button>
            {:else}
              <div class="wizard-cal-table">
                {#each calendarList as cal, i}
                  <div class="cal-row" class:cal-row--bordered={i > 0}>
                    <div class="cal-info">
                      <span class="cal-dot" style:background={cal.color ?? 'var(--color-accent)'}></span>
                      <span class="cal-name">{cal.name}</span>
                    </div>
                    <div class="cal-actions">
                      {#if cal.enabled && cal.googleCalendarId !== 'primary'}
                        <select
                          value={cal.mode}
                          onchange={(e) => setCalendarMode(cal, e.currentTarget.value as CalendarMode)}
                          aria-label={`Mode for ${cal.name}`}
                          class="cal-mode-select"
                        >
                          <option value="writable">Writable</option>
                          <option value="locked">Locked</option>
                        </select>
                      {/if}
                      {#if cal.googleCalendarId !== 'primary'}
                        <button
                          onclick={() => toggleCalendar(cal)}
                          role="switch"
                          aria-checked={cal.enabled}
                          aria-label="Toggle {cal.name}"
                          class="toggle-switch"
                          class:toggle-switch--on={cal.enabled}
                        >
                          <span
                            class="toggle-switch-knob"
                            class:toggle-switch-knob--on={cal.enabled}
                          ></span>
                        </button>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
              <p class="wizard-cal-hint">
                <strong>Writable</strong> = Cadence can create events. <strong>Locked</strong> = read-only, used to avoid conflicts.
              </p>
            {/if}
          </div>

        {:else if currentStep === 3}
          <!-- Step 4: Working Hours -->
          <div class="wizard-hours">
            <h2>Set your working hours</h2>
            <p>Tell us when you're available so we schedule around your real life.</p>

            <div class="wizard-hours-grid">
              <div class="form-field">
                <label for="wiz-work-start">Work starts</label>
                <input id="wiz-work-start" type="time" bind:value={workStart} class="font-mono" />
              </div>
              <div class="form-field">
                <label for="wiz-work-end">Work ends</label>
                <input id="wiz-work-end" type="time" bind:value={workEnd} class="font-mono" />
              </div>
            </div>

            <div class="form-field" style="margin-top: var(--space-4);">
              <label for="wiz-timezone">Timezone</label>
              <select id="wiz-timezone" bind:value={timezone}>
                {#each timezoneGroups as group}
                  <optgroup label={group.label}>
                    {#each group.zones as tz}
                      <option value={tz}>{tz.replace(/_/g, ' ')}</option>
                    {/each}
                  </optgroup>
                {/each}
              </select>
            </div>
          </div>

        {:else if currentStep === 4}
          <!-- Step 5: First Habit -->
          <div class="wizard-habit">
            <h2>Create your first habit</h2>
            <p>Pick something you want to do regularly. Cadence will find time for it.</p>

            <div class="wizard-habit-suggestions">
              {#each suggestions as s}
                <button
                  class="wizard-habit-chip"
                  class:selected={selectedSuggestion === s.name}
                  onclick={() => selectSuggestion(s)}
                  type="button"
                >
                  <s.icon size={16} />
                  {s.name}
                </button>
              {/each}
            </div>

            <div class="auth-form">
              <div class="auth-field">
                <label for="wiz-habit-name">Habit name</label>
                <div class="auth-input-wrap">
                  <input
                    id="wiz-habit-name"
                    type="text"
                    bind:value={habitName}
                    placeholder="e.g., Morning workout"
                  />
                </div>
              </div>

              <div class="form-row">
                <div class="form-field">
                  <label for="wiz-habit-duration">Duration</label>
                  <select id="wiz-habit-duration" bind:value={habitDuration}>
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                    <option value={45}>45 min</option>
                    <option value={60}>1 hour</option>
                  </select>
                </div>
                <div class="form-field">
                  <label for="wiz-habit-frequency">Frequency</label>
                  <select id="wiz-habit-frequency" bind:value={habitFrequency}>
                    <option value="daily">Daily</option>
                    <option value="weekdays">Weekdays</option>
                    <option value="3x_week">3x / week</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

        {:else}
          <!-- Step 6: All Set -->
          <div class="wizard-complete">
            <div class="wizard-complete-icon">
              <Check size={32} />
            </div>
            <h1>You're all set!</h1>
            <p>
              Cadence is now managing your calendar. Your first habit
              will appear on your schedule shortly.
            </p>
          </div>
        {/if}
      </div>
    {/key}
  </div>

  <div class="wizard-footer">
    {#if currentStep > (calendarConnected ? 2 : 0) && currentStep < TOTAL_STEPS - 1}
      <button class="wizard-btn-back" onclick={prevStep} type="button">
        <ChevronLeft size={16} />
        Back
      </button>
    {:else}
      <div></div>
    {/if}

    {#if currentStep < TOTAL_STEPS - 1}
      <button class="wizard-btn-next" onclick={nextStep} disabled={!canProceed} type="button">
        {stepCtaLabel}
        <ChevronRight size={16} />
      </button>
    {:else}
      <button class="wizard-btn-next" onclick={goToDashboard} type="button">
        Open Cadence
        <ArrowRight size={16} />
      </button>
    {/if}
  </div>
</div>
