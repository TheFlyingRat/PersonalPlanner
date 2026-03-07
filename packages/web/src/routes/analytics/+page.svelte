<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import Repeat from 'lucide-svelte/icons/repeat';
  import CheckSquare from 'lucide-svelte/icons/check-square';
  import Users from 'lucide-svelte/icons/users';
  import Target from 'lucide-svelte/icons/target';
  import { analytics as analyticsApi, schedule } from '$lib/api';
  import type { AnalyticsData, QualityScore } from '@cadence/shared';
  import Gauge from 'lucide-svelte/icons/gauge';

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

  function getWorkdayDivisor(range: DateRange): number {
    const now = new Date();
    if (range === 'week') {
      // Weekdays elapsed so far this week (Mon=1 ... Fri=5, Sat/Sun cap at 5)
      const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...6=Sat
      if (dayOfWeek === 0) return 5; // Sunday: full week passed
      if (dayOfWeek === 6) return 5; // Saturday: all 5 weekdays passed
      return Math.max(dayOfWeek, 1); // Mon=1, Tue=2, ...Fri=5
    }
    if (range === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      let weekdays = 0;
      const cursor = new Date(start);
      while (cursor <= now) {
        const d = cursor.getDay();
        if (d !== 0 && d !== 6) weekdays++;
        cursor.setDate(cursor.getDate() + 1);
      }
      return Math.max(weekdays, 1);
    }
    if (range === '30days') {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      let weekdays = 0;
      const cursor = new Date(start);
      while (cursor <= now) {
        const d = cursor.getDay();
        if (d !== 0 && d !== 6) weekdays++;
        cursor.setDate(cursor.getDate() + 1);
      }
      return Math.max(weekdays, 1);
    }
    // 'all' — not meaningful, return 0 to signal hiding the stat
    return 0;
  }

  function minutesToHours(minutes: number): number {
    return Math.round((minutes / 60) * 10) / 10;
  }

  // Analytics data — initialized to 0
  let habitHours = $state(0);
  let taskHours = $state(0);
  let meetingHours = $state(0);
  let focusHours = $state(0);

  let habitCompletionRate = $state(0);

  interface WeeklyBreakdownEntry {
    day: string;
    habits: number;
    tasks: number;
    meetings: number;
    focus: number;
  }

  let weeklyBreakdown = $state<WeeklyBreakdownEntry[]>([]);

  let totalHours = $derived(habitHours + taskHours + meetingHours + focusHours);

  let workdayDivisor = $derived(getWorkdayDivisor(selectedRange));

  let topCategory = $derived(
    [
      { name: 'Habits', hours: habitHours },
      { name: 'Tasks', hours: taskHours },
      { name: 'Meetings', hours: meetingHours },
      { name: 'Focus', hours: focusHours },
    ].reduce((a, b) => (a.hours >= b.hours ? a : b)).name
  );

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

  async function fetchAnalytics(range: DateRange) {
    loading = true;
    error = '';
    try {
      const { start, end } = getDateRange(range);
      const data = await analyticsApi.get(start, end);
      habitHours = minutesToHours(data.habitMinutes);
      taskHours = minutesToHours(data.taskMinutes);
      meetingHours = minutesToHours(data.meetingMinutes);
      focusHours = minutesToHours(data.focusMinutes);
      const rawRate = data.habitCompletionRate;
      habitCompletionRate = Math.round(rawRate <= 1 ? rawRate * 100 : rawRate);

      const breakdown = data.weeklyBreakdown;
      if (breakdown && breakdown.length > 0) {
        const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        weeklyBreakdown = breakdown.map((entry: AnalyticsData['weeklyBreakdown'][number], i: number) => ({
          day: dayLabels[i] || new Date(entry.date).toLocaleDateString('en-US', { weekday: 'short' }),
          habits: minutesToHours(entry.habitMinutes),
          tasks: minutesToHours(entry.taskMinutes),
          meetings: minutesToHours(entry.meetingMinutes),
          focus: minutesToHours(entry.focusMinutes),
        }));
      }
    } catch (err) {
      console.error(err);
      error = 'Could not load analytics data.';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    fetchAnalytics(selectedRange);
  });

  // Quality Score Trend (last 7 days)
  interface DayQuality {
    day: string;
    score: number;
  }

  let qualityTrend = $state<DayQuality[]>([]);
  let qualityLoading = $state(true);

  function qualityColor(score: number): string {
    if (score >= 90) return 'var(--color-success)';
    if (score >= 70) return 'var(--color-accent)';
    if (score >= 50) return 'var(--color-warning-amber)';
    return 'var(--color-danger)';
  }

  async function fetchQualityTrend() {
    qualityLoading = true;
    try {
      const days: DayQuality[] = [];
      const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const now = new Date();

      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        try {
          const q = await schedule.getQuality(dateStr);
          const dow = d.getDay();
          days.push({ day: dayLabels[dow === 0 ? 6 : dow - 1], score: q.overall });
        } catch {
          const dow = d.getDay();
          days.push({ day: dayLabels[dow === 0 ? 6 : dow - 1], score: 0 });
        }
      }
      qualityTrend = days;
    } catch {
      qualityTrend = [];
    } finally {
      qualityLoading = false;
    }
  }

  let maxQuality = $derived(Math.max(...qualityTrend.map(d => d.score), 1));
  let avgQuality = $derived(
    qualityTrend.length > 0
      ? Math.round(qualityTrend.reduce((s, d) => s + d.score, 0) / qualityTrend.length)
      : 0,
  );

  $effect(() => {
    fetchQualityTrend();
  });
