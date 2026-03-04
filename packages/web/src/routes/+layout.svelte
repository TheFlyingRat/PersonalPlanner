<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';

  let { children } = $props();
  let sidebarOpen = $state(false);

  const navItems = [
    { href: '/', label: 'Dashboard', icon: '📅' },
    { href: '/habits', label: 'Habits', icon: '🔁' },
    { href: '/tasks', label: 'Tasks', icon: '✅' },
    { href: '/meetings', label: 'Meetings', icon: '👥' },
    { href: '/focus', label: 'Focus', icon: '🎯' },
    { href: '/links', label: 'Links', icon: '🔗' },
    { href: '/analytics', label: 'Analytics', icon: '📊' },
    { href: '/settings', label: 'Settings', icon: '⚙️' },
  ];

  function isActive(href: string): boolean {
    if (href === '/') return page.url.pathname === '/';
    return page.url.pathname.startsWith(href);
  }

  function closeSidebar() {
    sidebarOpen = false;
  }
</script>

<div class="flex min-h-screen">
  <!-- Hamburger button (mobile only) -->
  <button
    onclick={() => { sidebarOpen = !sidebarOpen; }}
    class="fixed top-4 left-4 z-50 p-2 rounded-lg bg-slate-800 text-white md:hidden"
    aria-label="Toggle menu"
  >
    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {#if sidebarOpen}
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      {:else}
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
      {/if}
    </svg>
  </button>

  <!-- Overlay backdrop (mobile only) -->
  {#if sidebarOpen}
    <div
      class="fixed inset-0 bg-black/50 z-30 md:hidden"
      onclick={closeSidebar}
      onkeydown={(e) => { if (e.key === 'Escape') closeSidebar(); }}
      role="button"
      tabindex="-1"
      aria-label="Close sidebar"
    ></div>
  {/if}

  <aside class="w-64 bg-slate-800 text-white flex-col shrink-0 z-40
    {sidebarOpen ? 'fixed inset-y-0 left-0 flex' : 'hidden'} md:flex md:static">
    <div class="p-6 border-b border-slate-700">
      <h1 class="text-xl font-bold tracking-tight">Reclaim</h1>
      <p class="text-sm text-slate-400 mt-1">Smart Scheduling</p>
    </div>
    <nav class="flex-1 py-4">
      {#each navItems as item}
        <a
          href={item.href}
          onclick={closeSidebar}
          aria-label={item.label}
          class="flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors
            {isActive(item.href)
              ? 'bg-slate-700 text-white border-r-2 border-blue-400'
              : 'text-slate-300 hover:bg-slate-700/50 hover:text-white'}"
        >
          <span class="text-lg" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>
    <div class="p-4 border-t border-slate-700 text-xs text-slate-500">
      Reclaim Clone v0.1
    </div>
  </aside>

  <main class="flex-1 bg-gray-50 min-h-screen overflow-auto">
    {@render children()}
  </main>
</div>
