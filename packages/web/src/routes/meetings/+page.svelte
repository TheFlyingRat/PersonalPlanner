<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { onMount, onDestroy, tick } from 'svelte';
  import { meetings as meetingsApi, calendars as calendarsApi, ApiError } from '$lib/api';
  import type { SmartMeeting, Calendar } from '@cadence/shared';
  import { Frequency } from '@cadence/shared';
  import Plus from 'lucide-svelte/icons/plus';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import X from 'lucide-svelte/icons/x';
  import Users from 'lucide-svelte/icons/users';
  import EllipsisVertical from 'lucide-svelte/icons/ellipsis-vertical';

  let meetingList = $state<SmartMeeting[]>([]);
  let showPanel = $state(false);
  let editingId = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');
  let success = $state('');
  let submitting = $state(false);
  let menuOpenId = $state<string | null>(null);
  let confirmingDeleteId = $state<string | null>(null);

  // Form fields
  let formName = $state('');
  let formPriority = $state(3);
  let formDuration = $state(30);
  let formFrequency = $state('weekly');
  let formIdealTime = $state('10:00');
  let formWindowStart = $state('09:00');
  let formWindowEnd = $state('17:00');
  let formLocation = $state('');
  let formConferenceType = $state('none');
  let formAttendees = $state('');
  let formColor = $state('');
  let formCalendarId = $state('');
  let formSkipBuffer = $state(false);
  let calendarList = $state<Calendar[]>([]);

  let panelEl = $state<HTMLDivElement | null>(null);
  let successTimer: ReturnType<typeof setTimeout> | null = null;

  const priorityLabels: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };

  const conferenceLabels: Record<string, string> = {
    zoom: 'Zoom',
    meet: 'Meet',
    teams: 'Teams',
    none: 'None',
  };

  const colorNames: Record<string, string> = {
    '#4285f4': 'Blue',
    '#ea4335': 'Red',
    '#34a853': 'Green',
    '#fbbc04': 'Yellow',
    '#ff6d01': 'Orange',
    '#46bdc6': 'Teal',
    '#7b61ff': 'Purple',
    '#e91e63': 'Pink',
  };

  function getInitials(email: string): string {
    const name = email.split('@')[0];
    const parts = name.split(/[._-]/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function showSuccessMsg(msg: string) {
    success = msg;
    if (successTimer) clearTimeout(successTimer);
    successTimer = setTimeout(() => { success = ''; }, 3000);
  }

  onDestroy(() => {
    if (successTimer) clearTimeout(successTimer);
  });

  function resetForm() {
    formName = '';
    formPriority = 3;
    formDuration = 30;
    formFrequency = 'weekly';
    formIdealTime = '10:00';
    formWindowStart = '09:00';
    formWindowEnd = '17:00';
    formLocation = '';
    formConferenceType = 'none';
    formAttendees = '';
    formColor = '';
    formCalendarId = '';
    formSkipBuffer = false;
    editingId = null;
  }

  function openAddForm() {
    resetForm();
    showPanel = true;
    tick().then(() => focusFirstInPanel());
  }

  function openEditForm(meeting: SmartMeeting) {
    editingId = meeting.id;
    formName = meeting.name;
    formPriority = meeting.priority;
    formDuration = meeting.duration;
    formFrequency = meeting.frequency;
    formIdealTime = meeting.idealTime;
    formWindowStart = meeting.windowStart;
    formWindowEnd = meeting.windowEnd;
    formLocation = meeting.location;
    formConferenceType = meeting.conferenceType;
    formAttendees = meeting.attendees.join(', ');
    formColor = meeting.color ?? '';
    formCalendarId = meeting.calendarId ?? '';
    formSkipBuffer = meeting.skipBuffer ?? false;
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
      if (confirmingDeleteId) { confirmingDeleteId = null; return; }
      if (showPanel) closePanel();
    }
  }

  function handleWindowClick() {
    if (menuOpenId) menuOpenId = null;
  }

  async function handleSubmit() {
    submitting = true;
    error = '';
    const meetingData = {
      name: formName,
      priority: formPriority,
      duration: formDuration,
      frequency: formFrequency as Frequency,
      idealTime: formIdealTime,
      windowStart: formWindowStart,
      windowEnd: formWindowEnd,
      location: formLocation,
      conferenceType: formConferenceType,
      attendees: formAttendees
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean),
      color: formColor || undefined,
      calendarId: formCalendarId || undefined,
      skipBuffer: formSkipBuffer,
    };

    try {
      if (editingId) {
        await meetingsApi.update(editingId, meetingData);
      } else {
        await meetingsApi.create(meetingData);
      }
      const list = await meetingsApi.list();
      meetingList = list;
      showSuccessMsg(editingId ? 'Meeting updated successfully.' : 'Meeting created successfully.');
      closePanel();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to save. Please try again.';
    } finally {
      submitting = false;
    }
  }

  async function deleteMeeting(id: string) {
    try {
      await meetingsApi.delete(id);
      const list = await meetingsApi.list();
      meetingList = list;
      showSuccessMsg('Meeting deleted successfully.');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to delete meeting. Please try again.';
    }
    confirmingDeleteId = null;
  }

  function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  onMount(async () => {
    loading = true;
    error = '';
    try {
      const list = await meetingsApi.list();
      meetingList = list;
    } catch {
      error = 'Failed to load data from API. Showing cached data.';
    } finally {
      loading = false;
    }
    calendarsApi.list().then((c) => { calendarList = c; }).catch((err) => { console.warn('Failed to load calendars:', err); });
  });
