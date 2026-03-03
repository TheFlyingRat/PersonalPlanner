<script lang="ts">
  // Dashboard - Week Calendar View
  let currentWeekStart = $state(getMonday(new Date()));

  function getMonday(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function prevWeek() {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() - 7);
    currentWeekStart = d;
  }

  function nextWeek() {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + 7);
    currentWeekStart = d;
  }

  function goToday() {
    currentWeekStart = getMonday(new Date());
  }

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function getWeekDates(start: Date): Date[] {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }

  function formatDate(d: Date): string {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function formatWeekRange(start: Date): string {
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (start.getMonth() === end.getMonth()) {
      return `${monthNames[start.getMonth()]} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`;
    }
    return `${monthNames[start.getMonth()]} ${start.getDate()} - ${monthNames[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  }

  // Time grid from 7:00 to 22:00
  const hours = Array.from({ length: 16 }, (_, i) => i + 7);

  // Mock events: [dayIndex (0=Mon), startHour, durationHours, title, type]
  interface MockEvent {
    dayIndex: number;
    startHour: number;
    duration: number;
    title: string;
    type: 'habit' | 'task' | 'meeting' | 'focus' | 'manual';
  }

  const mockEvents: MockEvent[] = [
    { dayIndex: 0, startHour: 9, duration: 0.5, title: '🔒 Team Standup', type: 'meeting' },
    { dayIndex: 1, startHour: 12, duration: 1, title: '🟢 Lunch', type: 'habit' },
    { dayIndex: 2, startHour: 14, duration: 2, title: '🛡️ Project Work', type: 'task' },
    { dayIndex: 3, startHour: 10, duration: 2, title: '🟢 Deep Work', type: 'focus' },
    { dayIndex: 0, startHour: 14, duration: 1.5, title: '🛡️ Code Review', type: 'task' },
    { dayIndex: 1, startHour: 9, duration: 0.5, title: '🔒 1:1 with Manager', type: 'meeting' },
    { dayIndex: 4, startHour: 8, duration: 1, title: '🟢 Morning Exercise', type: 'habit' },
    { dayIndex: 4, startHour: 13, duration: 2, title: '🟢 Focus Time', type: 'focus' },
    { dayIndex: 2, startHour: 9, duration: 1, title: '🔒 Sprint Planning', type: 'meeting' },
    { dayIndex: 3, startHour: 15, duration: 1, title: '🛡️ Bug Fixes', type: 'task' },
  ];

  const typeColors: Record<string, string> = {
    habit: 'bg-green-500/90 border-green-600',
    task: 'bg-blue-500/90 border-blue-600',
    meeting: 'bg-purple-500/90 border-purple-600',
    focus: 'bg-orange-500/90 border-orange-600',
    manual: 'bg-gray-500/90 border-gray-600',
  };

  function getEventsForDay(dayIndex: number): MockEvent[] {
    return mockEvents.filter((e) => e.dayIndex === dayIndex);
  }

  function isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
  }
</script>

<div class="p-6">
  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p class="text-sm text-gray-500 mt-1">{formatWeekRange(currentWeekStart)}</p>
    </div>
    <div class="flex items-center gap-2">
      <button
        onclick={prevWeek}
        class="px-3 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 font-medium text-sm"
      >
        &larr;
      </button>
      <button
        onclick={goToday}
        class="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium text-sm"
      >
        Today
      </button>
      <button
        onclick={nextWeek}
        class="px-3 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 font-medium text-sm"
      >
        &rarr;
      </button>
    </div>
  </div>

  <!-- Legend -->
  <div class="flex gap-4 mb-4 text-sm">
    <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-green-500 inline-block"></span> Habit</span>
    <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-blue-500 inline-block"></span> Task</span>
    <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-purple-500 inline-block"></span> Meeting</span>
    <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-orange-500 inline-block"></span> Focus</span>
    <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-gray-500 inline-block"></span> Manual</span>
  </div>

  <!-- Calendar Grid -->
  <div class="bg-white rounded-lg shadow overflow-hidden">
    <!-- Day Headers -->
    <div class="grid grid-cols-[64px_repeat(7,1fr)] border-b border-gray-200">
      <div class="p-2 bg-gray-50"></div>
      {#each getWeekDates(currentWeekStart) as date, i}
        <div class="p-3 text-center border-l border-gray-200 {isToday(date) ? 'bg-blue-50' : 'bg-gray-50'}">
          <div class="text-xs font-medium text-gray-500 uppercase">{dayNames[i]}</div>
          <div class="text-lg font-bold {isToday(date) ? 'text-blue-600' : 'text-gray-900'}">
            {date.getDate()}
          </div>
        </div>
      {/each}
    </div>

    <!-- Time Grid -->
    <div class="grid grid-cols-[64px_repeat(7,1fr)] relative">
      <!-- Time Labels + Row Lines -->
      {#each hours as hour}
        <div class="h-16 border-b border-gray-100 flex items-start justify-end pr-2 pt-0.5">
          <span class="text-xs text-gray-400 font-medium">
            {hour.toString().padStart(2, '0')}:00
          </span>
        </div>
        {#each Array(7) as _, dayIdx}
          <div class="h-16 border-l border-b border-gray-100 relative">
            <!-- Half-hour line -->
            <div class="absolute top-1/2 left-0 right-0 border-t border-gray-50"></div>
          </div>
        {/each}
      {/each}

      <!-- Events Overlay -->
      {#each Array(7) as _, dayIdx}
        {#each getEventsForDay(dayIdx) as event}
          {@const topOffset = (event.startHour - 7) * 64}
          {@const height = event.duration * 64}
          {@const colStart = dayIdx + 2}
          <div
            class="absolute rounded-md border-l-4 px-2 py-1 text-white text-xs font-medium overflow-hidden cursor-pointer hover:opacity-90 transition-opacity {typeColors[event.type]}"
            style="top: {topOffset}px; height: {height}px; left: 0; right: 0; grid-column: {colStart}; position: absolute;"
            style:grid-column={colStart}
          >
            <div class="truncate">{event.title}</div>
            <div class="text-white/70 text-[10px]">
              {event.startHour.toString().padStart(2, '0')}:00 - {(event.startHour + event.duration).toString().padStart(2, '0')}:{event.duration % 1 ? '30' : '00'}
            </div>
          </div>
        {/each}
      {/each}
    </div>

    <!-- Absolute positioned events since CSS Grid overlays are tricky -->
  </div>

  <!-- Alternative: Simple Event List per Day for reliability -->
  <div class="mt-6 grid grid-cols-7 gap-2">
    {#each getWeekDates(currentWeekStart) as date, dayIdx}
      <div class="bg-white rounded-lg shadow p-3 min-h-[200px]">
        <div class="text-center mb-3 pb-2 border-b border-gray-100">
          <div class="text-xs font-medium text-gray-500 uppercase">{dayNames[dayIdx]}</div>
          <div class="text-sm font-bold {isToday(date) ? 'text-blue-600' : 'text-gray-900'}">{formatDate(date)}</div>
        </div>
        <div class="space-y-1.5">
          {#each getEventsForDay(dayIdx) as event}
            <div class="rounded-md border-l-4 px-2 py-1.5 text-xs {typeColors[event.type]} text-white">
              <div class="font-medium truncate">{event.title}</div>
              <div class="text-white/70 text-[10px]">
                {event.startHour.toString().padStart(2, '0')}:00 - {(event.startHour + event.duration).toString().padStart(2, '0')}:{event.duration % 1 ? '30' : '00'}
              </div>
            </div>
          {/each}
          {#if getEventsForDay(dayIdx).length === 0}
            <p class="text-xs text-gray-400 text-center py-4">No events</p>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>
