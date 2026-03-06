<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { tasks as tasksApi, calendars as calendarsApi } from '$lib/api';
  import type { Subtask, Calendar } from '../../../../shared/src/types';
  import Plus from 'lucide-svelte/icons/plus';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import X from 'lucide-svelte/icons/x';
  import CheckSquare from 'lucide-svelte/icons/check-square';
  import Zap from 'lucide-svelte/icons/zap';
  import ListChecks from 'lucide-svelte/icons/list-checks';
  import EllipsisVertical from 'lucide-svelte/icons/ellipsis-vertical';

  interface TaskItem {
    id: string;
    name: string;
    priority: number;
    totalDuration: number;
    remainingDuration: number;
    dueDate: string;
    earliestStart: string;
    chunkMin: number;
    chunkMax: number;
    status: string;
    isUpNext: boolean;
  }

  const mockTasks: TaskItem[] = [
    {
      id: '1',
      name: 'Write API Documentation',
      priority: 2,
      totalDuration: 180,
      remainingDuration: 120,
      dueDate: '2026-03-10T17:00:00Z',
      earliestStart: '2026-03-04T09:00:00Z',
      chunkMin: 30,
      chunkMax: 90,
      status: 'open',
      isUpNext: true,
    },
    {
      id: '2',
      name: 'Fix Login Bug',
      priority: 1,
      totalDuration: 60,
      remainingDuration: 60,
      dueDate: '2026-03-06T17:00:00Z',
      earliestStart: '2026-03-04T09:00:00Z',
      chunkMin: 15,
      chunkMax: 60,
      status: 'open',
      isUpNext: false,
    },
    {
      id: '3',
      name: 'Design Review Feedback',
      priority: 3,
      totalDuration: 90,
      remainingDuration: 0,
      dueDate: '2026-03-05T17:00:00Z',
      earliestStart: '2026-03-01T09:00:00Z',
      chunkMin: 30,
      chunkMax: 60,
      status: 'completed',
      isUpNext: false,
    },
    {
      id: '4',
      name: 'Prepare Sprint Demo',
      priority: 2,
      totalDuration: 120,
      remainingDuration: 45,
      dueDate: '2026-03-07T17:00:00Z',
      earliestStart: '2026-03-03T09:00:00Z',
      chunkMin: 30,
      chunkMax: 60,
      status: 'done_scheduling',
      isUpNext: false,
    },
  ];

  let taskList = $state<TaskItem[]>(mockTasks);
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
  let formTotalDuration = $state(60);
  let formDueDate = $state('');
  let formEarliestStart = $state('');
  let formChunkMin = $state(15);
  let formChunkMax = $state(60);

  let calendarList = $state<Calendar[]>([]);
  let formCalendarId = $state('');
  let formColor = $state('');

  // Subtask state
  let subtasks = $state<Subtask[]>([]);
  let newSubtaskName = $state('');
  let subtasksLoading = $state(false);
  let subtaskCounts = $state<Record<string, { done: number; total: number }>>({});

  let panelEl = $state<HTMLDivElement | null>(null);

  const priorityLabels: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
  const statusLabels: Record<string, string> = {
    open: 'Open',
    done_scheduling: 'Done Scheduling',
    completed: 'Completed',
  };

  function showSuccess(msg: string) {
    success = msg;
    setTimeout(() => { success = ''; }, 3000);
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

  function progress(task: TaskItem): number {
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
    formCalendarId = '';
    formColor = '';
    editingId = null;
  }

  async function loadAllSubtaskCounts() {
    for (const task of taskList) {
      try {
        const subs = await tasksApi.getSubtasks(task.id);
        const done = subs.filter((s) => s.completed).length;
        subtaskCounts = { ...subtaskCounts, [task.id]: { done, total: subs.length } };
      } catch {
        // API not available
      }
    }
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
    resetForm();
    subtasks = [];
    newSubtaskName = '';
    showPanel = true;
    tick().then(() => focusFirstInPanel());
  }

  function openEditForm(task: TaskItem) {
    editingId = task.id;
    formName = task.name;
    formPriority = task.priority;
    formTotalDuration = task.totalDuration;
    formDueDate = toDateInputValue(task.dueDate);
    formEarliestStart = toDateInputValue(task.earliestStart);
    formChunkMin = task.chunkMin;
    formChunkMax = task.chunkMax;
    formCalendarId = (task as any).calendarId ?? '';
    formColor = (task as any).color ?? '';
    newSubtaskName = '';
    showPanel = true;
    tick().then(() => focusFirstInPanel());
    loadSubtasks(task.id);
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
    const taskData = {
      name: formName,
      priority: formPriority,
      totalDuration: formTotalDuration,
      dueDate: new Date(formDueDate).toISOString(),
      earliestStart: formEarliestStart ? new Date(formEarliestStart).toISOString() : new Date().toISOString(),
      chunkMin: formChunkMin,
      chunkMax: formChunkMax,
      calendarId: formCalendarId || undefined,
      color: formColor || undefined,
    };

    try {
      if (editingId) {
        await tasksApi.update(editingId, taskData as any);
      } else {
        await tasksApi.create(taskData as any);
      }
      const list = await tasksApi.list();
      taskList = list as any;
      showSuccess(editingId ? 'Task updated successfully.' : 'Task created successfully.');
    } catch {
      if (editingId) {
        taskList = taskList.map((t) =>
          t.id === editingId ? { ...t, ...taskData } : t
        );
        showSuccess('Task updated (offline).');
      } else {
        taskList = [
          ...taskList,
          {
            id: crypto.randomUUID(),
            ...taskData,
            remainingDuration: taskData.totalDuration,
            status: 'open',
            isUpNext: false,
          },
        ];
        showSuccess('Task created (offline).');
      }
    } finally {
      submitting = false;
    }

    closePanel();
  }

  async function toggleComplete(task: TaskItem) {
    try {
      await tasksApi.complete(task.id);
      const list = await tasksApi.list();
      taskList = list as any;
    } catch {
      taskList = taskList.map((t) =>
        t.id === task.id
          ? { ...t, status: t.status === 'completed' ? 'open' : 'completed', remainingDuration: t.status === 'completed' ? t.totalDuration : 0 }
          : t
      );
    }
  }

  async function toggleUpNext(task: TaskItem) {
    try {
      await tasksApi.setUpNext(task.id, !task.isUpNext);
      const list = await tasksApi.list();
      taskList = list as any;
    } catch {
      taskList = taskList.map((t) =>
        t.id === task.id ? { ...t, isUpNext: !t.isUpNext } : t
      );
    }
  }

  async function deleteTask(id: string) {
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
      await tasksApi.delete(id);
      const list = await tasksApi.list();
      taskList = list as any;
      showSuccess('Task deleted successfully.');
    } catch {
      taskList = taskList.filter((t) => t.id !== id);
      showSuccess('Task deleted (offline).');
    }
  }

  onMount(async () => {
    loading = true;
    error = '';
    try {
      const list = await tasksApi.list();
      taskList = list as any;
    } catch {
      error = 'Failed to load data from API. Showing cached data.';
    } finally {
      loading = false;
    }
    loadAllSubtaskCounts();
    calendarsApi.list().then((c) => { calendarList = c; }).catch(() => {});
  });
