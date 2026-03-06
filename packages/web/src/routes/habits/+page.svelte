<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { habits as habitsApi, calendars as calendarsApi } from '$lib/api';
  import type { HabitCompletion, Calendar } from '../../../../shared/src/types';
  import Plus from 'lucide-svelte/icons/plus';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import X from 'lucide-svelte/icons/x';
  import Lock from 'lucide-svelte/icons/lock';
  import Unlock from 'lucide-svelte/icons/unlock';
  import Repeat from 'lucide-svelte/icons/repeat';
  import ToggleLeft from 'lucide-svelte/icons/toggle-left';
  import ToggleRight from 'lucide-svelte/icons/toggle-right';
  import Flame from 'lucide-svelte/icons/flame';
  import Link2 from 'lucide-svelte/icons/link-2';
  import CircleCheck from 'lucide-svelte/icons/circle-check';
  import EllipsisVertical from 'lucide-svelte/icons/ellipsis-vertical';

  interface HabitItem {
    id: string;
    name: string;
    priority: number;
    windowStart: string;
    windowEnd: string;
    idealTime: string;
    durationMin: number;
    durationMax: number;
    frequency: string;
    frequencyConfig?: { days?: string[] };
    schedulingHours: string;
    locked: boolean;
    autoDecline: boolean;
    enabled: boolean;
    dependsOn?: string | null;
  }

  const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const DAY_LABELS: Record<string, string> = {
    mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S', sun: 'S',
  };
  const DAY_FULL_LABELS: Record<string, string> = {
    mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
  };
  const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const WEEKENDS = ['sat', 'sun'];

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

  function daysFromHabit(habit: HabitItem): string[] {
    if (habit.frequencyConfig?.days?.length) return [...habit.frequencyConfig.days];
    if (habit.frequency === 'daily') return [...ALL_DAYS];
    if (habit.frequency === 'weekly') return ['mon'];
    return [...WEEKDAYS];
  }

  // Mock data
  const mockHabits: HabitItem[] = [
    {
      id: '1',
      name: 'Lunch Break',
      priority: 1,
      windowStart: '11:30',
      windowEnd: '13:30',
      idealTime: '12:00',
      durationMin: 30,
      durationMax: 60,
      frequency: 'daily',
      schedulingHours: 'working',
      locked: true,
      autoDecline: true,
      enabled: true,
    },
    {
      id: '2',
      name: 'Morning Exercise',
      priority: 2,
      windowStart: '06:00',
      windowEnd: '09:00',
      idealTime: '07:00',
      durationMin: 30,
      durationMax: 60,
      frequency: 'daily',
      schedulingHours: 'personal',
      locked: false,
      autoDecline: false,
      enabled: true,
    },
    {
      id: '3',
      name: 'Weekly Review',
      priority: 3,
      windowStart: '14:00',
      windowEnd: '17:00',
      idealTime: '15:00',
      durationMin: 45,
      durationMax: 60,
      frequency: 'weekly',
      schedulingHours: 'working',
      locked: false,
      autoDecline: false,
      enabled: true,
    },
  ];

  let habitList = $state<HabitItem[]>(mockHabits);
  let showPanel = $state(false);
  let editingId = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');
  let success = $state('');
  let submitting = $state(false);
  let menuOpenId = $state<string | null>(null);

  // Calendar list
  let calendarList = $state<Calendar[]>([]);

  // Streak and completion tracking
  let streaks = $state<Record<string, number>>({});
  let completions = $state<Record<string, HabitCompletion[]>>({});

  function getLast7Days(): string[] {
    const days: string[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
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
    for (const habit of habitList) {
      try {
        const [streakData, completionData] = await Promise.all([
          habitsApi.getStreak(habit.id),
          habitsApi.getCompletions(habit.id),
        ]);
        streaks = { ...streaks, [habit.id]: streakData.streak };
        completions = { ...completions, [habit.id]: completionData };
      } catch {
        // API not available yet, keep defaults
      }
    }
  }

  async function markComplete(habitId: string) {
    const today = new Date().toISOString().split('T')[0];
    try {
      await habitsApi.markComplete(habitId, today);
      const [streakData, completionData] = await Promise.all([
        habitsApi.getStreak(habitId),
        habitsApi.getCompletions(habitId),
      ]);
      streaks = { ...streaks, [habitId]: streakData.streak };
      completions = { ...completions, [habitId]: completionData };
      showSuccess('Habit marked complete.');
    } catch {
      // Optimistic update for offline
      const now = new Date().toISOString();
      const existing = completions[habitId] || [];
      completions = {
        ...completions,
        [habitId]: [...existing, { id: crypto.randomUUID(), habitId, scheduledDate: today, completedAt: now }],
      };
      streaks = { ...streaks, [habitId]: (streaks[habitId] || 0) + 1 };
      showSuccess('Habit marked complete (offline).');
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
  let formFrequency = $state('daily');
  let formDays = $state<string[]>([...WEEKDAYS]);
  let formSchedulingHours = $state('working');
  let formLocked = $state(false);
  let formAutoDecline = $state(false);
  let formSkipBuffer = $state(false);
  let formCalendarId = $state('');
  let formColor = $state('');

  let panelEl = $state<HTMLDivElement | null>(null);

  const priorityLabels: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };

  function showSuccess(msg: string) {
    success = msg;
    setTimeout(() => { success = ''; }, 3000);
  }

  function resetForm() {
    formName = '';
    formPriority = 3;
    formWindowStart = '09:00';
    formWindowEnd = '17:00';
    formIdealTime = '10:00';
    formDurationMin = 30;
    formDurationMax = 60;
    formFrequency = 'daily';
    formDays = [...WEEKDAYS];
    formSchedulingHours = 'working';
    formLocked = false;
    formAutoDecline = false;
    formSkipBuffer = false;
    formCalendarId = '';
    formColor = '';
    editingId = null;
  }

  function openAddForm() {
    resetForm();
    showPanel = true;
    tick().then(() => focusFirstInPanel());
  }

  function openEditForm(habit: HabitItem) {
    editingId = habit.id;
    formName = habit.name;
    formPriority = habit.priority;
    formWindowStart = habit.windowStart;
    formWindowEnd = habit.windowEnd;
    formIdealTime = habit.idealTime;
    formDurationMin = habit.durationMin;
    formDurationMax = habit.durationMax;
    formFrequency = habit.frequency;
    formDays = daysFromHabit(habit);
    formSchedulingHours = habit.schedulingHours;
    formLocked = habit.locked;
    formAutoDecline = habit.autoDecline;
    formSkipBuffer = (habit as any).skipBuffer ?? false;
    formCalendarId = (habit as any).calendarId ?? '';
    formColor = (habit as any).color ?? '';
    showPanel = true;
    tick().then(() => focusFirstInPanel());
  }

  function closePanel() {
    showPanel = false;
    resetForm();
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
      if (menuOpenId) { menuOpenId = null; return; }
      if (showPanel) closePanel();
    }
  }

  function handleWindowClick() {
    if (menuOpenId) menuOpenId = null;
  }

  async function handleSubmit() {
    submitting = true;
    const allSelected = arraysEqual(formDays, [...ALL_DAYS]);
    const weekdaysSelected = arraysEqual(formDays, WEEKDAYS);
    const mappedFrequency = (allSelected || weekdaysSelected) ? 'daily' : 'custom';
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
      skipBuffer: formSkipBuffer,
      calendarId: formCalendarId || undefined,
      color: formColor || undefined,
    };

    try {
      if (editingId) {
        await habitsApi.update(editingId, habitData as any);
      } else {
        await habitsApi.create(habitData as any);
      }
      const list = await habitsApi.list();
      habitList = list as any;
      showSuccess(editingId ? 'Habit updated successfully.' : 'Habit created successfully.');
    } catch {
      // API unavailable - use mock data
      if (editingId) {
        habitList = habitList.map((h) =>
          h.id === editingId ? { ...h, ...habitData } : h
        );
        showSuccess('Habit updated (offline).');
      } else {
        habitList = [
          ...habitList,
          { id: crypto.randomUUID(), ...habitData, enabled: true },
        ];
        showSuccess('Habit created (offline).');
      }
    } finally {
      submitting = false;
    }

    closePanel();
  }

  async function toggleLock(habit: HabitItem) {
    try {
      await habitsApi.lock(habit.id, !habit.locked);
      const list = await habitsApi.list();
      habitList = list as any;
    } catch {
      habitList = habitList.map((h) =>
        h.id === habit.id ? { ...h, locked: !h.locked } : h
      );
    }
  }

  async function toggleEnabled(habit: HabitItem) {
    const updated = { ...habit, enabled: !habit.enabled };
    try {
      await habitsApi.update(habit.id, updated as any);
      const list = await habitsApi.list();
      habitList = list as any;
    } catch {
      habitList = habitList.map((h) =>
        h.id === habit.id ? { ...h, enabled: !h.enabled } : h
      );
    }
  }

  async function deleteHabit(id: string) {
    if (!confirm('Are you sure you want to delete this habit?')) return;
    try {
      await habitsApi.delete(id);
      const list = await habitsApi.list();
      habitList = list as any;
      showSuccess('Habit deleted successfully.');
    } catch {
      habitList = habitList.filter((h) => h.id !== id);
      showSuccess('Habit deleted (offline).');
    }
  }

  onMount(async () => {
    loading = true;
    error = '';
    try {
      const list = await habitsApi.list();
      habitList = list as any;
    } catch {
      error = 'Failed to load data from API. Showing cached data.';
    } finally {
      loading = false;
    }
    loadStreaksAndCompletions();
    calendarsApi.list().then((c) => { calendarList = c; }).catch(() => {});
  });
