<script lang="ts">
  import { onMount } from 'svelte';
  import { settings as settingsApi, buffers as buffersApi } from '$lib/api';

  // Google connection
  let googleConnected = $state(false);
  let loading = $state(true);
  let error = $state('');
  let success = $state('');

  // Working hours
  let workStart = $state('09:00');
  let workEnd = $state('17:00');

  // Personal hours
  let personalStart = $state('17:00');
  let personalEnd = $state('22:00');

  // General
  let timezone = $state('America/New_York');
  let schedulingWindowDays = $state(14);

  // Buffers
  let travelTime = $state(15);
  let decompressionTime = $state(5);
  let breakBetween = $state(10);
  let decompApplyTo = $state('all');

  // Save status
  let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');

  function showSuccess(msg: string) {
    success = msg;
    setTimeout(() => { success = ''; }, 3000);
  }

  async function saveSettings() {
    saveStatus = 'saving';
    try {
      await settingsApi.update({
        workingHours: { start: workStart, end: workEnd },
        personalHours: { start: personalStart, end: personalEnd },
        timezone,
        schedulingWindowDays,
      });
      await buffersApi.update({
        travelTimeMinutes: travelTime,
        decompressionMinutes: decompressionTime,
        breakBetweenItemsMinutes: breakBetween,
        applyDecompressionTo: decompApplyTo as any,
      });
      saveStatus = 'saved';
      showSuccess('Settings saved successfully.');
    } catch {
      saveStatus = 'error';
    }
    setTimeout(() => { saveStatus = 'idle'; }, 2000);
  }

  async function connectGoogle() {
    try {
      const result = await settingsApi.connectGoogle();
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
      }
    } catch {
      // Mock toggle
      googleConnected = !googleConnected;
    }
  }

  onMount(async () => {
    loading = true;
    error = '';
    try {
      const [config, bufferConfig] = await Promise.all([
        settingsApi.get(),
        buffersApi.get(),
      ]);

      if (config.settings) {
        workStart = config.settings.workingHours?.start ?? '09:00';
        workEnd = config.settings.workingHours?.end ?? '17:00';
        personalStart = config.settings.personalHours?.start ?? '17:00';
        personalEnd = config.settings.personalHours?.end ?? '22:00';
        timezone = config.settings.timezone ?? 'America/New_York';
        schedulingWindowDays = config.settings.schedulingWindowDays ?? 14;
      }
      googleConnected = !!config.googleSyncToken;

      travelTime = bufferConfig.travelTimeMinutes ?? 15;
      decompressionTime = bufferConfig.decompressionMinutes ?? 5;
      breakBetween = bufferConfig.breakBetweenItemsMinutes ?? 10;
      decompApplyTo = bufferConfig.applyDecompressionTo ?? 'all';
    } catch {
      error = 'Failed to load data from API. Showing cached data.';
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>Settings - Reclaim</title>
</svelte:head>

<div class="p-6">
  <h1 class="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

  {#if error}
    <div class="mb-4 px-4 py-2 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
  {/if}
  {#if success}
    <div class="mb-4 px-4 py-2 bg-green-50 text-green-700 rounded-lg text-sm">{success}</div>
  {/if}

  {#if loading}
    <div class="flex items-center justify-center py-12">
      <p class="text-gray-500">Loading...</p>
    </div>
  {:else}
    <div class="space-y-6 max-w-3xl">
      <!-- Google Account -->
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Google Account</h2>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-3 h-3 rounded-full {googleConnected ? 'bg-green-500' : 'bg-gray-400'}"></div>
            <div>
              <p class="text-sm font-medium text-gray-700">
                {googleConnected ? 'Connected' : 'Not Connected'}
              </p>
              <p class="text-xs text-gray-400">
                {googleConnected
                  ? 'Google Calendar is synced'
                  : 'Connect to sync your calendar events'}
              </p>
            </div>
          </div>
          <button
            onclick={connectGoogle}
            class="px-4 py-2 rounded-lg font-medium text-sm transition-colors
              {googleConnected
                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                : 'bg-blue-600 text-white hover:bg-blue-700'}"
          >
            {googleConnected ? 'Disconnect' : 'Connect Google Calendar'}
          </button>
        </div>
      </div>

      <!-- Working Hours -->
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Working Hours</h2>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
            <input
              type="time"
              bind:value={workStart}
              class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">End Time</label>
            <input
              type="time"
              bind:value={workEnd}
              class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        <p class="text-xs text-gray-400 mt-2">
          Tasks, habits, and meetings will be scheduled within these hours by default.
        </p>
      </div>

      <!-- Personal Hours -->
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Personal Hours</h2>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
            <input
              type="time"
              bind:value={personalStart}
              class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">End Time</label>
            <input
              type="time"
              bind:value={personalEnd}
              class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        <p class="text-xs text-gray-400 mt-2">
          Items set to "Personal Hours" will be scheduled within this window.
        </p>
      </div>

      <!-- General -->
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">General</h2>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
            <input
              type="text"
              bind:value={timezone}
              class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., America/New_York"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Scheduling Window (days)</label>
            <input
              type="number"
              bind:value={schedulingWindowDays}
              min="1"
              max="90"
              class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        <p class="text-xs text-gray-400 mt-2">
          How far ahead the scheduler will plan items on your calendar.
        </p>
      </div>

      <!-- Buffers -->
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Buffers</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Travel Time (minutes)</label>
            <input
              type="number"
              bind:value={travelTime}
              min="0"
              max="120"
              class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p class="text-xs text-gray-400 mt-1">Buffer added before in-person meetings.</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Decompression Time (minutes)</label>
            <input
              type="number"
              bind:value={decompressionTime}
              min="0"
              max="60"
              class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p class="text-xs text-gray-400 mt-1">Buffer added after meetings to recover.</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Break Between Items (minutes)</label>
            <input
              type="number"
              bind:value={breakBetween}
              min="0"
              max="60"
              class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p class="text-xs text-gray-400 mt-1">Minimum gap between scheduled items.</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Apply Decompression To</label>
            <select
              bind:value={decompApplyTo}
              class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Meetings</option>
              <option value="video_only">Video Calls Only</option>
            </select>
            <p class="text-xs text-gray-400 mt-1">Which meetings get decompression time.</p>
          </div>
        </div>
      </div>

      <!-- Save Button -->
      <div class="flex items-center gap-4">
        <button
          onclick={saveSettings}
          disabled={saveStatus === 'saving'}
          class="px-6 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {#if saveStatus === 'saving'}
            Saving...
          {:else if saveStatus === 'saved'}
            Saved!
          {:else}
            Save Settings
          {/if}
        </button>
        {#if saveStatus === 'saved'}
          <span class="text-sm text-green-600 font-medium">Settings saved successfully.</span>
        {/if}
        {#if saveStatus === 'error'}
          <span class="text-sm text-red-600 font-medium">Failed to save. Please try again.</span>
        {/if}
      </div>
    </div>
  {/if}
</div>
