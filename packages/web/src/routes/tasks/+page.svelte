<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { tick } from 'svelte';
  import { tasks as tasksApi, calendars as calendarsApi, ApiError } from '$lib/api';
  import { SchedulingHours } from '@cadence/shared';
  import type { Task, Subtask, Calendar, CreateTaskRequest } from '@cadence/shared';
  import Plus from 'lucide-svelte/icons/plus';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import X from 'lucide-svelte/icons/x';
  import CheckSquare from 'lucide-svelte/icons/check-square';
  import Zap from 'lucide-svelte/icons/zap';
  import ListChecks from 'lucide-svelte/icons/list-checks';
  import EllipsisVertical from 'lucide-svelte/icons/ellipsis-vertical';

  const colorNames: Record<string, string> = {
    '#4285f4': 'Blue', '#ea4335': 'Red', '#34a853': 'Green', '#fbbc04': 'Yellow',
    '#ff6d01': 'Orange', '#e91e63': 'Pink', '#9c27b0': 'Purple', '#795548': 'Brown',
    '#46bdc6': 'Teal', '#7b61ff': 'Violet',
  };

  let taskList = $state<Task[]>([]);
  let showPanel = $state(false);
  let editingId = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');
  let success = $state('');
  let submitting = $state(false);
  let menuOpenId = $state<string | null>(null);
  let confirmingDeleteId = $state<string | null>(null);
  let panelTrigger: HTMLElement | null = null;
  let successTimer: ReturnType<typeof setTimeout> | undefined;

  // Form fields
  let formName = $state('');
  let formPriority = $state(3);
  let formTotalDuration = $state(60);
  let formDueDate = $state('');
  let formEarliestStart = $state('');
  let formChunkMin = $state(15);
  let formChunkMax = $state(60);
  let formSchedulingHours: SchedulingHours = $state(SchedulingHours.Working);

  let calendarList = $state<Calendar[]>([]);
  let formCalendarId = $state('');
  let formColor = $state('');
  let formSkipBuffer = $state(false);

  // Subtask state
  let subtasks = $state<Subtask[]>([]);
  let newSubtaskName = $state('');
  let subtasksLoading = $state(false);
  let subtaskCounts = $state<Record<string, { done: number; total: number }>>({});

  let panelEl: HTMLDivElement | null = null;

  const priorityLabels: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
  const statusLabels: Record<string, string> = {
    open: 'Open',
    done_scheduling: 'Done Scheduling',
    completed: 'Completed',
  };

  $effect(() => {
    return () => clearTimeout(successTimer);
  });

  function showSuccessMsg(msg: string) {
    success = msg;
    clearTimeout(successTimer);
    successTimer = setTimeout(() => { success = ''; }, 3000);
  }

  function formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function toDateInputValue(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toISOString().split('T')[0];
  }

  function progress(task: Task): number {
    return task.totalDuration > 0 ? Math.round(((task.totalDuration - task.remainingDuration) / task.totalDuration) * 100) : 0;
  }

  function resetForm() {
    formName = '';
    formPriority = 3;
    formTotalDuration = 60;
    formDueDate = '';
    formEarliestStart = '';
    formChunkMin = 15;
    formChunkMax = 60;
    formSchedulingHours = SchedulingHours.Working;
    formCalendarId = '';
    formColor = '';
    formSkipBuffer = false;
    editingId = null;
  }

  async function loadAllSubtaskCounts() {
    const results = await Promise.all(
      taskList.map(async (task) => {
        try {
          const subs = await tasksApi.getSubtasks(task.id);
          const done = subs.filter((s) => s.completed).length;
          return { id: task.id, done, total: subs.length };
        } catch {
          return null;
        }
      })
    );
    let newCounts = { ...subtaskCounts };
    for (const result of results) {
      if (result) {
        newCounts = { ...newCounts, [result.id]: { done: result.done, total: result.total } };
      }
    }
    subtaskCounts = newCounts;
  }

  async function loadSubtasks(taskId: string) {
    subtasksLoading = true;
    subtasks = [];
    try {
      subtasks = await tasksApi.getSubtasks(taskId);
    } catch {
      // API not available, keep empty
    } finally {
      subtasksLoading = false;
    }
  }

  async function addSubtask() {
    if (!editingId || !newSubtaskName.trim()) return;
    try {
      const created = await tasksApi.createSubtask(editingId, newSubtaskName.trim());
      subtasks = [...subtasks, created];
    } catch {
      // Optimistic offline
      subtasks = [...subtasks, {
        id: crypto.randomUUID(),
        taskId: editingId,
        name: newSubtaskName.trim(),
        completed: false,
        sortOrder: subtasks.length,
        createdAt: new Date().toISOString(),
      }];
    }
    newSubtaskName = '';
    syncSubtaskCounts();
  }

  async function toggleSubtask(subtask: Subtask) {
    if (!editingId) return;
    const updated = { ...subtask, completed: !subtask.completed };
    subtasks = subtasks.map((s) => s.id === subtask.id ? updated : s);
    syncSubtaskCounts();
    try {
      await tasksApi.updateSubtask(editingId, subtask.id, { completed: updated.completed });
    } catch {
      // Already optimistically updated
    }
  }

  async function removeSubtask(subtask: Subtask) {
    if (!editingId) return;
    subtasks = subtasks.filter((s) => s.id !== subtask.id);
    syncSubtaskCounts();
    try {
      await tasksApi.deleteSubtask(editingId, subtask.id);
    } catch {
      // Already optimistically removed
    }
  }

  function subtaskCompletionText(): string {
    if (subtasks.length === 0) return '';
    const done = subtasks.filter((s) => s.completed).length;
    return `${done}/${subtasks.length} subtasks`;
  }

  function syncSubtaskCounts() {
    if (!editingId) return;
    const done = subtasks.filter((s) => s.completed).length;
    subtaskCounts = { ...subtaskCounts, [editingId]: { done, total: subtasks.length } };
  }

  function openAddForm() {
    panelTrigger = document.activeElement as HTMLElement;
    resetForm();
    subtasks = [];
    newSubtaskName = '';
    showPanel = true;
    tick().then(() => focusFirstInPanel());
  }

  function openEditForm(task: Task) {
    panelTrigger = document.activeElement as HTMLElement;
    editingId = task.id;
    formName = task.name;
    formPriority = task.priority;
    formTotalDuration = task.totalDuration;
    formDueDate = toDateInputValue(task.dueDate);
    formEarliestStart = toDateInputValue(task.earliestStart);
    formChunkMin = task.chunkMin;
    formChunkMax = task.chunkMax;
    formSchedulingHours = task.schedulingHours ?? 'working';
    formCalendarId = task.calendarId ?? '';
    formColor = task.color ?? '';
    formSkipBuffer = task.skipBuffer ?? false;
    newSubtaskName = '';
    showPanel = true;
    tick().then(() => focusFirstInPanel());
    loadSubtasks(task.id);
  }

  function closePanel() {
    showPanel = false;
    resetForm();
    panelTrigger?.focus();
    panelTrigger = null;
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
      if (menuOpenId) { menuOpenId = null; confirmingDeleteId = null; return; }
      if (showPanel) closePanel();
    }
  }

  function handleWindowClick() {
    if (menuOpenId) { menuOpenId = null; confirmingDeleteId = null; }
  }

  async function handleSubmit() {
    submitting = true;
    error = '';
    const dueDate = formDueDate ? new Date(formDueDate + 'T23:59:59').toISOString() : undefined;
    const taskData = {
      name: formName,
      priority: formPriority,
      totalDuration: formTotalDuration,
      dueDate,
      earliestStart: formEarliestStart ? new Date(formEarliestStart + 'T00:00:00').toISOString() : undefined,
      chunkMin: formChunkMin,
      chunkMax: formChunkMax,
      schedulingHours: formSchedulingHours,
      calendarId: formCalendarId || undefined,
      color: formColor || undefined,
      skipBuffer: formSkipBuffer,
    };

    try {
      if (editingId) {
        await tasksApi.update(editingId, taskData);
      } else {
        await tasksApi.create({ ...taskData, dueDate: dueDate ?? '' } as CreateTaskRequest);
      }
      taskList = await tasksApi.list();
      showSuccessMsg(editingId ? 'Task updated successfully.' : 'Task created successfully.');
      closePanel();
    } catch (err) {
      if (err instanceof TypeError) {
        // Network error - use optimistic offline update
        if (editingId) {
          taskList = taskList.map((t) =>
            t.id === editingId ? { ...t, ...taskData } : t
          ) as Task[];
          showSuccessMsg('Task updated (offline).');
        } else {
          taskList = [
            ...taskList,
            {
              id: crypto.randomUUID(),
              ...taskData,
              remainingDuration: taskData.totalDuration,
              status: 'open',
              isUpNext: false,
            } as unknown as Task,
          ];
          showSuccessMsg('Task created (offline).');
        }
        closePanel();
      } else {
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    } finally {
      submitting = false;
    }
  }

  async function toggleComplete(task: Task) {
    try {
      await tasksApi.complete(task.id);
      taskList = await tasksApi.list();
    } catch (err) {
      if (err instanceof TypeError) {
        taskList = taskList.map((t) =>
          t.id === task.id
            ? { ...t, status: t.status === 'completed' ? 'open' : 'completed', remainingDuration: t.status === 'completed' ? t.totalDuration : 0 } as unknown as Task
            : t
        );
      } else {
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    }
  }

  async function toggleUpNext(task: Task) {
    try {
      await tasksApi.setUpNext(task.id, !task.isUpNext);
      taskList = await tasksApi.list();
    } catch (err) {
      if (err instanceof TypeError) {
        taskList = taskList.map((t) =>
          t.id === task.id ? { ...t, isUpNext: !t.isUpNext } : t
        );
      } else {
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    }
  }

  async function deleteTask(id: string) {
    try {
      await tasksApi.delete(id);
      taskList = await tasksApi.list();
      showSuccessMsg('Task deleted successfully.');
    } catch (err) {
      if (err instanceof TypeError) {
        taskList = taskList.filter((t) => t.id !== id);
        showSuccessMsg('Task deleted (offline).');
      } else {
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    }
    confirmingDeleteId = null;
    menuOpenId = null;
  }

  $effect(() => {
    (async () => {
      loading = true;
      error = '';
      try {
        taskList = await tasksApi.list();
      } catch (err) {
        if (err instanceof TypeError) {
          error = 'Unable to connect. Please check your network.';
        } else {
          error = err instanceof ApiError ? err.message : 'Failed to load data.';
        }
      } finally {
        loading = false;
      }
      loadAllSubtaskCounts();
      calendarsApi.list().then((c) => { calendarList = c; }).catch(() => {});
    })();
  });
</script>

<svelte:head>
  <title>{pageTitle('Tasks')}</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} onclick={handleWindowClick} />

<div class="page-wrapper">
  <!-- Header -->
  <div class="page-header">
    <h1 class="page-title">Tasks</h1>
    <button onclick={openAddForm} class="btn-accent-pill" aria-haspopup="dialog">
      <Plus size={16} strokeWidth={1.5} />
      Add Task
    </button>
  </div>

  {#if error}
    <div class="alert-error" role="alert">{error}</div>
  {/if}
  {#if success}
    <div class="alert-success" role="status">{success}</div>
  {/if}

  {#if loading}
    <div class="loading-container" role="status" aria-live="polite">
      <p class="loading-text">Loading...</p>
    </div>
  {:else if taskList.length === 0}
    <!-- Empty State -->
    <div class="empty-state">
      <CheckSquare size={48} strokeWidth={1.5} style="color: var(--color-text-tertiary);" />
      <h2 class="empty-state-title">No tasks yet</h2>
      <p class="empty-state-desc">Create your first task to start scheduling</p>
      <button onclick={openAddForm} class="btn-accent-pill empty-state-btn" aria-haspopup="dialog">
        <Plus size={16} strokeWidth={1.5} />
        Add Task
      </button>
    </div>
  {:else}
    <!-- Table -->
    <div role="table" aria-label="Tasks list">
      <!-- Table Header -->
      <div class="table-header tasks-grid" role="row">
        <span role="columnheader">Name</span>
        <span role="columnheader">Priority</span>
        <span role="columnheader" class="hide-mobile">Duration</span>
        <span role="columnheader" class="hide-mobile">Due Date</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Progress</span>
        <span role="columnheader" aria-label="Actions"></span>
      </div>

      <!-- Table Rows -->
      {#each taskList as task}
        <div
          class="table-row tasks-grid"
          role="row"
        >
          <span role="cell" class="name-cell">
            {#if task.status === 'completed'}
              <button class="name-btn name-btn--completed" onclick={() => openEditForm(task)}>{task.name}</button>
            {:else}
              <button class="name-btn" onclick={() => openEditForm(task)}>{task.name}</button>
            {/if}
            {#if task.isUpNext}
              <span class="upnext-badge">
                <Zap size={12} strokeWidth={1.5} />
                Up Next
              </span>
            {/if}
            {#if subtaskCounts[task.id]?.total}
              <span class="subtask-count-badge">
                <ListChecks size={12} strokeWidth={1.5} />
                {subtaskCounts[task.id].done}/{subtaskCounts[task.id].total}
              </span>
            {/if}
          </span>
          <span role="cell">
            <span class="priority-badge priority-{task.priority}">{priorityLabels[task.priority]}</span>
          </span>
          <span role="cell" class="font-mono hide-mobile" style="color: var(--color-text-secondary); font-size: 0.8125rem;">
            {formatDuration(task.remainingDuration)}/{formatDuration(task.totalDuration)}
          </span>
          <span role="cell" class="hide-mobile" style="color: var(--color-text-secondary); font-size: 0.8125rem;">{formatDate(task.dueDate)}</span>
          <span role="cell">
            <span class="status-badge status-{task.status}">{statusLabels[task.status]}</span>
          </span>
          <span role="cell" style="display: flex; align-items: center; gap: var(--space-2);">
            <div class="progress-track">
              <div class="progress-fill" style="width: {progress(task)}%;"></div>
            </div>
            <span class="font-mono" style="font-size: 0.75rem; color: var(--color-text-secondary);">{progress(task)}%</span>
          </span>
          <span role="cell" class="kebab-cell">
            <button
              class="kebab-btn"
              onclick={(e) => { e.stopPropagation(); confirmingDeleteId = null; menuOpenId = menuOpenId === task.id ? null : task.id; }}
              aria-label="Actions"
              aria-haspopup="menu"
              aria-expanded={menuOpenId === task.id}
            >
              <EllipsisVertical size={16} strokeWidth={1.5} />
            </button>
            {#if menuOpenId === task.id}
              <div class="kebab-menu" role="menu" onclick={(e) => e.stopPropagation()}>
                {#if confirmingDeleteId === task.id}
                  <span class="confirm-text" role="none">Delete this task?</span>
                  <button class="kebab-menu-item kebab-menu-item--danger" role="menuitem" onclick={() => deleteTask(task.id)}>
                    Confirm
                  </button>
                  <button class="kebab-menu-item" role="menuitem" onclick={() => { confirmingDeleteId = null; }}>
                    Cancel
                  </button>
                {:else}
                  <button class="kebab-menu-item" role="menuitem" onclick={() => { menuOpenId = null; openEditForm(task); }}>
                    <Pencil size={15} strokeWidth={1.5} />
                    Edit
                  </button>
                  <button class="kebab-menu-item kebab-menu-item--danger" role="menuitem" onclick={() => { confirmingDeleteId = task.id; }}>
                    <Trash2 size={15} strokeWidth={1.5} />
                    Delete
                  </button>
                {/if}
              </div>
            {/if}
          </span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Slide-over Panel -->
<!-- Note: aria-modal="true" on a div requires manual focus trapping (trapFocus handles this).
     A native <dialog> would provide this automatically but doesn't support slide-over animation. -->
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
      <h2 id="panel-title" class="panel-title">
        {editingId ? 'Edit Task' : 'Add Task'}
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
        <label for="task-name">Name</label>
        <input id="task-name" type="text" bind:value={formName} required placeholder="e.g., Write documentation" />
      </div>

      <div class="form-field">
        <label for="task-priority">Priority</label>
        <select id="task-priority" bind:value={formPriority}>
          <option value={1}>P1 - Critical</option>
          <option value={2}>P2 - High</option>
          <option value={3}>P3 - Medium</option>
          <option value={4}>P4 - Low</option>
        </select>
      </div>

      <div class="form-field">
        <label for="task-dur">Total Duration (minutes)</label>
        <input id="task-dur" type="number" bind:value={formTotalDuration} min="5" />
      </div>

      <div class="form-row">
        <div class="form-field">
          <label for="task-due">Due Date</label>
          <input id="task-due" type="date" bind:value={formDueDate} required />
        </div>
        <div class="form-field">
          <label for="task-start">Earliest Start</label>
          <input id="task-start" type="date" bind:value={formEarliestStart} />
        </div>
      </div>

      <div class="form-row">
        <div class="form-field">
          <label for="task-chunk-min">Chunk Min (min)</label>
          <input id="task-chunk-min" type="number" bind:value={formChunkMin} min="5" />
        </div>
        <div class="form-field">
          <label for="task-chunk-max">Chunk Max (min)</label>
          <input id="task-chunk-max" type="number" bind:value={formChunkMax} min="5" />
        </div>
      </div>

      <div class="form-field">
        <label for="task-sched">Schedule during</label>
        <select id="task-sched" bind:value={formSchedulingHours}>
          <option value="working">Work hours</option>
          <option value="personal">Personal hours</option>
          <option value="custom">Anytime (custom)</option>
        </select>
      </div>

      {#if calendarList.length > 0}
        <div class="form-field">
          <label for="task-calendar">Calendar</label>
          <select id="task-calendar" bind:value={formCalendarId}>
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
              aria-label="Select {colorNames[c] ?? c}"
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
          <input type="checkbox" bind:checked={formSkipBuffer} />
          <span>No buffer time</span>
        </label>
      </div>

      {#if editingId}
        {@const task = taskList.find(t => t.id === editingId)}
        {#if task}
          <div class="task-actions">
            <button
              type="button"
              class="btn-action"
              onclick={(e) => { e.preventDefault(); toggleComplete(task); closePanel(); }}
            >
              {task.status === 'completed' ? 'Reopen' : 'Complete'}
            </button>
            <button
              type="button"
              class="btn-action"
              onclick={(e) => { e.preventDefault(); toggleUpNext(task); closePanel(); }}
            >
              {task.isUpNext ? 'Remove Up Next' : 'Set Up Next'}
            </button>
          </div>
        {/if}

        <!-- Subtasks Section -->
        <div class="subtasks-section">
          <div class="subtasks-header">
            <span class="subtasks-title">
              <ListChecks size={16} strokeWidth={1.5} />
              Subtasks
            </span>
            {#if subtasks.length > 0}
              <span class="subtasks-count">{subtaskCompletionText()}</span>
            {/if}
          </div>

          {#if subtasksLoading}
            <p style="font-size: 0.8125rem; color: var(--color-text-tertiary);">Loading subtasks...</p>
          {:else}
            <div class="subtasks-list">
              {#each subtasks as subtask (subtask.id)}
                <div class="subtask-item">
                  <label class="subtask-check">
                    <input
                      type="checkbox"
                      checked={subtask.completed}
                      onchange={() => toggleSubtask(subtask)}
                    />
                    <span class:subtask-done={subtask.completed}>{subtask.name}</span>
                  </label>
                  <button
                    type="button"
                    class="subtask-delete"
                    onclick={() => removeSubtask(subtask)}
                    aria-label="Delete subtask"
                  >
                    <X size={14} strokeWidth={1.5} />
                  </button>
                </div>
              {/each}
            </div>

            <div class="subtask-add">
              <input
                type="text"
                placeholder="Add subtask..."
                bind:value={newSubtaskName}
                onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
              />
              <button
                type="button"
                class="subtask-add-btn"
                onclick={addSubtask}
                disabled={!newSubtaskName.trim()}
                aria-label="Add subtask"
              >
                <Plus size={16} strokeWidth={1.5} />
              </button>
            </div>
          {/if}
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

  .page-wrapper {
    padding: var(--space-6);
  }

  .panel-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .loading-container {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-12) 0;
  }

  .loading-text {
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

  .tasks-grid {
    grid-template-columns: 1fr 70px 90px 90px 80px 120px 40px;
  }

  @include mobile {
    .tasks-grid {
      grid-template-columns: 1fr 70px 80px 120px 40px;
    }
  }

  .name-cell {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 500;
    color: var(--color-text);
    overflow: hidden;
  }

  .name-btn {
    @include text-truncate;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: 500;
    color: var(--color-text);
    cursor: pointer;
    text-align: left;

    &:hover {
      color: var(--color-accent);
    }

    &--completed {
      text-decoration: line-through;
      color: var(--color-text-tertiary);
    }
  }

  .task-actions {
    display: flex;
    gap: var(--space-3);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border);
  }

  .form-toggles {
    display: flex;
    gap: var(--space-6);
    padding: var(--space-2) 0;
    flex-wrap: wrap;
  }

  /* Status badges */
  .status-badge {
    @include badge;
  }

  .status-open {
    background: var(--color-accent-muted);
    color: var(--color-accent);
  }

  .status-done_scheduling {
    background: var(--color-warning-amber-bg);
    color: var(--color-warning-amber);
  }

  .status-completed {
    background: var(--color-success-muted);
    color: var(--color-success);
  }

  /* Up Next badge */
  .upnext-badge {
    @include badge(var(--color-accent-muted), var(--color-accent));
    gap: 4px;
    font-size: 0.6875rem;
  }

  /* Progress bar */
  .progress-track {
    flex: 1;
    height: 4px;
    background: var(--color-border);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--color-accent);
    border-radius: var(--radius-full);
    transition: width var(--transition-base);
  }

  /* Subtask count badge on rows */
  .subtask-count-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--color-text-tertiary);
    padding: 1px 6px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    white-space: nowrap;
  }

  /* Subtasks Section */
  .subtasks-section {
    @include flex-col(var(--space-3));
    padding: var(--space-3) 0;
    border-top: 1px solid var(--color-border);
  }

  .subtasks-header {
    @include flex-between;
  }

  .subtasks-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  .subtasks-count {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-tertiary);
  }

  .subtasks-list {
    @include flex-col(2px);
  }

  .subtask-item {
    @include flex-between;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    transition: background var(--transition-fast);

    &:hover {
      background: var(--color-surface-hover);

      .subtask-delete {
        opacity: 1;
      }
    }

    &:focus-within {
      .subtask-delete {
        opacity: 1;
      }
    }
  }

  .subtask-check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.875rem;
    color: var(--color-text);
    cursor: pointer;
    flex: 1;
    min-width: 0;

    input[type="checkbox"] {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      accent-color: var(--color-accent);
    }

    span {
      @include text-truncate;
    }
  }

  .subtask-done {
    text-decoration: line-through;
    color: var(--color-text-tertiary);
  }

  .subtask-delete {
    @include flex-center;
    padding: 2px;
    border: none;
    background: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    opacity: 0;
    transition: opacity var(--transition-fast), color var(--transition-fast);

    &:hover {
      color: var(--color-danger);
    }
  }

  .subtask-add {
    display: flex;
    gap: var(--space-2);
    align-items: center;

    input {
      flex: 1;
      padding: var(--space-1) var(--space-2);
      font-size: 0.8125rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-bg);
      color: var(--color-text);
      font-family: inherit;

      &::placeholder {
        color: var(--color-text-tertiary);
      }
    }
  }

  .subtask-add-btn {
    @include flex-center;
    padding: var(--space-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);

    &:hover:not(:disabled) {
      background: var(--color-surface-hover);
      color: var(--color-text);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }
</style>
