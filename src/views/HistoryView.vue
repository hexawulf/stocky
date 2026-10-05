<script setup>
// History (spec §4.8): every movement, newest first, grouped by day, 50 per
// page with infinite scroll. Filters live in the URL (?type=&part=&place=
// &from=&to=) and run on the server (decision #22). A discovery import's
// rows are one collapsible group with Undo import (spec §13.4.4).
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useInventory } from '@/stores/inventory.js'
import { useAuth } from '@/stores/auth.js'
import { useMovementList } from '@/stores/movements.js'
import { placeLabel } from '@/lib/format.js'
import { MOVEMENT_TYPES, canUndo, formatDay, groupByDay } from '@/lib/movements.js'
import { canUndoImport, gatherImports, importTitle, placeQuietImports } from '@/lib/discovery.js'
import { listQuietImports, undoImport } from '@/lib/api.js'
import { describeError } from '@/lib/errors.js'
import { showToast } from '@/stores/toast.js'
import { useUndoSheet } from '@/composables/useUndoSheet.js'
import MovementRow from '@/components/MovementRow.vue'
import ConfirmSheet from '@/components/ConfirmSheet.vue'

const route = useRoute()
const router = useRouter()
const { records, canWrite } = useInventory()
const { user } = useAuth()

const KEYS = ['type', 'part', 'place', 'from', 'to']
const fromQuery = (q) =>
  Object.fromEntries(KEYS.map((k) => [k, typeof q[k] === 'string' ? q[k] : '']))

const filters = reactive(fromQuery(route.query))
const active = computed(() => KEYS.some((k) => filters[k]))

const list = useMovementList(() => ({ ...filters }))

// filters -> URL -> reload; Back/Forward (URL -> filters) too
watch(
  () => ({ ...filters }),
  (f) => {
    const query = Object.fromEntries(Object.entries(f).filter(([, v]) => v))
    router.replace({ query })
  },
)
watch(
  () => route.query,
  (q) => {
    const next = fromQuery(q)
    if (KEYS.some((k) => next[k] !== filters[k])) Object.assign(filters, next)
    list.reload()
  },
)

function clearFilters() {
  for (const k of KEYS) filters[k] = ''
}

// filter options: retired places and archived parts stay available (spec §4.8)
const bySort = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.label.localeCompare(b.label)
const locationOptions = computed(() => Object.values(records.locations).sort(bySort))
const hostOptions = computed(() => Object.values(records.hosts).sort(bySort))
const partOptions = computed(() =>
  Object.values(records.parts).sort((a, b) => a.name.localeCompare(b.name)),
)

// imports that only linked serials have no movement rows; they're placed on
// their day anyway, so every import leaves a trace (spec §13.11.11)
const quietImports = ref([])
async function loadQuietImports() {
  try {
    quietImports.value = await listQuietImports()
  } catch (e) {
    describeError(e) // logs it; History works without them
  }
}
const groups = computed(() =>
  placeQuietImports(
    groupByDay(list.items.value).map((g) => ({ ...g, blocks: gatherImports(g.items) })),
    quietImports.value,
    { filters, done: list.done.value },
  ),
)

// --- imports: one group each, with Undo import ----------------------------------------
const importOf = (id) => list.imports[id] ?? quietImports.value.find((i) => i.id === id)
const importUndoable = (id) =>
  canWrite.value && canUndoImport(importOf(id), { lastMovementId: user.value?.lastMovementId })
const undoingImport = ref(null) // { id, count }
const importBusy = ref(false)
const importError = ref('')
function askUndoImport(block) {
  undoingImport.value = { id: block.importId, count: block.items.length }
  importError.value = ''
}
async function confirmUndoImport() {
  importBusy.value = true
  importError.value = ''
  try {
    await undoImport(undoingImport.value.id)
    showToast('Import undone')
    undoingImport.value = null
    await Promise.all([list.refreshImports(), loadQuietImports()])
  } catch (e) {
    const d = describeError(e)
    if (d.kind !== 'aborted' && d.kind !== 'session') importError.value = d.message
  } finally {
    importBusy.value = false
  }
}

const undoSheet = useUndoSheet(records)
const undoable = (m) =>
  canWrite.value && canUndo(m, { lastMovementId: user.value?.lastMovementId, undone: list.undone })

