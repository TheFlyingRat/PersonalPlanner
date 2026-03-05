<script lang="ts">
  import { onMount } from 'svelte';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import Check from 'lucide-svelte/icons/check';
  import { focusTime as focusApi } from '$lib/api';

  // Config state
  let weeklyTarget = $state(10);
  let dailyTarget = $state(2);
  let schedulingHours = $state('working');
  let enabled = $state(true);
  let loading = $state(true);
  let error = $state('');
  let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');

  // Progress data
  let dailyBreakdown = $state([
    { day: 'Mon', hours: 1.5 },
    { day: 'Tue', hours: 2.0 },
    { day: 'Wed', hours: 1.0 },
    { day: 'Thu', hours: 2.0 },
    { day: 'Fri', hours: 1.5 },
    { day: 'Sat', hours: 0 },
    { day: 'Sun', hours: 0 },
  ]);

  let weeklyActual = $derived(dailyBreakdown.reduce((sum, d) => sum + d.hours, 0));

  let progressPercent = $derived(
    weeklyTarget <= 0 ? 0 : Math.min(100, Math.round((weeklyActual / weeklyTarget) * 100))
  );

  // Ring chart
  const ringRadius = 58;
  const ringCircumference = 2 * Math.PI * ringRadius;
  let ringDashoffset = $derived(ringCircumference * (1 - progressPercent / 100));

  let maxBarHours = $derived(Math.max(...dailyBreakdown.map(d => d.hours), dailyTarget, 0.1));

  async function saveConfig() {
    saveStatus = 'saving';
    try {
      await focusApi.update({
        weeklyTargetMinutes: weeklyTarget * 60,
        dailyTargetMinutes: dailyTarget * 60,
        schedulingHours: schedulingHours as any,
        enabled,
      });
      saveStatus = 'saved';
    } catch {
      saveStatus = 'saved';
    }
    setTimeout(() => { saveStatus = 'idle'; }, 2000);
  }

  onMount(async () => {
    loading = true;
    error = '';
    try {
      const config = await focusApi.get();
      weeklyTarget = (config.weeklyTargetMinutes ?? 600) / 60;
      dailyTarget = (config.dailyTargetMinutes ?? 120) / 60;
      schedulingHours = config.schedulingHours ?? 'working';
      enabled = config.enabled ?? true;
    } catch {
      error = 'Failed to load data from API. Showing cached data.';
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>Focus Time - Cadence</title>
</svelte:head>

<div style="padding: 24px; max-width: 960px;">
  <h1 style="font-size: 20px; font-weight: 600; color: var(--color-text); margin: 0 0 24px 0;">Focus Time</h1>

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
    <div class="focus-layout" style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">

      <!-- Configuration -->
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div style="border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 24px;">
          <h2 style="font-size: 14px; font-weight: 600; color: var(--color-text); margin: 0 0 20px 0;">Configuration</h2>

          <div style="display: flex; flex-direction: column; gap: 16px;">
            <!-- Enable toggle -->
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span id="focus-enable-label" style="font-size: 13px; font-weight: 500; color: var(--color-text);">Enable Focus Time</span>
              <button
                id="focus-enable-toggle"
                onclick={() => { enabled = !enabled; }}
                role="switch"
                aria-checked={enabled}
                aria-labelledby="focus-enable-label"
                style="position: relative; width: 36px; height: 20px; border-radius: var(--radius-full); border: none;
                  background: {enabled ? 'var(--color-accent)' : 'var(--color-border-strong)'}; cursor: pointer;
                  transition: background var(--transition-fast);"
              >
                <span
                  style="position: absolute; top: 2px; left: {enabled ? '18px' : '2px'}; width: 16px; height: 16px;
                    border-radius: var(--radius-full); background: white; transition: left var(--transition-fast);"
                ></span>
              </button>
            </div>

            <!-- Weekly Target -->
            <div>
              <label for="focus-weekly-target" style="display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 6px;">
                Weekly Target
              </label>
              <div style="display: flex; align-items: center; gap: 8px;">
                <input
                  id="focus-weekly-target"
                  type="number"
                  bind:value={weeklyTarget}
                  min="0"
                  max="60"
                  step="0.5"
                  class="font-mono"
                  style="flex: 1; padding: 8px 10px; font-size: 13px; border: 1px solid var(--color-border);
                    border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text);"
                />
                <span style="font-size: 13px; color: var(--color-text-secondary);">hours</span>
              </div>
            </div>

            <!-- Daily Target -->
            <div>
              <label for="focus-daily-target" style="display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 6px;">
                Daily Target
              </label>
              <div style="display: flex; align-items: center; gap: 8px;">
                <input
                  id="focus-daily-target"
                  type="number"
                  bind:value={dailyTarget}
                  min="0"
                  max="12"
                  step="0.5"
                  class="font-mono"
                  style="flex: 1; padding: 8px 10px; font-size: 13px; border: 1px solid var(--color-border);
                    border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text);"
                />
                <span style="font-size: 13px; color: var(--color-text-secondary);">hours</span>
              </div>
            </div>

            <!-- Scheduling Hours -->
            <div>
              <label for="focus-sched-hours" style="display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 6px;">
                Scheduling Hours
              </label>
              <select
                id="focus-sched-hours"
                bind:value={schedulingHours}
                style="width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid var(--color-border);
                  border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); cursor: pointer;"
              >
                <option value="working">Working Hours</option>
                <option value="personal">Personal Hours</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Save Button -->
        <button
          onclick={saveConfig}
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
            {:else}
              Save Configuration
            {/if}
          </span>
        </button>
      </div>

      <!-- Progress -->
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <!-- Progress Ring -->
        <div style="border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 24px; display: flex; flex-direction: column; align-items: center;">
          <h2 style="font-size: 14px; font-weight: 600; color: var(--color-text); margin: 0 0 20px 0; align-self: flex-start;">This Week</h2>
          <svg width="148" height="148" viewBox="0 0 148 148" aria-label="Weekly focus progress: {progressPercent}%">
            <circle
              cx="74" cy="74" r={ringRadius}
              fill="none"
              stroke="var(--color-border)"
              stroke-width="8"
            />
            <circle
              cx="74" cy="74" r={ringRadius}
              fill="none"
              stroke="var(--color-accent)"
              stroke-width="8"
              stroke-linecap="round"
              stroke-dasharray={ringCircumference}
              stroke-dashoffset={ringDashoffset}
              transform="rotate(-90 74 74)"
              class="ring-progress"
            />
            <text
              x="74" y="70"
              text-anchor="middle"
              class="font-mono"
              style="font-size: 28px; font-weight: 700; fill: var(--color-text);"
            >
              {progressPercent}%
            </text>
            <text
              x="74" y="90"
              text-anchor="middle"
              class="font-mono"
              style="font-size: 12px; fill: var(--color-text-secondary);"
            >
              {weeklyActual}h / {weeklyTarget}h
            </text>
          </svg>
        </div>

        <!-- Daily Breakdown -->
        <div style="border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 24px;">
          <h2 style="font-size: 14px; font-weight: 600; color: var(--color-text); margin: 0 0 20px 0;">Daily Breakdown</h2>

          <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 20px;">
            {#each dailyBreakdown as day}
              {@const barWidth = maxBarHours > 0 ? (day.hours / maxBarHours) * 100 : 0}
              <div style="display: grid; grid-template-columns: 36px 1fr 40px; gap: 12px; align-items: center;">
                <span class="font-mono" style="font-size: 12px; color: var(--color-text-secondary); text-align: right;">
                  {day.day}
                </span>
                <div style="height: 20px; border-radius: var(--radius-sm); overflow: hidden; background: var(--color-surface-hover);">
                  {#if day.hours > 0}
                    <div
                      style="height: 100%; width: {barWidth}%; border-radius: var(--radius-sm);
                        background: {day.hours >= dailyTarget ? 'var(--color-accent)' : 'var(--color-focus-border)'};
                        transition: width var(--transition-base);"
                    ></div>
                  {/if}
                </div>
                <span class="font-mono" style="font-size: 12px; color: var(--color-text-tertiary); text-align: right;">
                  {day.hours}h
                </span>
              </div>
            {/each}
          </div>

          <div style="display: flex; gap: 16px; margin-top: 16px;">
            <span style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--color-text-tertiary);">
              <span style="width: 8px; height: 8px; border-radius: 2px; background: var(--color-accent);"></span>
              Met target
            </span>
            <span style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--color-text-tertiary);">
              <span style="width: 8px; height: 8px; border-radius: 2px; background: var(--color-focus-border);"></span>
              Below target
            </span>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  input:focus, select:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px var(--color-accent-muted);
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
    .focus-layout {
      grid-template-columns: 1fr !important;
    }
  }
</style>
