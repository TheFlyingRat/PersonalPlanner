<script lang="ts">
  import { onMount } from 'svelte';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import Check from 'lucide-svelte/icons/check';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import { settings as settingsApi, buffers as buffersApi, calendars as calendarsApi, schedule as scheduleApi } from '$lib/api';

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

  // Calendars
  let calendarList = $state<any[]>([]);
  let discoveringCalendars = $state(false);
  let defaultHabitCalendarId = $state('primary');
  let defaultTaskCalendarId = $state('primary');

  // Save status
  let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Nuke status
  let nuking = $state(false);

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
        defaultHabitCalendarId,
        defaultTaskCalendarId,
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

  async function discoverCalendars() {
    discoveringCalendars = true;
    try {
      calendarList = await calendarsApi.discover();
      showSuccess('Calendars refreshed from Google.');
    } catch {
      error = 'Failed to discover calendars.';
    } finally {
      discoveringCalendars = false;
    }
  }

  async function toggleCalendar(cal: any) {
    try {
      const updated = await calendarsApi.update(cal.id, { enabled: !cal.enabled });
      calendarList = calendarList.map(c => c.id === cal.id ? updated : c);
    } catch {
      error = 'Failed to update calendar.';
    }
  }

  async function setCalendarMode(cal: any, mode: string) {
    try {
      const updated = await calendarsApi.update(cal.id, { mode });
      calendarList = calendarList.map(c => c.id === cal.id ? updated : c);
    } catch {
      error = 'Failed to update calendar mode.';
    }
  }

  async function nukeAllManagedEvents() {
    if (!confirm('This will permanently delete ALL Cadence-managed events from your Google Calendar. This cannot be undone. Continue?')) return;
    nuking = true;
    error = '';
    try {
      const result = await scheduleApi.deleteAllManaged();
      showSuccess(`Deleted ${result.googleEventsDeleted} events from Google Calendar and ${result.localEventsDeleted} from local database.`);
    } catch {
      error = 'Failed to delete managed events.';
    } finally {
      nuking = false;
    }
  }

  async function connectGoogle() {
    try {
      const result = await settingsApi.connectGoogle();
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
      }
    } catch {
      error = 'Failed to initiate Google connection.';
    }
  }

  onMount(async () => {
    loading = true;
    error = '';
    try {
      const [config, bufferConfig, cals, authStatus] = await Promise.all([
        settingsApi.get(),
        buffersApi.get(),
        calendarsApi.list(),
        settingsApi.getGoogleStatus(),
      ]);

      calendarList = cals;
      googleConnected = authStatus.connected;

      if (config.settings) {
        workStart = config.settings.workingHours?.start ?? '09:00';
        workEnd = config.settings.workingHours?.end ?? '17:00';
        personalStart = config.settings.personalHours?.start ?? '17:00';
        personalEnd = config.settings.personalHours?.end ?? '22:00';
        timezone = config.settings.timezone ?? 'America/New_York';
        schedulingWindowDays = config.settings.schedulingWindowDays ?? 14;
        defaultHabitCalendarId = config.settings.defaultHabitCalendarId ?? 'primary';
        defaultTaskCalendarId = config.settings.defaultTaskCalendarId ?? 'primary';
      }

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
  <title>Settings - Cadence</title>
</svelte:head>

<div style="padding: 24px; max-width: 720px;">
  <h1 style="font-size: 20px; font-weight: 600; color: var(--color-text); margin: 0 0 24px 0;">Settings</h1>

  {#if error}
    <div role="alert" style="margin-bottom: 16px; padding: 10px 14px; background: var(--color-danger-muted); color: var(--color-danger); border-radius: var(--radius-md); font-size: 13px;">
      {error}
    </div>
  {/if}
  {#if success}
    <div role="alert" style="margin-bottom: 16px; padding: 10px 14px; background: var(--color-success-muted); color: var(--color-success); border-radius: var(--radius-md); font-size: 13px;">
      {success}
    </div>
  {/if}

  {#if loading}
    <div style="display: flex; align-items: center; justify-content: center; padding: 48px 0;" role="status" aria-live="polite">
      <p style="color: var(--color-text-secondary); font-size: 14px;">Loading...</p>
    </div>
  {:else}
    <div style="display: flex; flex-direction: column;">

      <!-- Google Account -->
      <div style="padding: 32px 0;">
        <h2 style="font-size: 14px; font-weight: 600; color: var(--color-text); margin: 0 0 16px 0;">Google Account</h2>
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span
              aria-hidden="true"
              style="width: 8px; height: 8px; border-radius: var(--radius-full); background: {googleConnected ? 'var(--color-success)' : 'var(--color-danger)'};"
            ></span>
            <span style="font-size: 14px; color: var(--color-text);">
              {googleConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <button
            onclick={connectGoogle}
            style="padding: 6px 14px; font-size: 13px; font-weight: 500; border-radius: var(--radius-md);
              border: 1px solid var(--color-border-strong); background: transparent; color: var(--color-text);
              cursor: pointer; transition: background var(--transition-fast);"
            onmouseenter={(e) => e.currentTarget.style.background = 'var(--color-surface-hover)'}
            onmouseleave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            {googleConnected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
      </div>

      <div style="height: 1px; background: var(--color-border);"></div>

      <!-- Calendars -->
      {#if googleConnected}
        <div style="padding: 32px 0;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
            <h2 style="font-size: 14px; font-weight: 600; color: var(--color-text); margin: 0;">Calendars</h2>
            <button
              onclick={discoverCalendars}
              disabled={discoveringCalendars}
              style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; font-size: 13px; font-weight: 500;
                border-radius: var(--radius-md); border: 1px solid var(--color-border-strong); background: transparent;
                color: var(--color-text-secondary); cursor: pointer; transition: background var(--transition-fast);
                opacity: {discoveringCalendars ? '0.5' : '1'};"
              onmouseenter={(e) => { if (!discoveringCalendars) e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
              onmouseleave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <RefreshCw size={14} style={discoveringCalendars ? 'animation: spin 1s linear infinite;' : ''} />
              {discoveringCalendars ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {#if calendarList.length === 0}
            <p style="font-size: 13px; color: var(--color-text-tertiary);">No calendars found. Click Refresh to discover your calendars.</p>
          {:else}
            <!-- Calendar table -->
            <div style="border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden;">
              {#each calendarList as cal, i}
                <div
                  style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;
                    {i > 0 ? 'border-top: 1px solid var(--color-border);' : ''}"
                >
                  <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                    <span style="width: 10px; height: 10px; border-radius: var(--radius-full); flex-shrink: 0; background: {cal.color ?? 'var(--color-accent)'};">
                    </span>
                    <span style="font-size: 13px; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                      {cal.name}
                    </span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
                    {#if cal.enabled && cal.googleCalendarId !== 'primary'}
                      <select
                        value={cal.mode}
                        onchange={(e) => setCalendarMode(cal, e.currentTarget.value)}
                        style="font-size: 12px; padding: 4px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm);
                          background: var(--color-surface); color: var(--color-text-secondary); cursor: pointer;"
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
                        style="position: relative; width: 36px; height: 20px; border-radius: var(--radius-full); border: none;
                          background: {cal.enabled ? 'var(--color-accent)' : 'var(--color-border-strong)'}; cursor: pointer;
                          transition: background var(--transition-fast);"
                      >
                        <span
                          style="position: absolute; top: 2px; left: {cal.enabled ? '18px' : '2px'}; width: 16px; height: 16px;
                            border-radius: var(--radius-full); background: white; transition: left var(--transition-fast);"
                        ></span>
                      </button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>

            <!-- Default Calendars -->
            <div style="margin-top: 20px;">
              <h3 style="font-size: 13px; font-weight: 600; color: var(--color-text-secondary); margin: 0 0 12px 0;">Default Calendars</h3>
              <div class="settings-default-cals" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div>
                  <label for="default-habit-cal" style="display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 6px;">Habits</label>
                  <select
                    id="default-habit-cal"
                    bind:value={defaultHabitCalendarId}
                    style="width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid var(--color-border);
                      border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text);
                      cursor: pointer;"
                  >
                    {#each calendarList.filter(c => c.enabled && c.mode === 'writable') as cal}
                      <option value={cal.id}>{cal.name}</option>
                    {/each}
                  </select>
                </div>
                <div>
                  <label for="default-task-cal" style="display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 6px;">Tasks</label>
                  <select
                    id="default-task-cal"
                    bind:value={defaultTaskCalendarId}
                    style="width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid var(--color-border);
                      border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text);
                      cursor: pointer;"
                  >
                    {#each calendarList.filter(c => c.enabled && c.mode === 'writable') as cal}
                      <option value={cal.id}>{cal.name}</option>
                    {/each}
                  </select>
                </div>
              </div>
            </div>
          {/if}
        </div>

        <div style="height: 1px; background: var(--color-border);"></div>
      {/if}

      <!-- Working Hours -->
      <div style="padding: 32px 0;">
        <h2 style="font-size: 14px; font-weight: 600; color: var(--color-text); margin: 0 0 16px 0;">Working Hours</h2>
        <div class="settings-hours-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: end;">
          <div>
            <label for="work-start" style="display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 6px;">Start</label>
            <input
              id="work-start"
              type="time"
              bind:value={workStart}
              class="font-mono"
              style="width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid var(--color-border);
                border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text);"
            />
          </div>
          <div>
            <label for="work-end" style="display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 6px;">End</label>
            <input
              id="work-end"
              type="time"
              bind:value={workEnd}
              class="font-mono"
              style="width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid var(--color-border);
                border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text);"
            />
          </div>
        </div>
      </div>

      <div style="height: 1px; background: var(--color-border);"></div>

      <!-- Personal Hours -->
      <div style="padding: 32px 0;">
        <h2 style="font-size: 14px; font-weight: 600; color: var(--color-text); margin: 0 0 16px 0;">Personal Hours</h2>
        <div class="settings-hours-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: end;">
          <div>
            <label for="personal-start" style="display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 6px;">Start</label>
            <input
              id="personal-start"
              type="time"
              bind:value={personalStart}
              class="font-mono"
              style="width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid var(--color-border);
                border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text);"
            />
          </div>
          <div>
            <label for="personal-end" style="display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 6px;">End</label>
            <input
              id="personal-end"
              type="time"
              bind:value={personalEnd}
              class="font-mono"
              style="width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid var(--color-border);
                border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text);"
            />
          </div>
        </div>
      </div>

      <div style="height: 1px; background: var(--color-border);"></div>

      <!-- General -->
      <div style="padding: 32px 0;">
        <h2 style="font-size: 14px; font-weight: 600; color: var(--color-text); margin: 0 0 16px 0;">General</h2>
        <div class="settings-hours-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div>
            <label for="settings-timezone" style="display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 6px;">Timezone</label>
            <select
              id="settings-timezone"
              bind:value={timezone}
              style="width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid var(--color-border);
                border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text);"
            >
              {#each Intl.supportedValuesOf('timeZone') as tz}
                <option value={tz}>{tz.replace(/_/g, ' ')}</option>
              {/each}
            </select>
          </div>
          <div>
            <label for="settings-window" style="display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 6px;">Scheduling Window</label>
            <div style="display: flex; align-items: center; gap: 8px;">
              <input
                id="settings-window"
                type="number"
                bind:value={schedulingWindowDays}
                min="1"
                max="90"
                class="font-mono"
                style="flex: 1; padding: 8px 10px; font-size: 13px; border: 1px solid var(--color-border);
                  border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text);"
              />
              <span style="font-size: 13px; color: var(--color-text-secondary);">days</span>
            </div>
          </div>
        </div>
      </div>

      <div style="height: 1px; background: var(--color-border);"></div>

      <!-- Buffers -->
      <div style="padding: 32px 0;">
        <h2 style="font-size: 14px; font-weight: 600; color: var(--color-text); margin: 0 0 16px 0;">Buffers</h2>
        <div class="settings-buffers-grid" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 16px;">
          <div>
            <label for="buffer-travel" style="display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 6px;">Travel (min)</label>
            <input
              id="buffer-travel"
              type="number"
              bind:value={travelTime}
              min="0"
              max="120"
              class="font-mono"
              style="width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid var(--color-border);
                border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text);"
            />
          </div>
          <div>
            <label for="buffer-decomp" style="display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 6px;">Decompression (min)</label>
            <input
              id="buffer-decomp"
              type="number"
              bind:value={decompressionTime}
              min="0"
              max="60"
              class="font-mono"
              style="width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid var(--color-border);
                border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text);"
            />
          </div>
          <div>
            <label for="buffer-break" style="display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 6px;">Break (min)</label>
            <input
              id="buffer-break"
              type="number"
              bind:value={breakBetween}
              min="0"
              max="60"
              class="font-mono"
              style="width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid var(--color-border);
                border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text);"
            />
          </div>
        </div>
        <div>
          <label for="buffer-decomp-apply" style="display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 6px;">Apply Decompression To</label>
          <select
            id="buffer-decomp-apply"
            bind:value={decompApplyTo}
            style="padding: 8px 10px; font-size: 13px; border: 1px solid var(--color-border);
              border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); cursor: pointer;"
          >
            <option value="all">All Meetings</option>
            <option value="video_only">Video Calls Only</option>
          </select>
        </div>
      </div>
      <!-- Danger Zone -->
      {#if googleConnected}
        <div style="height: 1px; background: var(--color-border);"></div>

        <div style="padding: 32px 0;">
          <h2 style="font-size: 14px; font-weight: 600; color: var(--color-danger); margin: 0 0 8px 0;">Danger Zone</h2>
          <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0 0 16px 0;">
            Delete all Cadence-managed events from your Google Calendar. This removes every event the app created but does not affect your regular calendar events.
          </p>
          <button
            onclick={nukeAllManagedEvents}
            disabled={nuking}
            style="padding: 8px 16px; font-size: 13px; font-weight: 500; border-radius: var(--radius-md);
              border: 1px solid var(--color-danger); background: transparent; color: var(--color-danger);
              cursor: pointer; transition: background var(--transition-fast), color var(--transition-fast);
              opacity: {nuking ? '0.6' : '1'};"
            onmouseenter={(e) => { if (!nuking) { e.currentTarget.style.background = 'var(--color-danger)'; e.currentTarget.style.color = 'white'; } }}
            onmouseleave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-danger)'; }}
          >
            {nuking ? 'Deleting...' : 'Delete All Managed Events'}
          </button>
        </div>
      {/if}
    </div>

    <!-- Sticky Save Button -->
    <div style="position: sticky; bottom: 0; padding: 16px 0; background: var(--color-bg); border-top: 1px solid var(--color-border); margin-top: 8px;">
      <button
        onclick={saveSettings}
        disabled={saveStatus === 'saving'}
        style="width: 100%; padding: 10px 0; font-size: 14px; font-weight: 500; border: none;
          border-radius: var(--radius-md); cursor: pointer;
          background: {saveStatus === 'saved' ? 'var(--color-success)' : 'var(--color-accent)'};
          color: var(--color-accent-text);
          opacity: {saveStatus === 'saving' ? '0.7' : '1'};
          transition: background var(--transition-fast), opacity var(--transition-fast);"
        onmouseenter={(e) => { if (saveStatus === 'idle') e.currentTarget.style.background = 'var(--color-accent-hover)'; }}
        onmouseleave={(e) => { if (saveStatus === 'idle') e.currentTarget.style.background = 'var(--color-accent)'; }}
      >
        <span style="display: inline-flex; align-items: center; gap: 6px;">
          {#if saveStatus === 'saving'}
            <Loader2 size={16} style="animation: spin 1s linear infinite;" />
            Saving...
          {:else if saveStatus === 'saved'}
            <Check size={16} />
            Saved
          {:else if saveStatus === 'error'}
            Failed -- Retry
          {:else}
            Save Settings
          {/if}
        </span>
      </button>
    </div>
  {/if}
</div>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  input:focus, select:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px var(--color-accent-muted);
  }

  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    opacity: 1;
  }

  @include mobile {
    .settings-buffers-grid {
      grid-template-columns: 1fr !important;
    }
    .settings-hours-grid {
      grid-template-columns: 1fr !important;
    }
    .settings-default-cals {
      grid-template-columns: 1fr !important;
    }
  }
</style>
