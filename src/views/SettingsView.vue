<script setup>
// Settings (spec §4.9): account, the reference lists (§4.10), and the
// developer action "Recalculate totals" (§7.6).
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuth } from '@/stores/auth.js'
import { useInventory } from '@/stores/inventory.js'
import { recalculatePart } from '@/lib/api.js'
import { describeError } from '@/lib/errors.js'
import { formatQty, placeLabel } from '@/lib/format.js'
import { showToast } from '@/stores/toast.js'
import { useAbout } from '@/composables/useAbout.js'

const { user, logout } = useAuth()
const { records, canWrite } = useInventory()

const count = (o, pred = (x) => !x.retired) => Object.values(o).filter(pred).length
const lists = computed(() => [
  { kind: 'sites', label: 'Sites', n: count(records.locations) },
  { kind: 'hosts', label: 'Hosts', n: count(records.hosts) },
  { kind: 'categories', label: 'Categories', n: count(records.categories) },
])

// --- recalculate totals (§7.6) --------------------------------------------------------
const partOptions = computed(() =>
  Object.values(records.parts).sort((a, b) => a.name.localeCompare(b.name)),
)
const partId = ref('')
const result = ref(null)
const busy = ref(false)
const error = ref('')

async function run(fix = false) {
  if (!partId.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    result.value = await recalculatePart(partId.value, fix)
    if (fix && result.value.fixed) showToast('Totals fixed')
  } catch (e) {
    const d = describeError(e)
    if (d.kind !== 'session' && d.kind !== 'aborted') error.value = d.message
  } finally {
    busy.value = false
  }
}

// one row per place where stored and computed amounts differ or exist
const diffRows = computed(() => {
  const r = result.value
  if (!r) return []
  const unit = records.parts[partId.value]?.unit ?? 'pcs'
  const rows = []
  for (const [field, lookup] of [
    ['spare', records.locations],
    ['installed', records.hosts],
  ]) {
    const ids = new Set([
      ...Object.keys(r.stored[field] ?? {}),
      ...Object.keys(r.computed[field] ?? {}),
    ])
    for (const id of ids) {
      const stored = r.stored[field]?.[id] ?? 0
      const computed = r.computed[field]?.[id] ?? 0
      rows.push({
        id: `${field}:${id}`,
        place: placeLabel(lookup[id]) + (field === 'installed' ? ' (installed)' : ''),
        stored: formatQty(stored, unit),
        computed: formatQty(computed, unit),
        differs: stored !== computed,
      })
    }
  }
  return rows
})

const { open: openAbout } = useAbout()
</script>

<template>
  <section class="settings">
    <h1>Settings</h1>

    <h2>Account</h2>
    <p class="email">{{ user?.email }}</p>
    <button type="button" class="btn btn-secondary" @click="logout">Log out</button>

    <h2>Lists</h2>
    <ul class="links">
      <li v-for="l in lists" :key="l.kind">
        <RouterLink :to="{ name: 'settings-list', params: { kind: l.kind } }">
          <span>{{ l.label }}</span>
          <span class="count">{{ l.n }} ›</span>
        </RouterLink>
      </li>
    </ul>

    <h2>Stocky</h2>
    <ul class="links">
      <li>
        <button type="button" class="row-button" data-test="settings-about" @click="openAbout">
          <span>About Stocky</span>
          <span class="count">›</span>
        </button>
      </li>
    </ul>

    <h2>Recalculate totals</h2>
    <p class="muted">
      Replays a part's history and compares it with the stored quantities. A check changes nothing;
      Fix writes the replayed totals.
    </p>
    <div class="recalc">
      <select v-model="partId" aria-label="Part to check" @change="result = null">
        <option value="" disabled>Pick a part</option>
        <option v-for="p in partOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <button
        type="button"
        class="btn btn-secondary"
        :disabled="!partId || busy"
        @click="run(false)"
      >
        Check
      </button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="result" class="result" data-test="recalc-result">
      <p v-if="result.matches" class="ok">
        Stored totals match the history ({{ result.movements }} movements).
      </p>
      <template v-else>
        <p class="bad">Stored totals differ from the history.</p>
        <table>
          <thead>
            <tr>
              <th>Place</th>
              <th>Stored</th>
              <th>From history</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in diffRows" :key="r.id" :class="{ differs: r.differs }">
              <td>{{ r.place }}</td>
              <td>{{ r.stored }}</td>
              <td>{{ r.computed }}</td>
            </tr>
          </tbody>
        </table>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="busy || !canWrite"
          @click="run(true)"
        >
          Fix
        </button>
      </template>
      <p v-if="result.dippedBelowZero" class="muted">
        The replay dipped below zero along the way (back-dated movements); the final totals are what
        counts.
      </p>
    </div>
  </section>
</template>

<style scoped>
.settings h1 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 1rem;
}

.settings h2 {
  font-size: 1.05rem;
  font-weight: 700;
  margin: 1.5rem 0 0.5rem;
}

.email {
  margin-bottom: 0.75rem;
}

.btn {
  min-height: 44px;
  border: none;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.btn-secondary {
  background: none;
}

.btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.links {
  list-style: none;
  padding: 0;
  max-width: 28rem;
}

.links a,
.row-button {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  min-height: 52px;
  padding: 0;
  border: none;
  border-top: 1px solid var(--color-border);
  background: none;
  color: var(--color-heading);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.count {
  color: var(--color-text-muted);
  font-weight: 400;
}

.muted {
  color: var(--color-text-muted);
}

.recalc {
  display: flex;
  gap: 0.5rem;
  margin: 0.75rem 0;
  max-width: 28rem;
}

.recalc select {
  flex: 1;
  min-height: 44px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font: inherit;
}

.result table {
  border-collapse: collapse;
  margin: 0.5rem 0 0.75rem;
}

.result th,
.result td {
  padding: 0.3rem 0.75rem 0.3rem 0;
  text-align: left;
}

.differs td {
  color: hsl(0, 65%, 50%);
  font-weight: 600;
}

.ok {
  color: var(--color-accent);
  font-weight: 600;
}

.bad,
.error {
  color: hsl(0, 65%, 50%);
  font-weight: 600;
}
</style>
