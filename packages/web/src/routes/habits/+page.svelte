<script lang="ts">
  import { onMount } from 'svelte';
  import { habits as habitsApi } from '$lib/api';

  interface HabitItem {
    id: string;
    name: string;
    priority: number;
    windowStart: string;
    windowEnd: string;
    idealTime: string;
    durationMin: number;
    durationMax: number;
    frequency: string;
    schedulingHours: string;
    locked: boolean;
    autoDecline: boolean;
    enabled: boolean;
  }

  // Mock data
  const mockHabits: HabitItem[] = [
    {
      id: '1',
      name: 'Lunch Break',
      priority: 1,
      windowStart: '11:30',
      windowEnd: '13:30',
      idealTime: '12:00',
      durationMin: 30,
      durationMax: 60,
      frequency: 'daily',
      schedulingHours: 'working',
      locked: true,
      autoDecline: true,
      enabled: true,
    },
    {
      id: '2',
      name: 'Morning Exercise',
      priority: 2,
      windowStart: '06:00',
      windowEnd: '09:00',
      idealTime: '07:00',
      durationMin: 30,
      durationMax: 60,
      frequency: 'daily',
      schedulingHours: 'personal',
      locked: false,
      autoDecline: false,
      enabled: true,
    },
    {
      id: '3',
      name: 'Weekly Review',
      priority: 3,
      windowStart: '14:00',
      windowEnd: '17:00',
      idealTime: '15:00',
      durationMin: 45,
      durationMax: 60,
      frequency: 'weekly',
      schedulingHours: 'working',
      locked: false,
      autoDecline: false,
      enabled: true,
    },
  ];

  let habitList = $state<HabitItem[]>(mockHabits);
  let showForm = $state(false);
  let editingId = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');
  let success = $state('');
  let submitting = $state(false);

  // Form fields
  let formName = $state('');
  let formPriority = $state(3);
  let formWindowStart = $state('09:00');
  let formWindowEnd = $state('17:00');
  let formIdealTime = $state('10:00');
  let formDurationMin = $state(30);
  let formDurationMax = $state(60);
  let formFrequency = $state('daily');
  let formSchedulingHours = $state('working');
  let formLocked = $state(false);
  let formAutoDecline = $state(false);

  const priorityLabels: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
  const priorityColors: Record<number, string> = {
    1: 'bg-red-100 text-red-700',
    2: 'bg-orange-100 text-orange-700',
    3: 'bg-yellow-100 text-yellow-700',
    4: 'bg-green-100 text-green-700',
  };

  function showSuccess(msg: string) {
    success = msg;
    setTimeout(() => { success = ''; }, 3000);
  }

  function resetForm() {
    formName = '';
    formPriority = 3;
    formWindowStart = '09:00';
    formWindowEnd = '17:00';
    formIdealTime = '10:00';
    formDurationMin = 30;
    formDurationMax = 60;
    formFrequency = 'daily';
    formSchedulingHours = 'working';
    formLocked = false;
    formAutoDecline = false;
    editingId = null;
  }

  function openAddForm() {
    resetForm();
    showForm = true;
  }

  function openEditForm(habit: HabitItem) {
    editingId = habit.id;
    formName = habit.name;
    formPriority = habit.priority;
    formWindowStart = habit.windowStart;
    formWindowEnd = habit.windowEnd;
    formIdealTime = habit.idealTime;
    formDurationMin = habit.durationMin;
    formDurationMax = habit.durationMax;
    formFrequency = habit.frequency;
    formSchedulingHours = habit.schedulingHours;
    formLocked = habit.locked;
    formAutoDecline = habit.autoDecline;
    showForm = true;
  }

  async function handleSubmit() {
    submitting = true;
    const habitData = {
      name: formName,
      priority: formPriority,
      windowStart: formWindowStart,
      windowEnd: formWindowEnd,
      idealTime: formIdealTime,
      durationMin: formDurationMin,
      durationMax: formDurationMax,
      frequency: formFrequency,
      schedulingHours: formSchedulingHours,
      locked: formLocked,
      autoDecline: formAutoDecline,
    };

    try {
      if (editingId) {
        await habitsApi.update(editingId, habitData as any);
      } else {
        await habitsApi.create(habitData as any);
      }
      const list = await habitsApi.list();
      habitList = list as any;
      showSuccess(editingId ? 'Habit updated successfully.' : 'Habit created successfully.');
    } catch {
      // API unavailable - use mock data
      if (editingId) {
        habitList = habitList.map((h) =>
          h.id === editingId ? { ...h, ...habitData } : h
        );
        showSuccess('Habit updated (offline).');
      } else {
        habitList = [
          ...habitList,
          { id: crypto.randomUUID(), ...habitData, enabled: true },
        ];
        showSuccess('Habit created (offline).');
      }
    } finally {
      submitting = false;
    }

    showForm = false;
    resetForm();
  }

  async function toggleLock(habit: HabitItem) {
    try {
      await habitsApi.lock(habit.id, !habit.locked);
      const list = await habitsApi.list();
      habitList = list as any;
    } catch {
      habitList = habitList.map((h) =>
        h.id === habit.id ? { ...h, locked: !h.locked } : h
      );
    }
  }

  async function deleteHabit(id: string) {
    if (!confirm('Are you sure you want to delete this habit?')) return;
    try {
      await habitsApi.delete(id);
      const list = await habitsApi.list();
      habitList = list as any;
      showSuccess('Habit deleted successfully.');
    } catch {
      habitList = habitList.filter((h) => h.id !== id);
      showSuccess('Habit deleted (offline).');
    }
  }

  onMount(async () => {
    loading = true;
    error = '';
    try {
      const list = await habitsApi.list();
      habitList = list as any;
    } catch {
      error = 'Failed to load data from API. Showing cached data.';
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>Habits - Reclaim</title>
</svelte:head>

<div class="p-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-gray-900">Habits</h1>
    <button
      onclick={openAddForm}
      class="px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition-colors"
    >
      Add Habit
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
        {editingId ? 'Edit Habit' : 'Add New Habit'}
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
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent"
            placeholder="e.g., Lunch Break"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Priority</label>
          <select
            bind:value={formPriority}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent"
          >
            <option value={1}>P1 - Critical</option>
            <option value={2}>P2 - High</option>
            <option value={3}>P3 - Medium</option>
            <option value={4}>P4 - Low</option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
          <select
            bind:value={formFrequency}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Window Start</label>
          <input
            type="time"
            bind:value={formWindowStart}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Window End</label>
          <input
            type="time"
            bind:value={formWindowEnd}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Ideal Time</label>
          <input
            type="time"
            bind:value={formIdealTime}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Duration Min (minutes)</label>
          <input
            type="number"
            bind:value={formDurationMin}
            min="5"
            max="480"
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Duration Max (minutes)</label>
          <input
            type="number"
            bind:value={formDurationMax}
            min="5"
            max="480"
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Scheduling Hours</label>
          <select
            bind:value={formSchedulingHours}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent"
          >
            <option value="working">Working Hours</option>
            <option value="personal">Personal Hours</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        <div class="flex items-center gap-6 pt-6">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={formLocked} class="w-4 h-4 rounded" />
            <span class="text-sm font-medium text-gray-700">Locked</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={formAutoDecline} class="w-4 h-4 rounded" />
            <span class="text-sm font-medium text-gray-700">Auto-decline</span>
          </label>
        </div>

        <div class="flex items-end gap-3 lg:col-span-2">
          <button
            type="submit"
            disabled={submitting}
            class="px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {editingId ? 'Update Habit' : 'Create Habit'}
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
    <!-- Habit List -->
    <div class="space-y-4">
      {#each habitList as habit}
        <div class="bg-white rounded-lg shadow p-4">
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <div class="flex items-center gap-3 mb-2">
                <h3 class="text-lg font-semibold text-gray-900">{habit.name}</h3>
                <span class="px-2 py-0.5 rounded-full text-xs font-semibold {priorityColors[habit.priority]}">
                  {priorityLabels[habit.priority]}
                </span>
                {#if habit.locked}
                  <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                    Locked
                  </span>
                {/if}
                {#if habit.autoDecline}
                  <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                    Auto-decline
                  </span>
                {/if}
              </div>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-gray-600">
                <div>
                  <span class="font-medium text-gray-500">Window:</span>
                  {habit.windowStart} - {habit.windowEnd}
                </div>
                <div>
                  <span class="font-medium text-gray-500">Ideal:</span>
                  {habit.idealTime}
                </div>
                <div>
                  <span class="font-medium text-gray-500">Duration:</span>
                  {habit.durationMin}-{habit.durationMax} min
                </div>
                <div>
                  <span class="font-medium text-gray-500">Frequency:</span>
                  <span class="capitalize">{habit.frequency}</span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2 ml-4">
              <button
                onclick={() => toggleLock(habit)}
                class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                  {habit.locked
                    ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
              >
                {habit.locked ? 'Locked' : 'Unlocked'}
              </button>
              <button
                onclick={() => openEditForm(habit)}
                class="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
              >
                Edit
              </button>
              <button
                onclick={() => deleteHabit(habit.id)}
                class="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      {/each}

      {#if habitList.length === 0}
        <div class="bg-white rounded-lg shadow p-8 text-center">
          <p class="text-gray-500">No habits yet. Click "Add Habit" to create one.</p>
        </div>
      {/if}
    </div>
  {/if}
</div>
