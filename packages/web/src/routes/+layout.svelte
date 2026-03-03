<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';

  let { children } = $props();

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
</script>

<div class="flex min-h-screen">
  <aside class="w-64 bg-slate-800 text-white flex flex-col shrink-0">
    <div class="p-6 border-b border-slate-700">
      <h1 class="text-xl font-bold tracking-tight">Reclaim</h1>
      <p class="text-sm text-slate-400 mt-1">Smart Scheduling</p>
    </div>
    <nav class="flex-1 py-4">
      {#each navItems as item}
        <a
          href={item.href}
          class="flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors
            {isActive(item.href)
              ? 'bg-slate-700 text-white border-r-2 border-blue-400'
              : 'text-slate-300 hover:bg-slate-700/50 hover:text-white'}"
        >
          <span class="text-lg">{item.icon}</span>
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
