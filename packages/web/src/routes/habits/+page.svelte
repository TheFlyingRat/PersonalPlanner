<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { tick } from 'svelte';
  import { habits as habitsApi, calendars as calendarsApi, ApiError } from '$lib/api';
  import { Frequency, SchedulingHours } from '@cadence/shared';
  import type { Habit, HabitCompletion, Calendar } from '@cadence/shared';
  import Plus from 'lucide-svelte/icons/plus';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import X from 'lucide-svelte/icons/x';
  import Lock from 'lucide-svelte/icons/lock';
  import Bell from 'lucide-svelte/icons/bell';
  import BellOff from 'lucide-svelte/icons/bell-off';
  import Repeat from 'lucide-svelte/icons/repeat';
  import ToggleLeft from 'lucide-svelte/icons/toggle-left';
  import ToggleRight from 'lucide-svelte/icons/toggle-right';
  import Flame from 'lucide-svelte/icons/flame';
  import Link2 from 'lucide-svelte/icons/link-2';
  import CircleCheck from 'lucide-svelte/icons/circle-check';
  import EllipsisVertical from 'lucide-svelte/icons/ellipsis-vertical';

  const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const DAY_LABELS: Record<string, string> = {
    mon: 'M', tue: 'Tu', wed: 'W', thu: 'Th', fri: 'F', sat: 'Sa', sun: 'Su',
  };
  const DAY_FULL_LABELS: Record<string, string> = {
    mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
  };
  const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const WEEKENDS = ['sat', 'sun'];

  const colorNames: Record<string, string> = {
    '#4285f4': 'Blue', '#ea4335': 'Red', '#34a853': 'Green', '#fbbc04': 'Yellow',
    '#ff6d01': 'Orange', '#e91e63': 'Pink', '#9c27b0': 'Purple', '#795548': 'Brown',
    '#46bdc6': 'Teal', '#7b61ff': 'Violet',
  };

  function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sorted1 = [...a].sort();
    const sorted2 = [...b].sort();
    return sorted1.every((v, i) => v === sorted2[i]);
  }

  function getActivePreset(days: string[]): string {
    if (arraysEqual(days, [...ALL_DAYS])) return 'every-day';
    if (arraysEqual(days, WEEKDAYS)) return 'weekdays';
    if (arraysEqual(days, WEEKENDS)) return 'weekends';
    return 'custom';
  }

  function daysFromHabit(habit: Habit): string[] {
    if (habit.frequencyConfig?.days?.length) return [...habit.frequencyConfig.days];
    if (habit.frequency === 'daily') return [...ALL_DAYS];
    if (habit.frequency === 'weekly') return ['mon'];
    return [...WEEKDAYS];
  }

  function getTodayDateString(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).format(new Date());
  }

  let habitList = $state<Habit[]>([]);
  let showPanel = $state(false);
  let editingId = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');
  let success = $state('');
  let submitting = $state(false);
  let menuOpenId = $state<string | null>(null);
  let confirmingDeleteId = $state<string | null>(null);
  let panelTrigger: HTMLElement | null = null;
  let successTimer: ReturnType<typeof setTimeout> | undefined;

  // Calendar list
  let calendarList = $state<Calendar[]>([]);

  // Streak and completion tracking
  let streaks = $state<Record<string, number>>({});
  let completions = $state<Record<string, HabitCompletion[]>>({});

  $effect(() => {
    return () => clearTimeout(successTimer);
  });

  function getLast7Days(): string[] {
    const days: string[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push(new Intl.DateTimeFormat('en-CA').format(d));
    }
    return days;
  }

  function isDayCompleted(habitId: string, date: string): boolean {
    const list = completions[habitId] || [];
    return list.some((c) => c.scheduledDate.startsWith(date));
  }

  function getDayLabel(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'narrow' });
  }

  function getParentName(dependsOn: string | null | undefined): string {
    if (!dependsOn) return '';
    const parent = habitList.find((h) => h.id === dependsOn);
    return parent?.name || 'Unknown';
  }

  async function loadStreaksAndCompletions() {
    const results = await Promise.all(
      habitList.map(async (habit) => {
        try {
          const [streakData, completionData] = await Promise.all([
            habitsApi.getStreak(habit.id),
            habitsApi.getCompletions(habit.id),
          ]);
          return { id: habit.id, streak: streakData.currentStreak, completions: completionData };
        } catch {
          return null;
        }
      })
    );
    let newStreaks = { ...streaks };
    let newCompletions = { ...completions };
    for (const result of results) {
      if (result) {
        newStreaks = { ...newStreaks, [result.id]: result.streak };
        newCompletions = { ...newCompletions, [result.id]: result.completions };
      }
    }
    streaks = newStreaks;
    completions = newCompletions;
  }

  async function markComplete(habitId: string) {
    const today = getTodayDateString();
    try {
      await habitsApi.markComplete(habitId, today);
      const [streakData, completionData] = await Promise.all([
        habitsApi.getStreak(habitId),
        habitsApi.getCompletions(habitId),
      ]);
      streaks = { ...streaks, [habitId]: streakData.currentStreak };
      completions = { ...completions, [habitId]: completionData };
      showSuccessMsg('Habit marked complete.');
    } catch (err) {
      if (err instanceof TypeError) {
        // Network error — optimistic update for offline
        const now = new Date().toISOString();
        const existing = completions[habitId] || [];
        completions = {
          ...completions,
          [habitId]: [...existing, { id: crypto.randomUUID(), habitId, scheduledDate: today, completedAt: now }],
        };
        streaks = { ...streaks, [habitId]: (streaks[habitId] || 0) + 1 };
        showSuccessMsg('Habit marked complete (offline).');
      } else {
        error = err instanceof Error ? err.message : 'Failed to mark complete.';
      }
    }
  }

  // Form fields
  let formName = $state('');
  let formPriority = $state(3);
  let formWindowStart = $state('09:00');
  let formWindowEnd = $state('17:00');
  let formIdealTime = $state('10:00');
  let formDurationMin = $state(30);
  let formDurationMax = $state(60);
  let formDays = $state<string[]>([...WEEKDAYS]);
  let formSchedulingHours: SchedulingHours = $state(SchedulingHours.Working);
  let formLocked = $state(false);
  let formAutoDecline = $state(false);
  let formNotifications = $state(false);
  let formSkipBuffer = $state(false);
  let formCalendarId = $state('');
  let formColor = $state('');

  let panelEl: HTMLDivElement | null = null;

  const priorityLabels: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };

  function showSuccessMsg(msg: string) {
    success = msg;
    clearTimeout(successTimer);
    successTimer = setTimeout(() => { success = ''; }, 3000);
  }

  function resetForm() {
    formName = '';
    formPriority = 3;
    formWindowStart = '09:00';
    formWindowEnd = '17:00';
    formIdealTime = '10:00';
    formDurationMin = 30;
    formDurationMax = 60;
    formDays = [...WEEKDAYS];
    formSchedulingHours = SchedulingHours.Working;
    formLocked = false;
    formAutoDecline = false;
    formNotifications = false;
    formSkipBuffer = false;
    formCalendarId = '';
    formColor = '';
    editingId = null;
  }

  function openAddForm() {
    panelTrigger = document.activeElement as HTMLElement;
    resetForm();
    showPanel = true;
    tick().then(() => focusFirstInPanel());
  }

  function openEditForm(habit: Habit) {
    panelTrigger = document.activeElement as HTMLElement;
    editingId = habit.id;
    formName = habit.name;
    formPriority = habit.priority;
    formWindowStart = habit.windowStart;
    formWindowEnd = habit.windowEnd;
    formIdealTime = habit.idealTime;
    formDurationMin = habit.durationMin;
    formDurationMax = habit.durationMax;
    formDays = daysFromHabit(habit);
    formSchedulingHours = habit.schedulingHours;
    formLocked = habit.locked;
    formAutoDecline = habit.autoDecline;
    formNotifications = habit.notifications ?? false;
    formSkipBuffer = habit.skipBuffer ?? false;
    formCalendarId = habit.calendarId ?? '';
    formColor = habit.color ?? '';
    showPanel = true;
    tick().then(() => focusFirstInPanel());
  }

  function closePanel() {
    showPanel = false;
    resetForm();
    panelTrigger?.focus();
    panelTrigger = null;
  }

  function focusFirstInPanel() {
    if (!panelEl) return;
    const focusable = panelEl.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length > 0) focusable[0].focus();
  }

  function trapFocus(e: KeyboardEvent) {
    if (e.key === 'Escape') { closePanel(); return; }
    if (e.key !== 'Tab' || !panelEl) return;
    const focusable = panelEl.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (menuOpenId) { menuOpenId = null; confirmingDeleteId = null; return; }
      if (showPanel) closePanel();
    }
  }

  function handleWindowClick() {
    if (menuOpenId) { menuOpenId = null; confirmingDeleteId = null; }
  }

  async function handleSubmit() {
    error = '';
    if (formDurationMin > formDurationMax) {
      error = 'Min duration cannot exceed max';
      return;
    }
    if (formWindowStart >= formWindowEnd) {
      error = 'Window start must be before end';
      return;
    }

    submitting = true;
    const allSelected = arraysEqual(formDays, [...ALL_DAYS]);
    const weekdaysSelected = arraysEqual(formDays, WEEKDAYS);
    const mappedFrequency = (allSelected || weekdaysSelected) ? Frequency.Daily : Frequency.Custom;
    const habitData = {
      name: formName,
      priority: formPriority,
      windowStart: formWindowStart,
      windowEnd: formWindowEnd,
      idealTime: formIdealTime,
      durationMin: formDurationMin,
      durationMax: formDurationMax,
      frequency: mappedFrequency,
      frequencyConfig: { days: [...formDays] },
      schedulingHours: formSchedulingHours,
      locked: formLocked,
      autoDecline: formAutoDecline,
      notifications: formNotifications,
      skipBuffer: formSkipBuffer,
      calendarId: formCalendarId || undefined,
      color: formColor || undefined,
    };

    try {
      if (editingId) {
        await habitsApi.update(editingId, habitData);
      } else {
        await habitsApi.create(habitData);
      }
      habitList = await habitsApi.list();
      showSuccessMsg(editingId ? 'Habit updated successfully.' : 'Habit created successfully.');
      closePanel();
    } catch (err) {
      if (err instanceof TypeError) {
        // Network error - use optimistic offline update
        if (editingId) {
          habitList = habitList.map((h) =>
            h.id === editingId ? { ...h, ...habitData } : h
          ) as Habit[];
          showSuccessMsg('Habit updated (offline).');
        } else {
          habitList = [
            ...habitList,
            { id: crypto.randomUUID(), ...habitData, enabled: true } as unknown as Habit,
          ];
          showSuccessMsg('Habit created (offline).');
        }
        closePanel();
      } else {
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    } finally {
      submitting = false;
    }
  }

  async function toggleLock(habit: Habit) {
    try {
      await habitsApi.lock(habit.id, !habit.locked);
      habitList = await habitsApi.list();
    } catch (err) {
      if (err instanceof TypeError) {
        habitList = habitList.map((h) =>
          h.id === habit.id ? { ...h, locked: !h.locked } : h
        );
      } else {
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    }
  }

  async function toggleNotifications(habit: Habit) {
    try {
      await habitsApi.update(habit.id, { notifications: !habit.notifications });
      habitList = await habitsApi.list();
    } catch (err) {
      if (err instanceof TypeError) {
        habitList = habitList.map((h) =>
          h.id === habit.id ? { ...h, notifications: !h.notifications } : h
        );
      } else {
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    }
  }

  async function toggleEnabled(habit: Habit) {
    try {
      await habitsApi.update(habit.id, { enabled: !habit.enabled });
      habitList = await habitsApi.list();
    } catch (err) {
      if (err instanceof TypeError) {
        habitList = habitList.map((h) =>
          h.id === habit.id ? { ...h, enabled: !h.enabled } : h
        );
      } else {
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    }
  }

  async function deleteHabit(id: string) {
    try {
      await habitsApi.delete(id);
      habitList = await habitsApi.list();
      showSuccessMsg('Habit deleted successfully.');
    } catch (err) {
      if (err instanceof TypeError) {
        habitList = habitList.filter((h) => h.id !== id);
        showSuccessMsg('Habit deleted (offline).');
      } else {
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    }
    confirmingDeleteId = null;
    menuOpenId = null;
  }

  $effect(() => {
    (async () => {
      loading = true;
      error = '';
      try {
        habitList = await habitsApi.list();
      } catch (err) {
        if (err instanceof TypeError) {
          error = 'Unable to connect. Please check your network.';
        } else {
          error = err instanceof ApiError ? err.message : 'Failed to load data.';
        }
      } finally {
        loading = false;
      }
      loadStreaksAndCompletions();
      calendarsApi.list().then((c) => { calendarList = c; }).catch(() => {});
    })();
  });
</script>

<svelte:head>
  <title>{pageTitle('Habits')}</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} onclick={handleWindowClick} />

<div class="page-wrapper">
  <!-- Header -->
  <div class="page-header">
    <h1 class="page-title">Habits</h1>
    <button onclick={openAddForm} class="btn-accent-pill" aria-haspopup="dialog">
      <Plus size={16} strokeWidth={1.5} />
      Add Habit
    </button>
  </div>

  {#if error}
    <div class="alert-error" role="alert">{error}</div>
  {/if}
  {#if success}
    <div class="alert-success" role="alert">{success}</div>
  {/if}

  {#if loading}
    <div class="loading-container" role="status" aria-live="polite">
      <p class="loading-text">Loading...</p>
    </div>
  {:else if habitList.length === 0}
    <!-- Empty State -->
    <div class="empty-state">
      <Repeat size={48} strokeWidth={1.5} style="color: var(--color-text-tertiary);" />
      <h2 class="empty-state-title">No habits yet</h2>
      <p class="empty-state-desc">Create your first habit to start scheduling</p>
      <button onclick={openAddForm} class="btn-accent-pill empty-state-btn" aria-haspopup="dialog">
        <Plus size={16} strokeWidth={1.5} />
        Add Habit
      </button>
    </div>
  {:else}
    <!-- Table -->
    <div role="table" aria-label="Habits list">
      <!-- Table Header -->
      <div class="table-header habits-grid" role="row">
        <span role="columnheader">Name</span>
        <span role="columnheader">Streak</span>
        <span role="columnheader">Priority</span>
        <span role="columnheader" class="hide-mobile">Frequency</span>
        <span role="columnheader" class="hide-mobile">Duration</span>
        <span role="columnheader" class="hide-mobile">Window</span>
        <span role="columnheader">Status</span>
        <span role="columnheader" aria-label="Actions"></span>
      </div>

      <!-- Table Rows -->
      {#each habitList as habit}
        <div
          class="table-row habits-grid"
          role="row"
        >
          <span role="cell" class="name-cell">
            <button class="name-btn" onclick={() => openEditForm(habit)}>{habit.name}</button>
            {#if habit.locked}
              <Lock size={14} strokeWidth={1.5} style="color: var(--color-text-tertiary); flex-shrink: 0;" />
            {/if}
            <button
              class="toggle-btn notification-toggle"
              onclick={(e) => { e.stopPropagation(); toggleNotifications(habit); }}
              aria-label={habit.notifications ? 'Disable notifications' : 'Enable notifications'}
              title={habit.notifications ? 'Notifications on' : 'Notifications off'}
            >
              {#if habit.notifications}
                <Bell size={14} strokeWidth={1.5} style="color: var(--color-accent); flex-shrink: 0;" />
              {:else}
                <BellOff size={14} strokeWidth={1.5} style="color: var(--color-text-tertiary); flex-shrink: 0;" />
              {/if}
            </button>
            {#if habit.dependsOn}
              <span class="dependency-badge" title="Depends on: {getParentName(habit.dependsOn)}">
                <Link2 size={12} strokeWidth={1.5} />
                {getParentName(habit.dependsOn)}
              </span>
            {/if}
          </span>
          <span role="cell">
            {#if (streaks[habit.id] || 0) > 0}
              <span class="streak-badge">
                <Flame size={14} strokeWidth={1.5} />
                {streaks[habit.id]}
              </span>
            {:else}
              <span style="color: var(--color-text-tertiary); font-size: 0.8125rem;">--</span>
            {/if}
          </span>
          <span role="cell">
            <span class="priority-badge priority-{habit.priority}">{priorityLabels[habit.priority]}</span>
          </span>
          <span role="cell" class="hide-mobile freq-cell">{habit.frequency}</span>
          <span role="cell" class="font-mono hide-mobile" style="color: var(--color-text-secondary);">{habit.durationMin}-{habit.durationMax}m</span>
          <span role="cell" class="font-mono hide-mobile" style="color: var(--color-text-secondary);">{habit.windowStart}-{habit.windowEnd}</span>
          <span role="cell">
            <button
              class="toggle-btn"
              onclick={(e) => { e.stopPropagation(); toggleEnabled(habit); }}
              aria-label={habit.enabled ? 'Disable habit' : 'Enable habit'}
            >
              {#if habit.enabled}
                <ToggleRight size={20} strokeWidth={1.5} style="color: var(--color-accent);" />
              {:else}
                <ToggleLeft size={20} strokeWidth={1.5} style="color: var(--color-text-tertiary);" />
              {/if}
            </button>
          </span>
          <span role="cell" class="kebab-cell">
            <button
              class="kebab-btn"
              onclick={(e) => { e.stopPropagation(); confirmingDeleteId = null; menuOpenId = menuOpenId === habit.id ? null : habit.id; }}
              aria-label="Actions for {habit.name}"
              aria-haspopup="menu"
              aria-expanded={menuOpenId === habit.id}
            >
              <EllipsisVertical size={16} strokeWidth={1.5} />
            </button>
            {#if menuOpenId === habit.id}
              <div class="kebab-menu" role="menu" aria-label="Actions for {habit.name}" onclick={(e) => e.stopPropagation()}>
                {#if confirmingDeleteId === habit.id}
                  <span class="confirm-text" role="none">Delete this habit?</span>
                  <button class="kebab-menu-item kebab-menu-item--danger" role="menuitem" onclick={() => deleteHabit(habit.id)}>
                    Confirm
                  </button>
                  <button class="kebab-menu-item" role="menuitem" onclick={() => { confirmingDeleteId = null; }}>
                    Cancel
                  </button>
                {:else}
                  <button class="kebab-menu-item" role="menuitem" onclick={() => { menuOpenId = null; markComplete(habit.id); }}>
                    <CircleCheck size={15} strokeWidth={1.5} />
                    Mark complete
                  </button>
                  <button class="kebab-menu-item" role="menuitem" onclick={() => { menuOpenId = null; openEditForm(habit); }}>
                    <Pencil size={15} strokeWidth={1.5} />
                    Edit
                  </button>
                  <button class="kebab-menu-item kebab-menu-item--danger" role="menuitem" onclick={() => { confirmingDeleteId = habit.id; }}>
                    <Trash2 size={15} strokeWidth={1.5} />
                    Delete
                  </button>
                {/if}
              </div>
            {/if}
          </span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Slide-over Panel -->
{#if showPanel}
  <div class="panel-backdrop" onclick={closePanel} aria-hidden="true"></div>
  <div
    class="panel-slideover"
    role="dialog"
    aria-modal="true"
    aria-labelledby="panel-title"
    tabindex="-1"
    bind:this={panelEl}
    onkeydown={trapFocus}
  >
    <div class="panel-header">
      <h2 id="panel-title" class="panel-title">
        {editingId ? 'Edit Habit' : 'Add Habit'}
      </h2>
      <button onclick={closePanel} class="panel-close-btn" aria-label="Close panel">
        <X size={20} strokeWidth={1.5} />
      </button>
    </div>

    <form
      onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}
      class="panel-body"
    >
      <div class="form-field">
        <label for="habit-name">Name</label>
        <input id="habit-name" type="text" bind:value={formName} required placeholder="e.g., Lunch Break" />
      </div>

      <div class="form-field">
        <label for="habit-priority">Priority</label>
        <select id="habit-priority" bind:value={formPriority}>
          <option value={1}>P1 - Critical</option>
          <option value={2}>P2 - High</option>
          <option value={3}>P3 - Medium</option>
          <option value={4}>P4 - Low</option>
        </select>
      </div>

      <div class="form-field">
        <label>Days</label>
        <div class="day-presets">
          <button
            type="button"
            class="day-preset"
            class:day-preset--active={getActivePreset(formDays) === 'every-day'}
            aria-pressed={getActivePreset(formDays) === 'every-day'}
            onclick={() => { formDays = [...ALL_DAYS]; }}
          >Every day</button>
          <span class="day-preset-sep">&middot;</span>
          <button
            type="button"
            class="day-preset"
            class:day-preset--active={getActivePreset(formDays) === 'weekdays'}
            aria-pressed={getActivePreset(formDays) === 'weekdays'}
            onclick={() => { formDays = [...WEEKDAYS]; }}
          >Weekdays</button>
          <span class="day-preset-sep">&middot;</span>
          <button
            type="button"
            class="day-preset"
            class:day-preset--active={getActivePreset(formDays) === 'weekends'}
            aria-pressed={getActivePreset(formDays) === 'weekends'}
            onclick={() => { formDays = [...WEEKENDS]; }}
          >Weekends</button>
          <span class="day-preset-sep">&middot;</span>
          <button
            type="button"
            class="day-preset"
            class:day-preset--active={getActivePreset(formDays) === 'custom'}
            aria-pressed={getActivePreset(formDays) === 'custom'}
            disabled={getActivePreset(formDays) === 'custom'}
          >Custom</button>
        </div>
        <div class="day-picker">
          {#each ALL_DAYS as day}
            <button
              type="button"
              class="day-pill"
              class:day-pill--active={formDays.includes(day)}
              onclick={() => {
                if (formDays.includes(day)) {
                  if (formDays.length > 1) {
                    formDays = formDays.filter((d) => d !== day);
                  }
                } else {
                  formDays = [...formDays, day];
                }
              }}
              aria-label="{DAY_FULL_LABELS[day]}"
              aria-pressed={formDays.includes(day)}
            >{DAY_LABELS[day]}</button>
          {/each}
        </div>
      </div>

      <fieldset class="form-section">
        <legend class="form-section-header">Duration</legend>
        <span class="form-helper">How long this habit should be (the scheduler picks a duration in this range)</span>
        <div class="form-row">
          <div class="form-field">
            <label for="habit-dur-min">Minimum</label>
            <input id="habit-dur-min" type="number" bind:value={formDurationMin} min="5" max="480" />
          </div>
          <div class="form-field">
            <label for="habit-dur-max">Maximum</label>
            <input id="habit-dur-max" type="number" bind:value={formDurationMax} min="5" max="480" />
          </div>
        </div>
      </fieldset>

      <fieldset class="form-section">
        <legend class="form-section-header">Available time range</legend>
        <span class="form-helper">The time range this habit can be scheduled within</span>
        <div class="form-row">
          <div class="form-field">
            <label for="habit-win-start">Earliest</label>
            <input id="habit-win-start" type="time" bind:value={formWindowStart} />
          </div>
          <div class="form-field">
            <label for="habit-win-end">Latest</label>
            <input id="habit-win-end" type="time" bind:value={formWindowEnd} />
          </div>
        </div>
      </fieldset>

      <div class="form-field">
        <label for="habit-ideal">Preferred time</label>
        <input id="habit-ideal" type="time" bind:value={formIdealTime} />
        <span class="form-helper">The scheduler will try to schedule near this time</span>
      </div>

      <div class="form-field">
        <label for="habit-sched">Schedule during</label>
        <select id="habit-sched" bind:value={formSchedulingHours}>
          <option value="working">Work hours (from settings)</option>
          <option value="personal">Personal hours (from settings)</option>
          <option value="custom">Anytime (custom)</option>
        </select>
        <span class="form-helper">Uses hours from your settings page</span>
      </div>

      {#if calendarList.length > 0}
        <div class="form-field">
          <label for="habit-calendar">Calendar</label>
          <select id="habit-calendar" bind:value={formCalendarId}>
            <option value="">Default</option>
            {#each calendarList as cal}
              <option value={cal.id}>{cal.name}</option>
            {/each}
          </select>
        </div>
      {/if}

      <div class="form-field">
        <label>Color</label>
        <div class="color-picker">
          {#each ['#4285f4', '#ea4335', '#34a853', '#fbbc04', '#ff6d01', '#46bdc6', '#7b61ff', '#e91e63'] as c}
            <button
              type="button"
              class="color-swatch"
              class:color-swatch--active={formColor === c}
              style="background: {c};"
              onclick={() => { formColor = c; }}
              aria-label="Select {colorNames[c] ?? c}"
              aria-pressed={formColor === c}
            ></button>
          {/each}
          <button
            type="button"
            class="color-swatch color-swatch--none"
            class:color-swatch--active={!formColor}
            onclick={() => { formColor = ''; }}
            aria-label="No color"
            aria-pressed={!formColor}
          >&#x2715;</button>
        </div>
      </div>

      <div class="form-toggles">
        <label class="toggle-label">
          <input type="checkbox" bind:checked={formLocked} />
          <span>Locked</span>
        </label>
        <label class="toggle-label">
          <input type="checkbox" bind:checked={formAutoDecline} />
          <span>Auto-decline</span>
        </label>
        <label class="toggle-label">
          <input type="checkbox" bind:checked={formNotifications} />
          <span>Notifications</span>
        </label>
        <label class="toggle-label">
          <input type="checkbox" bind:checked={formSkipBuffer} />
          <span>No buffer time</span>
        </label>
      </div>

      {#if editingId}
        <!-- Last 7 days completion -->
        <div class="completion-section">
          <div class="completion-header">
            <span class="completion-title">Last 7 Days</span>
            {#if (streaks[editingId] || 0) > 0}
              <span class="streak-badge">
                <Flame size={14} strokeWidth={1.5} />
                {streaks[editingId]} day streak
              </span>
            {/if}
          </div>
          <div class="completion-dots">
            {#each getLast7Days() as day}
              <div class="completion-day">
                <div class="completion-dot" class:completed={isDayCompleted(editingId, day)}></div>
                <span class="completion-day-label">{getDayLabel(day)}</span>
              </div>
            {/each}
          </div>
          <button
            type="button"
            class="btn-action"
            onclick={() => { markComplete(editingId!); }}
          >
            <CircleCheck size={16} strokeWidth={1.5} />
            Mark Complete Today
          </button>
        </div>
      {/if}

      <div class="panel-footer">
        <button type="submit" class="btn-save" disabled={submitting}>
          {submitting ? 'Saving...' : 'Save'}
        </button>
        <button type="button" class="btn-cancel" onclick={closePanel}>
          Cancel
        </button>
      </div>
    </form>
  </div>
{/if}

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .page-wrapper {
    padding: var(--space-6);
  }

  .panel-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .loading-container {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-12) 0;
  }

  .loading-text {
    color: var(--color-text-secondary);
  }

  .empty-state-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
    margin-top: var(--space-4);
  }

  .empty-state-desc {
    color: var(--color-text-secondary);
    margin-top: var(--space-2);
  }

  .empty-state-btn {
    margin-top: var(--space-5);
  }

  .habits-grid {
    grid-template-columns: 1fr 60px 80px 100px 120px 140px 60px 40px;
  }

  @include mobile {
    .habits-grid {
      grid-template-columns: 1fr 60px 80px 60px 40px;
    }
  }

  .name-cell {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 500;
    color: var(--color-text);
    overflow: hidden;
  }

  .name-btn {
    @include text-truncate;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: 500;
    color: var(--color-text);
    cursor: pointer;
    text-align: left;

    &:hover {
      color: var(--color-accent);
    }
  }

  .freq-cell {
    color: var(--color-text-secondary);
    text-transform: capitalize;
  }

  .notification-toggle {
    padding: 0;
    flex-shrink: 0;
    line-height: 0;
  }

  .form-toggles {
    display: flex;
    gap: var(--space-6);
    padding: var(--space-2) 0;
    flex-wrap: wrap;
  }

  .streak-badge {
    @include badge;
    gap: 3px;
    padding: 0;
    font-size: 0.8125rem;
    color: var(--color-warning-amber);
  }

  .dependency-badge {
    @include badge;
    gap: 3px;
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--color-text-tertiary);
    padding: 1px 6px;
    border: 1px solid var(--color-border);
    white-space: nowrap;
  }

  .completion-section {
    @include flex-col(var(--space-3));
    padding: var(--space-3) 0;
    border-top: 1px solid var(--color-border);
  }

  .completion-header {
    @include flex-between;
  }

  .completion-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  .completion-dots {
    display: flex;
    gap: var(--space-3);
    justify-content: space-between;
  }

  .completion-day {
    @include flex-col(var(--space-1));
    align-items: center;
  }

  .completion-dot {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    border: 2px solid var(--color-border);
    background: none;
    transition: background var(--transition-fast), border-color var(--transition-fast);

    &.completed {
      background: var(--color-success);
      border-color: var(--color-success);
    }
  }

  .completion-day-label {
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    font-weight: 500;
  }

  .form-section {
    border: none;
    padding: 0;
    margin: 0;
    @include flex-col(var(--space-2));

    &-header {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--color-text);
      padding: 0;
    }
  }

  .form-helper {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
    line-height: 1.4;
  }

  .day-presets {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .day-preset {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: color var(--transition-fast);

    &:hover:not(:disabled) {
      color: var(--color-text);
    }

    &:disabled {
      cursor: default;
      opacity: 0.5;
    }

    &--active {
      color: var(--color-accent);
    }

    &-sep {
      font-size: 0.75rem;
      color: var(--color-border-strong);
      user-select: none;
    }
  }

  .day-picker {
    display: flex;
    gap: var(--space-1);
  }

  .day-pill {
    @include flex-center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    background: none;
    color: var(--color-text-tertiary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);

    &:hover {
      border-color: var(--color-border-strong);
      color: var(--color-text-secondary);
    }

    &--active {
      background: var(--color-accent);
      border-color: var(--color-accent);
      color: var(--color-accent-text);

      &:hover {
        background: var(--color-accent-hover);
        border-color: var(--color-accent-hover);
        color: var(--color-accent-text);
      }
    }
  }
</style>
