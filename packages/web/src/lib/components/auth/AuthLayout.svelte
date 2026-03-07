<script lang="ts">
  import { BRAND } from '@cadence/shared';
  let { children } = $props();
</script>

<main class="auth-layout" aria-label="Authentication">
  <div class="auth-card">
    <div class="auth-logo">
      <span class="sidebar-logo">C</span>
      <span class="auth-brand">{BRAND.name}</span>
    </div>
    {@render children()}
  </div>
  <footer class="auth-footer">
    <span>&copy; {new Date().getFullYear()} {BRAND.name}</span>
    &middot;
    <a href="/privacy">Privacy</a>
    &middot;
    <a href="/terms">Terms</a>
  </footer>
</main>
