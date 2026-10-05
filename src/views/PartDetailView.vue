<script setup>
// Part detail (spec §4.5): header, quantities per place, actions, recent
// history with Undo, and Edit / Archive.
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useInventory } from '@/stores/inventory.js'
import { useAuth } from '@/stores/auth.js'
import { useMovementList } from '@/stores/movements.js'
import { showToast } from '@/stores/toast.js'
import { updatePart } from '@/lib/api.js'
import { describeError } from '@/lib/errors.js'
import { formatQty, placeLabel } from '@/lib/format.js'
import { canUndo } from '@/lib/movements.js'
import { isLowStock } from '@/lib/parts.js'
import { useUndoSheet } from '@/composables/useUndoSheet.js'
import MovementRow from '@/components/MovementRow.vue'
import ConfirmSheet from '@/components/ConfirmSheet.vue'

const route = useRoute()
const { records, locations, hosts, status, canWrite } = useInventory()
const { user } = useAuth()

const id = computed(() => route.params.id)
const part = computed(() => records.parts[id.value])
const notFound = computed(() => status.value === 'ready' && !part.value)
const category = computed(() => records.categories[part.value?.category])

// spares per place: active locations, plus any retired one still holding stock
const spareRows = computed(() => {
  const p = part.value
  if (!p) return []
  const active = locations.value.map((l) => ({ place: l, qty: p.spare?.[l.id] ?? 0 }))
  const retired = Object.values(records.locations)
    .filter((l) => l.retired && (p.spare?.[l.id] ?? 0) > 0)
    .map((l) => ({ place: l, qty: p.spare[l.id] }))
  return [...active, ...retired]
})
const installedRows = computed(() => {
  const p = part.value
  if (!p) return []
  return Object.entries(p.installed ?? {})
    .filter(([, qty]) => qty > 0)
    .map(([hostId, qty]) => ({ host: records.hosts[hostId], qty }))
    .filter((r) => r.host)
    .sort((a, b) => a.host.label.localeCompare(b.host.label))
})
const installedTotal = computed(() => installedRows.value.reduce((s, r) => s + r.qty, 0))

// actions that can't apply right now are disabled with a hint (spec §4.5)
const actions = computed(() => {
  const p = part.value
  if (!p) return []
  const archived = p.archived ? 'Archived: unarchive it first' : ''
  const spareAtActive = locations.value.some((l) => (p.spare?.[l.id] ?? 0) > 0)
  const list = [
    { type: 'stock_in', label: 'Stock in', hint: archived },
    {
      type: 'move',
      label: 'Move',
      hint:
        archived ||
        (!spareAtActive
          ? 'No spare stock to move'
          : locations.value.length < 2
            ? 'Only one location'
            : ''),
    },
    {
      type: 'install',
      label: 'Install',
      hint:
        archived ||
        (!spareAtActive
          ? 'No spare stock to install'
          : hosts.value.length === 0
            ? 'No hosts yet'
            : ''),
    },
    {
      type: 'uninstall',
      label: 'Uninstall',
      hint: archived || (installedTotal.value === 0 ? 'Nothing installed' : ''),
    },
    {
      type: 'stock_out',
      label: 'Stock out',
      hint: archived || (!spareAtActive ? 'No spare stock' : ''),
    },
  ]
  return list
})

// recent history (20) for this part; "Show all" opens History filtered to it
const history = useMovementList(() => ({ part: id.value }), { pageSize: 20 })
onMounted(() => history.start())
watch(id, () => history.reload())

const undoSheet = useUndoSheet(records)
const undoable = (m) =>
  canWrite.value &&
  canUndo(m, { lastMovementId: user.value?.lastMovementId, undone: history.undone })

const menuOpen = ref(false)
async function toggleArchived() {
  menuOpen.value = false
  const archived = !part.value.archived
  try {
    await updatePart(part.value.id, { archived })
    showToast(archived ? 'Archived' : 'Unarchived')
  } catch (e) {
    const d = describeError(e)
    if (d.kind !== 'session' && d.kind !== 'aborted') showToast(d.message, { kind: 'error' })
  }
}

const thresholdText = computed(() =>
  part.value?.lowStockEnabled
    ? `Low-stock alert at ${formatQty(part.value.lowStockThreshold, part.value.unit)} or less`
    : 'No low-stock alert',
)
</script>

