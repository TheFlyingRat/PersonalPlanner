<script lang="ts">
  import '$lib/styles/main.scss';
  import { BRAND } from '@cadence/shared';
  import { page, navigating } from '$app/state';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { tick, onMount, onDestroy, untrack } from 'svelte';
  import { subscribeConnectionState, disconnect as disconnectWs } from '$lib/ws';
  import type { ConnectionState } from '$lib/ws';
  import WifiOff from 'lucide-svelte/icons/wifi-off';
  import Wifi from 'lucide-svelte/icons/wifi';
  import Calendar from 'lucide-svelte/icons/calendar';
  import Repeat from 'lucide-svelte/icons/repeat';
  import CheckSquare from 'lucide-svelte/icons/check-square';
  import Users from 'lucide-svelte/icons/users';
  import Target from 'lucide-svelte/icons/target';
  import Link from 'lucide-svelte/icons/link';
  import BarChart3 from 'lucide-svelte/icons/bar-chart-3';
  import Settings from 'lucide-svelte/icons/settings';
  import Search from 'lucide-svelte/icons/search';
  import PanelLeftClose from 'lucide-svelte/icons/panel-left-close';
  import PanelLeftOpen from 'lucide-svelte/icons/panel-left-open';
  import Menu from 'lucide-svelte/icons/menu';
  import X from 'lucide-svelte/icons/x';
  import Loader from 'lucide-svelte/icons/loader';
  import LogOut from 'lucide-svelte/icons/log-out';
  import ChevronUp from 'lucide-svelte/icons/chevron-up';
  import { search as searchApi } from '$lib/api';
  import { logout, getAuthState } from '$lib/auth.svelte';

  let { children } = $props();

  // State declarations
  let collapsed = $state(false);
  let mobileOpen = $state(false);
  let searchOpen = $state(false);
  let searchQuery = $state('');
  let searchResults = $state<Array<{ type: string; id: string; name: string; href: string }>>([]);
  let searchLoading = $state(false);
  let searchError = $state('');
  let selectedIndex = $state(-1);
  let isMac = $state(true);
  let profileMenuOpen = $state(false);
  let profileTriggerEl: HTMLButtonElement | undefined;
  let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let searchAbortController: AbortController | undefined;
  let previousFocus: HTMLElement | null = null;
  let searchInputEl: HTMLInputElement | undefined;

  const typeIcons: Record<string, typeof Repeat> = {
    habit: Repeat,
    task: CheckSquare,
    meeting: Users,
  };

  function openSearch() {
    previousFocus = document.activeElement as HTMLElement | null;
    searchOpen = true;
    searchQuery = '';
    searchResults = [];
    searchLoading = false;
    searchError = '';
    selectedIndex = -1;
    tick().then(() => searchInputEl?.focus());
  }

  function closeSearch() {
    searchOpen = false;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchAbortController?.abort();
    searchAbortController = undefined;
    previousFocus?.focus();
    previousFocus = null;
  }

  function handleSearchInput() {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchAbortController?.abort();
    const q = searchQuery.trim();
    if (q.length < 2) {
      searchResults = [];
      searchLoading = false;
      searchError = '';
      return;
    }
    searchLoading = true;
    searchError = '';
    const controller = new AbortController();
    searchAbortController = controller;
    searchDebounceTimer = setTimeout(async () => {
      try {
        const data = await searchApi.query(q);
        if (controller.signal.aborted) return;
        searchResults = data.results;
      } catch (err) {
        if (controller.signal.aborted) return;
        searchResults = [];
        searchError = 'Search failed. Please try again.';
      } finally {
        if (!controller.signal.aborted) {
          searchLoading = false;
        }
      }
    }, 300);
  }

  function selectResult(result: { href: string }) {
    closeSearch();
    if (result.href && result.href.startsWith('/')) {
      goto(result.href);
    }
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (searchOpen) {
        closeSearch();
      } else {
        openSearch();
      }
    }
    if (e.key === 'Escape' && searchOpen) {
      e.preventDefault();
      closeSearch();
    }
  }

  function handleSearchDialogKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = searchResults.length > 0
        ? Math.min(selectedIndex + 1, searchResults.length - 1)
        : -1;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
    } else if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < searchResults.length) {
      e.preventDefault();
      selectResult(searchResults[selectedIndex]);
    } else if (e.key === 'Tab') {
      const dialog = e.currentTarget as HTMLElement;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // Connection state
  let connectionState = $state<ConnectionState>('disconnected');
  let showRecoveryToast = $state(false);
  let recoveryToastTimer: ReturnType<typeof setTimeout> | undefined;
  let wasDisconnected = false;

  // Synchronously read sidebar state before first render to prevent flash
  if (browser) {
    collapsed = localStorage.getItem('sidebar-collapsed') === 'true';
  }

  onMount(() => {
    document.body.classList.add('hydrated');
    isMac = navigator.userAgent?.includes('Mac') ?? false;
  });

  $effect(() => {
    // Track isPublicRoute so the effect re-runs on navigation
    if (isPublicRoute) {
      disconnectWs();
      return;
    }

    const unsub = subscribeConnectionState((state) => {
      // untrack prevents Svelte 5 from tracking $state reads inside this
      // synchronously-called handler, which would cause an infinite effect loop
      untrack(() => {
        const prevState = connectionState;
        connectionState = state;

        if (state === 'disconnected' || state === 'reconnecting') {
          wasDisconnected = true;
          showRecoveryToast = false;
          if (recoveryToastTimer) clearTimeout(recoveryToastTimer);
        }

        if (state === 'connected' && wasDisconnected && prevState !== 'connected') {
          wasDisconnected = false;
          showRecoveryToast = true;
          if (recoveryToastTimer) clearTimeout(recoveryToastTimer);
          recoveryToastTimer = setTimeout(() => { showRecoveryToast = false; }, 3000);
        }
      });
    });
    return () => unsub();
  });

  onDestroy(() => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchAbortController?.abort();
    if (recoveryToastTimer) clearTimeout(recoveryToastTimer);
  });

  function toggleCollapsed() {
    collapsed = !collapsed;
    if (browser) {
      localStorage.setItem('sidebar-collapsed', String(collapsed));
    }
  }

  function closeMobile() {
    mobileOpen = false;
  }

  function handleSidebarKeydown(e: KeyboardEvent) {
    if (!mobileOpen) return;
    if (e.key === 'Escape') {
      closeMobile();
      return;
    }
    if (e.key === 'Tab') {
      const sidebar = e.currentTarget as HTMLElement;
      const focusable = sidebar.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  const mainNav = [
    { href: '/', label: 'Dashboard', icon: Calendar },
    { href: '/habits', label: 'Habits', icon: Repeat },
    { href: '/tasks', label: 'Tasks', icon: CheckSquare },
    { href: '/meetings', label: 'Meetings', icon: Users },
    { href: '/focus', label: 'Focus Time', icon: Target },
  ];

  const secondaryNav = [
    { href: '/links', label: 'Links', icon: Link },
    { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  ];

  function isActive(href: string): boolean {
    if (href === '/') return page.url.pathname === '/';
    return page.url.pathname.startsWith(href);
  }

  let isBookingRoute = $derived(page.url.pathname.startsWith('/book'));

  const AUTH_ROUTES = ['/login', '/signup', '/verify-email', '/forgot-password', '/reset-password', '/onboarding', '/privacy', '/terms'];
  let isAuthRoute = $derived(
    AUTH_ROUTES.some((r) => page.url.pathname.startsWith(r))
  );
  let isPublicRoute = $derived(isBookingRoute || isAuthRoute);

  const auth = getAuthState();
  let userFirstName = $derived(auth.user?.name?.split(' ')[0] ?? '');
  let userInitials = $derived(
    auth.user?.name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) ?? ''
  );

  function toggleProfileMenu() {
    profileMenuOpen = !profileMenuOpen;
  }

  function closeProfileMenu() {
    profileMenuOpen = false;
  }

  function handleProfileAction(action: 'settings' | 'logout') {
    closeProfileMenu();
    closeMobile();
    if (action === 'settings') {
      goto('/settings');
    } else {
      logout();
    }
  }

  function handleProfileMenuKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      closeProfileMenu();
    }
  }
