<script lang="ts">
  import { schedule, habits as habitsApi, tasks as tasksApi, meetings as meetingsApi, settings as settingsApi } from '$lib/api';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import AlertTriangle from 'lucide-svelte/icons/triangle-alert';
  import X from 'lucide-svelte/icons/x';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Eye from 'lucide-svelte/icons/eye';
  import Lock from 'lucide-svelte/icons/lock';
  import Unlock from 'lucide-svelte/icons/unlock';
  import MapPin from 'lucide-svelte/icons/map-pin';
  import Clock from 'lucide-svelte/icons/clock';
  import CalendarDays from 'lucide-svelte/icons/calendar-days';
  import { subscribe as subscribeWs } from '$lib/ws';

  // Dashboard - Week Calendar View
  let currentWeekStart = $state(getMonday(new Date()));
  let loading = $state(true);
  let error = $state('');

  // Selected event for detail panel
  let selectedEvent = $state<CalEvent | null>(null);

  // Context menu state
  let contextMenu = $state<{ x: number; y: number; event: CalEvent } | null>(null);

  // Reference to the scroll container for auto-scroll
  let scrollContainer: HTMLDivElement | undefined = $state();

  // User timezone (fetched from settings, falls back to browser timezone)
  let userTimezone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);

  /** Get the hour (0-23) and minute of a Date in the user's timezone */
  function getHourInTz(date: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(date);
    const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0');
    const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0');
    return h + m / 60;
  }

  /** Get the day of week (0=Sun..6=Sat) of a Date in the user's timezone */
  function getDayInTz(date: Date): number {
    const dayStr = new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone,
      weekday: 'short',
    }).format(date);
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return dayMap[dayStr] ?? 0;
  }

  /** Get the UTC instant that corresponds to midnight of a local date in the user's timezone.
   *  E.g. for 2026-03-02 in Australia/Sydney (+11), returns 2026-03-01T13:00:00.000Z */
  function midnightInTz(year: number, month: number, day: number): number {
    // Start with a rough UTC estimate and binary-search to find the exact offset
    const rough = Date.UTC(year, month, day);
    // Format that instant in the target timezone to find the offset
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: userTimezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    // Iterate to converge (handles DST transitions)
    let guess = rough;
    for (let i = 0; i < 3; i++) {
      const parts = fmt.formatToParts(new Date(guess));
      const pY = parseInt(parts.find(p => p.type === 'year')!.value);
      const pM = parseInt(parts.find(p => p.type === 'month')!.value) - 1;
      const pD = parseInt(parts.find(p => p.type === 'day')!.value);
      const pH = parseInt(parts.find(p => p.type === 'hour')!.value);
      const pMin = parseInt(parts.find(p => p.type === 'minute')!.value);
      const pS = parseInt(parts.find(p => p.type === 'second')!.value);
      const localMs = Date.UTC(pY, pM, pD, pH, pMin, pS);
      const offset = localMs - guess; // offset = local - UTC
      guess = rough - offset;
    }
    return guess;
  }

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

  function formatWeekRange(start: Date): string {
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (start.getMonth() === end.getMonth()) {
      return `${monthNames[start.getMonth()]} ${start.getDate()} \u2013 ${end.getDate()}, ${start.getFullYear()}`;
    }
    return `${monthNames[start.getMonth()]} ${start.getDate()} \u2013 ${monthNames[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  }

  const START_HOUR = 0;
  const END_HOUR = 24;
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => i + START_HOUR);
  const HOUR_HEIGHT = 60;
  const GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

  interface CalEvent {
    dayIndex: number;
    startHour: number;
    duration: number;
    title: string;
    type: 'habit' | 'task' | 'meeting' | 'focus' | 'manual' | 'external';
    calendarColor?: string;
    calendarName?: string;
    itemColor?: string;
    // Extended fields
    id?: string;
    itemId?: string;
    startISO: string;
    endISO: string;
    status?: string;
    location?: string;
    isAllDay?: boolean;
  }

  let deleting = $state(false);
  let rescheduling = $state(false);
  let rescheduleResult = $state<{ message: string; operationsApplied: number; unschedulable: any[] } | null>(null);

  let events = $state<CalEvent[]>([]);
  let hasAnyAllDay = $derived(events.some((e) => e.isAllDay));

  function detectConflicts(evts: CalEvent[]): Map<string, string[]> {
    const conflicts = new Map<string, string[]>();
    const timedEvents = evts.filter(e => !e.isAllDay);
    for (let i = 0; i < timedEvents.length; i++) {
      for (let j = i + 1; j < timedEvents.length; j++) {
        const a = timedEvents[i], b = timedEvents[j];
        if (a.dayIndex !== b.dayIndex) continue;
        const aEnd = a.startHour + a.duration;
        const bEnd = b.startHour + b.duration;
        if (a.startHour < bEnd && b.startHour < aEnd) {
          const aId = a.id || a.title;
          const bId = b.id || b.title;
          if (!conflicts.has(aId)) conflicts.set(aId, []);
          if (!conflicts.has(bId)) conflicts.set(bId, []);
          conflicts.get(aId)!.push(b.title);
          conflicts.get(bId)!.push(a.title);
        }
      }
    }
    return conflicts;
  }

  let conflicts = $derived(detectConflicts(events));

  interface LayoutEvent extends CalEvent {
    col: number;
    totalCols: number;
  }

  function getAllDayEventsForDay(dayIndex: number): CalEvent[] {
    return events.filter((e) => e.dayIndex === dayIndex && e.isAllDay);
  }

  function getEventsForDay(dayIndex: number): LayoutEvent[] {
    const dayEvents = events
      .filter((e) => e.dayIndex === dayIndex && !e.isAllDay)
      .sort((a, b) => a.startHour - b.startHour || b.duration - a.duration);

    // Assign each event a column. Place into the first column where it doesn't overlap.
    const columns: { startHour: number; duration: number; idx: number }[][] = [];
    const layout: { col: number }[] = [];

    for (let i = 0; i < dayEvents.length; i++) {
      const ev = dayEvents[i];
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        const hasOverlap = columns[c].some(
          (o) => ev.startHour < o.startHour + o.duration && ev.startHour + ev.duration > o.startHour,
        );
        if (!hasOverlap) {
          columns[c].push({ startHour: ev.startHour, duration: ev.duration, idx: i });
          layout[i] = { col: c };
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([{ startHour: ev.startHour, duration: ev.duration, idx: i }]);
        layout[i] = { col: columns.length - 1 };
      }
    }

    // For each event, find max columns among its overlapping cluster
    return dayEvents.map((ev, i) => {
      let maxCol = layout[i].col;
      for (let j = 0; j < dayEvents.length; j++) {
        const other = dayEvents[j];
        if (ev.startHour < other.startHour + other.duration && ev.startHour + ev.duration > other.startHour) {
          maxCol = Math.max(maxCol, layout[j].col);
        }
      }
      return { ...ev, col: layout[i].col, totalCols: maxCol + 1 };
    });
  }

  function getDateInTz(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: userTimezone }).format(date);
  }

  function isToday(date: Date): boolean {
    return getDateInTz(date) === getDateInTz(new Date());
  }

  function formatHourLabel(hour: number): string {
    if (hour === 0) return '12 AM';
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return '12 PM';
    return `${hour - 12} PM`;
  }

  function formatStartTime(startHour: number): string {
    const h = Math.floor(startHour);
    const m = Math.round((startHour - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  function formatEndTime(startHour: number, duration: number): string {
    const endDecimal = startHour + duration;
    const endH = Math.floor(endDecimal);
    const endM = Math.round((endDecimal - endH) * 60);
    return `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
  }

  function formatHourAmPm(startHour: number): string {
    const h = Math.floor(startHour);
    const m = Math.round((startHour - h) * 60);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, '0')} ${suffix}`;
  }

  /** Returns the current time position in pixels from grid top, or -1 if out of range */
  function getCurrentTimePosition(): number {
    const now = new Date();
    const currentHour = getHourInTz(now);
    return (currentHour - START_HOUR) * HOUR_HEIGHT;
  }

  /** Returns the day index (0=Mon..6=Sun) for today, or -1 if not in current week */
  function getTodayDayIndex(): number {
    const today = new Date();
    const weekDates = getWeekDates(currentWeekStart);
    for (let i = 0; i < weekDates.length; i++) {
      if (isToday(weekDates[i])) return i;
    }
    return -1;
  }

  // Event type styling map using CSS custom properties
  const eventTypeMap: Record<string, { bg: string; border: string; label: string }> = {
    habit: { bg: 'var(--color-habit-bg)', border: 'var(--color-habit-border)', label: 'Habit' },
    task: { bg: 'var(--color-task-bg)', border: 'var(--color-task-border)', label: 'Task' },
    meeting: { bg: 'var(--color-meeting-bg)', border: 'var(--color-meeting-border)', label: 'Meeting' },
    focus: { bg: 'var(--color-focus-bg)', border: 'var(--color-focus-border)', label: 'Focus' },
    external: { bg: 'var(--color-external-bg)', border: 'var(--color-external-border)', label: 'External' },
  };

  // Legend items
  const legendItems = [
    { type: 'habit', label: 'Habit' },
    { type: 'task', label: 'Task' },
    { type: 'meeting', label: 'Meeting' },
    { type: 'focus', label: 'Focus' },
    { type: 'external', label: 'External' },
  ];

  async function fetchEvents() {
    loading = true;
    error = '';
    try {
      const weekDates = getWeekDates(currentWeekStart);
      // Compute week boundaries as UTC instants corresponding to midnight in the user's timezone
      const mon = weekDates[0];
      const startMs = midnightInTz(mon.getFullYear(), mon.getMonth(), mon.getDate());
      const sun = weekDates[6];
      // End of Sunday = midnight of the next day
      const nextDay = new Date(sun);
      nextDay.setDate(nextDay.getDate() + 1);
      const endMs = midnightInTz(nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate());

      const start = new Date(startMs).toISOString();
      const end = new Date(endMs).toISOString();

      const apiEvents = await schedule.getEvents(start, end);
      const mapped: CalEvent[] = [];
      for (const raw of apiEvents) {
        const ev = raw as any;
        if (!ev.start || !ev.end) continue;
        const isAllDay = ev.isAllDay || (!ev.start.includes('T') && !ev.end.includes('T'));
        const startDate = new Date(ev.start);
        const endDateEv = new Date(ev.end);
        if (isNaN(startDate.getTime()) || isNaN(endDateEv.getTime())) continue;
        const dayOfWeek = getDayInTz(startDate);
        const dayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const startHour = isAllDay ? 0 : getHourInTz(startDate);
        const durationMs = endDateEv.getTime() - startDate.getTime();
        const duration = isAllDay ? 24 : durationMs / (1000 * 60 * 60);
        const type = ev.itemType || 'manual';
        mapped.push({
          dayIndex,
          startHour,
          duration,
          title: ev.title || '(No title)',
          type: type as CalEvent['type'],
          calendarColor: ev.calendarColor,
          calendarName: ev.calendarName,
          itemColor: ev.itemColor,
          id: ev.id,
          itemId: ev.itemId,
          startISO: ev.start,
          endISO: ev.end,
          status: ev.status,
          location: ev.location,
          isAllDay: !!isAllDay,
        });
      }
      events = mapped;
    } catch {
      error = 'Failed to load events from API.';
      events = [];
    } finally {
      loading = false;
    }
  }

  function handleEventClick(event: CalEvent) {
    contextMenu = null;
    selectedEvent = event;
  }

  function handleEventContextMenu(e: MouseEvent, event: CalEvent) {
    e.preventDefault();
    selectedEvent = null;
    contextMenu = { x: e.clientX, y: e.clientY, event };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function closeDetail() {
    selectedEvent = null;
  }

  async function deleteEvent(event: CalEvent) {
    if (!event.itemId) return;
    const typeLabel = eventTypeMap[event.type]?.label || event.type;
    if (!confirm(`Delete this ${typeLabel.toLowerCase()} "${event.title}"? This removes the source item, not just this occurrence.`)) return;
    deleting = true;
    try {
      if (event.type === 'habit') await habitsApi.delete(event.itemId);
      else if (event.type === 'task') await tasksApi.delete(event.itemId);
      else if (event.type === 'meeting') await meetingsApi.delete(event.itemId);
      else return;
      closeDetail();
      closeContextMenu();
      await fetchEvents();
    } catch {
      error = 'Failed to delete event.';
    } finally {
      deleting = false;
    }
  }

  async function handleReschedule() {
    rescheduling = true;
    rescheduleResult = null;
    try {
      const result = await schedule.run();
      rescheduleResult = result;
      await fetchEvents();
    } catch {
      error = 'Failed to reschedule.';
    } finally {
      rescheduling = false;
    }
  }

  function canDelete(event: CalEvent): boolean {
    return !!event.itemId && ['habit', 'task', 'meeting'].includes(event.type);
  }

  function canLock(event: CalEvent): boolean {
    return event.type === 'habit' && !!event.itemId;
  }

  function isLocked(event: CalEvent): boolean {
    return event.status === 'locked';
  }

  async function toggleLock(event: CalEvent) {
    if (!event.itemId) return;
    try {
      await habitsApi.lock(event.itemId, !isLocked(event));
      await fetchEvents();
    } catch {
      error = 'Failed to toggle lock.';
    }
    closeContextMenu();
    closeDetail();
  }

  function formatFullDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function formatTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  function scrollToCurrentTime() {
    if (!scrollContainer) return;
    const now = new Date();
    const todayInWeek = getTodayDayIndex() >= 0;
    // Scroll to current time if viewing current week, otherwise scroll to 7 AM
    const targetHour = todayInWeek ? getHourInTz(now) - 1 : 7;
    const scrollTarget = Math.max(0, targetHour * HOUR_HEIGHT);
    scrollContainer.scrollTop = scrollTarget;
  }

  // Fetch user timezone from settings
  settingsApi.get()
    .then((config) => {
      if (config.settings?.timezone) {
        userTimezone = config.settings.timezone;
      }
    })
    .catch(() => {});

  $effect(() => {
    // Re-fetch whenever the week changes
    const _week = currentWeekStart;
    fetchEvents();
  });

  $effect(() => {
    // Auto-scroll to current time after loading completes
    if (!loading && scrollContainer) {
      // Small delay to ensure DOM is rendered
      requestAnimationFrame(() => scrollToCurrentTime());
    }
  });

  $effect(() => {
    if (rescheduleResult) {
      const timer = setTimeout(() => { rescheduleResult = null; }, 5000);
      return () => clearTimeout(timer);
    }
  });

  // WebSocket: auto-refresh calendar on schedule updates
  let wsToast = $state('');
  let wsToastTimeout: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const unsubscribe = subscribeWs((msg) => {
      if (msg.type === 'schedule_updated') {
        fetchEvents();
        wsToast = msg.reason || 'Schedule updated';
        if (wsToastTimeout) clearTimeout(wsToastTimeout);
        wsToastTimeout = setTimeout(() => { wsToast = ''; }, 3000);
      }
    });
    return () => unsubscribe();
  });
</script>

<svelte:head>
  <title>Schedule - Cadence</title>
</svelte:head>

<div class="dashboard">
  {#if wsToast}
    <div class="ws-toast">{wsToast}</div>
  {/if}

  <!-- Header -->
  <header class="dashboard-header">
    <div class="header-left">
      <h1 class="header-title">Schedule</h1>
      <span class="header-date-range font-mono">{formatWeekRange(currentWeekStart)}</span>
    </div>
    <div class="header-nav">
      <button class="reschedule-btn" onclick={handleReschedule} disabled={rescheduling}>
        <RefreshCw size={16} strokeWidth={1.5} class={rescheduling ? 'spinning' : ''} />
        {rescheduling ? 'Scheduling...' : 'Reschedule'}
      </button>
      <button
        onclick={prevWeek}
        aria-label="Previous week"
        class="nav-btn"
      >
        <ChevronLeft size={16} strokeWidth={1.5} />
      </button>
      <button
        onclick={goToday}
        class="today-btn"
      >
        Today
      </button>
      <button
        onclick={nextWeek}
        aria-label="Next week"
        class="nav-btn"
      >
        <ChevronRight size={16} strokeWidth={1.5} />
      </button>
    </div>
  </header>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  {#if rescheduleResult}
    <div class="reschedule-banner">
      &#10003; {rescheduleResult.operationsApplied} changes applied
      {#if rescheduleResult.unschedulable?.length > 0}
        &middot; {rescheduleResult.unschedulable.length} items couldn't be scheduled
      {/if}
    </div>
  {/if}

  {#if loading}
    <div class="loading-skeleton" aria-busy="true" aria-label="Loading schedule">
      <div class="skeleton-header">
        {#each Array(7) as _}
          <div class="skeleton-day-col">
            <div class="skeleton-pulse skeleton-day-label"></div>
          </div>
        {/each}
      </div>
      <div class="skeleton-grid">
        {#each Array(7) as _}
          <div class="skeleton-day-col">
            <div class="skeleton-pulse skeleton-block" style="height: 48px; margin-top: 40px;"></div>
            <div class="skeleton-pulse skeleton-block" style="height: 72px; margin-top: 24px;"></div>
            <div class="skeleton-pulse skeleton-block" style="height: 36px; margin-top: 48px;"></div>
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <!-- Calendar Grid -->
    <div class="calendar-container">
      <!-- Day Headers -->
      <div class="day-headers">
        <div class="time-col-header"></div>
        {#each getWeekDates(currentWeekStart) as date, i}
          <div class="day-header" class:day-header--today={isToday(date)}>
            <span class="day-header-name">{dayNames[i]}</span>
            <span class="day-header-date font-mono" class:day-header-date--today={isToday(date)}>
              {date.getDate()}
              {#if isToday(date)}
                <span class="today-dot"></span>
              {/if}
            </span>
          </div>
        {/each}
      </div>

      <!-- All-day events row -->
      {#if hasAnyAllDay}
        <div class="all-day-row">
          <div class="time-col-header all-day-label font-mono">All day</div>
          {#each Array(7) as _, dayIdx}
            <div class="all-day-cell">
              {#each getAllDayEventsForDay(dayIdx) as event}
                {@const styles = eventTypeMap[event.type] || eventTypeMap.external}
                <button
                  class="all-day-event"
                  style="background: {event.itemColor ? event.itemColor + '22' : styles.bg}; border-left: 3px solid {event.itemColor || styles.border};"
                  onclick={() => handleEventClick(event)}
                  aria-label="{event.title} (all day)"
                >
                  <span class="all-day-event-title">{event.title}</span>
                </button>
              {/each}
            </div>
          {/each}
        </div>
      {/if}

      <!-- Scrollable time grid -->
      <div class="time-grid-scroll" bind:this={scrollContainer}>
        <div class="time-grid" style="height: {GRID_HEIGHT}px;">
          <!-- Time Labels Column -->
          <div class="time-labels-col">
            {#each hours as hour, idx}
              <div class="time-label font-mono" style="top: {idx * HOUR_HEIGHT}px;">
                {formatHourLabel(hour)}
              </div>
            {/each}
          </div>

          <!-- Day Columns -->
          {#each Array(7) as _, dayIdx}
            {@const todayIdx = getTodayDayIndex()}
            <div class="day-col" class:day-col--today={dayIdx === todayIdx}>
              <!-- Hour grid lines -->
              {#each hours as _, hourIdx}
                <div class="hour-line" style="top: {hourIdx * HOUR_HEIGHT}px;"></div>
              {/each}

              <!-- Current time indicator -->
              {#if dayIdx === todayIdx && getCurrentTimePosition() >= 0}
                <div class="current-time-line" style="top: {getCurrentTimePosition()}px;">
                  <div class="current-time-dot"></div>
                </div>
              {/if}

              <!-- Events for this day -->
              {#each getEventsForDay(dayIdx) as event}
                {@const topOffset = (event.startHour - START_HOUR) * HOUR_HEIGHT}
                {@const height = event.duration * HOUR_HEIGHT}
                {@const colWidth = 100 / event.totalCols}
                {@const leftPct = event.col * colWidth}
                {@const styles = eventTypeMap[event.type] || eventTypeMap.external}
                {@const eventId = event.id || event.title}
                {@const hasConflict = conflicts.has(eventId)}
                {@const evBg = event.itemColor ? event.itemColor + '22' : styles.bg}
                {@const evBorder = event.itemColor || styles.border}
                <div
                  class="cal-event"
                  class:cal-event--conflict={hasConflict}
                  role="button"
                  tabindex="0"
                  style="
                    top: {topOffset}px;
                    height: {Math.max(height, 20)}px;
                    left: calc({leftPct}% + 2px);
                    width: calc({colWidth}% - 4px);
                    background-color: {evBg};
                    border-left-color: {evBorder};
                  "
                  aria-label="{formatHourAmPm(event.startHour)} - {formatHourAmPm(event.startHour + event.duration)}: {event.title}"
                  onclick={() => handleEventClick(event)}
                  oncontextmenu={(e) => handleEventContextMenu(e, event)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleEventClick(event);
                    if (e.key === 'F10' && e.shiftKey) {
                      e.preventDefault();
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      handleEventContextMenu(new MouseEvent('contextmenu', { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }), event);
                    }
                  }}
                >
                  <div class="cal-event-title">{event.title}</div>
                  {#if height > 28}
                    <div class="cal-event-time font-mono">
                      {formatStartTime(event.startHour)} - {formatEndTime(event.startHour, event.duration)}
                    </div>
                  {/if}
                  {#if hasConflict}
                    <span class="conflict-badge" title="Overlaps with {conflicts.get(eventId)?.join(', ')}">
                      <AlertTriangle size={10} strokeWidth={2} />
                    </span>
                  {/if}
                </div>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- Legend -->
    <div class="legend">
      {#each legendItems as item}
        {@const styles = eventTypeMap[item.type]}
        <span class="legend-chip">
          <span class="legend-dot" style="background-color: {styles.border};"></span>
          {item.label}
        </span>
      {/each}
    </div>
  {/if}
</div>

<!-- Event Detail Slide-over -->
{#if selectedEvent}
  {@const styles = eventTypeMap[selectedEvent.type] || eventTypeMap.external}
  <div class="detail-backdrop" onclick={closeDetail} onkeydown={(e) => { if (e.key === 'Escape') closeDetail(); }} role="button" tabindex="-1"></div>
  <div class="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-panel-title" tabindex="-1">
    <header class="detail-header">
      <div class="detail-type-badge" style="background: {styles.bg}; color: {styles.border}; border: 1px solid {styles.border};">
        {styles.label}
      </div>
      <button class="detail-close" onclick={closeDetail} aria-label="Close">
        <X size={16} strokeWidth={1.5} />
      </button>
    </header>

    <h2 id="detail-panel-title" class="detail-title">{selectedEvent.title}</h2>

    <!-- Date & Time -->
    <div class="detail-section">
      <div class="detail-icon-row">
        <CalendarDays size={16} strokeWidth={1.5} class="detail-icon" />
        <span>{formatFullDate(selectedEvent.startISO)}</span>
      </div>
      <div class="detail-icon-row">
        <Clock size={16} strokeWidth={1.5} class="detail-icon" />
        <span class="font-mono">{formatTime(selectedEvent.startISO)} – {formatTime(selectedEvent.endISO)}</span>
        <span class="detail-duration-chip font-mono">{Math.round(selectedEvent.duration * 60)}m</span>
      </div>
      {#if selectedEvent.location}
        <div class="detail-icon-row">
          <MapPin size={16} strokeWidth={1.5} class="detail-icon" />
          <span>{selectedEvent.location}</span>
        </div>
      {/if}
    </div>

    <!-- Details grid -->
    <div class="detail-meta">
      <div class="detail-row">
        <span class="detail-label">Type</span>
        <span class="detail-value">
          <span class="detail-type-dot" style="background: {styles.border};"></span>
          {styles.label}
        </span>
      </div>
      {#if selectedEvent.status}
        <div class="detail-row">
          <span class="detail-label">Status</span>
          <span class="detail-value detail-status-badge">{selectedEvent.status}</span>
        </div>
      {/if}
      {#if selectedEvent.calendarName}
        <div class="detail-row">
          <span class="detail-label">Calendar</span>
          <span class="detail-value">
            {#if selectedEvent.calendarColor}
              <span class="detail-cal-dot" style="background: {selectedEvent.calendarColor};"></span>
            {/if}
            {selectedEvent.calendarName}
          </span>
        </div>
      {/if}
      {#if selectedEvent.itemId}
        <div class="detail-row">
          <span class="detail-label">Source ID</span>
          <span class="detail-value font-mono" style="font-size: 0.6875rem; opacity: 0.7;">{selectedEvent.itemId.slice(0, 8)}...</span>
        </div>
      {/if}
    </div>

    <!-- Conflicts -->
    {#if conflicts.has(selectedEvent.id || selectedEvent.title)}
      <div class="detail-conflicts">
        <span class="detail-conflicts-heading">
          <AlertTriangle size={14} strokeWidth={1.5} />
          Conflicts
        </span>
        <ul class="detail-conflicts-list">
          {#each conflicts.get(selectedEvent.id || selectedEvent.title)! as conflictTitle}
            <li>{conflictTitle}</li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Actions -->
    {#if canLock(selectedEvent) || canDelete(selectedEvent)}
      <div class="detail-actions">
        {#if canLock(selectedEvent)}
          <button
            class="detail-lock-btn"
            onclick={() => toggleLock(selectedEvent!)}
          >
            {#if isLocked(selectedEvent)}
              <Unlock size={14} strokeWidth={1.5} />
              Unlock
            {:else}
              <Lock size={14} strokeWidth={1.5} />
              Lock
            {/if}
          </button>
        {/if}
        {#if canDelete(selectedEvent)}
          <button
            class="detail-delete-btn"
            onclick={() => deleteEvent(selectedEvent!)}
            disabled={deleting}
          >
            <Trash2 size={14} strokeWidth={1.5} />
            {deleting ? 'Deleting...' : `Delete ${styles.label}`}
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<!-- Context Menu -->
{#if contextMenu}
  {@const styles = eventTypeMap[contextMenu.event.type] || eventTypeMap.external}
  <div class="ctx-backdrop" onclick={closeContextMenu} onkeydown={(e) => { if (e.key === 'Escape') closeContextMenu(); }} role="button" tabindex="-1"></div>
  <div
    class="ctx-menu"
    role="menu"
    tabindex="-1"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
    onkeydown={(e) => {
      if (e.key === 'Escape') { closeContextMenu(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]');
        const current = Array.from(items).indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'ArrowDown'
          ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    }}
  >
    <button class="ctx-item" role="menuitem" onclick={() => { handleEventClick(contextMenu!.event); }}>
      <Eye size={14} strokeWidth={1.5} />
      View details
    </button>
    {#if canLock(contextMenu.event)}
      <button class="ctx-item" role="menuitem" onclick={() => { toggleLock(contextMenu!.event); }}>
        {#if isLocked(contextMenu.event)}
          <Unlock size={14} strokeWidth={1.5} />
          Unlock
        {:else}
          <Lock size={14} strokeWidth={1.5} />
          Lock
        {/if}
      </button>
    {/if}
    {#if canDelete(contextMenu.event)}
      <button class="ctx-item ctx-item--danger" role="menuitem" onclick={() => { deleteEvent(contextMenu!.event); }}>
        <Trash2 size={14} strokeWidth={1.5} />
        Delete {styles.label.toLowerCase()}
      </button>
    {/if}
    <div class="ctx-divider"></div>
    <div class="ctx-info">
      <span class="ctx-info-label">{contextMenu.event.title}</span>
      <span class="ctx-info-sub font-mono">{formatTime(contextMenu.event.startISO)} – {formatTime(contextMenu.event.endISO)}</span>
    </div>
  </div>
{/if}

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') { closeDetail(); closeContextMenu(); } }} />

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  // Dashboard Layout
  .dashboard {
    @include flex-col(var(--space-4));
  }

  // Header
  .dashboard-header {
    @include flex-between;

    @include mobile {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
    }
  }

  .header-left {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
  }

  .header-title {
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0;
  }

  .header-date-range {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .header-nav {
    display: flex;
    align-items: center;
    gap: var(--space-2);

    @include mobile {
      align-self: flex-end;
    }
  }

  .nav-btn {
    @include flex-center;
    @include touch-target;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    cursor: pointer;
    @include hover-surface;
  }

  .today-btn {
    padding: var(--space-1) var(--space-4);
    height: 32px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-accent);
    background: transparent;
    color: var(--color-accent);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);

    &:hover {
      background: var(--color-accent);
      color: var(--color-accent-text);
    }
  }

  // Reschedule Button
  .reschedule-btn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-4);
    height: 32px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-accent);
    background: var(--color-accent);
    color: var(--color-accent-text);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast), opacity var(--transition-fast);

    &:hover:not(:disabled) {
      background: var(--color-accent-hover);
      border-color: var(--color-accent-hover);
    }

    &:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }

    :global(.spinning) {
      animation: spin 1s linear infinite;
    }
  }

  // Reschedule Banner
  .reschedule-banner {
    padding: var(--space-3) var(--space-4);
    background: var(--color-success-muted);
    color: var(--color-success);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    animation: fadeIn 200ms ease;
  }

  // Error
  .error-banner {
    padding: var(--space-3) var(--space-4);
    background: var(--color-danger-muted);
    color: var(--color-danger);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
  }

  // Loading Skeleton
  .loading-skeleton {
    @include card;
    overflow: hidden;
  }

  .skeleton-header {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }

  .skeleton-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
    padding: var(--space-4);
    min-height: 320px;
  }

  .skeleton-day-col {
    @include flex-col;
    padding: 0 var(--space-1);
  }

  .skeleton-day-label {
    width: 40px;
    height: 14px;
    border-radius: var(--radius-sm);
  }

  .skeleton-block {
    width: 100%;
    border-radius: var(--radius-sm);
  }

  .skeleton-pulse {
    background: var(--color-surface-hover);
    animation: skeleton-pulse 1.5s ease-in-out infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }

  @keyframes skeleton-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  // Calendar Container
  .calendar-container {
    @include card;
    overflow: hidden;
  }

  // Day Headers
  .day-headers {
    display: grid;
    grid-template-columns: 64px repeat(7, 1fr);
    border-bottom: 1px solid var(--color-border);
  }

  .time-col-header {
    border-right: 1px solid var(--color-border);
  }

  .day-header {
    padding: var(--space-3);
    text-align: center;
    border-left: 1px solid var(--color-border);
    @include flex-col;
    align-items: center;
    gap: 2px;

    &-name {
      @include mono-label;
      color: var(--color-text-tertiary);
    }

    &-date {
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--color-text);
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 4px;

      &--today {
        color: var(--color-accent);
      }
    }
  }

  .today-dot {
    width: 5px;
    height: 5px;
    border-radius: var(--radius-full);
    background: var(--color-accent);
    display: inline-block;
  }

  // All-day events row
  .all-day-row {
    display: grid;
    grid-template-columns: 64px repeat(7, 1fr);
    border-bottom: 1px solid var(--color-border);
  }

  .all-day-label {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: var(--space-2);
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
  }

  .all-day-cell {
    border-left: 1px solid var(--color-border);
    padding: var(--space-1);
    @include flex-col;
    gap: 2px;
    min-height: 28px;
  }

  .all-day-event {
    display: block;
    width: 100%;
    padding: 2px var(--space-2);
    border-radius: var(--radius-sm);
    border: none;
    cursor: pointer;
    text-align: left;
    transition: filter var(--transition-fast);

    &:hover {
      filter: brightness(0.95);
    }

    &-title {
      font-size: 0.6875rem;
      font-weight: 500;
      color: var(--color-text);
      @include text-truncate;
    }
  }

  // Time Grid
  .time-grid-scroll {
    overflow-y: auto;
    max-height: calc(100vh - 200px);
  }

  .time-grid {
    display: grid;
    grid-template-columns: 64px repeat(7, 1fr);
    position: relative;
  }

  .time-labels-col {
    position: relative;
    border-right: 1px solid var(--color-border);
  }

  .time-label {
    position: absolute;
    right: var(--space-2);
    transform: translateY(-50%);
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    white-space: nowrap;
    pointer-events: none;
  }

  // Day Columns
  .day-col {
    position: relative;
    border-left: 1px solid var(--color-border);

    &--today {
      background: var(--color-accent-muted);
    }
  }

  .hour-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    border-bottom: 1px solid var(--color-border);
  }

  // Current Time Indicator
  .current-time-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    border-top: 2px solid var(--color-accent);
    z-index: 20;
    pointer-events: none;
  }

  .current-time-dot {
    position: absolute;
    left: -4px;
    top: -5px;
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--color-accent);
  }

  // Events
  .cal-event {
    position: absolute;
    z-index: 10;
    border-radius: var(--radius-md);
    border-left: 3px solid;
    padding: var(--space-1) var(--space-2);
    overflow: hidden;
    cursor: pointer;
    transition: filter var(--transition-fast);

    &:hover {
      filter: brightness(0.95);
    }

    &-title {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--color-text);
      @include text-truncate;
      line-height: 1.3;
    }

    &-time {
      font-size: 0.625rem;
      color: var(--color-text-secondary);
      line-height: 1.3;
    }

    &--conflict {
      box-shadow: 0 0 0 1px var(--color-warning-amber);
    }
  }

  .conflict-badge {
    position: absolute;
    top: 2px;
    right: 4px;
    @include flex-center;
    width: 16px;
    height: 16px;
    border-radius: var(--radius-full);
    background: var(--color-warning-amber-bg);
    color: var(--color-warning-amber);
  }

  // Detail conflicts section
  .detail-conflicts {
    @include flex-col(var(--space-2));
    padding: var(--space-3) var(--space-4);
    background: var(--color-warning-amber-bg);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-warning-amber);

    &-heading {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--color-warning-amber);
    }

    &-list {
      margin: 0;
      padding-left: var(--space-5);
      font-size: 0.8125rem;
      color: var(--color-text-secondary);
      @include flex-col;
      gap: 2px;
    }
  }

  // Legend
  .legend {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-4);
    padding-top: var(--space-2);

    &-chip {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      font-size: 0.75rem;
      color: var(--color-text-tertiary);
    }

    &-dot {
      width: 8px;
      height: 8px;
      border-radius: var(--radius-full);
      flex-shrink: 0;
    }
  }

  // Event Detail Slide-over
  .detail-backdrop {
    @include backdrop(0.3);
    z-index: 40;
  }

  .detail-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 400px;
    max-width: 100vw;
    background: var(--color-surface);
    border-left: 1px solid var(--color-border);
    z-index: 50;
    padding: var(--space-6);
    @include flex-col(var(--space-4));
    animation: slideInRight 200ms ease;

    @keyframes slideInRight {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }
  }

  .detail-header {
    @include flex-between;
  }

  .detail-type-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 2px 10px;
    border-radius: var(--radius-full);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .detail-close {
    @include flex-center;
    @include touch-target;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: background var(--transition-fast);

    &:hover {
      background: var(--color-surface-hover);
      color: var(--color-text);
    }
  }

  .detail-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0;
  }

  .detail-section {
    @include flex-col(var(--space-2));
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }

  .detail-icon-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.8125rem;
    color: var(--color-text);

    :global(.detail-icon) {
      color: var(--color-text-tertiary);
      flex-shrink: 0;
    }
  }

  .detail-duration-chip {
    font-size: 0.6875rem;
    background: var(--color-surface-hover);
    padding: 1px 6px;
    border-radius: var(--radius-full);
    color: var(--color-text-secondary);
    margin-left: auto;
  }

  .detail-meta {
    @include flex-col(var(--space-3));
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .detail-label {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
  }

  .detail-value {
    font-size: 0.8125rem;
    color: var(--color-text);
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .detail-type-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }

  .detail-cal-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }

  .detail-status-badge {
    text-transform: capitalize;
  }

  .detail-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-4);
    margin-top: auto;
    border-top: 1px solid var(--color-border);
  }

  .detail-lock-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);

    &:hover {
      background: var(--color-surface-active);
      color: var(--color-text);
    }
  }

  .detail-delete-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger);
    background: transparent;
    color: var(--color-danger);
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);

    &:hover:not(:disabled) {
      background: var(--color-danger);
      color: white;
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  // Context Menu
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }

  .ctx-menu {
    position: fixed;
    z-index: 60;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    min-width: 180px;
    padding: var(--space-1);
    animation: fadeIn 100ms ease;

    @keyframes fadeIn {
      from { opacity: 0; transform: scale(0.96); }
      to { opacity: 1; transform: scale(1); }
    }
  }

  .ctx-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: none;
    background: transparent;
    color: var(--color-text);
    font-size: 0.8125rem;
    text-align: left;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);

    &:hover {
      background: var(--color-surface-hover);
    }

    &--danger {
      color: var(--color-danger);

      &:hover {
        background: var(--color-danger-muted);
      }
    }
  }

  .ctx-divider {
    height: 1px;
    background: var(--color-border);
    margin: var(--space-1) 0;
  }

  .ctx-info {
    padding: var(--space-2) var(--space-3);
    @include flex-col;
    gap: 2px;

    &-label {
      font-size: 0.75rem;
      color: var(--color-text-secondary);
      font-weight: 500;
    }

    &-sub {
      font-size: 0.6875rem;
      color: var(--color-text-tertiary);
    }
  }

  // WebSocket toast
  .ws-toast {
    position: fixed;
    bottom: var(--space-6);
    right: var(--space-6);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-lg);
    font-size: 0.8125rem;
    border: 1px solid var(--color-border);
    z-index: 1000;
    animation: toast-in var(--transition-slow) ease-out;
    pointer-events: none;

    @keyframes toast-in {
      from { opacity: 0; transform: translateY(0.5rem); }
      to { opacity: 1; transform: translateY(0); }
    }
  }
</style>