<template>
  <section class="detail">
    <div v-if="status === 'loading' || status === 'idle'" class="skeleton" aria-busy="true">
      <div class="row tall"></div>
      <div v-for="n in 3" :key="n" class="row"></div>
    </div>

    <p v-else-if="notFound" class="state">
      Part not found. <RouterLink :to="{ name: 'parts' }">Back to Parts</RouterLink>
    </p>

    <template v-else-if="part">
      <header class="head">
        <div>
          <h1>
            {{ part.name }}
            <span v-if="part.archived" class="tag">Archived</span>
          </h1>
          <p class="sub">
            <span class="chip">{{ category ? placeLabel(category) : 'No category' }}</span>
            <span>{{ part.unit }}</span>
            <span v-if="part.manufacturer || part.model">
              · {{ [part.manufacturer, part.model].filter(Boolean).join(' ') }}
            </span>
          </p>
          <p class="sub" :class="{ low: isLowStock(part) }">{{ thresholdText }}</p>
          <p v-if="part.notes" class="notes">{{ part.notes }}</p>
        </div>
        <div class="menu">
          <button
            type="button"
            class="more"
            aria-label="More actions"
            :aria-expanded="menuOpen"
            @click="menuOpen = !menuOpen"
          >
            ⋯
          </button>
          <div v-if="menuOpen" class="menu-list" role="menu">
            <RouterLink :to="{ name: 'part-edit', params: { id: part.id } }" role="menuitem">
              Edit
            </RouterLink>
            <button type="button" role="menuitem" :disabled="!canWrite" @click="toggleArchived">
              {{ part.archived ? 'Unarchive' : 'Archive' }}
            </button>
          </div>
        </div>
      </header>

      <section class="grid" aria-label="Quantities">
        <div v-for="r in spareRows" :key="r.place.id" class="cell">
          <span class="label">{{ placeLabel(r.place) }}</span>
          <span class="value">{{ formatQty(r.qty, part.unit) }}</span>
        </div>
        <div class="cell total">
          <span class="label">Total spare</span>
          <span class="value">{{ formatQty(part.spareTotal, part.unit) }}</span>
        </div>
      </section>

      <section class="installed">
        <h2>Installed in</h2>
        <ul v-if="installedRows.length">
          <li v-for="r in installedRows" :key="r.host.id">
            <span>{{ placeLabel(r.host) }}</span>
            <span class="value">{{ formatQty(r.qty, part.unit) }}</span>
          </li>
        </ul>
        <p v-else class="muted">Not installed anywhere</p>
      </section>

      <section class="actions" aria-label="Actions">
        <template v-for="a in actions" :key="a.type">
          <RouterLink
            v-if="!a.hint && canWrite"
            :to="{ name: 'record', query: { type: a.type, part: part.id } }"
            class="action"
            :data-action="a.type"
          >
            {{ a.label }}
          </RouterLink>
          <span v-else class="action disabled" :data-action="a.type" :title="a.hint || 'Offline'">
            {{ a.label }}
            <small>{{ a.hint || 'Offline' }}</small>
          </span>
        </template>
      </section>

      <section class="history">
        <h2>History</h2>
        <p v-if="history.error.value" class="muted" role="alert">
          Couldn't load the history.
          <button type="button" class="link" @click="history.reload()">Retry</button>
        </p>
        <p v-else-if="history.loading.value && !history.items.value.length" class="muted">
          Loading…
        </p>
        <p v-else-if="!history.items.value.length" class="muted">No movements yet</p>
        <template v-else>
          <MovementRow
            v-for="m in history.items.value.slice(0, 20)"
            :key="m.id"
            :movement="m"
            :records="records"
            :undone="history.undone.has(m.id)"
            :undoable="undoable(m)"
            @undo="undoSheet.open"
          />
          <RouterLink :to="{ name: 'history', query: { part: part.id } }" class="show-all">
            Show all
          </RouterLink>
        </template>
      </section>
    </template>

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
  </section>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

h1 {
  font-size: 1.5rem;
  font-weight: 700;
}

h2 {
  font-size: 1.05rem;
  font-weight: 700;
  margin: 1.5rem 0 0.5rem;
}

.sub {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  color: var(--color-text-muted);
  margin-top: 0.25rem;
}

.sub.low {
  color: hsl(35, 85%, 45%);
  font-weight: 600;
}

.chip {
  padding: 0.1rem 0.6rem;
  border-radius: 999px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-weight: 600;
  font-size: 0.85rem;
}

.tag {
  margin-left: 0.4rem;
  padding: 0 0.4rem;
  border-radius: 6px;
  background: var(--color-background-mute);
  color: var(--color-text-muted);
  font-size: 0.75rem;
  vertical-align: middle;
}

.notes {
  margin-top: 0.5rem;
  white-space: pre-wrap;
}

.menu {
  position: relative;
}

.more {
  width: 44px;
  height: 44px;
  border: none;
  background: none;
  color: var(--color-heading);
  font-size: 1.4rem;
  cursor: pointer;
}

.menu-list {
  position: absolute;
  right: 0;
  top: 44px;
  display: flex;
  flex-direction: column;
  min-width: 10rem;
  padding: 0.25rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  background: var(--color-background);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
  z-index: 20;
}

.menu-list a,
.menu-list button {
  min-height: 44px;
  padding: 0 0.75rem;
  border: none;
  background: none;
  color: var(--color-heading);
  font: inherit;
  text-align: left;
  display: flex;
  align-items: center;
  cursor: pointer;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
  gap: 0.5rem;
  margin-top: 1.25rem;
}

.cell {
  display: flex;
  flex-direction: column;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
}

.cell.total {
  background: var(--color-background-mute);
}

.label {
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.value {
  color: var(--color-heading);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.installed ul {
  list-style: none;
  padding: 0;
}

.installed li {
  display: flex;
  justify-content: space-between;
  min-height: 40px;
  align-items: center;
  border-top: 1px solid var(--color-border);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1.25rem;
}

.action {
  display: inline-flex;
  flex-direction: column;
  justify-content: center;
  min-height: 44px;
  padding: 0.3rem 0.9rem;
  border: 1px solid var(--color-accent);
  border-radius: 12px;
  color: var(--color-accent);
  font-weight: 600;
}

.action.disabled {
  border-color: var(--color-border);
  color: var(--color-text-muted);
  cursor: not-allowed;
}

.action small {
  font-weight: 400;
  font-size: 0.75rem;
}

.show-all {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  font-weight: 600;
}

.muted {
  color: var(--color-text-muted);
}

.link {
  border: none;
  background: none;
  color: var(--color-accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.state {
  padding: 3rem 0;
  text-align: center;
}

.skeleton .row {
  height: 48px;
  margin-bottom: 0.75rem;
  border-radius: 12px;
  background: var(--color-background-mute);
}

.skeleton .tall {
  height: 96px;
}

@media (min-width: 768px) {
  .detail {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 2rem;
  }

  .head,
  .grid,
  .installed,
  .actions {
    grid-column: 1;
  }

  .history {
    grid-column: 2;
    grid-row: 1 / span 5;
  }
}
</style>