</script>

<svelte:window onkeydown={isPublicRoute ? undefined : handleGlobalKeydown} />

{#if isPublicRoute}
  <!-- Public/auth pages render without app shell -->
  {@render children()}
{:else}

<a href="#main-content" class="skip-link">Skip to main content</a>

<!-- Connection status banner -->
{#if connectionState === 'disconnected' || connectionState === 'reconnecting'}
  <div class="connection-banner" role="alert" aria-live="polite">
    <WifiOff size={14} strokeWidth={1.5} />
    <span>{connectionState === 'reconnecting' ? 'Reconnecting...' : 'You\'re offline'}</span>
  </div>
{/if}
{#if showRecoveryToast}
  <div class="connection-toast" role="status" aria-live="polite">
    <Wifi size={14} strokeWidth={1.5} />
    <span>Back online</span>
  </div>
{/if}

{#if navigating.to}
  <div class="nav-progress" aria-hidden="true"></div>
{/if}

{#if searchOpen}
  <!-- Command Palette Backdrop -->
  <button
    class="search-backdrop"
    onclick={closeSearch}
    aria-label="Close search"
    tabindex="-1"
  ></button>

  <!-- Command Palette Dialog -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="search-dialog" role="dialog" aria-modal="true" aria-label="Search" onkeydown={handleSearchDialogKeydown}>
    <div class="search-input-row">
      <Search size={18} strokeWidth={1.5} />
      <input
        class="search-input"
        type="text"
        placeholder="Search habits, tasks, meetings..."
        bind:value={searchQuery}
        bind:this={searchInputEl}
        oninput={handleSearchInput}
        role="combobox"
        aria-expanded={searchResults.length > 0}
        aria-controls="search-listbox"
        aria-activedescendant={selectedIndex >= 0 ? `search-option-${selectedIndex}` : undefined}
        autofocus
      />
      <kbd class="search-kbd">Esc</kbd>
    </div>

    <div class="search-results" id="search-listbox" role="menu" aria-label="Search results">
      {#if searchLoading}
        <div class="search-empty">
          <Loader size={18} strokeWidth={1.5} class="spin" />
          <span>Searching...</span>
        </div>
      {:else if searchError}
        <div class="search-empty search-empty--error">{searchError}</div>
      {:else if searchResults.length > 0}
        {#each searchResults as result, i (result.id)}
          {@const Icon = typeIcons[result.type] || Calendar}
          <button
            class="search-result"
            class:selected={i === selectedIndex}
            id="search-option-{i}"
            role="menuitem"
            onclick={() => selectResult(result)}
          >
            <Icon size={16} strokeWidth={1.5} />
            <span class="search-result-name">{result.name}</span>
            <span class="search-result-type">{result.type}</span>
          </button>
        {/each}
      {:else}
        <div class="search-hint">
          {#if searchQuery.trim().length >= 2}
            <span class="search-hint-text">no matches</span>
          {:else}
            <div class="search-hint-shortcuts">
              <div class="search-hint-row">
                <span class="search-hint-keys"><kbd>↑</kbd><kbd>↓</kbd></span>
                <span class="search-hint-label">navigate</span>
              </div>
              <div class="search-hint-row">
                <span class="search-hint-keys"><kbd>↵</kbd></span>
                <span class="search-hint-label">open</span>
              </div>
              <div class="search-hint-row">
                <span class="search-hint-keys"><kbd>esc</kbd></span>
                <span class="search-hint-label">close</span>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<div class="app-layout" class:sidebar-collapsed={collapsed}>
  <!-- Mobile hamburger -->
  <button
    class="mobile-menu-btn"
    onclick={() => { mobileOpen = !mobileOpen; }}
    aria-label="Toggle menu"
    aria-expanded={mobileOpen}
  >
    {#if mobileOpen}
      <X size={20} strokeWidth={1.5} />
    {:else}
      <Menu size={20} strokeWidth={1.5} />
    {/if}
  </button>

  <!-- Mobile backdrop -->
  {#if mobileOpen}
    <button
      class="sidebar-backdrop"
      onclick={closeMobile}
      onkeydown={(e) => { if (e.key === 'Escape') closeMobile(); }}
      aria-label="Close sidebar"
      tabindex="-1"
    ></button>
  {/if}

  <!-- Sidebar -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <aside class="sidebar" class:mobile-open={mobileOpen} aria-label="Application sidebar" onkeydown={handleSidebarKeydown}>
    <div class="sidebar-header">
      {#if collapsed}
        <button
          class="sidebar-logo sidebar-logo--btn"
          onclick={toggleCollapsed}
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >C</button>
      {:else}
        <span class="sidebar-logo">C</span>
        <span class="sidebar-brand">{BRAND.name}</span>
        <button
          class="collapse-btn"
          onclick={toggleCollapsed}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <PanelLeftClose size={16} strokeWidth={1.5} />
        </button>
      {/if}
    </div>

    <div class="sidebar-divider"></div>

    {#if !collapsed}
      <button class="nav-search" onclick={openSearch}>
        <Search size={20} strokeWidth={1.5} />
        <span>Search...</span>
        <kbd>{isMac ? '⌘K' : 'Ctrl+K'}</kbd>
      </button>
    {/if}

    <div class="sidebar-divider"></div>

    <nav class="sidebar-nav" aria-label="Main navigation">
      {#each mainNav as item}
        <a
          href={item.href}
          onclick={closeMobile}
          class="nav-item"
          class:active={isActive(item.href)}
          title={collapsed ? item.label : undefined}
          aria-label={collapsed ? item.label : undefined}
          aria-current={isActive(item.href) ? 'page' : undefined}
        >
          <item.icon size={20} strokeWidth={1.5} />
          {#if !collapsed}
            <span class="nav-label">{item.label}</span>
          {/if}
        </a>
      {/each}

      <div class="sidebar-divider"></div>

      {#each secondaryNav as item}
        <a
          href={item.href}
          onclick={closeMobile}
          class="nav-item"
          class:active={isActive(item.href)}
          title={collapsed ? item.label : undefined}
          aria-label={collapsed ? item.label : undefined}
          aria-current={isActive(item.href) ? 'page' : undefined}
        >
          <item.icon size={20} strokeWidth={1.5} />
          {#if !collapsed}
            <span class="nav-label">{item.label}</span>
          {/if}
        </a>
      {/each}

    </nav>

    <!-- Profile -->
    <div class="profile-section">
      <button
        class="profile-trigger"
        bind:this={profileTriggerEl}
        onclick={toggleProfileMenu}
        aria-expanded={profileMenuOpen}
        aria-haspopup="menu"
        title={collapsed ? (auth.user?.name ?? 'Profile') : undefined}
      >
        {#if auth.user?.avatarUrl}
          <img class="profile-avatar" src={auth.user.avatarUrl} alt="" />
        {:else}
          <span class="profile-avatar profile-avatar--initials">{userInitials}</span>
        {/if}
        {#if !collapsed}
          <span class="profile-name">Hey, {userFirstName}</span>
          <ChevronUp size={14} strokeWidth={1.5} class="profile-chevron" />
        {/if}
      </button>
    </div>
  </aside>

  {#if profileMenuOpen}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="profile-menu-overlay" onkeydown={handleProfileMenuKeydown}>
      <button class="profile-menu-backdrop" onclick={closeProfileMenu} aria-label="Close menu" tabindex="-1"></button>
      <div
        class="profile-menu"
        role="menu"
        style="left: {profileTriggerEl?.getBoundingClientRect().left ?? 0}px; bottom: {window.innerHeight - (profileTriggerEl?.getBoundingClientRect().top ?? 0) + 4}px;"
      >
        <button class="profile-menu-item" role="menuitem" onclick={() => handleProfileAction('settings')}>
          <Settings size={16} strokeWidth={1.5} />
          <span>Settings</span>
        </button>
        <div class="profile-menu-divider"></div>
        <button class="profile-menu-item profile-menu-item--danger" role="menuitem" onclick={() => handleProfileAction('logout')}>
          <LogOut size={16} strokeWidth={1.5} />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  {/if}

  <main id="main-content" class="main-content">
    {@render children()}
  </main>
</div>

{/if}

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .app-layout {
    display: flex;
    min-height: 100vh;
  }

  // ---- Sidebar ----

  .sidebar {
    width: var(--sidebar-width);
    background: var(--color-surface);
    border-right: 1px solid var(--color-border);
    @include flex-col;
    flex-shrink: 0;
    transition: width var(--transition-base);
    overflow: hidden;
    position: sticky;
    top: 0;
    height: 100vh;

    .sidebar-collapsed & {
      width: var(--sidebar-collapsed-width);
    }
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    height: 56px;

    .sidebar-collapsed & {
      justify-content: center;
      padding: var(--space-3);
    }
  }

  .collapse-btn {
    @include flex-center;
    margin-left: auto;
    padding: var(--space-1);
    border: none;
    background: none;
    color: var(--color-text-tertiary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
    flex-shrink: 0;

    &:hover {
      background: var(--color-surface-hover);
      color: var(--color-text-secondary);
    }

    .sidebar-collapsed & {
      display: none;
    }
  }

  .sidebar-logo {
    @include flex-center;
    width: 28px;
    height: 28px;
    background: var(--color-accent);
    color: var(--color-accent-text);
    border-radius: var(--radius-md);
    font-weight: 700;
    font-size: 14px;
    flex-shrink: 0;

    &--btn {
      border: none;
      cursor: pointer;
      transition: opacity var(--transition-fast);

      &:hover {
        opacity: 0.85;
      }
    }
  }

  .sidebar-brand {
    font-weight: 600;
    font-size: 15px;
    color: var(--color-text);
    white-space: nowrap;
  }

  .sidebar-divider {
    height: 1px;
    background: var(--color-border);
    margin: var(--space-2) 0;

    .sidebar-collapsed & {
      margin: var(--space-1) var(--space-2);
    }
  }

  .nav-search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    margin: 0 var(--space-2);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    cursor: pointer;
    transition: background var(--transition-fast);
    border: none;
    background: none;
    width: calc(100% - var(--space-2) * 2);
    text-align: left;

    &:hover {
      background: var(--color-surface-hover);
    }

    kbd {
      margin-left: auto;
      font-family: $font-mono;
      font-size: 0.6875rem;
      padding: 1px 5px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      color: var(--color-text-tertiary);
    }
  }

  .sidebar-nav {
    flex: 1;
    @include flex-col;
    padding: var(--space-1) var(--space-2);

    .sidebar-collapsed & {
      align-items: center;
      padding: var(--space-1) 0;
    }
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-2);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    text-decoration: none;
    font-size: 14px;
    font-weight: 500;
    transition: background var(--transition-fast), color var(--transition-fast),
      border-color var(--transition-fast);
    border-left: 2px solid transparent;
    white-space: nowrap;
    min-height: 44px;

    &:hover {
      background: var(--color-surface-hover);
      color: var(--color-text);
    }

    &.active {
      background: var(--color-accent-muted);
      color: var(--color-accent);
      border-left-color: var(--color-accent);
    }

    .sidebar-collapsed & {
      @include flex-center;
      width: 36px;
      height: 36px;
      min-height: 36px;
      padding: 0;
      border-left: none;
      border-radius: var(--radius-md);
    }
  }

  .nav-label {
    @include text-truncate;
  }

  // ---- Profile Section ----

  .profile-section {
    position: relative;
    padding: var(--space-2);
    border-top: 1px solid var(--color-border);

    .sidebar-collapsed & {
      @include flex-center;
      padding: var(--space-2) 0;
    }
  }

  .profile-trigger {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2);
    border: none;
    background: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background var(--transition-fast);
    text-align: left;
    overflow: hidden;

    &:hover {
      background: var(--color-surface-hover);
    }

    .sidebar-collapsed & {
      @include flex-center;
      width: 36px;
      height: 36px;
      padding: 0;
    }
  }

  .profile-avatar {
    width: 32px;
    height: 32px;
    min-width: 32px;
    border-radius: 50%;
    flex-shrink: 0;
    object-fit: cover;

    .sidebar-collapsed & {
      width: 28px;
      height: 28px;
      min-width: 28px;
    }

    &--initials {
      @include flex-center;
      background: var(--color-accent);
      color: var(--color-accent-text);
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
  }

  .profile-name {
    flex: 1;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text);
    @include text-truncate;
  }

  :global(.profile-chevron) {
    color: var(--color-text-tertiary);
    flex-shrink: 0;
    transition: transform var(--transition-fast);
  }

  .profile-trigger[aria-expanded='true'] :global(.profile-chevron) {
    transform: rotate(180deg);
  }

  .profile-menu-overlay {
    position: fixed;
    inset: 0;
    z-index: $z-dropdown;
    pointer-events: none;

    > * {
      pointer-events: auto;
    }
  }

  .profile-menu-backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .profile-menu {
    position: fixed;
    min-width: 160px;
    width: max-content;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.15));
    padding: var(--space-1);
    white-space: nowrap;
  }

  .profile-menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    font-family: inherit;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
    white-space: nowrap;

    &:hover {
      background: var(--color-surface-hover);
      color: var(--color-text);
    }

    &--danger:hover {
      color: var(--color-error, #ef4444);
    }
  }

  .profile-menu-divider {
    height: 1px;
    background: var(--color-border);
    margin: var(--space-1) 0;
  }

  // ---- Main Content ----

  .main-content {
    flex: 1;
    min-width: 0;
    padding: var(--space-6);
    overflow: auto;
  }

  // ---- Mobile ----

  .mobile-menu-btn {
    display: none;
    position: fixed;
    top: var(--space-3);
    left: var(--space-3);
    z-index: $z-dropdown;
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    border-radius: var(--radius-md);
    cursor: pointer;
    @include touch-target;
  }

  .sidebar-backdrop {
    display: none;
    @include backdrop(0.5);
    z-index: $z-sidebar - 1;
  }

  @include mobile {
    .mobile-menu-btn {
      @include flex-center;
    }

    .sidebar {
      position: fixed;
      inset-block: 0;
      left: 0;
      z-index: $z-sidebar;
      transform: translateX(-100%);
      transition: transform var(--transition-base);
      width: var(--sidebar-width) !important;

      &.mobile-open {
        transform: translateX(0);
      }
    }

    .sidebar-backdrop {
      display: block;
    }

    .collapse-btn {
      display: none;
    }

    .main-content {
      padding: var(--space-4);
      padding-top: 56px;
    }
  }

  // ---- Command Palette ----

  .search-backdrop {
    @include backdrop(0.5);
    z-index: $z-overlay;
  }

  .search-dialog {
    position: fixed;
    top: 20%;
    left: 50%;
    transform: translateX(-50%);
    width: 90vw;
    max-width: 560px;
    max-height: 420px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg, 0 16px 48px rgba(0, 0, 0, 0.2));
    z-index: $z-modal;
    @include flex-col;
    overflow: hidden;
  }

  .search-input-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text-secondary);
  }

  .search-input {
    flex: 1;
    border: none;
    background: none;
    font-size: 0.9375rem;
    font-family: inherit;
    color: var(--color-text);
    outline: none;

    &::placeholder {
      color: var(--color-text-tertiary);
    }
  }

  .search-kbd {
    font-family: $font-mono;
    font-size: 0.6875rem;
    padding: 1px 5px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-tertiary);
    flex-shrink: 0;
  }

  .search-results {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2) 0;
  }

  .search-empty {
    @include flex-center;
    gap: var(--space-2);
    padding: var(--space-6);
    color: var(--color-text-tertiary);
    font-size: 0.875rem;

    &--error {
      color: var(--color-text-error);
    }
  }

  .search-hint {
    @include flex-center;
    padding: var(--space-6) var(--space-4);
  }

  .search-hint-text {
    font-size: 0.875rem;
    font-family: $font-mono;
    color: var(--color-text-tertiary);
    letter-spacing: 0.05em;
  }

  .search-hint-shortcuts {
    display: flex;
    gap: var(--space-6);
  }

  .search-hint-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
  }

  .search-hint-keys {
    display: flex;
    gap: 2px;

    kbd {
      font-family: $font-mono;
      font-size: 0.6875rem;
      padding: 2px 6px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      color: var(--color-text-secondary);
      background: var(--color-bg-secondary, transparent);
      line-height: 1.4;
    }
  }

  .search-hint-label {
    font-size: 0.6875rem;
    font-family: $font-mono;
    color: var(--color-text-tertiary);
    letter-spacing: 0.03em;
  }

  .search-result {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-4);
    border: none;
    background: none;
    color: var(--color-text);
    font-size: 0.875rem;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    transition: background var(--transition-fast);

    &:hover {
      background: var(--color-surface-hover);
    }
  }

  .search-result-name {
    flex: 1;
    @include text-truncate;
  }

  .search-result-type {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
    text-transform: capitalize;
    flex-shrink: 0;
  }

  // ---- Connection Status ----

  .connection-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: $z-progress;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-4);
    background: var(--color-warning-amber, #f59e0b);
    color: #000;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .connection-toast {
    position: fixed;
    top: var(--space-3);
    left: 50%;
    transform: translateX(-50%);
    z-index: $z-progress;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: var(--color-success);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 500;
    border-radius: var(--radius-lg);
    animation: toast-slide-in 0.3s ease-out;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }

  @keyframes toast-slide-in {
    from { opacity: 0; transform: translateX(-50%) translateY(-0.5rem); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  // ---- Navigation Progress Bar ----

  .nav-progress {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--color-accent);
    z-index: $z-progress;
    animation: nav-progress-indeterminate 1.2s ease infinite;
  }

  @keyframes nav-progress-indeterminate {
    0% { transform: translateX(-100%); }
    50% { transform: translateX(0%); }
    100% { transform: translateX(100%); }
  }

  @media (prefers-reduced-motion: reduce) {
    .nav-progress { animation: none; }
  }

  // Search error state

  // Selected search result (arrow key nav)
  .search-result.selected {
    background: var(--color-surface-hover);
  }

  // Spinner animation
  :global(.spin) {
    animation: spin 1s linear infinite;
  }

</style>
