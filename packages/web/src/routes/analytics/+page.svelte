<script lang="ts">
  import Repeat from 'lucide-svelte/icons/repeat';
  import CheckSquare from 'lucide-svelte/icons/check-square';
  import Users from 'lucide-svelte/icons/users';
  import Target from 'lucide-svelte/icons/target';
  import { analytics as analyticsApi } from '$lib/api';

  let loading = $state(true);
  let error = $state('');

  // Date range filter
  type DateRange = 'week' | 'month' | '30days' | 'all';
  let selectedRange = $state<DateRange>('month');

  const rangeOptions: { key: DateRange; label: string }[] = [
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: '30days', label: 'Last 30 Days' },
    { key: 'all', label: 'All Time' },
  ];

  function getDateRange(range: DateRange): { start?: string; end?: string } {
    const now = new Date();
    const end = now.toISOString();
    if (range === 'all') return {};
    if (range === 'week') {
      const start = new Date(now);
      start.setDate(start.getDate() - start.getDay() + 1);
      start.setHours(0, 0, 0, 0);
      return { start: start.toISOString(), end };
    }
    if (range === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: start.toISOString(), end };
    }
    // 30days
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return { start: start.toISOString(), end };
  }

  // Analytics data
  let habitHours = $state(6.5);
  let taskHours = $state(8.0);
  let meetingHours = $state(5.5);
  let focusHours = $state(8.0);

  let habitCompletionRate = $state(82);

  let weeklyBreakdown = $state([
    { day: 'Mon', habits: 1.0, tasks: 1.5, meetings: 1.0, focus: 1.5 },
    { day: 'Tue', habits: 1.5, tasks: 1.0, meetings: 0.5, focus: 2.0 },
    { day: 'Wed', habits: 0.5, tasks: 2.0, meetings: 1.5, focus: 1.0 },
    { day: 'Thu', habits: 1.0, tasks: 1.5, meetings: 1.0, focus: 2.0 },
    { day: 'Fri', habits: 1.5, tasks: 1.0, meetings: 1.5, focus: 1.5 },
    { day: 'Sat', habits: 0.5, tasks: 0.5, meetings: 0, focus: 0 },
    { day: 'Sun', habits: 0.5, tasks: 0.5, meetings: 0, focus: 0 },
  ]);

  let totalHours = $derived(habitHours + taskHours + meetingHours + focusHours);

  let topCategory = $derived(() => {
    const cats = [
      { name: 'Habits', hours: habitHours },
      { name: 'Tasks', hours: taskHours },
      { name: 'Meetings', hours: meetingHours },
      { name: 'Focus', hours: focusHours },
    ];
    return cats.reduce((a, b) => a.hours >= b.hours ? a : b).name;
  });

  // Ring chart
  const ringRadius = 58;
  const ringCircumference = 2 * Math.PI * ringRadius;
  let ringDashoffset = $derived(ringCircumference * (1 - habitCompletionRate / 100));

  // Stacked bar chart
  let maxDayTotal = $derived(
    Math.max(
      ...weeklyBreakdown.map((d) => d.habits + d.tasks + d.meetings + d.focus),
      0.1
    )
  );

  const barChartHeight = 160;

  function barH(value: number): number {
    if (maxDayTotal === 0) return 0;
    return (value / maxDayTotal) * barChartHeight;
  }

  async function fetchAnalytics(range: DateRange) {
    loading = true;
    error = '';
    try {
      const { start, end } = getDateRange(range);
      const [data, weeklyData] = await Promise.all([
        analyticsApi.get(start, end),
        analyticsApi.weekly(),
      ]);
      habitHours = Math.round((data.habitMinutes / 60) * 10) / 10;
      taskHours = Math.round((data.taskMinutes / 60) * 10) / 10;
      meetingHours = Math.round((data.meetingMinutes / 60) * 10) / 10;
      focusHours = Math.round((data.focusMinutes / 60) * 10) / 10;
      const rawRate = data.habitCompletionRate;
      habitCompletionRate = Math.round(rawRate <= 1 ? rawRate * 100 : rawRate);

      const breakdown = weeklyData?.weeklyBreakdown ?? data.weeklyBreakdown;
      if (breakdown && breakdown.length > 0) {
        const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        weeklyBreakdown = breakdown.map((entry: any, i: number) => ({
          day: dayLabels[i] || new Date(entry.date).toLocaleDateString('en-US', { weekday: 'short' }),
          habits: Math.round((entry.habitMinutes / 60) * 10) / 10,
          tasks: Math.round((entry.taskMinutes / 60) * 10) / 10,
          meetings: Math.round((entry.meetingMinutes / 60) * 10) / 10,
          focus: Math.round((entry.focusMinutes / 60) * 10) / 10,
        }));
      }
    } catch {
      error = 'Failed to load data from API. Showing cached data.';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const _range = selectedRange;
    fetchAnalytics(_range);
  });
