<script setup>
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useInventory } from '@/stores/inventory.js'
import { useAbout } from '@/composables/useAbout.js'
import AboutDialog from '@/components/AboutDialog.vue'

// Spec §4 layout: bottom nav on phones, a left sidebar from 768 px.
const route = useRoute()
const { online } = useInventory()
const about = useAbout()

// a tab stays highlighted on its sub-pages (Parts on a part's detail page)
const tabs = [
  { to: { name: 'home' }, label: 'Home', icon: '⌂', routes: ['home'] },
  { to: { name: 'parts' }, label: 'Parts', icon: '☰', routes: ['parts', 'part'] },
  { to: { name: 'record' }, label: 'Record', icon: '＋', primary: true, routes: ['record'] },
  { to: { name: 'history' }, label: 'History', icon: '⟲', routes: ['history'] },
]
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <RouterLink :to="{ name: 'home' }" class="brand">Stocky</RouterLink>
      <div class="top-actions">
        <!-- discovery import, from anywhere (spec §4.11) -->
        <RouterLink :to="{ name: 'import' }" class="import" data-test="top-import">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M4 14v5h16v-5 M12 3v11 M8 10l4 4 4-4" />
          </svg>
          <span>Import</span>
        </RouterLink>
        <!-- Import is the only labelled control; About and Settings are icons -->
        <button
          type="button"
          class="icon-btn"
          aria-label="About Stocky"
          title="About Stocky"
          aria-haspopup="dialog"
          data-test="top-about"
          @click="about.open"
        >
          <span aria-hidden="true">ⓘ</span>
        </button>
        <RouterLink
          :to="{ name: 'settings' }"
          class="icon-btn"
          aria-label="Settings"
          title="Settings"
          data-test="top-settings"
        >
          <span aria-hidden="true">⚙</span>
        </RouterLink>
      </div>
    </header>

    <p v-if="!online" class="offline" role="status">
      Offline — showing last synced data. Changes are disabled until you reconnect.
    </p>

    <nav class="nav" aria-label="Main">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.label"
        :to="tab.to"
        class="tab"
        :class="{ primary: tab.primary, active: tab.routes.includes(route.name) }"
        :aria-current="tab.routes.includes(route.name) ? 'page' : undefined"
      >
        <span class="icon" aria-hidden="true">{{ tab.icon }}</span>
        <span>{{ tab.label }}</span>
      </RouterLink>
    </nav>

    <main class="content">
      <RouterView />
    </main>

    <AboutDialog v-if="about.isOpen.value" @close="about.close" />
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  padding-bottom: 5rem; /* room for the bottom nav */
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
}

.brand {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-heading);
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.import {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 44px;
  padding: 0 0.75rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 999px;
  color: var(--color-heading);
  font-weight: 600;
}

.import svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.import.router-link-active {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.import:hover {
  border-color: var(--color-accent);
}

/* About and Settings: the same 44 px round icon button */
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--color-heading);
  font: inherit;
  font-size: 1.3rem;
  font-weight: 400;
  line-height: 1;
  text-decoration: none;
  cursor: pointer;
}

.icon-btn:hover,
.icon-btn.router-link-active {
  background: var(--color-background-mute);
}

.import:focus-visible,
.icon-btn:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.offline {
  margin-bottom: 1rem;
  padding: 0.6rem 0.8rem;
  border-radius: 10px;
  background: hsla(40, 90%, 50%, 0.16);
  color: var(--color-heading);
}

.nav {
  position: fixed;
  inset: auto 0 0 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid var(--color-border);
  background: var(--color-background);
  padding-bottom: env(safe-area-inset-bottom);
  z-index: 10;
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 56px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.tab .icon {
  font-size: 1.25rem;
  line-height: 1;
}

.tab.active {
  color: var(--color-accent);
}

.tab.primary .icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.2rem;
  height: 2.2rem;
  border-radius: 50%;
  background: var(--color-accent);
  color: var(--color-on-accent);
}

@media (min-width: 768px) {
  .shell {
    display: grid;
    grid-template-columns: 11rem 1fr;
    grid-template-rows: auto auto 1fr;
    column-gap: 2rem;
    padding-bottom: 0;
  }

  .topbar,
  .offline {
    grid-column: 1 / -1;
  }

  .nav {
    position: sticky;
    top: 1rem;
    align-self: start;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    border: none;
    background: none;
    padding: 0;
  }

  .tab {
    flex-direction: row;
    justify-content: flex-start;
    gap: 0.75rem;
    padding: 0 0.75rem;
    min-height: 44px;
    border-radius: 10px;
    font-size: 0.95rem;
  }

  .tab.active {
    background: var(--color-accent-soft);
  }

  .content {
    max-width: 960px;
  }
}
</style>