</script>

<svelte:head>
  <title>Tasks - Cadence</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} onclick={handleWindowClick} />

<div style="padding: var(--space-6);">
  <!-- Header -->
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-6);">
    <h1 style="font-size: 1.5rem; font-weight: 600; color: var(--color-text);">Tasks</h1>
    <button onclick={openAddForm} class="btn-accent-pill" aria-expanded={showPanel}>
      <Plus size={16} strokeWidth={1.5} />
      Add Task
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
  {:else if taskList.length === 0}
    <!-- Empty State -->
    <div class="empty-state">
      <CheckSquare size={48} strokeWidth={1.5} style="color: var(--color-text-tertiary);" />
      <h2 style="font-size: 1.125rem; font-weight: 600; color: var(--color-text); margin-top: var(--space-4);">No tasks yet</h2>
      <p style="color: var(--color-text-secondary); margin-top: var(--space-2);">Create your first task to start scheduling</p>
      <button onclick={openAddForm} class="btn-accent-pill" style="margin-top: var(--space-5);">
        <Plus size={16} strokeWidth={1.5} />
        Add Task
      </button>
    </div>
  {:else}
    <!-- Table Header -->
    <div class="table-header" style="grid-template-columns: 1fr 70px 90px 90px 80px 120px 40px;">
      <span>Name</span>
      <span>Priority</span>
      <span>Duration</span>
      <span>Due Date</span>
      <span>Status</span>
      <span>Progress</span>
      <span></span>
    </div>

    <!-- Table Rows -->
    {#each taskList as task}
      <div
        class="table-row"
        style="grid-template-columns: 1fr 70px 90px 90px 80px 120px 40px;"
        onclick={() => openEditForm(task)}
        role="button"
        tabindex="0"
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditForm(task); } }}
      >
        <span style="display: flex; align-items: center; gap: var(--space-2); font-weight: 500; color: var(--color-text);">
          {#if task.status === 'completed'}
            <span style="text-decoration: line-through; color: var(--color-text-tertiary);">{task.name}</span>
          {:else}
            {task.name}
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
        <span>
          <span class="priority-badge priority-{task.priority}">{priorityLabels[task.priority]}</span>
        </span>
        <span class="font-mono" style="color: var(--color-text-secondary); font-size: 0.8125rem;">
          {formatDuration(task.remainingDuration)}/{formatDuration(task.totalDuration)}
        </span>
        <span style="color: var(--color-text-secondary); font-size: 0.8125rem;">{formatDate(task.dueDate)}</span>
        <span>
          <span class="status-badge status-{task.status}">{statusLabels[task.status]}</span>
        </span>
        <span style="display: flex; align-items: center; gap: var(--space-2);">
          <div class="progress-track">
            <div class="progress-fill" style="width: {progress(task)}%;"></div>
          </div>
          <span class="font-mono" style="font-size: 0.75rem; color: var(--color-text-secondary);">{progress(task)}%</span>
        </span>
        <span class="kebab-cell">
          <button
            class="kebab-btn"
            onclick={(e) => { e.stopPropagation(); menuOpenId = menuOpenId === task.id ? null : task.id; }}
            aria-label="Actions"
            aria-haspopup="true"
            aria-expanded={menuOpenId === task.id}
          >
            <EllipsisVertical size={16} strokeWidth={1.5} />
          </button>
          {#if menuOpenId === task.id}
            <div class="kebab-menu" onclick={(e) => e.stopPropagation()}>
              <button class="kebab-menu-item" onclick={() => { menuOpenId = null; openEditForm(task); }}>
                <Pencil size={15} strokeWidth={1.5} />
                Edit
              </button>
              <button class="kebab-menu-item kebab-menu-item--danger" onclick={() => { menuOpenId = null; deleteTask(task.id); }}>
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

      {#if editingId}
        {@const task = taskList.find(t => t.id === editingId)}
        {#if task}
          <div style="display: flex; gap: var(--space-3); padding-top: var(--space-2); border-top: 1px solid var(--color-border);">
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
