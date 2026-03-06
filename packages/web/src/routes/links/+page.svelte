<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { links as linksApi } from '$lib/api';
  import Plus from 'lucide-svelte/icons/plus';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import X from 'lucide-svelte/icons/x';
  import Link from 'lucide-svelte/icons/link';
  import Copy from 'lucide-svelte/icons/copy';
  import Check from 'lucide-svelte/icons/check';
  import ToggleLeft from 'lucide-svelte/icons/toggle-left';
  import ToggleRight from 'lucide-svelte/icons/toggle-right';
  import EllipsisVertical from 'lucide-svelte/icons/ellipsis-vertical';

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
  let showPanel = $state(false);
  let editingId = $state<string | null>(null);
  let copyFeedback = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');
  let success = $state('');
  let submitting = $state(false);
  let menuOpenId = $state<string | null>(null);

  // Form fields
  let formName = $state('');
  let formSlug = $state('');
  let formPriority = $state(3);
  let formDuration15 = $state(false);
  let formDuration30 = $state(true);
  let formDuration60 = $state(false);

  let panelEl = $state<HTMLDivElement | null>(null);

  const priorityLabels: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };

  function showSuccess(msg: string) {
    success = msg;
    setTimeout(() => { success = ''; }, 3000);
  }

  function resetForm() {
    formName = '';
    formSlug = '';
    formPriority = 3;
    formDuration15 = false;
    formDuration30 = true;
    formDuration60 = false;
    editingId = null;
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
      copyFeedback = slug;
      setTimeout(() => { copyFeedback = null; }, 2000);
    }
  }

  function openAddForm() {
    resetForm();
    showPanel = true;
    tick().then(() => focusFirstInPanel());
  }

  function openEditForm(link: LinkItem) {
    editingId = link.id;
    formName = link.name;
    formSlug = link.slug;
    formPriority = link.priority;
    formDuration15 = link.durations.includes(15);
    formDuration30 = link.durations.includes(30);
    formDuration60 = link.durations.includes(60);
    showPanel = true;
    tick().then(() => focusFirstInPanel());
  }

  function closePanel() {
    showPanel = false;
    resetForm();
  }

  function focusFirstInPanel() {
    if (!panelEl) return;
    const focusable = panelEl.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length > 0) focusable[0].focus();
  }

  function trapFocus(e: KeyboardEvent) {
    if (e.key === 'Escape') { closePanel(); return; }
    if (e.key !== 'Tab' || !panelEl) return;
    const focusable = panelEl.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (menuOpenId) { menuOpenId = null; return; }
      if (showPanel) closePanel();
    }
  }

  function handleWindowClick() {
    if (menuOpenId) menuOpenId = null;
  }

  async function handleSubmit() {
    submitting = true;
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
      if (editingId) {
        await linksApi.update(editingId, linkData as any);
      } else {
        await linksApi.create(linkData as any);
      }
      const list = await linksApi.list();
      linkList = list as any;
      showSuccess(editingId ? 'Link updated successfully.' : 'Link created successfully.');
    } catch {
      if (editingId) {
        linkList = linkList.map((l) =>
          l.id === editingId ? { ...l, ...linkData } : l
        );
        showSuccess('Link updated (offline).');
      } else {
        linkList = [
          ...linkList,
          { id: crypto.randomUUID(), ...linkData, enabled: true },
        ];
        showSuccess('Link created (offline).');
      }
    } finally {
      submitting = false;
    }

    closePanel();
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
    if (!confirm('Are you sure you want to delete this link?')) return;
    try {
      await linksApi.delete(id);
      const list = await linksApi.list();
      linkList = list as any;
      showSuccess('Link deleted successfully.');
    } catch {
      linkList = linkList.filter((l) => l.id !== id);
      showSuccess('Link deleted (offline).');
    }
  }

  function autoSlug() {
    formSlug = formName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  onMount(async () => {
    loading = true;
    error = '';
    try {
      const list = await linksApi.list();
      linkList = list as any;
    } catch {
      error = 'Failed to load data from API. Showing cached data.';
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>Links - Cadence</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} onclick={handleWindowClick} />

<div style="padding: var(--space-6);">
  <!-- Header -->
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-6);">
    <h1 style="font-size: 1.5rem; font-weight: 600; color: var(--color-text);">Scheduling Links</h1>
    <button onclick={openAddForm} class="btn-accent-pill" aria-expanded={showPanel}>
      <Plus size={16} strokeWidth={1.5} />
      Add Link
    </button>
  </div>

  {#if error}
    <div class="alert-error" role="alert">{error}</div>
  {/if}
  {#if success}
    <div class="alert-success" role="alert">{success}</div>
  {/if}

  {#if loading}
    <div style="display: flex; align-items: center; justify-content: center; padding: var(--space-12) 0;" role="status" aria-live="polite">
      <p style="color: var(--color-text-secondary);">Loading...</p>
    </div>
  {:else if linkList.length === 0}
    <!-- Empty State -->
    <div class="empty-state">
      <Link size={48} strokeWidth={1.5} style="color: var(--color-text-tertiary);" />
      <h2 style="font-size: 1.125rem; font-weight: 600; color: var(--color-text); margin-top: var(--space-4);">No links yet</h2>
      <p style="color: var(--color-text-secondary); margin-top: var(--space-2);">Create your first scheduling link to share with others</p>
      <button onclick={openAddForm} class="btn-accent-pill" style="margin-top: var(--space-5);">
        <Plus size={16} strokeWidth={1.5} />
        Add Link
      </button>
    </div>
  {:else}
    <!-- Table Header -->
    <div class="table-header" style="grid-template-columns: 1fr 140px 160px 60px 40px 40px;">
      <span>Name</span>
      <span>Slug</span>
      <span>Durations</span>
      <span>Status</span>
      <span></span>
      <span></span>
    </div>

    <!-- Table Rows -->
    {#each linkList as link}
      <div
        class="table-row"
        style="grid-template-columns: 1fr 140px 160px 60px 40px 40px;"
        onclick={() => openEditForm(link)}
        role="button"
        tabindex="0"
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditForm(link); } }}
      >
        <span style="font-weight: 500; color: var(--color-text);">{link.name}</span>
        <span class="font-mono" style="color: var(--color-text-secondary); font-size: 0.8125rem;">/{link.slug}</span>
        <span style="display: flex; gap: var(--space-1); flex-wrap: wrap;">
          {#each link.durations as dur}
            <span class="duration-pill">{dur}m</span>
          {/each}
        </span>
        <span>
          <button
            class="toggle-btn"
            onclick={(e) => { e.stopPropagation(); toggleEnabled(link); }}
            aria-label={link.enabled ? 'Disable link' : 'Enable link'}
          >
            {#if link.enabled}
              <ToggleRight size={20} strokeWidth={1.5} style="color: var(--color-accent);" />
            {:else}
              <ToggleLeft size={20} strokeWidth={1.5} style="color: var(--color-text-tertiary);" />
            {/if}
          </button>
        </span>
        <span>
          <button
            class="copy-btn"
            onclick={(e) => { e.stopPropagation(); copyUrl(link.slug); }}
            aria-label="Copy URL"
          >
            {#if copyFeedback === link.slug}
              <Check size={16} strokeWidth={1.5} style="color: var(--color-success);" />
            {:else}
              <Copy size={16} strokeWidth={1.5} />
            {/if}
          </button>
        </span>
        <span class="kebab-cell">
          <button
            class="kebab-btn"
            onclick={(e) => { e.stopPropagation(); menuOpenId = menuOpenId === link.id ? null : link.id; }}
            aria-label="Actions"
            aria-haspopup="true"
            aria-expanded={menuOpenId === link.id}
          >
            <EllipsisVertical size={16} strokeWidth={1.5} />
          </button>
          {#if menuOpenId === link.id}
            <div class="kebab-menu" onclick={(e) => e.stopPropagation()}>
              <button class="kebab-menu-item" onclick={() => { menuOpenId = null; openEditForm(link); }}>
                <Pencil size={15} strokeWidth={1.5} />
                Edit
              </button>
              <button class="kebab-menu-item kebab-menu-item--danger" onclick={() => { menuOpenId = null; deleteLink(link.id); }}>
                <Trash2 size={15} strokeWidth={1.5} />
                Delete
              </button>
            </div>
          {/if}
        </span>
      </div>
    {/each}
  {/if}
</div>

<!-- Slide-over Panel -->
{#if showPanel}
  <div class="panel-backdrop" onclick={closePanel} aria-hidden="true"></div>
  <div
    class="panel-slideover"
    role="dialog"
    aria-modal="true"
    aria-labelledby="panel-title"
    tabindex="-1"
    bind:this={panelEl}
    onkeydown={trapFocus}
  >
    <div class="panel-header">
      <h2 id="panel-title" style="font-size: 1.125rem; font-weight: 600; color: var(--color-text);">
        {editingId ? 'Edit Link' : 'Add Link'}
      </h2>
      <button onclick={closePanel} class="panel-close-btn" aria-label="Close panel">
        <X size={20} strokeWidth={1.5} />
      </button>
    </div>

    <form
      onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}
      class="panel-body"
    >
      <div class="form-field">
        <label for="link-name">Name</label>
        <input id="link-name" type="text" bind:value={formName} oninput={autoSlug} required placeholder="e.g., Quick Chat" />
      </div>

      <div class="form-field">
        <label for="link-slug">Slug</label>
        <input id="link-slug" type="text" bind:value={formSlug} required placeholder="e.g., quick-chat" />
      </div>

      <div class="form-field">
        <label for="link-priority">Priority</label>
        <select id="link-priority" bind:value={formPriority}>
          <option value={1}>P1 - Critical</option>
          <option value={2}>P2 - High</option>
          <option value={3}>P3 - Medium</option>
          <option value={4}>P4 - Low</option>
        </select>
      </div>

      <fieldset class="form-field" style="border: none; padding: 0; margin: 0;">
        <legend style="font-size: 13px; font-weight: 500; color: var(--color-text); padding: 0; margin-bottom: var(--space-1);">Durations</legend>
        <div style="display: flex; gap: var(--space-4); padding-top: var(--space-1);">
          <label class="toggle-label">
            <input type="checkbox" bind:checked={formDuration15} />
            <span>15 min</span>
          </label>
          <label class="toggle-label">
            <input type="checkbox" bind:checked={formDuration30} />
            <span>30 min</span>
          </label>
          <label class="toggle-label">
            <input type="checkbox" bind:checked={formDuration60} />
            <span>60 min</span>
          </label>
        </div>
      </fieldset>

      <div class="panel-footer">
        <button type="submit" class="btn-save" disabled={submitting}>
          {submitting ? 'Saving...' : 'Save'}
        </button>
        <button type="button" class="btn-cancel" onclick={closePanel}>
          Cancel
        </button>
      </div>
    </form>
  </div>
{/if}

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .duration-pill {
    @include badge(var(--color-surface-hover), var(--color-text-secondary));
    font-weight: 500;
    font-family: 'Geist Mono', ui-monospace, monospace;
  }

  .copy-btn {
    @include flex-center;
    @include touch-target;
    @include hover-surface;
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--space-1);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
  }
</style>
