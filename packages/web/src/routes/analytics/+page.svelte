<script lang="ts">
  import { onMount } from 'svelte';
  import { analytics as analyticsApi } from '$lib/api';

  let loading = $state(true);
  let error = $state('');

  // Mutable analytics data
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

  let summaryCards = $derived([
    { label: 'Habit Hours', value: habitHours, color: 'text-green-600', bgColor: 'bg-green-50', borderColor: 'border-green-200' },
    { label: 'Task Hours', value: taskHours, color: 'text-blue-600', bgColor: 'bg-blue-50', borderColor: 'border-blue-200' },
    { label: 'Meeting Hours', value: meetingHours, color: 'text-purple-600', bgColor: 'bg-purple-50', borderColor: 'border-purple-200' },
    { label: 'Focus Hours', value: focusHours, color: 'text-orange-600', bgColor: 'bg-orange-50', borderColor: 'border-orange-200' },
  ]);

  // SVG chart constants
  const chartWidth = 700;
  const chartHeight = 200;
  const barGroupWidth = chartWidth / 7;
  const barWidth = barGroupWidth * 0.6;

  let maxDayTotal = $derived(
    Math.max(
      ...weeklyBreakdown.map((d) => d.habits + d.tasks + d.meetings + d.focus)
    )
  );

  function getBarHeight(value: number): number {
    if (maxDayTotal === 0) return 0;
    return (value / maxDayTotal) * (chartHeight - 30);
  }

  // Completion ring
  const ringRadius = 54;
  const ringCircumference = 2 * Math.PI * ringRadius;
  let ringDashoffset = $derived(ringCircumference * (1 - habitCompletionRate / 100));

  onMount(async () => {
    loading = true;
    error = '';
    try {
      const [data, weeklyData] = await Promise.all([
        analyticsApi.get(),
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
  });
</script>

<svelte:head>
  <title>Analytics - Reclaim</title>
</svelte:head>

<div class="p-6">
  <h1 class="text-2xl font-bold text-gray-900 mb-6">Analytics</h1>

  {#if error}
    <div class="mb-4 px-4 py-2 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
  {/if}

  {#if loading}
    <div class="flex items-center justify-center py-12">
      <p class="text-gray-500">Loading...</p>
    </div>
  {:else}
    <!-- Summary Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {#each summaryCards as card}
        <div class="bg-white rounded-lg shadow p-4 border {card.borderColor}">
          <div class="{card.bgColor} rounded-lg p-3 mb-3 inline-block">
            <span class="text-2xl font-bold {card.color}">{card.value}h</span>
          </div>
          <div class="text-sm font-medium text-gray-600">{card.label}</div>
          <div class="text-xs text-gray-400 mt-1">This week</div>
        </div>
      {/each}
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      <!-- Habit Completion Rate -->
      <div class="bg-white rounded-lg shadow p-6 flex flex-col items-center">
        <h2 class="text-lg font-semibold text-gray-900 mb-4 self-start">Habit Completion</h2>
        <div class="relative">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <!-- Background ring -->
            <circle
              cx="70"
              cy="70"
              r={ringRadius}
              fill="none"
              stroke="#e5e7eb"
              stroke-width="10"
            />
            <!-- Progress ring -->
            <circle
              cx="70"
              cy="70"
              r={ringRadius}
              fill="none"
              stroke={habitCompletionRate >= 75 ? '#22c55e' : habitCompletionRate >= 50 ? '#eab308' : '#ef4444'}
              stroke-width="10"
              stroke-linecap="round"
              stroke-dasharray={ringCircumference}
              stroke-dashoffset={ringDashoffset}
              transform="rotate(-90 70 70)"
            />
            <!-- Text -->
            <text
              x="70"
              y="65"
              text-anchor="middle"
              font-size="28"
              font-weight="bold"
              fill="#111827"
            >
              {habitCompletionRate}%
            </text>
            <text
              x="70"
              y="85"
              text-anchor="middle"
              font-size="11"
              fill="#6b7280"
            >
              completed
            </text>
          </svg>
        </div>
        <p class="text-sm text-gray-500 mt-3">
          {Math.round(habitCompletionRate * 7 / 100)} of 7 daily habits completed on average
        </p>
      </div>

      <!-- Weekly Total -->
      <div class="bg-white rounded-lg shadow p-6 lg:col-span-2">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Weekly Summary</h2>
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-gray-50 rounded-lg p-4">
            <div class="text-3xl font-bold text-gray-900">{totalHours}h</div>
            <div class="text-sm text-gray-500">Total scheduled time</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-4">
            <div class="text-3xl font-bold text-gray-900">{(totalHours / 5).toFixed(1)}h</div>
            <div class="text-sm text-gray-500">Average per workday</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-4">
            <div class="text-3xl font-bold text-green-600">{habitHours}h</div>
            <div class="text-sm text-gray-500">Habits (top category)</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-4">
            <div class="text-3xl font-bold text-orange-600">{focusHours}h</div>
            <div class="text-sm text-gray-500">Focus time achieved</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Daily Breakdown Chart -->
    <div class="bg-white rounded-lg shadow p-6">
      <h2 class="text-lg font-semibold text-gray-900 mb-4">Daily Breakdown</h2>

      <!-- Legend -->
      <div class="flex gap-4 mb-4 text-sm">
        <span class="flex items-center gap-1.5">
          <span class="w-3 h-3 rounded bg-green-500 inline-block"></span> Habits
        </span>
        <span class="flex items-center gap-1.5">
          <span class="w-3 h-3 rounded bg-blue-500 inline-block"></span> Tasks
        </span>
        <span class="flex items-center gap-1.5">
          <span class="w-3 h-3 rounded bg-purple-500 inline-block"></span> Meetings
        </span>
        <span class="flex items-center gap-1.5">
          <span class="w-3 h-3 rounded bg-orange-500 inline-block"></span> Focus
        </span>
      </div>

      <!-- Stacked Bar Chart (Inline SVG) -->
      <svg viewBox="0 0 {chartWidth} {chartHeight + 30}" class="w-full" style="max-height: 280px">
        {#each weeklyBreakdown as day, i}
          {@const x = i * barGroupWidth + (barGroupWidth - barWidth) / 2}
          {@const hHabits = getBarHeight(day.habits)}
          {@const hTasks = getBarHeight(day.tasks)}
          {@const hMeetings = getBarHeight(day.meetings)}
          {@const hFocus = getBarHeight(day.focus)}
          {@const totalH = hHabits + hTasks + hMeetings + hFocus}
          {@const baseY = chartHeight - 5}

          <!-- Focus (bottom) -->
          <rect
            x={x}
            y={baseY - hFocus}
            width={barWidth}
            height={hFocus}
            rx="2"
            fill="#f97316"
          />
          <!-- Meetings -->
          <rect
            x={x}
            y={baseY - hFocus - hMeetings}
            width={barWidth}
            height={hMeetings}
            rx="0"
            fill="#a855f7"
          />
          <!-- Tasks -->
          <rect
            x={x}
            y={baseY - hFocus - hMeetings - hTasks}
            width={barWidth}
            height={hTasks}
            rx="0"
            fill="#3b82f6"
          />
          <!-- Habits (top) -->
          <rect
            x={x}
            y={baseY - totalH}
            width={barWidth}
            height={hHabits}
            rx="2"
            fill="#22c55e"
          />

          <!-- Day label -->
          <text
            x={x + barWidth / 2}
            y={chartHeight + 15}
            text-anchor="middle"
            font-size="12"
            fill="#6b7280"
          >
            {day.day}
          </text>

          <!-- Total label on top -->
          {#if totalH > 0}
            <text
              x={x + barWidth / 2}
              y={baseY - totalH - 5}
              text-anchor="middle"
              font-size="10"
              fill="#9ca3af"
            >
              {(day.habits + day.tasks + day.meetings + day.focus).toFixed(1)}h
            </text>
          {/if}
        {/each}
      </svg>
    </div>
  {/if}
</div>