</script>

<svelte:head>
  <title>{pageTitle('Analytics')}</title>
</svelte:head>

<div class="analytics-page">
  <div class="page-header">
    <h1 class="page-title">Analytics</h1>
    <div class="date-range-selector" role="group" aria-label="Date range">
      {#each rangeOptions as range}
        <button
          class="range-btn"
          class:range-btn--active={selectedRange === range.key}
          aria-pressed={selectedRange === range.key}
          onclick={() => { selectedRange = range.key; }}
        >
          {range.label}
        </button>
      {/each}
    </div>
  </div>

  {#if error}
    <div class="analytics-error" role="alert">
      {error}
    </div>
  {/if}

  {#if loading}
    <div class="analytics-loading" role="status" aria-live="polite">
      <p>Loading...</p>
    </div>
  {:else}
    <!-- KPI Cards -->
    <div class="analytics-kpi-grid">
      {#each [
        { icon: Repeat, label: 'Habit Hours', value: habitHours, color: 'var(--color-habit-border)' },
        { icon: CheckSquare, label: 'Task Hours', value: taskHours, color: 'var(--color-task-border)' },
        { icon: Users, label: 'Meeting Hours', value: meetingHours, color: 'var(--color-meeting-border)' },
        { icon: Target, label: 'Focus Hours', value: focusHours, color: 'var(--color-focus-border)' },
      ] as card}
        {@const Icon = card.icon}
        <div class="kpi-card">
          <div class="kpi-label-row">
            <Icon size={16} color="var(--color-text-tertiary)" aria-hidden="true" />
            <span class="kpi-label">
              {card.label}
            </span>
          </div>
          <div class="kpi-value font-mono">
            {card.value}<span class="kpi-unit">h</span>
          </div>
        </div>
      {/each}
    </div>

    <div class="analytics-content-grid">
      <!-- Habit Completion Ring -->
      <div class="ring-card">
        <h2 class="section-heading">Habit Completion</h2>
        <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Habit completion: {habitCompletionRate}%">
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
            class="ring-value font-mono"
            aria-hidden="true"
          >
            {habitCompletionRate}%
          </text>
          <text
            x="70" y="84"
            text-anchor="middle"
            class="ring-label-text"
            aria-hidden="true"
          >
            completed
          </text>
        </svg>
      </div>

      <!-- Weekly Summary -->
      <div class="summary-card">
        <h2 class="section-heading">Weekly Summary</h2>
        <div class="summary-grid">
          <div class="summary-stat">
            <div class="summary-value font-mono">
              {totalHours}<span class="summary-unit">h</span>
            </div>
            <div class="summary-label">Total Hours</div>
          </div>
          {#if workdayDivisor > 0}
            <div class="summary-stat">
              <div class="summary-value font-mono">
                {(totalHours / workdayDivisor).toFixed(1)}<span class="summary-unit">h</span>
              </div>
              <div class="summary-label">Avg / Workday</div>
            </div>
          {/if}
          <div class="summary-stat">
            <div class="summary-top-cat">
              {topCategory}
            </div>
            <div class="summary-label">Top Category</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Daily Breakdown -->
    <div class="breakdown-card">
      <div class="breakdown-header">
        <h2 class="section-heading">Daily Breakdown</h2>
        <div class="legend">
          {#each [
            { label: 'Habits', color: 'var(--color-habit-border)' },
            { label: 'Tasks', color: 'var(--color-task-border)' },
            { label: 'Meetings', color: 'var(--color-meeting-border)' },
            { label: 'Focus', color: 'var(--color-focus-border)' },
          ] as legend}
            <span class="legend-item">
              <span class="legend-swatch" style="background: {legend.color};" aria-hidden="true"></span>
              {legend.label}
            </span>
          {/each}
        </div>
      </div>

      <!-- Horizontal stacked bars -->
      <ul class="analytics-bars" role="list">
        {#each weeklyBreakdown as day}
          {@const dayTotal = day.habits + day.tasks + day.meetings + day.focus}
          <li class="bar-row" aria-label="{day.day}: {dayTotal.toFixed(1)} hours total - Habits {day.habits}h, Tasks {day.tasks}h, Meetings {day.meetings}h, Focus {day.focus}h">
            <span class="bar-day font-mono">
              {day.day}
            </span>
            <div class="bar-track">
              {#if day.habits > 0}
                <div class="bar-segment bar-segment--habits" style="width: {(day.habits / maxDayTotal) * 100}%;"></div>
              {/if}
              {#if day.tasks > 0}
                <div class="bar-segment bar-segment--tasks" style="width: {(day.tasks / maxDayTotal) * 100}%;"></div>
              {/if}
              {#if day.meetings > 0}
                <div class="bar-segment bar-segment--meetings" style="width: {(day.meetings / maxDayTotal) * 100}%;"></div>
              {/if}
              {#if day.focus > 0}
                <div class="bar-segment bar-segment--focus" style="width: {(day.focus / maxDayTotal) * 100}%;"></div>
              {/if}
            </div>
            <span class="bar-total font-mono">
              {dayTotal.toFixed(1)}h
            </span>
          </li>
        {/each}
      </ul>
    </div>

    <!-- Schedule Quality Trend -->
    <div class="quality-trend-card">
      <div class="breakdown-header">
        <h2 class="section-heading">Schedule Quality (7-day trend)</h2>
        {#if !qualityLoading && qualityTrend.length > 0}
          <span class="quality-avg font-mono">
            Avg: {avgQuality}
          </span>
        {/if}
      </div>

      {#if qualityLoading}
        <div class="quality-trend-loading">Loading...</div>
      {:else if qualityTrend.length > 0}
        <ul class="quality-trend-bars" role="list">
          {#each qualityTrend as day}
            <li class="quality-bar-row" aria-label="{day.day}: score {day.score}">
              <span class="bar-day font-mono">{day.day}</span>
              <div class="bar-track">
                <div
                  class="quality-bar-fill"
                  style="width: {(day.score / 100) * 100}%; background: {qualityColor(day.score)}"
                ></div>
              </div>
              <span class="bar-total font-mono">{day.score}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="quality-trend-empty">No quality data available.</p>
      {/if}
    </div>
  {/if}
</div>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .analytics-page {
    padding: var(--space-6);
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

    &:hover {
      background: var(--color-surface-hover);
      color: var(--color-text);
    }

    &--active {
      background: var(--color-accent);
      color: var(--color-accent-text);
      border-color: var(--color-accent);

      &:hover {
        background: var(--color-accent-hover);
        border-color: var(--color-accent-hover);
        color: var(--color-accent-text);
      }
    }
  }

  .analytics-error {
    margin-bottom: var(--space-4);
    padding: var(--space-2) var(--space-4);
    background: var(--color-danger-muted);
    color: var(--color-danger);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
  }

  .analytics-loading {
    @include flex-center;
    padding: var(--space-12) 0;
    color: var(--color-text-secondary);
    font-size: 0.875rem;
  }

  .analytics-kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-4);
    margin-bottom: var(--space-8);
  }

  .kpi-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
  }

  .kpi-label-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .kpi-label {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .kpi-value {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--color-text);
  }

  .kpi-unit {
    font-size: 1rem;
    font-weight: 400;
    color: var(--color-text-secondary);
  }

  .analytics-content-grid {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: var(--space-6);
    margin-bottom: var(--space-8);
  }

  .ring-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-5) 0;
    align-self: flex-start;
  }

  .ring-value {
    font-size: 26px;
    font-weight: 700;
    fill: var(--color-text);
  }

  .ring-label-text {
    font-size: 11px;
    fill: var(--color-text-secondary);
  }

  .ring-progress {
    @include ring-progress;
  }

  .summary-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
  }

  .summary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--space-4);
  }

  .summary-stat {
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .summary-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--color-text);
    margin-bottom: var(--space-1);
  }

  .summary-unit {
    font-size: 0.875rem;
    font-weight: 400;
    color: var(--color-text-secondary);
  }

  .summary-top-cat {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--color-text);
    margin-bottom: var(--space-1);
  }

  .summary-label {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .breakdown-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
  }

  .breakdown-header {
    @include flex-between;
    margin-bottom: var(--space-5);
  }

  .legend {
    display: flex;
    gap: var(--space-4);
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
  }

  .legend-swatch {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .analytics-bars {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .bar-row {
    display: grid;
    grid-template-columns: 36px 1fr 48px;
    gap: var(--space-3);
    align-items: center;
  }

  .bar-day {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    text-align: right;
  }

  .bar-track {
    display: flex;
    height: 24px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--color-surface-hover);
  }

  .bar-segment {
    transition: width var(--transition-base);

    &--habits { background: var(--color-habit-border); }
    &--tasks { background: var(--color-task-border); }
    &--meetings { background: var(--color-meeting-border); }
    &--focus { background: var(--color-focus-border); }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  }

  .bar-total {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
    text-align: right;
  }

  @include mobile {
    :global(.page-header) {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
    }
    .date-range-selector {
      flex-wrap: wrap;
    }
    .analytics-kpi-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    .analytics-content-grid {
      grid-template-columns: 1fr;
    }
    .analytics-bars {
      overflow-x: auto;
    }
  }

  @include small {
    .analytics-kpi-grid {
      grid-template-columns: 1fr;
    }
  }

  // Quality Trend
  .quality-trend-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    margin-top: var(--space-8);
  }

  .quality-avg {
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--color-text);
  }

  .quality-trend-bars {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .quality-bar-row {
    display: grid;
    grid-template-columns: 36px 1fr 32px;
    gap: var(--space-3);
    align-items: center;
  }

  .quality-bar-fill {
    height: 100%;
    border-radius: var(--radius-sm);
    transition: width var(--transition-base);
  }

  .quality-trend-loading,
  .quality-trend-empty {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    padding: var(--space-4) 0;
  }
</style>
