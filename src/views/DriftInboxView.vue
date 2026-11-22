<script setup>
// Drift Inbox (/fleet/drift — Phase 3.4):
// Shows every host with pending hardware changes detected by automated ingest.
// Operator can review diff summary (New, Missing, Replaced, Moved, Conflicts, SMART warnings)
// and confirm changes into the ledger in 1 click (or open full interactive preview) — with 24h undo.
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useInventory } from '@/stores/inventory.js'
import { showToast } from '@/stores/toast.js'
import { applyDriftSnapshot, dismissDriftSnapshot, listPendingSnapshots } from '@/lib/api.js'
import { describeError } from '@/lib/errors.js'

const { records, canWrite } = useInventory()

const pendingList = ref([])
const loading = ref(true)
const busyId = ref('')
const error = ref('')

async function loadPending() {
  loading.value = true
  error.value = ''
  try {
    pendingList.value = await listPendingSnapshots('status = "drift_pending"')
  } catch (e) {
    error.value = describeError(e).message
  } finally {
    loading.value = false
  }
}

onMounted(loadPending)

const enriched = computed(() =>
  pendingList.value.map((item) => {
    const host = records.hosts[item.host]
    const site = host ? records.locations[host.site] : null
    const diff = item.diffSummary && typeof item.diffSummary === 'object' ? item.diffSummary : {}
    const snap = item.snapshot && typeof item.snapshot === 'object' ? item.snapshot : {}
    const badges = []
    if (diff.new) badges.push(`${diff.new} new`)
    if (diff.missing) badges.push(`${diff.missing} missing`)
    if (diff.replaced) badges.push(`${diff.replaced} replaced`)
    if (diff.moved) badges.push(`${diff.moved} moved`)
    if (diff.conflicts) badges.push(`${diff.conflicts} conflict`)
    if (diff.adopt) badges.push(`${diff.adopt} serial adopt`)
    return {
      item,
      host,
      hostLabel: host?.label || snap.host?.hostname || 'Host',
      siteLabel: site?.label || '',
      badges,
      smartWarnings: diff.smartWarnings || [],
      items: (snap.items || []).slice(0, 6),
    }
  }),
)

async function confirmDrift(entry) {
  if (busyId.value || !canWrite.value) return
  busyId.value = entry.item.id
  error.value = ''
  try {
    const res = await applyDriftSnapshot(entry.item.id)
    showToast(
      `Applied drift for ${entry.hostLabel}: ${res.movements} movement${res.movements === 1 ? '' : 's'}`,
      {
        actions: [{ label: 'History', to: { name: 'history', query: { place: entry.item.host } } }],
      },
    )
    await loadPending()
  } catch (e) {
    error.value = describeError(e).message
  } finally {
    busyId.value = ''
  }
}

async function ignoreDrift(entry) {
  if (busyId.value || !canWrite.value) return
  busyId.value = entry.item.id
  error.value = ''
  try {
    await dismissDriftSnapshot(entry.item.id)
    showToast(`Dismissed pending drift for ${entry.hostLabel}`)
    await loadPending()
  } catch (e) {
    error.value = describeError(e).message
  } finally {
    busyId.value = ''
  }
}
</script>

