<script setup>
// Home (spec §4.3): low stock first, then spares per location (tabs on a
// phone, columns from 768 px) grouped by category, and a collapsed
// "Installed" section by site and host. Live through realtime (§5.6).
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useInventory } from '@/stores/inventory.js'
import { formatQty, placeLabel } from '@/lib/format.js'
import { installedSections, locationSections } from '@/lib/home.js'

const { status, retry, records, parts, locations, hosts, lowStock, transit } = useInventory()

const sections = computed(() => locationSections(parts.value, locations.value, records.categories))
const installed = computed(() => installedSections(parts.value, hosts.value, records.locations))

// the location shown on a phone (all are shown as columns on wider screens)
const tab = ref('')
watch(
  sections,
  (list) => {
    if (!list.some((s) => s.location.id === tab.value)) tab.value = list[0]?.location.id ?? ''
  },
  { immediate: true },
)

const inTransitShare = (p) => (transit.value ? (p.spare?.[transit.value.id] ?? 0) : 0)
const unitOf = (s) => {
  // a section total mixes units; show a plain count when they differ
  const units = new Set(s.groups.flatMap((g) => g.items.map((i) => i.part.unit)))
  return units.size === 1 ? [...units][0] : ''
}
</script>

<template>
  <div v-if="status === 'loading' || status === 'idle'" class="skeleton" aria-busy="true">
    <div v-for="n in 4" :key="n" class="row"></div>
  </div>

  <div v-else-if="status === 'error'" class="state" role="alert">
    <p>Couldn't load your inventory.</p>
    <button type="button" class="btn btn-secondary" @click="retry">Retry</button>
  </div>

  <div v-else-if="parts.length === 0" class="state">
    <h2>Your catalog is empty</h2>
    <RouterLink :to="{ name: 'part-new' }" class="btn btn-primary">Add your first part</RouterLink>
  </div>

  <div v-else class="home">
    <section v-if="lowStock.length" class="card low" data-test="low-stock">
      <h2>Low stock</h2>
      <ul>
        <li v-for="p in lowStock" :key="p.id">
          <RouterLink :to="{ name: 'part', params: { id: p.id } }">{{ p.name }}</RouterLink>
          <span class="nums">
            {{ formatQty(p.spareTotal, p.unit) }}
            <template v-if="inTransitShare(p)">({{ inTransitShare(p) }} in transit)</template>
            · min {{ p.lowStockThreshold }}
          </span>
        </li>
      </ul>
    </section>

    <div class="tabs" role="tablist" aria-label="Locations">
      <button
        v-for="s in sections"
        :key="s.location.id"
        type="button"
        role="tab"
        :aria-selected="tab === s.location.id"
        :class="{ on: tab === s.location.id }"
        @click="tab = s.location.id"
      >
        {{ s.location.label }} <span class="count">{{ s.total }}</span>
      </button>
    </div>

    <div class="columns">
      <section
        v-for="s in sections"
        :key="s.location.id"
        class="card location"
        :class="{ shown: tab === s.location.id }"
        :data-location="s.location.id"
        role="tabpanel"
      >
        <h2>
          {{ s.location.label }}
          <span class="total">{{ unitOf(s) ? formatQty(s.total, unitOf(s)) : s.total }}</span>
        </h2>
        <template v-if="s.groups.length">
          <div v-for="g in s.groups" :key="g.category.id" class="group">
            <h3>{{ placeLabel(g.category) }}</h3>
            <ul>
              <li v-for="row in g.items" :key="row.part.id">
                <RouterLink :to="{ name: 'part', params: { id: row.part.id } }">{{
                  row.part.name
                }}</RouterLink>
                <span class="badge">{{ formatQty(row.qty, row.part.unit) }}</span>
              </li>
            </ul>
          </div>
        </template>
        <p v-else-if="s.location.kind === 'transit'" class="muted">Nothing in transit</p>
        <p v-else class="muted">
          Nothing spare in {{ s.location.label }} ·
          <RouterLink :to="{ name: 'record', query: { type: 'stock_in' } }"
            >Record stock in</RouterLink
          >
        </p>
      </section>
    </div>

    <details class="card installed" data-test="installed">
      <summary>
        <h2>Installed</h2>
      </summary>
      <p v-if="!installed.length" class="muted">
        No hosts yet.
        <RouterLink :to="{ name: 'settings-list', params: { kind: 'hosts' } }">Add one</RouterLink>
      </p>
      <div v-for="s in installed" :key="s.site.id" class="group">
        <h3>{{ placeLabel(s.site) }}</h3>
        <div v-for="h in s.hosts" :key="h.host.id" class="host">
          <p class="host-name">{{ h.host.label }}</p>
          <ul v-if="h.items.length">
            <li v-for="row in h.items" :key="row.part.id">
              <RouterLink :to="{ name: 'part', params: { id: row.part.id } }">{{
                row.part.name
              }}</RouterLink>
              <span class="badge">{{ formatQty(row.qty, row.part.unit) }}</span>
            </li>
          </ul>
          <p v-else class="muted">Nothing recorded as installed</p>
        </div>
      </div>
    </details>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.card {
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: 14px;
}

.card h2 {
  display: flex;
  justify-content: space-between;
  font-size: 1.05rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.low {
  border-color: hsla(40, 90%, 50%, 0.6);
}

h3 {
  margin: 0.75rem 0 0.25rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

ul {
  list-style: none;
  padding: 0;
}

li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  min-height: 44px;
  align-items: center;
  border-top: 1px solid var(--color-border);
}

li:first-child {
  border-top: none;
}

.badge,
.total,
.nums {
  font-variant-numeric: tabular-nums;
  color: var(--color-heading);
  font-weight: 600;
}

.tabs {
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
}

.tabs button {
  flex: none;
  min-height: 44px;
  padding: 0 0.9rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 999px;
  background: none;
  color: var(--color-heading);
  font: inherit;
  cursor: pointer;
}

.tabs button.on {
  border-color: var(--color-accent);
  background: var(--color-accent);
  color: var(--color-on-accent);
  font-weight: 600;
}

.count {
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}

/* phone: one location at a time (tabs) */
.location {
  display: none;
}

.location.shown {
  display: block;
}

.installed summary {
  list-style: none;
  cursor: pointer;
  min-height: 44px;
  display: flex;
  align-items: center;
}

.installed summary h2 {
  margin: 0;
}

.installed summary::before {
  content: '▸';
  margin-right: 0.5rem;
  color: var(--color-text-muted);
}

.installed[open] summary::before {
  content: '▾';
}

.host-name {
  margin-top: 0.4rem;
  font-weight: 600;
  color: var(--color-heading);
}

.muted {
  color: var(--color-text-muted);
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 3rem 0;
  text-align: center;
}

.skeleton .row {
  height: 56px;
  margin-bottom: 0.75rem;
  border-radius: 14px;
  background: var(--color-background-mute);
}

/* desktop: all locations side by side, no tabs */
@media (min-width: 768px) {
  .tabs {
    display: none;
  }

  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 1rem;
  }

  .location {
    display: block;
  }
}
</style>
