<script lang="ts">
  import { links as linksApi } from '$lib/api';

  interface LinkItem {
    id: string;
    slug: string;
    name: string;
    durations: number[];
    priority: number;
    enabled: boolean;
  }

  const mockLinks: LinkItem[] = [
    {
      id: '1',
      slug: 'intro-call',
      name: 'Intro Call',
      durations: [15, 30],
      priority: 2,
      enabled: true,
    },
    {
      id: '2',
      slug: 'deep-dive',
      name: 'Deep Dive Session',
      durations: [30, 60],
      priority: 3,
      enabled: false,
    },
  ];

  let linkList = $state<LinkItem[]>(mockLinks);
  let showForm = $state(false);
  let copyFeedback = $state<string | null>(null);

  // Form fields
  let formName = $state('');
  let formSlug = $state('');
  let formPriority = $state(3);
  let formDuration15 = $state(false);
  let formDuration30 = $state(true);
  let formDuration60 = $state(false);

  const priorityLabels: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
  const priorityColors: Record<number, string> = {
    1: 'bg-red-100 text-red-700',
    2: 'bg-orange-100 text-orange-700',
    3: 'bg-yellow-100 text-yellow-700',
    4: 'bg-green-100 text-green-700',
  };

  function resetForm() {
    formName = '';
    formSlug = '';
    formPriority = 3;
    formDuration15 = false;
    formDuration30 = true;
    formDuration60 = false;
  }

  function getBookingUrl(slug: string): string {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/book/${slug}`;
    }
    return `/book/${slug}`;
  }

  async function copyUrl(slug: string) {
    const url = getBookingUrl(slug);
    try {
      await navigator.clipboard.writeText(url);
      copyFeedback = slug;
      setTimeout(() => { copyFeedback = null; }, 2000);
    } catch {
      // Fallback
      copyFeedback = slug;
      setTimeout(() => { copyFeedback = null; }, 2000);
    }
  }

  async function handleSubmit() {
    const durations: number[] = [];
    if (formDuration15) durations.push(15);
    if (formDuration30) durations.push(30);
    if (formDuration60) durations.push(60);

    const linkData = {
      name: formName,
      slug: formSlug,
      durations,
      priority: formPriority,
    };

    try {
      await linksApi.create(linkData as any);
      const list = await linksApi.list();
      linkList = list as any;
    } catch {
      linkList = [
        ...linkList,
        { id: crypto.randomUUID(), ...linkData, enabled: true },
      ];
    }

    showForm = false;
    resetForm();
  }

  async function toggleEnabled(link: LinkItem) {
    try {
      await linksApi.update(link.id, { ...link, enabled: !link.enabled } as any);
      const list = await linksApi.list();
      linkList = list as any;
    } catch {
      linkList = linkList.map((l) =>
        l.id === link.id ? { ...l, enabled: !l.enabled } : l
      );
    }
  }

  async function deleteLink(id: string) {
    try {
      await linksApi.delete(id);
      const list = await linksApi.list();
      linkList = list as any;
    } catch {
      linkList = linkList.filter((l) => l.id !== id);
    }
  }

  function formatDurations(durations: number[]): string {
    return durations.map((d) => `${d}min`).join(', ');
  }

  function autoSlug() {
    formSlug = formName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
</script>

<div class="p-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-gray-900">Scheduling Links</h1>
    <button
      onclick={() => { resetForm(); showForm = true; }}
      class="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
    >
      Create Link
    </button>
  </div>

  <!-- Create Form -->
  {#if showForm}
    <div class="bg-white rounded-lg shadow p-6 mb-6">
      <h2 class="text-lg font-semibold text-gray-900 mb-4">Create Scheduling Link</h2>
      <form
        onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}
        class="grid grid-cols-1 md:grid-cols-2 gap-4"
      >
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            type="text"
            bind:value={formName}
            oninput={autoSlug}
            required
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="e.g., Quick Chat"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Slug</label>
          <input
            type="text"
            bind:value={formSlug}
            required
            class="border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="e.g., quick-chat"
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
          <label class="block text-sm font-medium text-gray-700 mb-2">Durations</label>
          <div class="flex items-center gap-4">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" bind:checked={formDuration15} class="w-4 h-4 rounded" />
              <span class="text-sm text-gray-700">15 min</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" bind:checked={formDuration30} class="w-4 h-4 rounded" />
              <span class="text-sm text-gray-700">30 min</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" bind:checked={formDuration60} class="w-4 h-4 rounded" />
              <span class="text-sm text-gray-700">60 min</span>
            </label>
          </div>
        </div>

        <div class="flex items-end gap-3 md:col-span-2">
          <button
            type="submit"
            class="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
          >
            Create Link
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

  <!-- Links List -->
  <div class="space-y-4">
    {#each linkList as link}
      <div class="bg-white rounded-lg shadow p-4">
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <div class="flex items-center gap-3 mb-2">
              <h3 class="text-lg font-semibold text-gray-900">{link.name}</h3>
              <span class="px-2 py-0.5 rounded-full text-xs font-semibold {priorityColors[link.priority]}">
                {priorityLabels[link.priority]}
              </span>
              <span class="px-2 py-0.5 rounded-full text-xs font-semibold
                {link.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}">
                {link.enabled ? 'Active' : 'Disabled'}
              </span>
            </div>
            <div class="flex items-center gap-4 text-sm text-gray-600">
              <div>
                <span class="font-medium text-gray-500">Slug:</span>
                <code class="ml-1 px-1.5 py-0.5 bg-gray-100 rounded text-xs">{link.slug}</code>
              </div>
              <div>
                <span class="font-medium text-gray-500">Durations:</span>
                {formatDurations(link.durations)}
              </div>
            </div>
            <div class="mt-2 text-xs text-gray-400">
              {getBookingUrl(link.slug)}
            </div>
          </div>
          <div class="flex items-center gap-2 ml-4">
            <button
              onclick={() => copyUrl(link.slug)}
              class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                {copyFeedback === link.slug
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
            >
              {copyFeedback === link.slug ? 'Copied!' : 'Copy URL'}
            </button>
            <button
              onclick={() => toggleEnabled(link)}
              class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                {link.enabled
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}"
            >
              {link.enabled ? 'Disable' : 'Enable'}
            </button>
            <button
              onclick={() => deleteLink(link.id)}
              class="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    {/each}

    {#if linkList.length === 0}
      <div class="bg-white rounded-lg shadow p-8 text-center">
        <p class="text-gray-500">No scheduling links yet. Click "Create Link" to create one.</p>
      </div>
    {/if}
  </div>
</div>
