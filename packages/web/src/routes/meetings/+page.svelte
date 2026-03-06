<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { meetings as meetingsApi, calendars as calendarsApi } from '$lib/api';
  import type { Calendar } from '../../../../shared/src/types';
  import Plus from 'lucide-svelte/icons/plus';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import X from 'lucide-svelte/icons/x';
  import Users from 'lucide-svelte/icons/users';
  import EllipsisVertical from 'lucide-svelte/icons/ellipsis-vertical';

  interface MeetingItem {
    id: string;
    name: string;
    priority: number;
    attendees: string[];
    duration: number;
    frequency: string;
    idealTime: string;
    windowStart: string;
    windowEnd: string;
    location: string;
    conferenceType: string;
  }

  const mockMeetings: MeetingItem[] = [
    {
      id: '1',
      name: 'Team Standup',
      priority: 1,
      attendees: ['alice@example.com', 'bob@example.com'],
      duration: 30,
      frequency: 'daily',
      idealTime: '09:00',
      windowStart: '08:30',
      windowEnd: '10:00',
      location: '',
      conferenceType: 'meet',
    },
    {
      id: '2',
      name: 'Sprint Retrospective',
      priority: 2,
      attendees: ['alice@example.com', 'bob@example.com', 'carol@example.com'],
      duration: 60,
      frequency: 'weekly',
      idealTime: '14:00',
      windowStart: '13:00',
      windowEnd: '17:00',
      location: 'Conference Room B',
      conferenceType: 'zoom',
    },
  ];

  let meetingList = $state<MeetingItem[]>(mockMeetings);
  let showPanel = $state(false);
  let editingId = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');
  let success = $state('');
  let submitting = $state(false);
  let menuOpenId = $state<string | null>(null);

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

  const priorityLabels: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };

  const conferenceLabels: Record<string, string> = {
    zoom: 'Zoom',
    meet: 'Meet',
    teams: 'Teams',
    none: 'None',
  };

  function getInitials(email: string): string {
    const name = email.split('@')[0];
    const parts = name.split(/[._-]/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function showSuccess(msg: string) {
    success = msg;
    setTimeout(() => { success = ''; }, 3000);
  }

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

  function openEditForm(meeting: MeetingItem) {
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
    formColor = (meeting as any).color ?? '';
    formCalendarId = (meeting as any).calendarId ?? '';
    formSkipBuffer = (meeting as any).skipBuffer ?? false;
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
    const meetingData = {
      name: formName,
      priority: formPriority,
      duration: formDuration,
      frequency: formFrequency,
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
        await meetingsApi.update(editingId, meetingData as any);
      } else {
        await meetingsApi.create(meetingData as any);
      }
      const list = await meetingsApi.list();
      meetingList = list as any;
      showSuccess(editingId ? 'Meeting updated successfully.' : 'Meeting created successfully.');
    } catch {
      if (editingId) {
        meetingList = meetingList.map((m) =>
          m.id === editingId ? { ...m, ...meetingData } : m
        );
        showSuccess('Meeting updated (offline).');
      } else {
        meetingList = [
          ...meetingList,
          { id: crypto.randomUUID(), ...meetingData },
        ];
        showSuccess('Meeting created (offline).');
      }
    } finally {
      submitting = false;
    }

    closePanel();
  }

  async function deleteMeeting(id: string) {
    if (!confirm('Are you sure you want to delete this meeting?')) return;
    try {
      await meetingsApi.delete(id);
      const list = await meetingsApi.list();
      meetingList = list as any;
      showSuccess('Meeting deleted successfully.');
    } catch {
      meetingList = meetingList.filter((m) => m.id !== id);
      showSuccess('Meeting deleted (offline).');
    }
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
      meetingList = list as any;
    } catch {
      error = 'Failed to load data from API. Showing cached data.';
    } finally {
      loading = false;
    }
    calendarsApi.list().then((c) => { calendarList = c; }).catch(() => {});
  });
</script>

