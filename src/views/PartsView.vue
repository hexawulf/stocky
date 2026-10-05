<script setup>
// Parts catalog and search (spec §4.4). Search runs in memory (spec §5.6).
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useInventory } from '@/stores/inventory.js'
import { formatQty } from '@/lib/format.js'
import { isLowStock, searchParts } from '@/lib/parts.js'

const route = useRoute()
const router = useRouter()
const { records, categories, status, retry } = useInventory()

const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const category = ref('')
const showArchived = ref(false)
const searchInput = ref(null)

// opened from the ＋ flow or with ?q=: focus the search (spec §4.4)
onMounted(() => {
  if (route.query.focus || route.query.q) searchInput.value?.focus()
})
watch(query, (q) => router.replace({ query: q ? { q } : {} }))

const allParts = computed(() => Object.values(records.parts))
const visible = computed(() => {
  let list = allParts.value.filter((p) => showArchived.value || !p.archived)
  if (category.value) list = list.filter((p) => p.category === category.value)
  return searchParts(list, query.value).sort((a, b) => a.name.localeCompare(b.name))
})

const categoryLabel = (id) => {
  const c = records.categories[id]
  if (!c) return ''
  return c.retired ? `${c.label} (retired)` : c.label
}
const maker = (p) => [p.manufacturer, p.model].filter(Boolean).join(' ')
const newPartLink = computed(() => ({
  name: 'part-new',
  query: query.value.trim() ? { name: query.value.trim() } : {},
}))
</script>

<template>
  <section class="parts">
    <h1>Parts</h1>

    <input
      ref="searchInput"
      v-model="query"
      type="search"
      class="search"
      placeholder="Search name, manufacturer, model"
      aria-label="Search parts"
    />

    <div class="chips" role="group" aria-label="Filter by category">
      <button
        v-for="c in categories"
        :key="c.id"
        type="button"
        :class="{ on: category === c.id }"
        :aria-pressed="category === c.id"
        @click="category = category === c.id ? '' : c.id"
      >
        {{ c.label }}
      </button>
    </div>

    <label class="toggle">
      <input v-model="showArchived" type="checkbox" />
      Show archived parts
    </label>

    <div v-if="status === 'loading' || status === 'idle'" class="skeleton" aria-busy="true">
      <div v-for="n in 5" :key="n" class="row"></div>
    </div>

    <div v-else-if="status === 'error'" class="state" role="alert">
      <p>Couldn't load your parts.</p>
      <button type="button" class="btn btn-secondary" @click="retry">Retry</button>
    </div>

    <div v-else-if="allParts.length === 0" class="state">
      <h2>Your catalog is empty</h2>
      <RouterLink :to="{ name: 'part-new' }" class="btn btn-primary"
        >Add your first part</RouterLink
      >
    </div>

    <div v-else-if="visible.length === 0" class="state">
      <p v-if="query.trim()">No parts match '{{ query.trim() }}'</p>
      <p v-else>No parts in this view</p>
      <RouterLink v-if="query.trim()" :to="newPartLink" class="btn btn-primary">
        Add "{{ query.trim() }}" as a new part
      </RouterLink>
    </div>

    <ul v-else class="list">
      <li v-for="p in visible" :key="p.id">
        <RouterLink :to="{ name: 'part', params: { id: p.id } }" class="item">
          <span class="main">
            <span class="name">
              {{ p.name }}
              <span v-if="p.archived" class="tag">Archived</span>
            </span>
            <span class="meta">
              {{ categoryLabel(p.category) }}<template v-if="maker(p)"> · {{ maker(p) }}</template>
            </span>
          </span>
          <span class="qty">
            <span v-if="isLowStock(p)" class="low" title="Low stock" aria-label="Low stock"></span>
            {{ formatQty(p.spareTotal, p.unit) }}
          </span>
        </RouterLink>
      </li>
    </ul>

    <RouterLink :to="newPartLink" class="fab" aria-label="New part">＋ New part</RouterLink>
  </section>
</template>

<style scoped>
.parts h1 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 0.75rem;
}

.search {
  width: 100%;
  min-height: 44px;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font: inherit;
}

.chips {
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  padding: 0.75rem 0 0.5rem;
}

.chips button {
  flex: none;
  min-height: 36px;
  padding: 0 0.8rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 999px;
  background: none;
  color: var(--color-heading);
  font: inherit;
  cursor: pointer;
}

.chips button.on {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-weight: 600;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 44px;
  color: var(--color-text-muted);
}

.list {
  list-style: none;
  padding: 0;
  margin-bottom: 5rem;
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 60px;
  padding: 0.5rem 0;
  border-top: 1px solid var(--color-border);
  color: var(--color-text);
}

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.name {
  color: var(--color-heading);
  font-weight: 600;
}

.meta {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.tag {
  margin-left: 0.4rem;
  padding: 0 0.4rem;
  border-radius: 6px;
  background: var(--color-background-mute);
  color: var(--color-text-muted);
  font-size: 0.75rem;
  font-weight: 600;
}

.qty {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: none;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--color-heading);
}

.low {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: hsl(40, 90%, 50%);
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
  margin-top: 0.75rem;
  border-radius: 12px;
  background: var(--color-background-mute);
}

.fab {
  position: fixed;
  right: 1rem;
  bottom: calc(72px + env(safe-area-inset-bottom));
  display: inline-flex;
  align-items: center;
  min-height: 48px;
  padding: 0 1.1rem;
  border-radius: 999px;
  background: var(--color-accent);
  color: var(--color-on-accent);
  font-weight: 700;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
  z-index: 15;
}

@media (min-width: 768px) {
  .fab {
    bottom: 1.5rem;
  }
}
</style>
