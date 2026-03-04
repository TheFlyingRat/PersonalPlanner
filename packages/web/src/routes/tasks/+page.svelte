<script lang="ts">
  import { onMount } from 'svelte';
  import { tasks as tasksApi } from '$lib/api';

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
  let showForm = $state(false);
  let editingId = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');
  let success = $state('');
  let submitting = $state(false);

  // Form fields
  let formName = $state('');
  let formPriority = $state(3);
  let formTotalDuration = $state(60);
  let formDueDate = $state('');
  let formEarliestStart = $state('');
  let formChunkMin = $state(15);
  let formChunkMax = $state(60);

  const priorityLabels: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
  const priorityColors: Record<number, string> = {
    1: 'bg-red-100 text-red-700',
    2: 'bg-orange-100 text-orange-700',
    3: 'bg-yellow-100 text-yellow-700',
    4: 'bg-green-100 text-green-700',
  };
  const statusColors: Record<string, string> = {
    open: 'bg-blue-100 text-blue-700',
    done_scheduling: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
  };
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
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function toDateInputValue(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toISOString().split('T')[0];
  }

  function resetForm() {
    formName = '';
    formPriority = 3;
    formTotalDuration = 60;
    formDueDate = '';
    formEarliestStart = '';
    formChunkMin = 15;
    formChunkMax = 60;
    editingId = null;
  }

  function openAddForm() {
    resetForm();
    showForm = true;
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
    showForm = true;
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

    showForm = false;
    resetForm();
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
  });
</script>

<svelte:head>
  <title>Tasks - Reclaim</title>
</svelte:head>

<div class="p-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-gray-900">Tasks</h1>
    <button
      onclick={openAddForm}
      class="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
    >
      Add Task
    </button>
  </div>

  {#if error}
    <div class="mb-4 px-4 py-2 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
  {/if}
  {#if success}
    <div class="mb-4 px-4 py-2 bg-green-50 text-green-700 rounded-lg text-sm">{success}</div>
  {/if}

  <!-- Add/Edit Form -->
  {#if showForm}
    <div class="bg-white rounded-lg shadow p-6 mb-6">
      <h2 class="text-lg font-semibold text-gray-900 mb-4">
        {editingId ? 'Edit Task' : 'Add New Task'}
      </h2>
      <form
        onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            type="text"
            bind:value={formName}
            required
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="e.g., Write documentation"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Priority</label>
          <select
            bind:value={formPriority}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value={1}>P1 - Critical</option>
            <option value={2}>P2 - High</option>
            <option value={3}>P3 - Medium</option>
            <option value={4}>P4 - Low</option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Total Duration (minutes)</label>
          <input
            type="number"
            bind:value={formTotalDuration}
            min="5"
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
          <input
            type="date"
            bind:value={formDueDate}
            required
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Earliest Start</label>
          <input
            type="date"
            bind:value={formEarliestStart}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Chunk Min (minutes)</label>
          <input
            type="number"
            bind:value={formChunkMin}
            min="5"
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Chunk Max (minutes)</label>
          <input
            type="number"
            bind:value={formChunkMax}
            min="5"
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div class="flex items-end gap-3 lg:col-span-2">
          <button
            type="submit"
            disabled={submitting}
            class="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {editingId ? 'Update Task' : 'Create Task'}
          </button>
          <button
            type="button"
            onclick={() => { showForm = false; resetForm(); }}
            class="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 font-medium hover:bg-gray-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center justify-center py-12">
      <p class="text-gray-500">Loading...</p>
    </div>
  {:else}
    <!-- Task List -->
    <div class="space-y-4">
      {#each taskList as task}
        <div class="bg-white rounded-lg shadow p-4">
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <div class="flex items-center gap-3 mb-2">
                <h3 class="text-lg font-semibold text-gray-900 {task.status === 'completed' ? 'line-through text-gray-400' : ''}">
                  {task.name}
                </h3>
                <span class="px-2 py-0.5 rounded-full text-xs font-semibold {priorityColors[task.priority]}">
                  {priorityLabels[task.priority]}
                </span>
                <span class="px-2 py-0.5 rounded-full text-xs font-semibold {statusColors[task.status]}">
                  {statusLabels[task.status]}
                </span>
                {#if task.isUpNext}
                  <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700">
                    Up Next
                  </span>
                {/if}
              </div>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-gray-600">
                <div>
                  <span class="font-medium text-gray-500">Duration:</span>
                  {formatDuration(task.remainingDuration)} / {formatDuration(task.totalDuration)}
                </div>
                <div>
                  <span class="font-medium text-gray-500">Due:</span>
                  {formatDate(task.dueDate)}
                </div>
                <div>
                  <span class="font-medium text-gray-500">Chunks:</span>
                  {task.chunkMin}-{task.chunkMax} min
                </div>
                <div>
                  <!-- Progress bar -->
                  <span class="font-medium text-gray-500">Progress:</span>
                  <div class="flex items-center gap-2 mt-1">
                    <div class="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div class="h-full bg-blue-500 rounded-full transition-all" style="width: {task.totalDuration > 0 ? Math.round(((task.totalDuration - task.remainingDuration) / task.totalDuration) * 100) : 0}%"></div>
                    </div>
                    <span class="text-xs font-medium">{task.totalDuration > 0 ? Math.round(((task.totalDuration - task.remainingDuration) / task.totalDuration) * 100) : 0}%</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2 ml-4">
              <button
                onclick={() => toggleComplete(task)}
                class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                  {task.status === 'completed'
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
              >
                {task.status === 'completed' ? 'Undo' : 'Complete'}
              </button>
              <button
                onclick={() => toggleUpNext(task)}
                class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                  {task.isUpNext
                    ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
              >
                {task.isUpNext ? 'Remove Up Next' : 'Up Next'}
              </button>
              <button
                onclick={() => openEditForm(task)}
                class="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
              >
                Edit
              </button>
              <button
                onclick={() => deleteTask(task.id)}
                class="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      {/each}

      {#if taskList.length === 0}
        <div class="bg-white rounded-lg shadow p-8 text-center">
          <p class="text-gray-500">No tasks yet. Click "Add Task" to create one.</p>
        </div>
      {/if}
    </div>
  {/if}
</div>