<template>
  <section class="drift-page" data-test="drift-inbox-view">
    <header class="head">
      <div>
        <RouterLink :to="{ name: 'fleet' }" class="back">‹ Fleet</RouterLink>
        <h1>Drift Inbox</h1>
        <p class="sub">
          Review physical hardware changes detected by automated fleet snapshots before updating the
          stock ledger
        </p>
      </div>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div v-if="loading" class="skeleton" aria-busy="true">
      <div v-for="n in 2" :key="n" class="row"></div>
    </div>

    <div v-else-if="!enriched.length" class="empty-card" data-test="drift-empty">
      <h2>All hosts are in sync</h2>
      <p class="muted">
        Zero unreviewed hardware drift across your fleet. Telemetry (OS, kernel, SMART temperatures
        and last-seen timestamps) updates automatically without cluttering your movement ledger.
      </p>
      <RouterLink :to="{ name: 'fleet' }" class="btn btn-secondary">Back to Fleet</RouterLink>
    </div>

    <div v-else class="drift-list">
      <article
        v-for="e in enriched"
        :key="e.item.id"
        class="drift-card"
        :data-drift-host="e.hostLabel"
      >
        <header class="card-head">
          <div>
            <h2>
              <RouterLink v-if="e.host" :to="{ name: 'host-detail', params: { id: e.host.id } }">
                {{ e.hostLabel }}
              </RouterLink>
              <span v-else>{{ e.hostLabel }}</span>
              <span v-if="e.siteLabel" class="site-tag">· {{ e.siteLabel }}</span>
            </h2>
            <p class="meta">
              Collected
              {{ (e.item.collectedAt || e.item.created || '').slice(0, 16).replace('T', ' ') }}
              <template v-if="e.item.collector"> · {{ e.item.collector }}</template>
            </p>
          </div>
          <div class="badge-row">
            <span v-for="(b, idx) in e.badges" :key="idx" class="diff-badge">
              {{ b }}
            </span>
          </div>
        </header>

        <ul v-if="e.smartWarnings.length" class="smart-alerts">
          <li v-for="(w, i) in e.smartWarnings" :key="i">SMART Warning: {{ w }}</li>
        </ul>

        <div class="detected-preview">
          <span v-for="(it, idx) in e.items" :key="idx" class="item-chip">
            <strong>{{ it.kind }}:</strong> {{ [it.vendor, it.model].filter(Boolean).join(' ') }}
            <template v-if="it.serial"> ({{ it.serial }})</template>
          </span>
        </div>

        <footer class="card-actions">
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="!!busyId || !canWrite"
            data-test="drift-dismiss"
            @click="ignoreDrift(e)"
          >
            Dismiss
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!!busyId || !canWrite"
            data-test="drift-apply"
            @click="confirmDrift(e)"
          >
            {{ busyId === e.item.id ? 'Applying…' : 'Confirm & Apply to Ledger' }}
          </button>
        </footer>
      </article>
    </div>
  </section>
</template>

<style scoped>
.drift-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.back {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  font-weight: 600;
}

h1 {
  font-size: 1.45rem;
  font-weight: 700;
}

.sub {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.empty-card {
  padding: 2.25rem 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.empty-card p {
  max-width: 34rem;
}

.drift-list {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.drift-card {
  padding: 1rem 1.15rem;
  border: 1px solid var(--color-border-hover);
  border-left: 4px solid hsl(35, 90%, 50%);
  border-radius: 14px;
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.card-head h2 {
  font-size: 1.1rem;
  font-weight: 700;
}

.site-tag,
.meta {
  color: var(--color-text-muted);
  font-size: 0.85rem;
  font-weight: 400;
}

.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.diff-badge {
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: hsla(35, 95%, 50%, 0.18);
  color: hsl(35, 90%, 45%);
  font-size: 0.78rem;
  font-weight: 700;
}

.smart-alerts {
  margin: 0;
  padding: 0.5rem 0.75rem 0.5rem 1.6rem;
  border-radius: 8px;
  background: hsla(0, 85%, 50%, 0.14);
  color: hsl(0, 75%, 50%);
  font-size: 0.85rem;
  font-weight: 600;
}

.detected-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.item-chip {
  padding: 0.2rem 0.55rem;
  border-radius: 7px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  font-size: 0.78rem;
}

.card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
}

.btn {
  min-height: 42px;
  padding: 0 1rem;
  border: none;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.muted {
  color: var(--color-text-muted);
}

.error {
  color: hsl(0, 65%, 50%);
  font-weight: 600;
}

.skeleton .row {
  height: 96px;
  margin-bottom: 0.75rem;
  border-radius: 14px;
  background: var(--color-background-mute);
}
</style>
