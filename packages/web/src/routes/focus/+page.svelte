<script lang="ts">
  import { focusTime as focusApi } from '$lib/api';

  // Config state
  let weeklyTarget = $state(10);
  let dailyTarget = $state(2);
  let schedulingHours = $state('working');
  let enabled = $state(true);

  // Mock progress data
  let weeklyActual = $state(8);
  let dailyBreakdown = $state([
    { day: 'Mon', hours: 1.5 },
    { day: 'Tue', hours: 2.0 },
    { day: 'Wed', hours: 1.0 },
    { day: 'Thu', hours: 2.0 },
    { day: 'Fri', hours: 1.5 },
    { day: 'Sat', hours: 0 },
    { day: 'Sun', hours: 0 },
  ]);

  $effect(() => {
    weeklyActual = dailyBreakdown.reduce((sum, d) => sum + d.hours, 0);
  });

  function getProgressPercent(): number {
    if (weeklyTarget <= 0) return 0;
    return Math.min(100, Math.round((weeklyActual / weeklyTarget) * 100));
  }

  function getProgressColor(pct: number): string {
    if (pct >= 75) return 'bg-green-500';
    if (pct >= 50) return 'bg-yellow-500';
    return 'bg-red-500';
  }

  function getProgressTextColor(pct: number): string {
    if (pct >= 75) return 'text-green-600';
    if (pct >= 50) return 'text-yellow-600';
    return 'text-red-600';
  }

  async function saveConfig() {
    try {
      await focusApi.update({
        weeklyTargetMinutes: weeklyTarget * 60,
        dailyTargetMinutes: dailyTarget * 60,
        schedulingHours: schedulingHours as any,
        enabled,
      });
    } catch {
      // Mock save - already reflected in state
    }
  }
</script>

<div class="p-6">
  <h1 class="text-2xl font-bold text-gray-900 mb-6">Focus Time</h1>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- Configuration Panel -->
    <div class="bg-white rounded-lg shadow p-6">
      <h2 class="text-lg font-semibold text-gray-900 mb-4">Configuration</h2>

      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium text-gray-700">Enable Focus Time</label>
          <button
            onclick={() => { enabled = !enabled; }}
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors
              {enabled ? 'bg-blue-600' : 'bg-gray-300'}"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                {enabled ? 'translate-x-6' : 'translate-x-1'}"
            ></span>
          </button>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">
            Weekly Target (hours)
          </label>
          <input
            type="number"
            bind:value={weeklyTarget}
            min="0"
            max="60"
            step="0.5"
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">
            Daily Target (hours)
          </label>
          <input
            type="number"
            bind:value={dailyTarget}
            min="0"
            max="12"
            step="0.5"
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">
            Scheduling Hours
          </label>
          <select
            bind:value={schedulingHours}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="working">Working Hours</option>
            <option value="personal">Personal Hours</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        <button
          onclick={saveConfig}
          class="w-full px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors mt-2"
        >
          Save Configuration
        </button>
      </div>
    </div>

    <!-- Progress Panel -->
    <div class="space-y-6">
      <!-- Weekly Progress -->
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">This Week</h2>

        {#if true}
        {@const pct = getProgressPercent()}

        <div class="text-center mb-4">
          <div class="text-4xl font-bold {getProgressTextColor(pct)}">
            {pct}%
          </div>
          <div class="text-sm text-gray-500 mt-1">
            {weeklyActual}h / {weeklyTarget}h target
          </div>
        </div>

        <!-- Progress Bar -->
        <div class="w-full h-4 bg-gray-200 rounded-full overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-500 {getProgressColor(pct)}"
            style="width: {pct}%"
          ></div>
        </div>

        <div class="flex justify-between text-xs text-gray-400 mt-1">
          <span>0h</span>
          <span>{weeklyTarget}h</span>
        </div>
        {/if}
      </div>

      <!-- Daily Breakdown -->
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Daily Breakdown</h2>

        <div class="flex items-end gap-2 h-40">
          {#each dailyBreakdown as day}
            {@const maxH = Math.max(...dailyBreakdown.map((d) => d.hours), dailyTarget)}
            {@const barHeight = maxH > 0 ? (day.hours / maxH) * 100 : 0}
            <div class="flex-1 flex flex-col items-center">
              <div class="w-full flex flex-col justify-end" style="height: 120px">
                <div
                  class="w-full rounded-t-md transition-all duration-300
                    {day.hours >= dailyTarget ? 'bg-green-500' : day.hours > 0 ? 'bg-orange-400' : 'bg-gray-200'}"
                  style="height: {barHeight}%"
                ></div>
              </div>
              <div class="text-xs font-medium text-gray-600 mt-2">{day.day}</div>
              <div class="text-xs text-gray-400">{day.hours}h</div>
            </div>
          {/each}
        </div>

        <!-- Target line indicator -->
        <div class="mt-3 flex items-center gap-2 text-xs text-gray-500">
          <div class="w-3 h-0.5 bg-green-500"></div>
          <span>Met daily target ({dailyTarget}h)</span>
          <div class="w-3 h-0.5 bg-orange-400 ml-2"></div>
          <span>Below target</span>
        </div>
      </div>
    </div>
  </div>
</div>
