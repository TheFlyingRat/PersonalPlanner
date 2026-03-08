<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { onMount, onDestroy, tick } from 'svelte';
  import { links as linksApi, schedulingTemplates as templatesApi } from '$lib/api';
  import type { SchedulingTemplate } from '$lib/api';
  import type { SchedulingLink } from '@cadence/shared';
  import { SchedulingHours } from '@cadence/shared';
  import Plus from 'lucide-svelte/icons/plus';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import X from 'lucide-svelte/icons/x';
  import Link from 'lucide-svelte/icons/link';
  import Copy from 'lucide-svelte/icons/copy';
  import Check from 'lucide-svelte/icons/check';
  import AlertCircle from 'lucide-svelte/icons/alert-circle';
  import ToggleLeft from 'lucide-svelte/icons/toggle-left';
  import ToggleRight from 'lucide-svelte/icons/toggle-right';
  import EllipsisVertical from 'lucide-svelte/icons/ellipsis-vertical';

  let linkList = $state<SchedulingLink[]>([]);
  let showPanel = $state(false);
  let editingId = $state<string | null>(null);
  let copyFeedback = $state<string | null>(null);
  let copyError = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');
  let success = $state('');
  let submitting = $state(false);
  let menuOpenId = $state<string | null>(null);
  let confirmingDeleteId = $state<string | null>(null);
  let menuFocusIndex = $state(-1);
  let slugError = $state('');
  let menuItemEls = $state<(HTMLButtonElement | null)[]>([null, null]);

  // Form fields
  let formName = $state('');
  let formSlug = $state('');
  let formPriority = $state(3);
  let formDuration15 = $state(false);
  let formDuration30 = $state(true);
  let formDuration60 = $state(false);
  let formSchedulingHours: SchedulingHours = $state(SchedulingHours.Working);
  let manualSlugEdit = $state(false);

  // Scheduling templates
  let schedulingTemplates = $state<SchedulingTemplate[]>([]);
  let selectedTemplateId = $state<string | null>(null);

  let panelEl = $state<HTMLDivElement | null>(null);
  let successTimer: ReturnType<typeof setTimeout> | null = null;

  function showSuccessMsg(msg: string) {
    success = msg;
    if (successTimer) clearTimeout(successTimer);
    successTimer = setTimeout(() => { success = ''; }, 3000);
  }

  onDestroy(() => {
    if (successTimer) clearTimeout(successTimer);
  });

  function handleScheduleDropdownChange(value: string) {
    if (value.startsWith('template:')) {
      const tmplId = value.slice('template:'.length);
      const tmpl = schedulingTemplates.find((t) => t.id === tmplId);
      if (tmpl) {
        selectedTemplateId = tmplId;
        formSchedulingHours = SchedulingHours.Custom;
      }
    } else {
      selectedTemplateId = null;
      formSchedulingHours = value as SchedulingHours;
    }
  }

  function getScheduleDropdownValue(): string {
    if (selectedTemplateId) return `template:${selectedTemplateId}`;
    return formSchedulingHours;
  }

  function resetForm() {
    formName = '';
    formSlug = '';
    formPriority = 3;
    formDuration15 = false;
    formDuration30 = true;
    formDuration60 = false;
    formSchedulingHours = SchedulingHours.Working;
    selectedTemplateId = null;
    manualSlugEdit = false;
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
      copyError = null;
      setTimeout(() => { copyFeedback = null; }, 2000);
    } catch {
      copyError = slug;
      copyFeedback = null;
      setTimeout(() => { copyError = null; }, 2000);
    }
  }

  function openAddForm() {
    resetForm();
    showPanel = true;
    tick().then(() => focusFirstInPanel());
  }

  function openEditForm(link: SchedulingLink) {
    editingId = link.id;
    formName = link.name;
    formSlug = link.slug;
    formPriority = link.priority;
    formDuration15 = link.durations.includes(15);
    formDuration30 = link.durations.includes(30);
    formDuration60 = link.durations.includes(60);
    formSchedulingHours = link.schedulingHours ?? SchedulingHours.Working;
    selectedTemplateId = null;
    manualSlugEdit = true;
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
      if (menuOpenId) { menuOpenId = null; menuFocusIndex = -1; return; }
      if (confirmingDeleteId) { confirmingDeleteId = null; return; }
      if (showPanel) closePanel();
    }
  }

  function handleWindowClick() {
    if (menuOpenId) { menuOpenId = null; menuFocusIndex = -1; }
    if (confirmingDeleteId) confirmingDeleteId = null;
  }

  $effect(() => {
    if (menuFocusIndex >= 0 && menuItemEls[menuFocusIndex]) {
      menuItemEls[menuFocusIndex]!.focus();
    }
  });

  function handleMenuKeydown(e: KeyboardEvent, link: SchedulingLink) {
    const menuItems = 2; // Edit, Delete
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      menuFocusIndex = (menuFocusIndex + 1) % menuItems;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      menuFocusIndex = (menuFocusIndex - 1 + menuItems) % menuItems;
    } else if (e.key === 'Home') {
      e.preventDefault();
      menuFocusIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      menuFocusIndex = menuItems - 1;
    }
  }

  async function handleSubmit() {
    const durations: number[] = [];
    if (formDuration15) durations.push(15);
    if (formDuration30) durations.push(30);
    if (formDuration60) durations.push(60);

    if (durations.length === 0) {
      error = 'Select at least one duration.';
      return;
    }

    if (!/^[a-z0-9-]+$/.test(formSlug)) {
      slugError = 'Slug must contain only lowercase letters, numbers, and hyphens.';
      return;
    }
    slugError = '';

    submitting = true;

    const linkData = {
      name: formName,
      slug: formSlug,
      durations,
      priority: formPriority,
      schedulingHours: formSchedulingHours,
    };

    try {
      if (editingId) {
        await linksApi.update(editingId, linkData);
      } else {
        await linksApi.create(linkData);
      }
      const list = await linksApi.list();
      linkList = list as SchedulingLink[];
      showSuccessMsg(editingId ? 'Link updated successfully.' : 'Link created successfully.');
      closePanel();
    } catch (err) {
      console.error(err);
      if (editingId) {
        linkList = linkList.map((l) =>
          l.id === editingId ? { ...l, ...linkData } : l
        );
        showSuccessMsg('Link updated (offline).');
      } else {
        linkList = [
          ...linkList,
          { id: crypto.randomUUID(), ...linkData, enabled: true, schedulingHours: 'working', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as SchedulingLink,
        ];
        showSuccessMsg('Link created (offline).');
      }
    } finally {
      submitting = false;
    }
  }

  async function toggleEnabled(link: SchedulingLink) {
    try {
      await linksApi.update(link.id, { ...link, enabled: !link.enabled });
      const list = await linksApi.list();
      linkList = list as SchedulingLink[];
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
      linkList = list as SchedulingLink[];
      showSuccessMsg('Link deleted successfully.');
    } catch {
      linkList = linkList.filter((l) => l.id !== id);
      showSuccessMsg('Link deleted (offline).');
    }
    confirmingDeleteId = null;
  }

  function autoSlug() {
    if (manualSlugEdit) return;
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
      linkList = list as SchedulingLink[];
    } catch (err) {
      console.error(err);
      error = 'Could not load scheduling links.';
    } finally {
      loading = false;
    }
    templatesApi.list().then((r) => { schedulingTemplates = r.templates; }).catch(() => {});
  });