</script>

<svelte:head>
  <title>Habits - Cadence</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} onclick={handleWindowClick} />

<div style="padding: var(--space-6);">
  <!-- Header -->
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-6);">
    <h1 style="font-size: 1.5rem; font-weight: 600; color: var(--color-text);">Habits</h1>
    <button onclick={openAddForm} class="btn-accent-pill" aria-expanded={showPanel}>
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
    <div style="display: flex; align-items: center; justify-content: center; padding: var(--space-12) 0;" role="status" aria-live="polite">
      <p style="color: var(--color-text-secondary);">Loading...</p>
    </div>
  {:else if habitList.length === 0}
    <!-- Empty State -->
    <div class="empty-state">
      <Repeat size={48} strokeWidth={1.5} style="color: var(--color-text-tertiary);" />
      <h2 style="font-size: 1.125rem; font-weight: 600; color: var(--color-text); margin-top: var(--space-4);">No habits yet</h2>
      <p style="color: var(--color-text-secondary); margin-top: var(--space-2);">Create your first habit to start scheduling</p>
      <button onclick={openAddForm} class="btn-accent-pill" style="margin-top: var(--space-5);">
        <Plus size={16} strokeWidth={1.5} />
        Add Habit
      </button>
    </div>
  {:else}
    <!-- Table Header -->
    <div class="table-header" style="grid-template-columns: 1fr 60px 80px 100px 120px 140px 60px 40px;">
      <span>Name</span>
      <span>Streak</span>
      <span>Priority</span>
      <span>Frequency</span>
      <span>Duration</span>
      <span>Window</span>
      <span>Status</span>
      <span></span>
    </div>

    <!-- Table Rows -->
    {#each habitList as habit}
      <div
        class="table-row"
        style="grid-template-columns: 1fr 60px 80px 100px 120px 140px 60px 40px;"
        onclick={() => openEditForm(habit)}
        role="button"
        tabindex="0"
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditForm(habit); } }}
      >
        <span style="display: flex; align-items: center; gap: var(--space-2); font-weight: 500; color: var(--color-text); overflow: hidden;">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{habit.name}</span>
          {#if habit.locked}
            <Lock size={14} strokeWidth={1.5} style="color: var(--color-text-tertiary); flex-shrink: 0;" />
          {/if}
          {#if habit.dependsOn}
            <span class="dependency-badge" title="Depends on: {getParentName(habit.dependsOn)}">
              <Link2 size={12} strokeWidth={1.5} />
              {getParentName(habit.dependsOn)}
            </span>
          {/if}
        </span>
        <span>
          {#if (streaks[habit.id] || 0) > 0}
            <span class="streak-badge">
              <Flame size={14} strokeWidth={1.5} />
              {streaks[habit.id]}
            </span>
          {:else}
            <span style="color: var(--color-text-tertiary); font-size: 0.8125rem;">--</span>
          {/if}
        </span>
        <span>
          <span class="priority-badge priority-{habit.priority}">{priorityLabels[habit.priority]}</span>
        </span>
        <span style="color: var(--color-text-secondary); text-transform: capitalize;">{habit.frequency}</span>
        <span class="font-mono" style="color: var(--color-text-secondary);">{habit.durationMin}-{habit.durationMax}m</span>
        <span class="font-mono" style="color: var(--color-text-secondary);">{habit.windowStart}-{habit.windowEnd}</span>
        <span>
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
        <span class="kebab-cell">
          <button
            class="kebab-btn"
            onclick={(e) => { e.stopPropagation(); menuOpenId = menuOpenId === habit.id ? null : habit.id; }}
            aria-label="Actions"
            aria-haspopup="true"
            aria-expanded={menuOpenId === habit.id}
          >
            <EllipsisVertical size={16} strokeWidth={1.5} />
          </button>
          {#if menuOpenId === habit.id}
            <div class="kebab-menu" onclick={(e) => e.stopPropagation()}>
              <button class="kebab-menu-item" onclick={() => { menuOpenId = null; markComplete(habit.id); }}>
                <CircleCheck size={15} strokeWidth={1.5} />
                Mark complete
              </button>
              <button class="kebab-menu-item" onclick={() => { menuOpenId = null; openEditForm(habit); }}>
                <Pencil size={15} strokeWidth={1.5} />
                Edit
              </button>
              <button class="kebab-menu-item kebab-menu-item--danger" onclick={() => { menuOpenId = null; deleteHabit(habit.id); }}>
                <Trash2 size={15} strokeWidth={1.5} />
                Delete
              </button>
            </div>
          {/if}
        </span>
      </div>
    {/each}
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
      <h2 id="panel-title" style="font-size: 1.125rem; font-weight: 600; color: var(--color-text);">
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
            onclick={() => { formDays = [...ALL_DAYS]; }}
          >Every day</button>
          <span class="day-preset-sep">&middot;</span>
          <button
            type="button"
            class="day-preset"
            class:day-preset--active={getActivePreset(formDays) === 'weekdays'}
            onclick={() => { formDays = [...WEEKDAYS]; }}
          >Weekdays</button>
          <span class="day-preset-sep">&middot;</span>
          <button
            type="button"
            class="day-preset"
            class:day-preset--active={getActivePreset(formDays) === 'weekends'}
            onclick={() => { formDays = [...WEEKENDS]; }}
          >Weekends</button>
          <span class="day-preset-sep">&middot;</span>
          <button
            type="button"
            class="day-preset"
            class:day-preset--active={getActivePreset(formDays) === 'custom'}
            onclick={() => { /* already custom, no-op */ }}
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
              aria-label="Select color {c}"
            ></button>
          {/each}
          <button
            type="button"
            class="color-swatch color-swatch--none"
            class:color-swatch--active={!formColor}
            onclick={() => { formColor = ''; }}
            aria-label="No color"
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

  .form-toggles {
    display: flex;
    gap: var(--space-6);
    padding: var(--space-2) 0;
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

    &:hover {
      color: var(--color-text);
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
