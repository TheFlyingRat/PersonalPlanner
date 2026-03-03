<script lang="ts">
  import { meetings as meetingsApi } from '$lib/api';

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
  let showForm = $state(false);

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

  const priorityLabels: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
  const priorityColors: Record<number, string> = {
    1: 'bg-red-100 text-red-700',
    2: 'bg-orange-100 text-orange-700',
    3: 'bg-yellow-100 text-yellow-700',
    4: 'bg-green-100 text-green-700',
  };

  const conferenceLabels: Record<string, string> = {
    zoom: 'Zoom',
    meet: 'Google Meet',
    teams: 'Microsoft Teams',
    none: 'None',
  };

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
  }

  async function handleSubmit() {
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
    };

    try {
      await meetingsApi.create(meetingData as any);
      const list = await meetingsApi.list();
      meetingList = list as any;
    } catch {
      meetingList = [
        ...meetingList,
        { id: crypto.randomUUID(), ...meetingData },
      ];
    }

    showForm = false;
    resetForm();
  }

  async function deleteMeeting(id: string) {
    try {
      await meetingsApi.delete(id);
      const list = await meetingsApi.list();
      meetingList = list as any;
    } catch {
      meetingList = meetingList.filter((m) => m.id !== id);
    }
  }

  function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
</script>

<div class="p-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-gray-900">Smart Meetings</h1>
    <button
      onclick={() => { resetForm(); showForm = true; }}
      class="px-4 py-2 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 transition-colors"
    >
      Add Meeting
    </button>
  </div>

  <!-- Add Form -->
  {#if showForm}
    <div class="bg-white rounded-lg shadow p-6 mb-6">
      <h2 class="text-lg font-semibold text-gray-900 mb-4">Add New Meeting</h2>
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
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            placeholder="e.g., Team Standup"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Priority</label>
          <select
            bind:value={formPriority}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          >
            <option value={1}>P1 - Critical</option>
            <option value={2}>P2 - High</option>
            <option value={3}>P3 - Medium</option>
            <option value={4}>P4 - Low</option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Duration (minutes)</label>
          <input
            type="number"
            bind:value={formDuration}
            min="5"
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
          <select
            bind:value={formFrequency}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Ideal Time</label>
          <input
            type="time"
            bind:value={formIdealTime}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Window Start</label>
          <input
            type="time"
            bind:value={formWindowStart}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Window End</label>
          <input
            type="time"
            bind:value={formWindowEnd}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Location</label>
          <input
            type="text"
            bind:value={formLocation}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            placeholder="e.g., Conference Room A"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Conference Type</label>
          <select
            bind:value={formConferenceType}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          >
            <option value="none">None</option>
            <option value="zoom">Zoom</option>
            <option value="meet">Google Meet</option>
            <option value="teams">Microsoft Teams</option>
          </select>
        </div>

        <div class="lg:col-span-2">
          <label class="block text-sm font-medium text-gray-700 mb-1">Attendees (comma-separated emails)</label>
          <input
            type="text"
            bind:value={formAttendees}
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            placeholder="e.g., alice@example.com, bob@example.com"
          />
        </div>

        <div class="flex items-end gap-3">
          <button
            type="submit"
            class="px-4 py-2 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 transition-colors"
          >
            Create Meeting
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

  <!-- Meeting List -->
  <div class="space-y-4">
    {#each meetingList as meeting}
      <div class="bg-white rounded-lg shadow p-4">
        <div class="flex items-start justify-between">
          <div class="flex-1">
            <div class="flex items-center gap-3 mb-2">
              <h3 class="text-lg font-semibold text-gray-900">{meeting.name}</h3>
              <span class="px-2 py-0.5 rounded-full text-xs font-semibold {priorityColors[meeting.priority]}">
                {priorityLabels[meeting.priority]}
              </span>
              <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 capitalize">
                {meeting.frequency}
              </span>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-gray-600">
              <div>
                <span class="font-medium text-gray-500">Duration:</span>
                {formatDuration(meeting.duration)}
              </div>
              <div>
                <span class="font-medium text-gray-500">Ideal Time:</span>
                {meeting.idealTime}
              </div>
              <div>
                <span class="font-medium text-gray-500">Window:</span>
                {meeting.windowStart} - {meeting.windowEnd}
              </div>
              <div>
                <span class="font-medium text-gray-500">Conference:</span>
                {conferenceLabels[meeting.conferenceType] || meeting.conferenceType}
              </div>
            </div>
            {#if meeting.attendees.length > 0}
              <div class="mt-2 text-sm text-gray-500">
                <span class="font-medium">Attendees:</span>
                {meeting.attendees.join(', ')}
              </div>
            {/if}
            {#if meeting.location}
              <div class="mt-1 text-sm text-gray-500">
                <span class="font-medium">Location:</span>
                {meeting.location}
              </div>
            {/if}
          </div>
          <div class="flex items-center gap-2 ml-4">
            <button
              onclick={() => deleteMeeting(meeting.id)}
              class="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    {/each}

    {#if meetingList.length === 0}
      <div class="bg-white rounded-lg shadow p-8 text-center">
        <p class="text-gray-500">No smart meetings yet. Click "Add Meeting" to create one.</p>
      </div>
    {/if}
  </div>
</div>