</script>

<svelte:head>
  <title>{pageTitle('Links')}</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} onclick={handleWindowClick} />

<div class="links-page">
  <!-- Header -->
  <div class="page-header">
    <h1 class="page-title">Scheduling Links</h1>
    <button onclick={openAddForm} class="btn-accent-pill" aria-haspopup="dialog">
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
  <div class="sr-only" aria-live="polite">
    {#if copyFeedback}URL copied to clipboard{:else if copyError}Failed to copy URL{/if}
  </div>

  {#if loading}
    <div class="links-loading" role="status" aria-live="polite">
      <p class="text-secondary">Loading...</p>
    </div>
  {:else if linkList.length === 0}
    <!-- Empty State -->
    <div class="empty-state">
      <Link size={48} strokeWidth={1.5} style="color: var(--color-text-tertiary);" />
      <h2 class="empty-title">No links yet</h2>
      <p class="empty-desc">Create your first scheduling link to share with others</p>
      <button onclick={openAddForm} class="btn-accent-pill empty-cta">
        <Plus size={16} strokeWidth={1.5} />
        Add Link
      </button>
    </div>
  {:else}
    <!-- Table -->
    <div role="table" aria-label="Scheduling links">
      <div class="table-header table-grid" role="row">
        <span role="columnheader">Name</span>
        <span role="columnheader">Slug</span>
        <span role="columnheader">Durations</span>
        <span role="columnheader">Status</span>
        <span role="columnheader"><span class="sr-only">Copy</span></span>
        <span role="columnheader"><span class="sr-only">Actions</span></span>
      </div>

      {#each linkList as link}
        <div
          class="table-row table-grid"
          onclick={() => openEditForm(link)}
          role="row"
          tabindex="0"
          aria-label="Edit {link.name}"
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditForm(link); } }}
        >
          <span role="cell" class="link-name">{link.name}</span>
          <span role="cell" class="link-slug font-mono">/{link.slug}</span>
          <span role="cell" class="link-durations">
            {#each link.durations as dur}
              <span class="duration-pill">{dur}m</span>
            {/each}
          </span>
          <span role="cell">
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
          <span role="cell">
            <button
              class="row-action-btn"
              onclick={(e) => { e.stopPropagation(); copyUrl(link.slug); }}
              aria-label="Copy URL"
            >
              {#if copyError === link.slug}
                <AlertCircle size={16} strokeWidth={1.5} style="color: var(--color-danger);" />
              {:else if copyFeedback === link.slug}
                <Check size={16} strokeWidth={1.5} style="color: var(--color-success);" />
              {:else}
                <Copy size={16} strokeWidth={1.5} />
              {/if}
            </button>
          </span>
          <span role="cell" class="kebab-cell">
            <button
              class="kebab-btn"
              onclick={(e) => { e.stopPropagation(); menuFocusIndex = -1; menuOpenId = menuOpenId === link.id ? null : link.id; }}
              aria-label="Actions"
              aria-haspopup="menu"
              aria-expanded={menuOpenId === link.id}
            >
              <EllipsisVertical size={16} strokeWidth={1.5} />
            </button>
            {#if menuOpenId === link.id}
              <div class="kebab-menu" role="menu" onclick={(e) => e.stopPropagation()} onkeydown={(e) => handleMenuKeydown(e, link)}>
                <button
                  class="kebab-menu-item"
                  class:kebab-menu-item--focused={menuFocusIndex === 0}
                  role="menuitem"
                  tabindex={menuFocusIndex === 0 ? 0 : -1}
                  bind:this={menuItemEls[0]}
                  onclick={() => { menuOpenId = null; menuFocusIndex = -1; openEditForm(link); }}
                >
                  <Pencil size={15} strokeWidth={1.5} />
                  Edit
                </button>
                <button
                  class="kebab-menu-item kebab-menu-item--danger"
                  class:kebab-menu-item--focused={menuFocusIndex === 1}
                  role="menuitem"
                  tabindex={menuFocusIndex === 1 ? 0 : -1}
                  bind:this={menuItemEls[1]}
                  onclick={() => { menuOpenId = null; menuFocusIndex = -1; confirmingDeleteId = link.id; tick().then(() => document.getElementById('confirm-delete-yes')?.focus()); }}
                >
                  <Trash2 size={15} strokeWidth={1.5} />
                  Delete
                </button>
              </div>
            {/if}
            {#if confirmingDeleteId === link.id}
              <div class="confirm-delete" role="alertdialog" aria-label="Confirm deletion" aria-describedby="confirm-delete-label" onclick={(e) => e.stopPropagation()}>
                <span class="confirm-delete-text" id="confirm-delete-label">Delete this link?</span>
                <button class="confirm-delete-yes" id="confirm-delete-yes" onclick={() => deleteLink(link.id)}>Yes</button>
                <button class="confirm-delete-no" onclick={() => { confirmingDeleteId = null; }}>No</button>
              </div>
            {/if}
          </span>
        </div>
      {/each}
    </div>
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
      <h2 id="panel-title" class="panel-title">
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
        <input id="link-slug" type="text" bind:value={formSlug} oninput={() => { manualSlugEdit = true; slugError = ''; }} required placeholder="e.g., quick-chat" pattern="[a-z0-9\-]+" />
        {#if slugError}
          <span class="field-error" role="alert">{slugError}</span>
        {/if}
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

      <div class="form-field">
        <label for="link-sched">Schedule during</label>
        <select id="link-sched" value={getScheduleDropdownValue()} onchange={(e) => handleScheduleDropdownChange(e.currentTarget.value)}>
          <option value="working">Work hours</option>
          <option value="personal">Personal hours</option>
          <option value="custom">Anytime (custom)</option>
          {#if schedulingTemplates.length > 0}
            <optgroup label="Templates">
              {#each schedulingTemplates as tmpl}
                <option value="template:{tmpl.id}">{tmpl.name} ({tmpl.startTime}–{tmpl.endTime})</option>
              {/each}
            </optgroup>
          {/if}
        </select>
      </div>

      <fieldset class="form-field durations-fieldset">
        <legend class="durations-legend">Durations</legend>
        <div class="durations-row">
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

  .links-page {
    padding: var(--space-6);
  }

  .links-loading {
    @include flex-center;
    padding: var(--space-12) 0;
  }

  .text-secondary {
    color: var(--color-text-secondary);
  }

  .empty-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
    margin-top: var(--space-4);
  }

  .empty-desc {
    color: var(--color-text-secondary);
    margin-top: var(--space-2);
  }

  .empty-cta {
    margin-top: var(--space-5);
  }

  .table-grid {
    grid-template-columns: 1fr 140px 160px 60px 40px 40px;
  }

  .link-name {
    font-weight: 500;
    color: var(--color-text);
  }

  .link-slug {
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
  }

  .link-durations {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
  }

  .duration-pill {
    @include badge(var(--color-surface-hover), var(--color-text-secondary));
    font-weight: 500;
    font-family: $font-mono;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .field-error {
    font-size: 0.75rem;
    color: var(--color-danger);
  }

  .panel-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .durations-fieldset {
    border: none;
    padding: 0;
    margin: 0;
  }

  .durations-legend {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text);
    padding: 0;
    margin-bottom: var(--space-1);
  }

  .durations-row {
    display: flex;
    gap: var(--space-4);
    padding-top: var(--space-1);
  }

  .confirm-delete {
    @include dropdown-menu;
    top: 100%;
    right: 0;
    min-width: 160px;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .confirm-delete-text {
    font-size: 0.8125rem;
    color: var(--color-text);
    white-space: nowrap;
  }

  .confirm-delete-yes {
    padding: var(--space-1) var(--space-3);
    background: var(--color-danger);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
  }

  .confirm-delete-no {
    padding: var(--space-1) var(--space-3);
    background: none;
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    @include hover-surface;
  }

  .kebab-menu-item--focused {
    background: var(--color-surface-hover);
  }

  @include mobile {
    .table-grid {
      grid-template-columns: 1fr 100px 120px 50px 36px 36px;
    }
  }

  @include small {
    .table-grid {
      grid-template-columns: 1fr 80px 40px 36px 36px;
    }
    .link-slug {
      display: none;
    }
  }
</style>