</script>

<svelte:head>
  <title>{pageTitle('Meetings')}</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} onclick={handleWindowClick} />

<div class="page-wrapper">
  <!-- Header -->
  <div class="page-header">
    <h1 class="page-title">Meetings</h1>
    <button onclick={openAddForm} class="btn-accent-pill" aria-expanded={showPanel} aria-controls="meetings-panel">
      <Plus size={16} strokeWidth={1.5} />
      Add Meeting
    </button>
  </div>

  {#if error}
    <div class="alert-error" role="alert">{error}</div>
  {/if}
  {#if success}
    <div class="alert-success" role="alert">{success}</div>
  {/if}

  {#if loading}
    <div class="loading-state" role="status" aria-live="polite">
      <p>Loading...</p>
    </div>
  {:else if meetingList.length === 0}
    <!-- Empty State -->
    <div class="empty-state">
      <Users size={48} strokeWidth={1.5} aria-hidden="true" />
      <h2 class="empty-state-title">No meetings yet</h2>
      <p class="empty-state-desc">Create your first smart meeting to start scheduling</p>
      <button onclick={openAddForm} class="btn-accent-pill empty-state-btn">
        <Plus size={16} strokeWidth={1.5} />
        Add Meeting
      </button>
    </div>
  {:else}
    <!-- Table -->
    <div role="table" aria-label="Meetings">
      <!-- Table Header -->
      <div class="table-header table-grid" role="row">
        <span role="columnheader">Name</span>
        <span role="columnheader">Priority</span>
        <span role="columnheader">Duration</span>
        <span role="columnheader">Frequency</span>
        <span role="columnheader">Conference</span>
        <span role="columnheader">Attendees</span>
        <span role="columnheader" aria-label="Actions"></span>
      </div>

      <!-- Table Rows -->
      {#each meetingList as meeting}
        <div class="table-row table-grid" role="row">
          <span role="cell">
            <button class="name-btn" onclick={() => openEditForm(meeting)}>{meeting.name}</button>
          </span>
          <span role="cell">
            <span class="priority-badge priority-{meeting.priority}">{priorityLabels[meeting.priority]}</span>
          </span>
          <span role="cell" class="font-mono cell-secondary">{formatDuration(meeting.duration)}</span>
          <span role="cell" class="cell-frequency">{meeting.frequency}</span>
          <span role="cell">
            {#if meeting.conferenceType && meeting.conferenceType !== 'none'}
              <span class="conference-badge">{conferenceLabels[meeting.conferenceType] || meeting.conferenceType}</span>
            {:else}
              <span class="cell-placeholder">--</span>
            {/if}
          </span>
          <span role="cell" class="cell-attendees">
            {#if meeting.attendees.length > 0}
              <div class="avatar-group">
                {#each meeting.attendees.slice(0, 3) as email}
                  <div class="avatar-circle" title={email}>{getInitials(email)}</div>
                {/each}
                {#if meeting.attendees.length > 3}
                  <div class="avatar-circle avatar-overflow">+{meeting.attendees.length - 3}</div>
                {/if}
              </div>
            {:else}
              <span class="cell-placeholder">--</span>
            {/if}
          </span>
          <span role="cell" class="kebab-cell">
            <button
              class="kebab-btn"
              onclick={(e) => { e.stopPropagation(); menuOpenId = menuOpenId === meeting.id ? null : meeting.id; if (menuOpenId) tick().then(() => { const el = e.currentTarget as HTMLElement; el.closest('.kebab-cell')?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); }); }}
              aria-label="Actions for {meeting.name}"
              aria-haspopup="true"
              aria-expanded={menuOpenId === meeting.id}
            >
              <EllipsisVertical size={16} strokeWidth={1.5} />
            </button>
            {#if menuOpenId === meeting.id}
              <div class="kebab-menu" role="menu" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') { menuOpenId = null; } }} onclick={(e) => e.stopPropagation()}>
                <button class="kebab-menu-item" role="menuitem" onclick={() => { menuOpenId = null; openEditForm(meeting); }}>
                  <Pencil size={15} strokeWidth={1.5} />
                  Edit
                </button>
                <button class="kebab-menu-item kebab-menu-item--danger" role="menuitem" onclick={() => { menuOpenId = null; confirmingDeleteId = meeting.id; }}>
                  <Trash2 size={15} strokeWidth={1.5} />
                  Delete
                </button>
              </div>
            {/if}
            {#if confirmingDeleteId === meeting.id}
              <div class="kebab-menu confirm-menu" role="alertdialog" aria-labelledby="confirm-text-{meeting.id}" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') { confirmingDeleteId = null; } }} onclick={(e) => e.stopPropagation()}>
                <p class="confirm-text" id="confirm-text-{meeting.id}">Delete this meeting?</p>
                <div class="confirm-actions">
                  <button class="btn-confirm-yes" onclick={() => deleteMeeting(meeting.id)}>Yes, delete</button>
                  <button class="btn-confirm-no" onclick={() => { confirmingDeleteId = null; }}>Cancel</button>
                </div>
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
    id="meetings-panel"
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
        {editingId ? 'Edit Meeting' : 'Add Meeting'}
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
        <label for="mtg-name">Name</label>
        <input id="mtg-name" type="text" bind:value={formName} required placeholder="e.g., Team Standup" />
      </div>

      <div class="form-field">
        <label for="mtg-priority">Priority</label>
        <select id="mtg-priority" bind:value={formPriority}>
          <option value={1}>P1 - Critical</option>
          <option value={2}>P2 - High</option>
          <option value={3}>P3 - Medium</option>
          <option value={4}>P4 - Low</option>
        </select>
      </div>

      <div class="form-row">
        <div class="form-field">
          <label for="mtg-dur">Duration (min)</label>
          <input id="mtg-dur" type="number" bind:value={formDuration} min="5" />
        </div>
        <div class="form-field">
          <label for="mtg-freq">Frequency</label>
          <select id="mtg-freq" bind:value={formFrequency}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>

      <div class="form-field">
        <label for="mtg-ideal">Ideal Time</label>
        <input id="mtg-ideal" type="time" bind:value={formIdealTime} />
      </div>

      <div class="form-row">
        <div class="form-field">
          <label for="mtg-win-start">Window Start</label>
          <input id="mtg-win-start" type="time" bind:value={formWindowStart} />
        </div>
        <div class="form-field">
          <label for="mtg-win-end">Window End</label>
          <input id="mtg-win-end" type="time" bind:value={formWindowEnd} />
        </div>
      </div>

      <div class="form-field">
        <label for="mtg-conf">Conference Type</label>
        <select id="mtg-conf" bind:value={formConferenceType}>
          <option value="none">None</option>
          <option value="zoom">Zoom</option>
          <option value="meet">Google Meet</option>
          <option value="teams">Microsoft Teams</option>
        </select>
      </div>

      <div class="form-field">
        <label for="mtg-location">Location</label>
        <input id="mtg-location" type="text" bind:value={formLocation} placeholder="e.g., Conference Room A" />
      </div>

      <div class="form-field">
        <label for="mtg-attendees">Attendees (comma-separated emails)</label>
        <input id="mtg-attendees" type="text" bind:value={formAttendees} placeholder="e.g., alice@example.com, bob@example.com" />
      </div>

      {#if calendarList.length > 0}
        <div class="form-field">
          <label for="mtg-calendar">Calendar</label>
          <select id="mtg-calendar" bind:value={formCalendarId}>
            <option value="">Default</option>
            {#each calendarList as cal}
              <option value={cal.id}>{cal.name}</option>
            {/each}
          </select>
        </div>
      {/if}

      <fieldset class="form-field color-fieldset">
        <legend>Color</legend>
        <div class="color-picker">
          {#each ['#4285f4', '#ea4335', '#34a853', '#fbbc04', '#ff6d01', '#46bdc6', '#7b61ff', '#e91e63'] as c}
            <button
              type="button"
              class="color-swatch"
              class:color-swatch--active={formColor === c}
              style="background: {c};"
              onclick={() => { formColor = c; }}
              aria-label="Select color {colorNames[c] ?? c}"
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
      </fieldset>

      <div class="form-field">
        <label class="toggle-label">
          <input type="checkbox" bind:checked={formSkipBuffer} />
          <span>Skip buffer time for this meeting</span>
        </label>
      </div>

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

  .loading-state {
    @include flex-center;
    padding: var(--space-12) 0;
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

  .table-grid {
    grid-template-columns: 1fr 70px 80px 90px 100px 120px 40px;
  }

  .name-btn {
    background: none;
    border: none;
    padding: 0;
    font-weight: 500;
    color: var(--color-text);
    cursor: pointer;
    text-align: left;

    &:hover {
      color: var(--color-accent);
    }
  }

  .cell-secondary {
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
  }

  .cell-frequency {
    color: var(--color-text-secondary);
    text-transform: capitalize;
    font-size: 0.8125rem;
  }

  .cell-placeholder {
    color: var(--color-text-tertiary);
    font-size: 0.8125rem;
  }

  .cell-attendees {
    display: flex;
    align-items: center;
  }

  .panel-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .conference-badge {
    @include badge(var(--color-meeting-bg), var(--color-meeting-border));
    font-weight: 500;
  }

  .avatar-group {
    display: flex;
    align-items: center;
  }

  .avatar-circle {
    @include flex-center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-full);
    background: var(--color-accent-muted);
    color: var(--color-accent);
    font-size: 0.625rem;
    font-weight: 600;
    border: 2px solid var(--color-surface);
    margin-left: -6px;

    &:first-child {
      margin-left: 0;
    }
  }

  .avatar-overflow {
    background: var(--color-surface-active);
    color: var(--color-text-secondary);
  }

  .color-fieldset {
    border: none;
    padding: 0;
    margin: 0;

    legend {
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--color-text-secondary);
      margin-bottom: var(--space-1);
    }
  }

  @include mobile {
    .table-grid {
      grid-template-columns: 1fr 60px 70px 40px;
    }

    .cell-frequency,
    .cell-attendees,
    .table-header [role="columnheader"]:nth-child(4),
    .table-header [role="columnheader"]:nth-child(5),
    .table-header [role="columnheader"]:nth-child(6) {
      display: none;
    }

    // Also hide conference column in rows
    .table-row [role="cell"]:nth-child(5),
    .table-row [role="cell"]:nth-child(4),
    .table-row [role="cell"]:nth-child(6) {
      display: none;
    }
  }
</style>