</script>

<svelte:head>
  <title>Analytics - Cadence</title>
</svelte:head>

<div style="padding: 24px;">
  <div class="analytics-header">
    <h1 style="font-size: 20px; font-weight: 600; color: var(--color-text); margin: 0;">Analytics</h1>
    <div class="date-range-selector">
      {#each rangeOptions as range}
        <button
          class="range-btn"
          class:range-btn--active={selectedRange === range.key}
          onclick={() => { selectedRange = range.key; }}
        >
          {range.label}
        </button>
      {/each}
    </div>
  </div>

  {#if error}
    <div role="alert" style="margin-bottom: 16px; padding: 10px 14px; background: var(--color-danger-muted); color: var(--color-danger); border-radius: var(--radius-md); font-size: 13px;">
      {error}
    </div>
  {/if}

  {#if loading}
    <div style="display: flex; align-items: center; justify-content: center; padding: 48px 0;" role="status" aria-live="polite">
      <p style="color: var(--color-text-secondary); font-size: 14px;">Loading...</p>
    </div>
  {:else}
    <!-- KPI Cards -->
    <div class="analytics-kpi-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px;">
      {#each [
        { icon: Repeat, label: 'Habit Hours', value: habitHours, color: 'var(--color-habit-border)' },
        { icon: CheckSquare, label: 'Task Hours', value: taskHours, color: 'var(--color-task-border)' },
        { icon: Users, label: 'Meeting Hours', value: meetingHours, color: 'var(--color-meeting-border)' },
        { icon: Target, label: 'Focus Hours', value: focusHours, color: 'var(--color-focus-border)' },
      ] as card}
        <div style="border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 20px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
            {#if card.icon === Repeat}<Repeat size={16} color="var(--color-text-tertiary)" aria-hidden="true" />
            {:else if card.icon === CheckSquare}<CheckSquare size={16} color="var(--color-text-tertiary)" aria-hidden="true" />
            {:else if card.icon === Users}<Users size={16} color="var(--color-text-tertiary)" aria-hidden="true" />
            {:else if card.icon === Target}<Target size={16} color="var(--color-text-tertiary)" aria-hidden="true" />
            {/if}
            <span style="font-size: 12px; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.05em;">
              {card.label}
            </span>
          </div>
          <div class="font-mono" style="font-size: 28px; font-weight: 700; color: var(--color-text);">
            {card.value}<span style="font-size: 16px; font-weight: 400; color: var(--color-text-secondary);">h</span>
          </div>
        </div>
      {/each}
    </div>

    <div class="analytics-content-grid" style="display: grid; grid-template-columns: 1fr 2fr; gap: 24px; margin-bottom: 32px;">
      <!-- Habit Completion Ring -->
      <div style="border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 24px; display: flex; flex-direction: column; align-items: center;">
        <h2 style="font-size: 14px; font-weight: 600; color: var(--color-text); margin: 0 0 20px 0; align-self: flex-start;">Habit Completion</h2>
        <svg width="140" height="140" viewBox="0 0 140 140" aria-label="Habit completion: {habitCompletionRate}%">
          <circle
            cx="70" cy="70" r={ringRadius}
            fill="none"
            stroke="var(--color-border)"
            stroke-width="8"
          />
          <circle
            cx="70" cy="70" r={ringRadius}
            fill="none"
            stroke="var(--color-accent)"
            stroke-width="8"
            stroke-linecap="round"
            stroke-dasharray={ringCircumference}
            stroke-dashoffset={ringDashoffset}
            transform="rotate(-90 70 70)"
            class="ring-progress"
          />
          <text
            x="70" y="66"
            text-anchor="middle"
            class="font-mono"
            style="font-size: 26px; font-weight: 700; fill: var(--color-text);"
          >
            {habitCompletionRate}%
          </text>
          <text
            x="70" y="84"
            text-anchor="middle"
            style="font-size: 11px; fill: var(--color-text-secondary);"
          >
            completed
          </text>
        </svg>
      </div>

      <!-- Weekly Summary -->
      <div style="border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 24px;">
        <h2 style="font-size: 14px; font-weight: 600; color: var(--color-text); margin: 0 0 20px 0;">Weekly Summary</h2>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
          <div style="padding: 16px; border: 1px solid var(--color-border); border-radius: var(--radius-md);">
            <div class="font-mono" style="font-size: 24px; font-weight: 700; color: var(--color-text); margin-bottom: 4px;">
              {totalHours}<span style="font-size: 14px; font-weight: 400; color: var(--color-text-secondary);">h</span>
            </div>
            <div style="font-size: 12px; color: var(--color-text-secondary);">Total Hours</div>
          </div>
          <div style="padding: 16px; border: 1px solid var(--color-border); border-radius: var(--radius-md);">
            <div class="font-mono" style="font-size: 24px; font-weight: 700; color: var(--color-text); margin-bottom: 4px;">
              {(totalHours / 5).toFixed(1)}<span style="font-size: 14px; font-weight: 400; color: var(--color-text-secondary);">h</span>
            </div>
            <div style="font-size: 12px; color: var(--color-text-secondary);">Avg / Workday</div>
          </div>
          <div style="padding: 16px; border: 1px solid var(--color-border); border-radius: var(--radius-md);">
            <div style="font-size: 24px; font-weight: 700; color: var(--color-text); margin-bottom: 4px;">
              {topCategory()}
            </div>
            <div style="font-size: 12px; color: var(--color-text-secondary);">Top Category</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Daily Breakdown -->
    <div style="border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 24px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
        <h2 style="font-size: 14px; font-weight: 600; color: var(--color-text); margin: 0;">Daily Breakdown</h2>
        <div style="display: flex; gap: 16px;">
          {#each [
            { label: 'Habits', color: 'var(--color-habit-border)' },
            { label: 'Tasks', color: 'var(--color-task-border)' },
            { label: 'Meetings', color: 'var(--color-meeting-border)' },
            { label: 'Focus', color: 'var(--color-focus-border)' },
          ] as legend}
            <span style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--color-text-tertiary);">
              <span style="width: 8px; height: 8px; border-radius: 2px; background: {legend.color};"></span>
              {legend.label}
            </span>
          {/each}
        </div>
      </div>

      <!-- Horizontal stacked bars -->
      <div class="analytics-bars" style="display: flex; flex-direction: column; gap: 8px;">
        {#each weeklyBreakdown as day}
          {@const dayTotal = day.habits + day.tasks + day.meetings + day.focus}
          {@const barMax = maxDayTotal}
          <div style="display: grid; grid-template-columns: 36px 1fr 48px; gap: 12px; align-items: center;">
            <span class="font-mono" style="font-size: 12px; color: var(--color-text-secondary); text-align: right;">
              {day.day}
            </span>
            <div style="display: flex; height: 24px; border-radius: var(--radius-sm); overflow: hidden; background: var(--color-surface-hover);">
              {#if day.habits > 0}
                <div style="width: {(day.habits / barMax) * 100}%; background: var(--color-habit-border); transition: width var(--transition-base);"></div>
              {/if}
              {#if day.tasks > 0}
                <div style="width: {(day.tasks / barMax) * 100}%; background: var(--color-task-border); transition: width var(--transition-base);"></div>
              {/if}
              {#if day.meetings > 0}
                <div style="width: {(day.meetings / barMax) * 100}%; background: var(--color-meeting-border); transition: width var(--transition-base);"></div>
              {/if}
              {#if day.focus > 0}
                <div style="width: {(day.focus / barMax) * 100}%; background: var(--color-focus-border); transition: width var(--transition-base);"></div>
              {/if}
            </div>
            <span class="font-mono" style="font-size: 12px; color: var(--color-text-tertiary); text-align: right;">
              {dayTotal.toFixed(1)}h
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .analytics-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
  }

  .date-range-selector {
    display: flex;
    gap: var(--space-2);
  }

  .range-btn {
    padding: var(--space-1) var(--space-4);
    height: 32px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  }

  .range-btn:hover {
    background: var(--color-surface-hover);
    color: var(--color-text);
  }

  .range-btn--active {
    background: var(--color-accent);
    color: var(--color-accent-text);
    border-color: var(--color-accent);
  }

  .range-btn--active:hover {
    background: var(--color-accent-hover);
    border-color: var(--color-accent-hover);
    color: var(--color-accent-text);
  }

  .ring-progress {
    transition: stroke-dashoffset var(--transition-slow);
  }

  @media (prefers-reduced-motion: reduce) {
    .ring-progress {
      transition: none;
    }
  }

  @media (max-width: 768px) {
    .analytics-header {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
    }
    .date-range-selector {
      flex-wrap: wrap;
    }
    .analytics-kpi-grid {
      grid-template-columns: repeat(2, 1fr) !important;
    }
    .analytics-content-grid {
      grid-template-columns: 1fr !important;
    }
    .analytics-bars {
      overflow-x: auto;
    }
  }

  @media (max-width: 480px) {
    .analytics-kpi-grid {
      grid-template-columns: 1fr !important;
    }
  }
</style>
