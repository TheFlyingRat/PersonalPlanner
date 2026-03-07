<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { getAuthState, googleAuth } from '$lib/auth.svelte';
  import { settings as settingsApi, habits as habitsApi } from '$lib/api';
  import { Frequency } from '@cadence/shared';
  import GoogleLogo from '$lib/components/auth/GoogleLogo.svelte';
  import CalendarIcon from 'lucide-svelte/icons/calendar';
  import Check from 'lucide-svelte/icons/check';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import ArrowRight from 'lucide-svelte/icons/arrow-right';
  import Lock from 'lucide-svelte/icons/lock';
  import Dumbbell from 'lucide-svelte/icons/dumbbell';
  import BookOpen from 'lucide-svelte/icons/book-open';
  import Brain from 'lucide-svelte/icons/brain';
  import ClipboardList from 'lucide-svelte/icons/clipboard-list';
  import Languages from 'lucide-svelte/icons/languages';

  const TOTAL_STEPS = 5;

  // Resume at step 2 if returning from Google OAuth
  const resumeStep = page.url.searchParams.get('step');
  let currentStep = $state(resumeStep ? parseInt(resumeStep, 10) : 0);
  let stepKey = $state(0);

  // Step 2: Calendar
  let calendarConnected = $state(false);

  onMount(async () => {
    try {
      const status = await settingsApi.getGoogleStatus();
      calendarConnected = status.connected;
      // Skip welcome + calendar steps if already connected via Google sign-in
      if (calendarConnected && currentStep < 2) {
        currentStep = 2;
        stepKey += 1;
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
    currentStep === 2 ? workStart < workEnd :
    currentStep === 3 ? habitName.trim().length > 0 :
    true
  );

  let stepCtaLabel = $derived(
    currentStep === 0 ? "Let's go" :
    currentStep === 1 ? (calendarConnected ? 'Continue' : 'Skip for now') :
    currentStep === 2 ? 'Continue' :
    currentStep === 3 ? 'Create habit' :
    'Continue'
  );

  function selectSuggestion(s: typeof suggestions[number]) {
    selectedSuggestion = s.name;
    habitName = s.name;
    habitDuration = s.duration;
    habitFrequency = s.frequency;
  }

  async function nextStep() {
    // Save data on specific steps
    if (currentStep === 2) {
      try {
        await settingsApi.update({
          workingHours: { start: workStart, end: workEnd },
          timezone,
        });
      } catch {
        // Continue even if save fails
      }
    }

    if (currentStep === 3 && habitName.trim()) {
      try {
        const freqMap: Record<string, Frequency> = {
          daily: Frequency.Daily,
          weekdays: Frequency.Custom,
          '3x_week': Frequency.Custom,
        };
        await habitsApi.create({
          name: habitName.trim(),
          durationMin: habitDuration,
          durationMax: habitDuration,
          frequency: freqMap[habitFrequency] ?? Frequency.Daily,
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
      currentStep += 1;
      stepKey += 1;
    }
  }

  function prevStep() {
    const minStep = calendarConnected ? 2 : 0;
    if (currentStep > minStep) {
      currentStep -= 1;
      stepKey += 1;
    }
  }

  function skipOnboarding() {
    goto('/');
  }

  function goToDashboard() {
    goto('/');
  }

  async function connectGoogle() {
    // Check if already connected via the existing Google OAuth flow
    try {
      const response = await settingsApi.connectGoogle();
      if (response.redirectUrl) {
        window.location.href = response.redirectUrl;
      }
    } catch {
      // fallback
      googleAuth();
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
      <div class="wizard-step">
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
          <!-- Step 3: Working Hours -->
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

        {:else if currentStep === 3}
          <!-- Step 4: First Habit -->
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
          <!-- Step 5: All Set -->
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
    {#if currentStep > 0 && currentStep < TOTAL_STEPS - 1}
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
