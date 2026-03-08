<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { onMount, onDestroy } from 'svelte';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import Check from 'lucide-svelte/icons/check';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import Download from 'lucide-svelte/icons/download';
  import { settings as settingsApi, buffers as buffersApi, calendars as calendarsApi, schedule as scheduleApi, auth as authApi, schedulingTemplates as templatesApi } from '$lib/api';
  import type { SessionInfo, SchedulingTemplate } from '$lib/api';
  import Plus from 'lucide-svelte/icons/plus';
  import Clock from 'lucide-svelte/icons/clock';
  import type { Calendar } from '@cadence/shared';
  import { CalendarMode, DecompressionTarget } from '@cadence/shared';
  import Lock from 'lucide-svelte/icons/lock';
  import Monitor from 'lucide-svelte/icons/monitor';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Shield from 'lucide-svelte/icons/shield';

  // Google connection
  let googleConnected = $state(false);
  let loading = $state(true);

  // Unified notification state (#12)
  let notification = $state<{ type: 'error' | 'success'; message: string } | null>(null);
  let notificationTimer: ReturnType<typeof setTimeout> | undefined;

  function clearNotification() {
    if (notificationTimer) clearTimeout(notificationTimer);
    notification = null;
  }

  function showError(msg: string) {
    clearNotification();
    notification = { type: 'error', message: msg };
  }

  function showSuccess(msg: string) {
    clearNotification();
    notification = { type: 'success', message: msg };
    notificationTimer = setTimeout(() => { notification = null; }, 3000);
  }

  // Working hours
  let workStart = $state('09:00');
  let workEnd = $state('17:00');

  // Personal hours
  let personalStart = $state('17:00');
  let personalEnd = $state('22:00');

  // General
  let timezone = $state('America/New_York');
  let schedulingWindowDays = $state(14);

  // Buffers
  let travelTime = $state(15);
  let decompressionTime = $state(5);
  let breakBetween = $state(10);
  let decompApplyTo = $state<DecompressionTarget>(DecompressionTarget.All);

  // Calendars (#4 — typed properly)
  let calendarList = $state<Calendar[]>([]);
  let discoveringCalendars = $state(false);
  let defaultHabitCalendarId = $state('primary');
  let defaultTaskCalendarId = $state('primary');

  // Save status
  let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let saveStatusTimer: ReturnType<typeof setTimeout> | undefined;

  // Load failure guard — prevents saving default values when API failed
  let loadFailed = $state(false);

  // PWA install prompt
  let installPrompt = $state<BeforeInstallPromptEvent | null>(null);
  let pwaInstalled = $state(false);

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  // Danger zone inline confirmation (#13)
  let confirmingDanger = $state(false);
  let dangerConfirmText = $state('');
  let nuking = $state(false);

  // Account info
  let userName = $state('');
  let userEmail = $state('');
  let userAvatarUrl = $state<string | null>(null);
  let userHasPassword = $state(false);

  // Change password
  let showChangePassword = $state(false);
  let currentPassword = $state('');
  let newPassword = $state('');
  let changingPassword = $state(false);

  // Data export
  let exporting = $state(false);

  // Sessions
  let sessionList = $state<SessionInfo[]>([]);
  let revokingAll = $state(false);

  // Account deletion
  let confirmingDelete = $state(false);
  let deleteConfirmEmail = $state('');
  let deleting = $state(false);
  let deletePassword = $state('');

  // Scheduling templates
  let templates = $state<SchedulingTemplate[]>([]);
  let newTemplateName = $state('');
  let newTemplateStart = $state('09:00');
  let newTemplateEnd = $state('17:00');
  let templateError = $state('');
  let addingTemplate = $state(false);

  // Validation (#10)
  let hoursError = $derived.by(() => {
    const errors: string[] = [];
    if (workEnd <= workStart) errors.push('Work end time must be after start time.');
    if (personalEnd <= personalStart) errors.push('Personal end time must be after start time.');
    return errors.join(' ');
  });
  let hoursValid = $derived(hoursError === '');

  // Writable calendars for default-calendar selects (#5)
  let writableCalendars = $derived(calendarList.filter((c: Calendar) => c.enabled && c.mode === 'writable'));

  // Timezone grouping (#6)
  interface TimezoneGroup {
    label: string;
    zones: string[];
  }

  function groupTimezones(): TimezoneGroup[] {
    const allZones = Intl.supportedValuesOf('timeZone');
    const groups = new Map<string, string[]>();
    const ungrouped: string[] = [];

    for (const tz of allZones) {
      const slashIdx = tz.indexOf('/');
      if (slashIdx > 0) {
        const region = tz.substring(0, slashIdx);
        const existing = groups.get(region);
        if (existing) {
          existing.push(tz);
        } else {
          groups.set(region, [tz]);
        }
      } else {
        ungrouped.push(tz);
      }
    }

    const result: TimezoneGroup[] = [];
    for (const [label, zones] of groups) {
      result.push({ label, zones });
    }
    if (ungrouped.length > 0) {
      result.push({ label: 'Other', zones: ungrouped });
    }
    return result;
  }

  const timezoneGroups = groupTimezones();

  async function saveSettings() {
    clearNotification();

    // Validate scheduling window (#11)
    if (schedulingWindowDays < 1 || schedulingWindowDays > 90) {
      showError('Scheduling window must be between 1 and 90 days.');
      return;
    }

    // Validate hours (#10)
    if (!hoursValid) {
      showError(hoursError);
      return;
    }

    saveStatus = 'saving';
    try {
      await settingsApi.update({
        workingHours: { start: workStart, end: workEnd },
        personalHours: { start: personalStart, end: personalEnd },
        timezone,
        schedulingWindowDays,
        defaultHabitCalendarId,
        defaultTaskCalendarId,
      });
      await buffersApi.update({
        travelTimeMinutes: travelTime,
        decompressionMinutes: decompressionTime,
        breakBetweenItemsMinutes: breakBetween,
        applyDecompressionTo: decompApplyTo,
      });
      saveStatus = 'saved';
      showSuccess('Settings saved successfully.');
    } catch {
      saveStatus = 'error';
      showError('Failed to save settings.');
    }
    if (saveStatusTimer) clearTimeout(saveStatusTimer);
    saveStatusTimer = setTimeout(() => { saveStatus = 'idle'; }, 2000);
  }

  async function discoverCalendars() {
    discoveringCalendars = true;
    clearNotification();
    try {
      calendarList = await calendarsApi.discover();
      showSuccess('Calendars refreshed from Google.');
    } catch {
      showError('Failed to discover calendars.');
    } finally {
      discoveringCalendars = false;
    }
  }

  async function toggleCalendar(cal: Calendar) {
    clearNotification();
    try {
      const updated = await calendarsApi.update(cal.id, { enabled: !cal.enabled });
      calendarList = calendarList.map((c: Calendar) => c.id === cal.id ? updated : c);
    } catch {
      showError('Failed to update calendar.');
    }
  }

  async function setCalendarMode(cal: Calendar, mode: CalendarMode) {
    clearNotification();
    try {
      const updated = await calendarsApi.update(cal.id, { mode });
      calendarList = calendarList.map((c: Calendar) => c.id === cal.id ? updated : c);
    } catch {
      showError('Failed to update calendar mode.');
    }
  }

  // Danger zone: two-step confirmation (#13)
  function handleDangerClick() {
    if (!confirmingDanger) {
      confirmingDanger = true;
      return;
    }
    if (dangerConfirmText !== 'DELETE') return;
    nukeAllManagedEvents();
  }

  function cancelDanger() {
    confirmingDanger = false;
    dangerConfirmText = '';
  }

  async function nukeAllManagedEvents() {
    nuking = true;
    clearNotification();
    try {
      const result = await scheduleApi.deleteAllManaged();
      showSuccess(`Deleted ${result.googleEventsDeleted} events from Google Calendar and ${result.localEventsDeleted} from local database.`);
    } catch {
      showError('Failed to delete managed events.');
    } finally {
      nuking = false;
      confirmingDanger = false;
      dangerConfirmText = '';
    }
  }

  // Google toggle: connect or disconnect (#1 — CRITICAL fix)
  async function handleGoogleToggle() {
    clearNotification();
    if (googleConnected) {
      try {
        await settingsApi.disconnectGoogle();
        googleConnected = false;
        showSuccess('Google Calendar disconnected.');
      } catch {
        showError('Failed to disconnect.');
      }
    } else {
      try {
        const res = await settingsApi.connectGoogle();
        if (res.redirectUrl && res.redirectUrl.startsWith('https://accounts.google.com/')) {
          window.location.href = res.redirectUrl;
        } else if (res.redirectUrl) {
          notification = { type: 'error', message: 'Unexpected OAuth redirect URL' };
        }
      } catch {
        showError('Failed to start Google connection.');
      }
    }
  }

  async function handleInstallApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      pwaInstalled = true;
      installPrompt = null;
    }
  }

  // Account initials
  let initials = $derived(
    userName
      ? userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
      : userEmail ? userEmail[0].toUpperCase() : '?'
  );

  // Change password
  async function handleChangePassword() {
    if (!currentPassword || !newPassword) return;
    changingPassword = true;
    clearNotification();
    try {
      await authApi.changePassword(currentPassword, newPassword);
      showSuccess('Password changed successfully.');
      showChangePassword = false;
      currentPassword = '';
      newPassword = '';
    } catch (e: any) {
      showError(e?.message || 'Failed to change password.');
    } finally {
      changingPassword = false;
    }
  }

  // Export data
  async function handleExportData() {
    exporting = true;
    clearNotification();
    try {
      await authApi.exportData();
      showSuccess('Data export downloaded.');
    } catch {
      showError('Failed to export data.');
    } finally {
      exporting = false;
    }
  }

  // Sessions
  async function loadSessions() {
    try {
      const result = await authApi.getSessions();
      sessionList = result.sessions;
    } catch {
      // silent fail on session load
    }
  }

  async function handleRevokeSession(id: string) {
    clearNotification();
    try {
      await authApi.revokeSession(id);
      sessionList = sessionList.filter(s => s.id !== id);
      showSuccess('Session revoked.');
    } catch {
      showError('Failed to revoke session.');
    }
  }

  async function handleRevokeOtherSessions() {
    revokingAll = true;
    clearNotification();
    try {
      await authApi.revokeOtherSessions();
      sessionList = sessionList.filter(s => s.current);
      showSuccess('All other sessions revoked.');
    } catch {
      showError('Failed to revoke sessions.');
    } finally {
      revokingAll = false;
    }
  }

  // Account deletion
  async function handleDeleteAccount() {
    if (deleteConfirmEmail !== userEmail) return;
    deleting = true;
    clearNotification();
    try {
      await authApi.deleteAccount(userHasPassword ? deletePassword : undefined);
      window.location.href = '/login?deleted=true';
    } catch (e: any) {
      showError(e?.message || 'Failed to delete account.');
      deleting = false;
    }
  }

  async function loadTemplates() {
    try {
      const result = await templatesApi.list();
      templates = result.templates;
    } catch {
      // Non-critical — don't block settings load
    }
  }

  async function addTemplate() {
    templateError = '';
    const name = newTemplateName.trim();
    if (!name) {
      templateError = 'Name is required.';
      return;
    }
    if (name.length > 50) {
      templateError = 'Name must be 50 characters or less.';
      return;
    }
    if (newTemplateStart >= newTemplateEnd) {
      templateError = 'Start time must be before end time.';
      return;
    }
    if (templates.length >= 8) {
      templateError = 'Maximum 8 templates allowed.';
      return;
    }
    addingTemplate = true;
    try {
      const result = await templatesApi.create({
        name,
        startTime: newTemplateStart,
        endTime: newTemplateEnd,
      });
      templates = [...templates, result.template];
      newTemplateName = '';
      newTemplateStart = '09:00';
      newTemplateEnd = '17:00';
      showSuccess('Template added.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to add template.';
      templateError = msg.length > 200 ? msg.slice(0, 200) + '...' : msg;
    } finally {
      addingTemplate = false;
    }
  }

  async function deleteTemplate(id: string) {
    try {
      await templatesApi.delete(id);
      templates = templates.filter(t => t.id !== id);
      showSuccess('Template deleted.');
    } catch {
      showError('Failed to delete template.');
    }
  }

  function handleInstallPrompt(e: Event) {
    e.preventDefault();
    installPrompt = e as BeforeInstallPromptEvent;
  }

  function handleInstalled() {
    pwaInstalled = true;
    installPrompt = null;
  }

  onDestroy(() => {
    if (saveStatusTimer) clearTimeout(saveStatusTimer);
    clearNotification();
    window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
    window.removeEventListener('appinstalled', handleInstalled);
  });

  onMount(async () => {
    // PWA install prompt
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    // Check if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      pwaInstalled = true;
    }

    loading = true;
    clearNotification();
    try {
      const [config, bufferConfig, cals, authStatus, meResult] = await Promise.all([
        settingsApi.get(),
        buffersApi.get(),
        calendarsApi.list(),
        settingsApi.getGoogleStatus(),
        authApi.me(),
      ]);

      if (meResult.user) {
        userName = meResult.user.name || '';
        userEmail = meResult.user.email || '';
        userAvatarUrl = meResult.user.avatarUrl || null;
        userHasPassword = !!meResult.user.hasPassword;
      }

      // Load sessions and templates in background
      loadSessions();
      loadTemplates();

      calendarList = cals;
      googleConnected = authStatus.connected;

      if (config.settings) {
        workStart = config.settings.workingHours?.start ?? '09:00';
        workEnd = config.settings.workingHours?.end ?? '17:00';
        personalStart = config.settings.personalHours?.start ?? '17:00';
        personalEnd = config.settings.personalHours?.end ?? '22:00';
        timezone = config.settings.timezone ?? 'America/New_York';
        schedulingWindowDays = config.settings.schedulingWindowDays ?? 14;
        defaultHabitCalendarId = config.settings.defaultHabitCalendarId ?? 'primary';
        defaultTaskCalendarId = config.settings.defaultTaskCalendarId ?? 'primary';
      }

      travelTime = bufferConfig.travelTimeMinutes ?? 15;
      decompressionTime = bufferConfig.decompressionMinutes ?? 5;
      breakBetween = bufferConfig.breakBetweenItemsMinutes ?? 10;
      decompApplyTo = bufferConfig.applyDecompressionTo ?? DecompressionTarget.All;
    } catch {
      loadFailed = true;
      showError('Failed to load settings. Displaying defaults — saving is disabled.');
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>{pageTitle('Settings')}</title>
</svelte:head>

<main class="settings-page">
  <h1 class="settings-title" id="settings-heading">Settings</h1>

  {#if notification}
    <div
      role="alert"
      aria-live="assertive"
      class={notification.type === 'error' ? 'alert-error' : 'alert-success'}
    >
      {notification.message}
    </div>
  {/if}

  {#if loading}
    <div class="settings-loading" role="status" aria-live="polite">
      <p>Loading...</p>
    </div>
  {:else}
    <div class="settings-sections">

      <!-- Google Account -->
      <section aria-labelledby="google-heading" class="settings-section">
        <h2 id="google-heading" class="section-heading">Google Account</h2>
        <div class="section-row">
          <div class="status-indicator">
            <span
              aria-hidden="true"
              class="status-dot"
              class:status-dot--connected={googleConnected}
            ></span>
            <span class="status-label">
              {googleConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <button class="btn-cancel" onclick={handleGoogleToggle}>
            {googleConnected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
      </section>

      <hr class="section-divider" />

      <!-- Calendars -->
      {#if googleConnected}
        <section aria-labelledby="calendars-heading" class="settings-section">
          <div class="section-row">
            <h2 id="calendars-heading" class="section-heading section-heading--inline">Calendars</h2>
            <button
              class="btn-action"
              onclick={discoverCalendars}
              disabled={discoveringCalendars}
            >
              <RefreshCw size={14} class={discoveringCalendars ? 'spinning' : ''} />
              {discoveringCalendars ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {#if calendarList.length === 0}
            <p class="text-hint">No calendars found. Click Refresh to discover your calendars.</p>
          {:else}
            <!-- Calendar table -->
            <div class="cal-table">
              {#each calendarList as cal, i}
                <div class="cal-row" class:cal-row--bordered={i > 0}>
                  <div class="cal-info">
                    <span class="cal-dot" style:background={cal.color ?? 'var(--color-accent)'}></span>
                    <span class="cal-name">{cal.name}</span>
                  </div>
                  <div class="cal-actions">
                    {#if cal.enabled && cal.googleCalendarId !== 'primary'}
                      <select
                        value={cal.mode}
                        onchange={(e) => setCalendarMode(cal, e.currentTarget.value as CalendarMode)}
                        aria-label={`Mode for ${cal.name}`}
                        class="cal-mode-select"
                      >
                        <option value="writable">Writable</option>
                        <option value="locked">Locked</option>
                      </select>
                    {/if}
                    {#if cal.googleCalendarId !== 'primary'}
                      <button
                        onclick={() => toggleCalendar(cal)}
                        role="switch"
                        aria-checked={cal.enabled}
                        aria-label="Toggle {cal.name}"
                        class="toggle-switch"
                        class:toggle-switch--on={cal.enabled}
                      >
                        <span
                          class="toggle-switch-knob"
                          class:toggle-switch-knob--on={cal.enabled}
                        ></span>
                      </button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>

            <!-- Default Calendars -->
            <div class="default-cals">
              <h3 class="subsection-heading">Default Calendars</h3>
              <div class="form-row">
                <div class="form-field">
                  <label for="default-habit-cal">Habits</label>
                  {#if writableCalendars.length === 0}
                    <select id="default-habit-cal" disabled>
                      <option value="">-- no writable calendars --</option>
                    </select>
                    <span class="text-hint">Enable a writable calendar above to select a default.</span>
                  {:else}
                    <select id="default-habit-cal" bind:value={defaultHabitCalendarId}>
                      {#each writableCalendars as cal}
                        <option value={cal.id}>{cal.name}</option>
                      {/each}
                    </select>
                  {/if}
                </div>
                <div class="form-field">
                  <label for="default-task-cal">Tasks</label>
                  {#if writableCalendars.length === 0}
                    <select id="default-task-cal" disabled>
                      <option value="">-- no writable calendars --</option>
                    </select>
                    <span class="text-hint">Enable a writable calendar above to select a default.</span>
                  {:else}
                    <select id="default-task-cal" bind:value={defaultTaskCalendarId}>
                      {#each writableCalendars as cal}
                        <option value={cal.id}>{cal.name}</option>
                      {/each}
                    </select>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        </section>

        <hr class="section-divider" />
      {/if}

      <!-- Working Hours -->
      <section aria-labelledby="work-hours-heading" class="settings-section">
        <h2 id="work-hours-heading" class="section-heading">Working Hours</h2>
        <div class="form-row">
          <div class="form-field">
            <label for="work-start">Start</label>
            <input
              id="work-start"
              type="time"
              bind:value={workStart}
              class="font-mono"
            />
          </div>
          <div class="form-field">
            <label for="work-end">End</label>
            <input
              id="work-end"
              type="time"
              bind:value={workEnd}
              class="font-mono"
              aria-invalid={workEnd <= workStart}
            />
          </div>
        </div>
        {#if workEnd <= workStart}
          <p class="validation-error">End time must be after start time.</p>
        {/if}
      </section>

      <hr class="section-divider" />

      <!-- Personal Hours -->
      <section aria-labelledby="personal-hours-heading" class="settings-section">
        <h2 id="personal-hours-heading" class="section-heading">Personal Hours</h2>
        <div class="form-row">
          <div class="form-field">
            <label for="personal-start">Start</label>
            <input
              id="personal-start"
              type="time"
              bind:value={personalStart}
              class="font-mono"
            />
          </div>
          <div class="form-field">
            <label for="personal-end">End</label>
            <input
              id="personal-end"
              type="time"
              bind:value={personalEnd}
              class="font-mono"
              aria-invalid={personalEnd <= personalStart}
            />
          </div>
        </div>
        {#if personalEnd <= personalStart}
          <p class="validation-error">End time must be after start time.</p>
        {/if}
      </section>

      <hr class="section-divider" />

      <!-- Scheduling Templates -->
      <section aria-labelledby="templates-heading" class="settings-section">
        <div class="section-header-row">
          <h2 id="templates-heading" class="section-heading">Scheduling Templates</h2>
          <span class="template-count">{templates.length} / 8</span>
        </div>
        <p class="section-description">Define reusable time windows for habits, tasks, and focus time.</p>

        {#if templates.length === 0}
          <p class="empty-message">No custom templates yet.</p>
        {:else}
          <div class="template-list">
            {#each templates as template (template.id)}
              <div class="template-item">
                <div class="template-info">
                  <Clock size={14} />
                  <span class="template-name">{template.name}</span>
                  <span class="template-time font-mono">{template.startTime} – {template.endTime}</span>
                </div>
                <button
                  class="btn-icon-danger"
                  onclick={() => deleteTemplate(template.id)}
                  aria-label="Delete template {template.name}"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            {/each}
          </div>
        {/if}

        {#if templates.length < 8}
          <div class="template-form">
            <div class="form-field">
              <input
                type="text"
                placeholder="Template name"
                bind:value={newTemplateName}
                maxlength={50}
              />
            </div>
            <div class="form-field">
              <input
                type="time"
                bind:value={newTemplateStart}
                class="font-mono"
              />
            </div>
            <div class="form-field">
              <input
                type="time"
                bind:value={newTemplateEnd}
                class="font-mono"
                aria-invalid={newTemplateStart >= newTemplateEnd}
              />
            </div>
            <button
              class="btn-sm btn-primary"
              onclick={addTemplate}
              disabled={addingTemplate}
            >
              <Plus size={14} />
              Add
            </button>
          </div>
          {#if templateError}
            <p class="validation-error">{templateError}</p>
          {/if}
        {/if}
      </section>

      <hr class="section-divider" />

      <!-- General -->
      <section aria-labelledby="general-heading" class="settings-section">
        <h2 id="general-heading" class="section-heading">General</h2>
        <div class="form-row">
          <div class="form-field">
            <label for="settings-timezone">Timezone</label>
            <select id="settings-timezone" bind:value={timezone}>
              {#each timezoneGroups as group}
                <optgroup label={group.label}>
                  {#each group.zones as tz}
                    <option value={tz}>{tz.replace(/_/g, ' ')}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
          </div>
          <div class="form-field">
            <label for="settings-window">Scheduling Window</label>
            <div class="input-with-suffix">
              <input
                id="settings-window"
                type="number"
                bind:value={schedulingWindowDays}
                min="1"
                max="90"
                class="font-mono"
              />
              <span class="input-suffix">days</span>
            </div>
          </div>
        </div>
      </section>

      <hr class="section-divider" />

      <!-- Buffers -->
      <section aria-labelledby="buffers-heading" class="settings-section">
        <h2 id="buffers-heading" class="section-heading">Buffers</h2>
        <div class="form-grid-3">
          <div class="form-field">
            <label for="buffer-travel">Travel (min)</label>
            <input
              id="buffer-travel"
              type="number"
              bind:value={travelTime}
              min="0"
              max="120"
              class="font-mono"
            />
          </div>
          <div class="form-field">
            <label for="buffer-decomp">Decompression (min)</label>
            <input
              id="buffer-decomp"
              type="number"
              bind:value={decompressionTime}
              min="0"
              max="60"
              class="font-mono"
            />
          </div>
          <div class="form-field">
            <label for="buffer-break">Break (min)</label>
            <input
              id="buffer-break"
              type="number"
              bind:value={breakBetween}
              min="0"
              max="60"
              class="font-mono"
            />
          </div>
        </div>
        <div class="form-field decomp-field">
          <label for="buffer-decomp-apply">Apply Decompression To</label>
          <select id="buffer-decomp-apply" bind:value={decompApplyTo} class="decomp-select">
            <option value={DecompressionTarget.All}>All Meetings</option>
            <option value={DecompressionTarget.VideoOnly}>Video Calls Only</option>
          </select>
        </div>
      </section>

      <!-- Install App -->
      {#if installPrompt || pwaInstalled}
        <hr class="section-divider" />

        <section aria-labelledby="install-heading" class="settings-section">
          <h2 id="install-heading" class="section-heading">Install App</h2>
          {#if pwaInstalled}
            <p class="text-hint">Cadence is installed on this device.</p>
          {:else}
            <p class="text-hint install-desc">Install Cadence as a standalone app for quick access.</p>
            <button class="btn-install" onclick={handleInstallApp}>
              <Download size={14} />
              Install Cadence
            </button>
          {/if}
        </section>
      {/if}

      <!-- Account -->
      <hr class="section-divider" />

      <section aria-labelledby="account-heading" class="settings-section">
        <h2 id="account-heading" class="section-heading">Account</h2>

        <div class="account-info">
          <div class="account-avatar">
            {#if userAvatarUrl}
              <img src={userAvatarUrl} alt="" class="account-avatar-img" referrerpolicy="no-referrer" onerror={(e: Event) => { userAvatarUrl = null; }} />
            {:else}
              {initials}
            {/if}
          </div>
          <div class="account-details">
            <span class="account-name">{userName || 'No name set'}</span>
            <span class="account-email">{userEmail}</span>
          </div>
        </div>

        <div class="account-actions">
          <button class="btn-action" onclick={() => { showChangePassword = !showChangePassword; }}>
            <Lock size={14} />
            Change password
          </button>
        </div>

        {#if showChangePassword}
          <div class="change-password-form">
            <div class="form-field">
              <label for="current-pw">Current password</label>
              <input
                id="current-pw"
                type="password"
                bind:value={currentPassword}
                placeholder="Enter current password"
              />
            </div>
            <div class="form-field">
              <label for="new-pw">New password</label>
              <input
                id="new-pw"
                type="password"
                bind:value={newPassword}
                placeholder="Min. 8 characters"
                minlength="8"
              />
            </div>
            <div class="change-password-actions">
              <button
                class="btn-action"
                onclick={handleChangePassword}
                disabled={changingPassword || !currentPassword || newPassword.length < 8}
              >
                {changingPassword ? 'Saving...' : 'Update password'}
              </button>
              <button class="btn-cancel" onclick={() => { showChangePassword = false; currentPassword = ''; newPassword = ''; }}>
                Cancel
              </button>
            </div>
          </div>
        {/if}
      </section>

      <!-- Privacy & Data -->
      <hr class="section-divider" />

      <section aria-labelledby="privacy-heading" class="settings-section">
        <h2 id="privacy-heading" class="section-heading">Privacy & Data</h2>

        <div class="privacy-actions">
          <div class="privacy-item">
            <div class="privacy-item-info">
              <h3>Export data</h3>
              <p>Download all your habits, tasks, and settings as JSON.</p>
            </div>
            <button class="btn-action" onclick={handleExportData} disabled={exporting}>
              <Download size={14} />
              {exporting ? 'Exporting...' : 'Export'}
            </button>
          </div>

          <div class="privacy-item">
            <div class="privacy-item-info">
              <h3>Active sessions</h3>
              <p>You are signed in on {sessionList.length} device(s).</p>
            </div>
            <button
              class="btn-action"
              onclick={handleRevokeOtherSessions}
              disabled={revokingAll || sessionList.filter(s => !s.current).length === 0}
            >
              {revokingAll ? 'Revoking...' : 'Sign out other devices'}
            </button>
          </div>

          {#if sessionList.length > 0}
            <div class="session-list">
              {#each sessionList as session}
                <div class="session-row" class:session-row--current={session.current}>
                  <div class="session-info">
                    <Monitor size={14} class="session-icon" />
                    <div class="session-details">
                      <span class="session-agent">{session.userAgent ? session.userAgent.substring(0, 60) : 'Unknown device'}{session.current ? ' (current)' : ''}</span>
                      <span class="session-meta">
                        {session.ipAddress || 'Unknown IP'}
                        {' \u00b7 '}
                        {new Date(session.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  {#if !session.current}
                    <button
                      class="btn-session-revoke"
                      onclick={() => handleRevokeSession(session.id)}
                      aria-label="Revoke session"
                    >
                      Revoke
                    </button>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          <div class="privacy-item">
            <div class="privacy-item-info">
              <h3>Privacy policy</h3>
              <p>Learn how Cadence handles your data.</p>
            </div>
            <a href="/privacy" class="btn-action privacy-link">
              <Shield size={14} />
              View
            </a>
          </div>
        </div>
      </section>

      <!-- Delete Account -->
      <hr class="section-divider" />

      <section aria-labelledby="delete-heading" class="settings-section">
        <h2 id="delete-heading" class="section-heading section-heading--danger">Delete Account</h2>
        <p class="text-hint danger-desc">
          Permanently delete your account and all associated data.
          This removes all habits, tasks, settings, and calendar events managed by Cadence. This cannot be undone.
        </p>

        {#if confirmingDelete}
          <div class="danger-confirm">
            <div class="form-field">
              <label for="delete-confirm-email">Type your email to confirm</label>
              <input
                id="delete-confirm-email"
                type="email"
                placeholder={userEmail}
                bind:value={deleteConfirmEmail}
              />
            </div>
            {#if userHasPassword}
              <div class="form-field">
                <label for="delete-confirm-pw">Enter your password</label>
                <input
                  id="delete-confirm-pw"
                  type="password"
                  placeholder="Password"
                  bind:value={deletePassword}
                />
              </div>
            {/if}
            <div class="danger-confirm-actions">
              <button
                class="btn-danger btn-danger--filled"
                onclick={handleDeleteAccount}
                disabled={deleting || deleteConfirmEmail !== userEmail}
              >
                <Trash2 size={14} />
                {deleting ? 'Deleting...' : 'Permanently delete account'}
              </button>
              <button class="btn-cancel" onclick={() => { confirmingDelete = false; deleteConfirmEmail = ''; deletePassword = ''; }}>
                Cancel
              </button>
            </div>
          </div>
        {:else}
          <button class="btn-danger-outline" onclick={() => { confirmingDelete = true; }}>
            Delete my account
          </button>
        {/if}
      </section>

      <!-- Danger Zone: only shown when Google is connected, since managed events
           only exist on Google Calendar and cleanup requires an active connection. -->
      {#if googleConnected}
        <hr class="section-divider" />

        <section aria-labelledby="danger-heading" class="settings-section">
          <h2 id="danger-heading" class="section-heading section-heading--danger">Danger Zone</h2>
          <p class="text-hint danger-desc">
            Delete all Cadence-managed events from your Google Calendar. This removes every event the app created but does not affect your regular calendar events.
          </p>
          {#if confirmingDanger}
            <div class="danger-confirm">
              <p class="danger-confirm-text">This will permanently delete all Cadence-managed events from your Google Calendar. This cannot be undone.</p>
              <div class="form-field">
                <label for="danger-confirm-input">Type <strong>DELETE</strong> to confirm</label>
                <input
                  id="danger-confirm-input"
                  type="text"
                  placeholder="DELETE"
                  bind:value={dangerConfirmText}
                  autocomplete="off"
                />
              </div>
              <div class="danger-confirm-actions">
                <button
                  class="btn-danger btn-danger--filled"
                  onclick={handleDangerClick}
                  disabled={nuking || dangerConfirmText !== 'DELETE'}
                >
                  {nuking ? 'Deleting...' : 'Permanently delete all events'}
                </button>
                <button class="btn-cancel" onclick={cancelDanger} disabled={nuking}>
                  Cancel
                </button>
              </div>
            </div>
          {:else}
            <button class="btn-danger-outline" onclick={handleDangerClick}>
              Delete All Managed Events
            </button>
          {/if}
        </section>
      {/if}
    </div>

    {#if hoursError}
      <p class="validation-error" id="hours-error">{hoursError}</p>
    {/if}

    <!-- Sticky Save Button -->
    <div class="save-bar">
      <button
        class="btn-save-full"
        onclick={saveSettings}
        disabled={saveStatus === 'saving' || !hoursValid || loadFailed}
        title={!hoursValid ? hoursError : ''}
        aria-describedby={!hoursValid ? 'hours-error' : undefined}
        class:btn-save-full--saved={saveStatus === 'saved'}
      >
        <span class="save-inner">
          {#if saveStatus === 'saving'}
            <Loader2 size={16} class="spinning" />
            Saving...
          {:else if saveStatus === 'saved'}
            <Check size={16} />
            Saved
          {:else if saveStatus === 'error'}
            Failed -- Retry
          {:else}
            Save Settings
          {/if}
        </span>
      </button>
    </div>
  {/if}
</main>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  /* Page layout */
  .settings-page {
    padding: var(--space-6);
    max-width: 720px;
  }

  .settings-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-6) 0;
  }

  .settings-loading {
    @include flex-center;
    padding: var(--space-12) 0;

    p {
      color: var(--color-text-secondary);
      font-size: 0.875rem;
    }
  }

  .settings-sections {
    @include flex-col;
  }

  /* Sections */
  .settings-section {
    padding: var(--space-8) 0;
  }

  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-4) 0;

    &--danger {
      color: var(--color-danger);
    }

    &--inline {
      margin-bottom: 0;
    }
  }

  .subsection-heading {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-3) 0;
  }

  .section-row {
    @include flex-between;
  }

  .section-divider {
    border: none;
    height: 1px;
    background: var(--color-border);
    margin: 0;
  }

  /* Status indicator (Google connection) */
  .status-indicator {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--color-danger);

    &--connected {
      background: var(--color-success);
    }
  }

  .status-label {
    font-size: 0.875rem;
    color: var(--color-text);
  }

  /* Form grids */
  .form-grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--space-4);
  }

  /* Input with suffix (e.g. "days") */
  .input-with-suffix {
    display: flex;
    align-items: center;
    gap: var(--space-2);

    input { flex: 1; }
    .input-suffix {
      font-size: 0.8125rem;
      color: var(--color-text-secondary);
    }
  }

  /* Hints and validation */
  .text-hint {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
    margin: 0;
  }

  .validation-error {
    font-size: 0.8125rem;
    color: var(--color-danger);
    margin: var(--space-2) 0 0 0;
  }

  /* Default calendars */
  .default-cals {
    margin-top: var(--space-5);
  }

  /* Decomp select */
  .decomp-field {
    margin-top: var(--space-4);
  }

  .decomp-select {
    width: auto;
  }

  /* Install app */
  .install-desc {
    margin-bottom: var(--space-3);
  }

  .btn-install {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-accent);
    background: transparent;
    color: var(--color-accent);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);

    &:hover {
      background: var(--color-accent);
      color: var(--color-accent-text);
    }
  }

  /* Danger zone */
  .danger-desc {
    margin-bottom: var(--space-4);
  }

  .btn-danger-outline {
    padding: var(--space-2) var(--space-4);
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-danger);
    background: transparent;
    color: var(--color-danger);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);

    &:hover {
      background: var(--color-danger);
      color: white;
    }
  }

  /* Uses global .btn-danger from _components.scss.
     Settings uses the filled variant via .btn-danger--filled for the Danger Zone. */
  .btn-danger--filled {
    background: var(--color-danger);
    color: white;
    border: none;

    &:hover:not(:disabled) {
      background: var(--color-danger);
      opacity: 0.9;
    }
  }

  .danger-confirm {
    @include flex-col(var(--space-3));
  }

  .danger-confirm-text {
    font-size: 0.8125rem;
    color: var(--color-danger);
    font-weight: 500;
    margin: 0;
  }

  .danger-confirm-actions {
    display: flex;
    gap: var(--space-3);
  }

  /* Sticky save bar */
  .save-bar {
    position: sticky;
    bottom: 0;
    padding: var(--space-4) 0;
    background: var(--color-bg);
    border-top: 1px solid var(--color-border);
    margin-top: var(--space-2);
  }

  .btn-save-full {
    width: 100%;
    padding: var(--space-2) 0;
    font-size: 0.875rem;
    font-weight: 500;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    background: var(--color-accent);
    color: var(--color-accent-text);
    transition: background var(--transition-fast), opacity var(--transition-fast);

    &:hover:not(:disabled) {
      background: var(--color-accent-hover);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &--saved {
      background: var(--color-success);
    }
  }

  .save-inner {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* Focus styles (global within this component) */
  input:focus, select:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px var(--color-accent-muted);
  }

  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    opacity: 1;
  }

  /* Account section */
  .account-info {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }

  .account-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--color-accent-muted);
    color: var(--color-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    font-weight: 600;
    flex-shrink: 0;
    overflow: hidden;
  }

  .account-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .account-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .account-name {
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--color-text);
  }

  .account-email {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .account-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  /* Change password form */
  .change-password-form {
    margin-top: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 320px;
  }

  .change-password-actions {
    display: flex;
    gap: var(--space-3);
  }

  /* Privacy section */
  .privacy-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .privacy-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .privacy-item-info {
    h3 {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text);
      margin: 0 0 2px;
    }

    p {
      font-size: 0.8125rem;
      color: var(--color-text-secondary);
      margin: 0;
    }
  }

  .privacy-link {
    text-decoration: none;
    color: var(--color-text);
  }

  /* Session list */
  .session-list {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .session-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    gap: var(--space-3);

    &:not(:first-child) {
      border-top: 1px solid var(--color-border);
    }

    &--current {
      background: var(--color-accent-muted);
    }
  }

  .session-info {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    flex: 1;
  }

  :global(.session-icon) {
    flex-shrink: 0;
    color: var(--color-text-tertiary);
  }

  .session-details {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .session-agent {
    font-size: 0.8125rem;
    color: var(--color-text);
    @include text-truncate;
  }

  .session-meta {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
  }

  .btn-session-revoke {
    flex-shrink: 0;
    padding: var(--space-1) var(--space-2);
    font-size: 0.75rem;
    font-weight: 500;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: border-color var(--transition-fast), color var(--transition-fast);

    &:hover {
      border-color: var(--color-danger);
      color: var(--color-danger);
    }
  }

  /* Responsive */
  @include mobile {
    .form-grid-3 {
      grid-template-columns: 1fr !important;
    }

    .privacy-item {
      flex-direction: column;
      align-items: flex-start;
    }

    .template-form {
      grid-template-columns: 1fr !important;
    }
  }

  /* Scheduling Templates */
  .section-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }

  .section-header-row .section-heading {
    margin-bottom: 0;
  }

  .template-count {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
  }

  .section-description {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-4) 0;
  }

  .empty-message {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
    margin: 0 0 var(--space-4) 0;
    font-style: italic;
  }

  .template-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-4);
  }

  .template-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-bg-secondary);

    &:hover {
      background: var(--color-bg-tertiary);
    }
  }

  .template-info {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.8125rem;
    color: var(--color-text);
  }

  .template-name {
    font-weight: 500;
  }

  .template-time {
    color: var(--color-text-secondary);
    font-size: 0.75rem;
  }

  .template-form {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    gap: var(--space-2);
    align-items: end;

    .form-field {
      margin: 0;
    }
  }

  .btn-icon-danger {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;

    &:hover {
      color: var(--color-danger);
      background: var(--color-danger-bg, rgba(239, 68, 68, 0.1));
    }
  }
</style>