// infinite scroll: load the next page when the sentinel comes into view
const sentinel = ref(null)
let observer = null
onMounted(async () => {
  loadQuietImports()
  await list.start()
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) list.loadMore()
    })
    if (sentinel.value) observer.observe(sentinel.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section class="history">
    <h1>History</h1>

    <form class="filters" aria-label="Filters" @submit.prevent>
      <label>
        Type
        <select v-model="filters.type" data-filter="type">
          <option value="">All types</option>
          <option v-for="t in MOVEMENT_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </label>
      <label>
        Place
        <select v-model="filters.place" data-filter="place">
          <option value="">All places</option>
          <optgroup label="Locations">
            <option v-for="l in locationOptions" :key="l.id" :value="l.id">
              {{ placeLabel(l) }}
            </option>
          </optgroup>
          <optgroup v-if="hostOptions.length" label="Hosts">
            <option v-for="h in hostOptions" :key="h.id" :value="h.id">{{ placeLabel(h) }}</option>
          </optgroup>
        </select>
      </label>
      <label>
        Part
        <select v-model="filters.part" data-filter="part">
          <option value="">All parts</option>
          <option v-for="p in partOptions" :key="p.id" :value="p.id">
            {{ p.archived ? `${p.name} (archived)` : p.name }}
          </option>
        </select>
      </label>
      <label>
        From
        <input
          v-model="filters.from"
          type="date"
          data-filter="from"
          :max="filters.to || undefined"
        />
      </label>
      <label>
        To
        <input v-model="filters.to" type="date" data-filter="to" :min="filters.from || undefined" />
      </label>
      <button v-if="active" type="button" class="clear" @click="clearFilters">Clear filters</button>
    </form>

    <p v-if="list.error.value && !list.items.value.length" class="state" role="alert">
      Couldn't load the history.
      <button type="button" class="link" @click="list.reload()">Retry</button>
    </p>

    <div
      v-else-if="list.loading.value && !list.items.value.length"
      class="skeleton"
      aria-busy="true"
    >
      <div v-for="n in 6" :key="n" class="row"></div>
    </div>

    <div v-else-if="!list.items.value.length" class="state">
      <template v-if="active">
        <p>No movements match these filters</p>
        <button type="button" class="btn btn-secondary" @click="clearFilters">Clear filters</button>
      </template>
      <p v-else>No movements yet</p>
    </div>

    <template v-else>
      <section v-for="g in groups" :key="g.date" class="day">
        <h2>{{ formatDay(g.date) }}</h2>
        <template
          v-for="b in g.blocks"
          :key="
            b.kind === 'import' ? `i-${b.importId}-${b.items[0]?.id ?? 'quiet'}` : b.movement.id
          "
        >
          <details v-if="b.kind === 'import'" class="import-group" :data-import="b.importId">
            <summary>
              <span class="import-title">{{
                importTitle(importOf(b.importId), b.items, records.hosts)
              }}</span>
              <span v-if="importOf(b.importId)?.undone" class="badge">Undone</span>
              <button
                v-if="importUndoable(b.importId)"
                type="button"
                class="undo-import"
                data-test="undo-import"
                @click.prevent="askUndoImport(b)"
              >
                Undo import
              </button>
            </summary>
            <p v-if="b.quiet" class="quiet" data-test="quiet-import">
              No quantities changed: serials were linked to parts already recorded in this host.
            </p>
            <MovementRow
              v-for="m in b.items"
              :key="m.id"
              :movement="m"
              :records="records"
              show-part
              :undone="list.undone.has(m.id)"
            />
          </details>
          <MovementRow
            v-else
            :movement="b.movement"
            :records="records"
            show-part
            :undone="list.undone.has(b.movement.id)"
            :undoable="undoable(b.movement)"
            @undo="undoSheet.open"
          />
        </template>
      </section>
      <p v-if="list.error.value" class="state" role="alert">
        Couldn't load more.
        <button type="button" class="link" @click="list.loadMore()">Retry</button>
      </p>
      <button
        v-else-if="!list.done.value"
        type="button"
        class="more"
        :disabled="list.loading.value"
        @click="list.loadMore()"
      >
        {{ list.loading.value ? 'Loading…' : 'Load more' }}
      </button>
    </template>
    <div ref="sentinel" class="sentinel" aria-hidden="true"></div>

    <ConfirmSheet
      v-if="undoSheet.pending.value"
      title="Undo this movement?"
      confirm-label="Undo"
      :busy="undoSheet.busy.value"
      :error="undoSheet.error.value"
      @confirm="undoSheet.confirm"
      @cancel="undoSheet.close"
    >
      <p data-test="reversal">{{ undoSheet.text.value }}</p>
    </ConfirmSheet>

    <ConfirmSheet
      v-if="undoingImport"
      title="Undo this import?"
      confirm-label="Undo import"
      :busy="importBusy"
      :error="importError"
      @confirm="confirmUndoImport"
      @cancel="undoingImport = null"
    >
      <p data-test="undo-import-text">
        Its {{ undoingImport.count }} movement{{ undoingImport.count === 1 ? ' is' : 's are' }}
        reversed, serials it added are removed and what it learned is forgotten. Parts it created
        stay; archive them if you don't need them.
      </p>
    </ConfirmSheet>
  </section>
</template>

<style scoped>
.history h1 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 0.75rem;
}

.filters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.filters label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

select,
input {
  min-height: 44px;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font: inherit;
}

.clear,
.link,
.more {
  min-height: 44px;
  border: none;
  background: none;
  color: var(--color-accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.clear {
  align-self: end;
}

.day h2 {
  margin: 1rem 0 0.25rem;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.more {
  width: 100%;
  margin-top: 0.75rem;
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
  height: 52px;
  margin-bottom: 0.6rem;
  border-radius: 12px;
  background: var(--color-background-mute);
}

.sentinel {
  height: 1px;
}
.import-group {
  margin: 0.25rem 0;
  border-top: 1px solid var(--color-border);
}

.import-group summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  min-height: 44px;
  padding: 0.4rem 0;
  cursor: pointer;
  list-style: none;
}

.import-group summary::before {
  content: '▸';
  color: var(--color-text-muted);
}

.import-group[open] summary::before {
  content: '▾';
}

.import-group[open] {
  padding-left: 0.75rem;
  border-left: 3px solid var(--color-accent-soft);
}

.import-title {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  color: var(--color-heading);
}

.badge {
  padding: 0 0.4rem;
  border-radius: 6px;
  background: var(--color-background-mute);
  color: var(--color-text-muted);
  font-size: 0.75rem;
  font-weight: 600;
}

.undo-import {
  min-height: 44px;
  padding: 0 0.9rem;
  border: 1px solid var(--color-accent);
  border-radius: 999px;
  background: none;
  color: var(--color-accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.quiet {
  padding: 0.25rem 0 0.6rem;
  color: var(--color-text-muted);
  font-size: 0.9rem;
}
</style>