<svelte:head>
  <title>Meetings - Cadence</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} onclick={handleWindowClick} />

<div style="padding: var(--space-6);">
  <!-- Header -->
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-6);">
    <h1 style="font-size: 1.5rem; font-weight: 600; color: var(--color-text);">Meetings</h1>
    <button onclick={openAddForm} class="btn-accent-pill" aria-expanded={showPanel}>
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
    <div style="display: flex; align-items: center; justify-content: center; padding: var(--space-12) 0;" role="status" aria-live="polite">
      <p style="color: var(--color-text-secondary);">Loading...</p>
    </div>
  {:else if meetingList.length === 0}
    <!-- Empty State -->
    <div class="empty-state">
      <Users size={48} strokeWidth={1.5} style="color: var(--color-text-tertiary);" />
      <h2 style="font-size: 1.125rem; font-weight: 600; color: var(--color-text); margin-top: var(--space-4);">No meetings yet</h2>
      <p style="color: var(--color-text-secondary); margin-top: var(--space-2);">Create your first smart meeting to start scheduling</p>
      <button onclick={openAddForm} class="btn-accent-pill" style="margin-top: var(--space-5);">
        <Plus size={16} strokeWidth={1.5} />
        Add Meeting
      </button>
    </div>
  {:else}
    <!-- Table Header -->
    <div class="table-header" style="grid-template-columns: 1fr 70px 80px 90px 100px 120px 40px;">
      <span>Name</span>
      <span>Priority</span>
      <span>Duration</span>
      <span>Frequency</span>
      <span>Conference</span>
      <span>Attendees</span>
      <span></span>
    </div>

    <!-- Table Rows -->
    {#each meetingList as meeting}
      <div
        class="table-row"
        style="grid-template-columns: 1fr 70px 80px 90px 100px 120px 40px;"
        onclick={() => openEditForm(meeting)}
        role="button"
        tabindex="0"
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditForm(meeting); } }}
      >
        <span style="font-weight: 500; color: var(--color-text);">{meeting.name}</span>
        <span>
          <span class="priority-badge priority-{meeting.priority}">{priorityLabels[meeting.priority]}</span>
        </span>
        <span class="font-mono" style="color: var(--color-text-secondary); font-size: 0.8125rem;">{formatDuration(meeting.duration)}</span>
        <span style="color: var(--color-text-secondary); text-transform: capitalize; font-size: 0.8125rem;">{meeting.frequency}</span>
        <span>
          {#if meeting.conferenceType && meeting.conferenceType !== 'none'}
            <span class="conference-badge">{conferenceLabels[meeting.conferenceType] || meeting.conferenceType}</span>
          {:else}
            <span style="color: var(--color-text-tertiary); font-size: 0.8125rem;">--</span>
          {/if}
        </span>
        <span style="display: flex; align-items: center;">
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
            <span style="color: var(--color-text-tertiary); font-size: 0.8125rem;">--</span>
          {/if}
        </span>
        <span class="kebab-cell">
          <button
            class="kebab-btn"
            onclick={(e) => { e.stopPropagation(); menuOpenId = menuOpenId === meeting.id ? null : meeting.id; }}
            aria-label="Actions"
            aria-haspopup="true"
            aria-expanded={menuOpenId === meeting.id}
          >
            <EllipsisVertical size={16} strokeWidth={1.5} />
          </button>
          {#if menuOpenId === meeting.id}
            <div class="kebab-menu" onclick={(e) => e.stopPropagation()}>
              <button class="kebab-menu-item" onclick={() => { menuOpenId = null; openEditForm(meeting); }}>
                <Pencil size={15} strokeWidth={1.5} />
                Edit
              </button>
              <button class="kebab-menu-item kebab-menu-item--danger" onclick={() => { menuOpenId = null; deleteMeeting(meeting.id); }}>
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

      <div class="form-field" style="display: flex; gap: var(--space-4);">
        <label class="toggle-label">
          <input type="checkbox" bind:checked={formSkipBuffer} />
          <span>No buffer time</span>
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
</style>
