<script setup>
// Host Detail Inspector (/fleet/:id — Phase 3.3):
// - Visual Hardware Anatomy Diagram (SVG block diagram showing Board/SoC -> CPU,
//   Memory slots, Drive Bays with model/size/interface/serial/SMART, PCIe/GPUs, NICs, USB/HATs)
// - Installed Units & Spare Linkage (lists Stocky-tracked units & parts installed in this host,
//   with 1-click "Swap with spare" or "Uninstall to spare" wired into Stocky's movement flow)
// - Hardware Timeline (chronological history of snapshots & imports for this host)
// - Quick Metadata Editor (Site, Role, Form Factor, Provider, Monthly Cost, TDP).
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useInventory } from '@/stores/inventory.js'
import { showToast } from '@/stores/toast.js'
import {
  listImports,
  listPendingSnapshots,
  listUnits,
  recordMovement,
  updateEntry,
} from '@/lib/api.js'
import { describeError } from '@/lib/errors.js'
import { CURRENCIES, formatQty, placeLabel } from '@/lib/format.js'
import {
  FORM_FACTORS,
  FORM_FACTOR_LABELS,
  formatDriveShort,
  formatRamGb,
  formatStorageBytes,
  hostFreshness,
  inferHostFormFactor,
} from '@/lib/fleet.js'

const route = useRoute()
const { records, status, canWrite, locations } = useInventory()

const hostId = computed(() => route.params.id)
const host = computed(() => records.hosts[hostId.value] || null)
const specs = computed(() =>
  host.value?.specs && typeof host.value.specs === 'object' ? host.value.specs : {},
)
const ff = computed(() => (host.value ? inferHostFormFactor(host.value) : 'workstation'))
const fresh = computed(() => (host.value ? hostFreshness(host.value) : { label: '—', dot: 'gray' }))
const sites = computed(() => locations.value.filter((l) => l.kind === 'site'))

// Installed parts and units in this host
const hostUnits = ref([])
const hostImports = ref([])
const hostSnapshots = ref([])
const actionBusy = ref(false)

async function loadHostExtras() {
  if (!hostId.value) return
  try {
    const [u, imps, snaps] = await Promise.all([
      listUnits(`host = "${hostId.value}" && status = "installed"`),
      listImports(),
      listPendingSnapshots(`host = "${hostId.value}"`),
    ])
    hostUnits.value = u
    hostImports.value = imps.filter((i) => i.host === hostId.value)
    hostSnapshots.value = snaps
  } catch (e) {
    describeError(e)
  }
}

onMounted(loadHostExtras)
watch(hostId, loadHostExtras)

const installedParts = computed(() => {
  if (!host.value) return []
  return Object.values(records.parts)
    .filter((p) => (p.installed?.[host.value.id] ?? 0) > 0)
    .map((p) => ({
      part: p,
      qty: p.installed[host.value.id],
      spareAtSite: p.spare?.[host.value.site] ?? 0,
      units: hostUnits.value.filter((u) => u.part === p.id),
    }))
    .sort((a, b) => a.part.name.localeCompare(b.part.name))
})

async function quickUninstall(part) {
  if (!host.value || actionBusy.value || !canWrite.value) return
  actionBusy.value = true
  try {
    await recordMovement({
      type: 'uninstall',
      part: part.id,
      quantity: 1,
      fromHost: host.value.id,
      toLocation: host.value.site,
      note: `Uninstalled from ${host.value.label} to site spare`,
    })
    showToast(`Uninstalled 1 ${part.name} to ${placeLabel(records.locations[host.value.site])}`)
    await loadHostExtras()
  } catch (e) {
    showToast(describeError(e).message)
  } finally {
    actionBusy.value = false
  }
}

// Metadata Editor
const editingMeta = ref(false)
const metaBusy = ref(false)
const metaError = ref('')
const metaForm = reactive({
  site: '',
  role: '',
  type: '',
  formFactor: '',
  provider: '',
  monthlyCost: '',
  currency: 'USD',
  tdpWatts: '',
})

function openMetaEditor() {
  if (!host.value) return
  metaForm.site = host.value.site || ''
  metaForm.role = host.value.role || ''
  metaForm.type = host.value.type || ''
  metaForm.formFactor = inferHostFormFactor(host.value)
  metaForm.provider = host.value.provider || ''
  metaForm.monthlyCost = host.value.monthlyCost || ''
  metaForm.currency = host.value.currency || 'USD'
  metaForm.tdpWatts = host.value.tdpWatts || ''
  metaError.value = ''
  editingMeta.value = true
}

async function saveMeta() {
  if (!host.value || metaBusy.value || !canWrite.value) return
  metaBusy.value = true
  metaError.value = ''
  try {
    await updateEntry('hosts', host.value.id, {
      site: metaForm.site,
      role: metaForm.role.trim(),
      type: metaForm.type.trim(),
      formFactor: metaForm.formFactor,
      provider: metaForm.provider.trim(),
      monthlyCost: Number(metaForm.monthlyCost) || 0,
      currency: metaForm.currency || 'USD',
      tdpWatts: Number(metaForm.tdpWatts) || 0,
    })
    editingMeta.value = false
    showToast('Host metadata updated')
  } catch (e) {
    metaError.value = describeError(e).message
  } finally {
    metaBusy.value = false
  }
}
</script>

<template>
  <section class="inspector" data-test="host-detail-view">
    <RouterLink :to="{ name: 'fleet' }" class="back">‹ Fleet</RouterLink>

    <div v-if="status === 'loading' || status === 'idle'" class="skeleton" aria-busy="true">
      <div v-for="n in 3" :key="n" class="row"></div>
    </div>

    <p v-else-if="!host" class="state">This host doesn't exist.</p>

    <template v-else>
      <header class="head">
        <div>
          <div class="title-line">
            <span class="dot" :class="`dot-${fresh.dot}`"></span>
            <h1>{{ host.label }}</h1>
            <span class="ff-badge">{{ FORM_FACTOR_LABELS[ff] || ff }}</span>
          </div>
          <p class="sub">
            {{
              [
                placeLabel(records.locations[host.site]),
                host.role,
                host.type || specs.model,
                specs.os ? `${specs.os.name} ${specs.os.version || ''}`.trim() : '',
              ]
                .filter(Boolean)
                .join(' · ')
            }}
          </p>
        </div>
        <div class="actions">
          <button
            type="button"
            class="btn btn-secondary"
            data-test="edit-host-meta"
            @click="openMetaEditor"
          >
            Edit Metadata
          </button>
          <RouterLink
            :to="{ name: 'host-import', params: { id: host.id } }"
            class="btn btn-primary"
          >
            Import Snapshot
          </RouterLink>
        </div>
      </header>

      <!-- Quick Metadata Editor -->
      <form v-if="editingMeta" class="card meta-form" @submit.prevent="saveMeta">
        <h2>Host Metadata</h2>
        <div class="meta-grid">
          <div class="field">
            <label for="hm-site">Site</label>
            <select id="hm-site" v-model="metaForm.site">
              <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
          </div>
          <div class="field">
            <label for="hm-ff">Form Factor</label>
            <select id="hm-ff" v-model="metaForm.formFactor">
              <option v-for="f in FORM_FACTORS" :key="f.value" :value="f.value">
                {{ f.label }}
              </option>
            </select>
          </div>
          <div class="field">
            <label for="hm-role">Role</label>
            <input
              id="hm-role"
              v-model="metaForm.role"
              maxlength="80"
              placeholder="e.g. Edge Ingress"
            />
          </div>
          <div class="field">
            <label for="hm-type">Model / Type</label>
            <input id="hm-type" v-model="metaForm.type" maxlength="60" />
          </div>
          <div class="field">
            <label for="hm-provider">Provider</label>
            <input
              id="hm-provider"
              v-model="metaForm.provider"
              maxlength="60"
              placeholder="e.g. Bare Metal"
            />
          </div>
          <div class="field">
            <label for="hm-cost">Monthly Cost</label>
            <div class="inline-row">
              <input
                id="hm-cost"
                v-model="metaForm.monthlyCost"
                type="number"
                step="0.01"
                min="0"
              />
              <select v-model="metaForm.currency" aria-label="Currency">
                <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label for="hm-tdp">Estimated TDP (Watts)</label>
            <input id="hm-tdp" v-model="metaForm.tdpWatts" type="number" min="0" />
          </div>
        </div>
        <p v-if="metaError" class="error" role="alert">{{ metaError }}</p>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" @click="editingMeta = false">
            Cancel
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="metaBusy"
            data-test="save-host-meta"
          >
            {{ metaBusy ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </form>

      <!-- Visual Hardware Anatomy Diagram (SVG) -->
      <section class="card anatomy-card" data-test="host-anatomy-svg">
        <h2>Visual Hardware Anatomy</h2>
        <div class="anatomy-viewport">
          <svg
            viewBox="0 0 760 280"
            class="anatomy-svg"
            role="img"
            :aria-label="`Hardware anatomy diagram for ${host.label}`"
          >
            <!-- Central System Bus / Board Spine -->
            <rect x="20" y="18" width="720" height="52" rx="10" class="an-board" />
            <text x="36" y="42" class="an-title">
              {{ specs.model || host.type || host.label }} ({{ specs.platform || 'System Board' }})
            </text>
            <text x="36" y="59" class="an-sub">
              Kernel: {{ specs.os?.kernel || '—' }} · Virtualization:
              {{ host.virtualType || specs.virtualType || 'bare-metal' }} · Last seen:
              {{ fresh.label }}
            </text>

            <!-- Bus Drops -->
            <line x1="130" y1="70" x2="130" y2="96" class="an-bus" />
            <line x1="380" y1="70" x2="380" y2="96" class="an-bus" />
            <line x1="620" y1="70" x2="620" y2="96" class="an-bus" />

            <!-- Block 1: CPU & Compute -->
            <g transform="translate(20, 96)">
              <rect width="225" height="78" rx="9" class="an-box" />
              <text x="14" y="24" class="an-kicker">COMPUTE / CPU</text>
              <text x="14" y="44" class="an-main">
                {{ (specs.cpu?.model || 'Processor').slice(0, 28) }}
              </text>
              <text x="14" y="62" class="an-meta">
                {{ specs.cpu?.physicalCores || 0 }} physical /
                {{ specs.cpu?.logicalCores || specs.cpu?.physicalCores || 0 }} threads
                <template v-if="specs.cpu?.maxMhz">· {{ specs.cpu.maxMhz }} MHz</template>
              </text>
            </g>

            <!-- Block 2: Memory Subsystem -->
            <g transform="translate(265, 96)">
              <rect width="230" height="78" rx="9" class="an-box" />
              <text x="14" y="24" class="an-kicker">MEMORY SUBSYSTEM</text>
              <text x="14" y="44" class="an-main">
                {{ formatRamGb(specs.memory?.totalBytes) }}
                {{ specs.memory?.type || '' }}
              </text>
              <text x="14" y="62" class="an-meta">
                {{
                  specs.memory?.modules?.length
                    ? `${specs.memory.modules.length} DIMM module(s) populated`
                    : 'Onboard / unified memory'
                }}
              </text>
            </g>

            <!-- Block 3: PCIe / GPU / Network / HATs -->
            <g transform="translate(515, 96)">
              <rect width="225" height="78" rx="9" class="an-box" />
              <text x="14" y="24" class="an-kicker">PCIe · GPU · NETWORK</text>
              <text x="14" y="44" class="an-main">
                {{
                  specs.gpus?.length
                    ? specs.gpus[0].model.slice(0, 26)
                    : `${(specs.nics || []).length} Network Interface(s)`
                }}
              </text>
              <text x="14" y="62" class="an-meta">
                {{
                  [
                    ...(specs.nics || []).map((n) => n.interface || 'eth'),
                    ...(specs.hats || []).map((x) => x.model),
                  ]
                    .join(' · ')
                    .slice(0, 32) || 'Onboard I/O'
                }}
              </text>
            </g>

            <!-- Block 4: Drive Bays Strip -->
            <g transform="translate(20, 190)">
              <rect width="720" height="76" rx="9" class="an-box" />
              <text x="14" y="22" class="an-kicker">
                STORAGE BAYS ({{ formatStorageBytes(specs.storage?.totalBytes) }} TOTAL)
              </text>
              <g
                v-for="(drv, idx) in (specs.storage?.drives || []).slice(0, 4)"
                :key="idx"
                :transform="`translate(${14 + idx * 174}, 30)`"
              >
                <rect width="166" height="36" rx="6" class="an-bay" />
                <text x="10" y="15" class="an-bay-title">
                  {{ formatDriveShort(drv) }} · {{ drv.slot || `bay${idx}` }}
                </text>
                <text x="10" y="29" class="an-bay-sub">
                  {{ (drv.model || 'Drive').slice(0, 18) }}
                  {{ drv.tempC ? `· ${drv.tempC}°C` : '' }}
                </text>
              </g>
              <text v-if="!(specs.storage?.drives || []).length" x="14" y="48" class="an-meta">
                No block drives reported in latest snapshot
              </text>
            </g>
          </svg>
        </div>
      </section>

      <!-- Installed Stocky Parts & Serialized Units -->
      <section class="card" data-test="host-installed-units">
        <div class="sec-head">
          <h2>Installed Stocky Parts &amp; Units</h2>
          <RouterLink
            :to="{ name: 'record', query: { type: 'install', host: host.id } }"
            class="link-btn"
          >
            ＋ Install from spares
          </RouterLink>
        </div>
        <p v-if="!installedParts.length" class="muted">
          No parts recorded in Stocky's ledger for {{ host.label }} yet.
        </p>
        <ul v-else class="installed-list">
          <li v-for="row in installedParts" :key="row.part.id">
            <div class="part-info">
              <RouterLink :to="{ name: 'part', params: { id: row.part.id } }" class="part-name">
                {{ row.part.name }}
              </RouterLink>
              <span class="qty-badge">{{ formatQty(row.qty, row.part.unit) }}</span>
              <div v-if="row.units.length" class="serial-chips">
                <span v-for="u in row.units" :key="u.id" class="serial-chip">
                  S/N {{ u.serial }}{{ u.slot ? ` (${u.slot})` : '' }}
                </span>
              </div>
            </div>
            <div class="part-actions">
              <RouterLink
                v-if="row.spareAtSite > 0"
                :to="{
                  name: 'record',
                  query: { type: 'install', part: row.part.id, host: host.id },
                }"
                class="mini-action"
              >
                Swap ({{ row.spareAtSite }} spare)
              </RouterLink>
              <button
                type="button"
                class="mini-action"
                :disabled="actionBusy || !canWrite"
                data-test="quick-uninstall"
                @click="quickUninstall(row.part)"
              >
                Uninstall to spare
              </button>
            </div>
          </li>
        </ul>
      </section>

      <!-- Hardware Timeline -->
      <section class="card" data-test="host-timeline">
        <h2>Hardware Timeline</h2>
        <p v-if="!hostImports.length && !hostSnapshots.length" class="muted">
          No discovery snapshots or imports recorded for this host yet.
        </p>
        <ul v-else class="timeline">
          <li v-for="snap in hostSnapshots.slice(0, 8)" :key="`s-${snap.id}`">
            <span class="tl-badge" :class="`tl-${snap.status}`">{{ snap.status }}</span>
            <span class="tl-text">
              Automated snapshot ({{ snap.collector || 'stocky-collect' }})
            </span>
            <span class="tl-date">
              {{ (snap.collectedAt || snap.created || '').slice(0, 16).replace('T', ' ') }}
            </span>
          </li>
          <li v-for="imp in hostImports.slice(0, 8)" :key="`i-${imp.id}`">
            <span class="tl-badge tl-applied">
              {{ imp.undone ? 'undone' : 'import' }}
            </span>
            <span class="tl-text">
              Discovery import applied ({{ imp.collector || 'manual' }})
            </span>
            <span class="tl-date">{{ (imp.created || '').slice(0, 16) }}</span>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.back {
  align-self: flex-start;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  font-weight: 600;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.title-line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

h1 {
  font-size: 1.45rem;
  font-weight: 700;
}

h2 {
  font-size: 1.05rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.sub {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.ff-badge {
  padding: 0.15rem 0.5rem;
  border-radius: 6px;
  background: var(--color-background-mute);
  color: var(--color-text-muted);
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
}

.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.btn {
  min-height: 44px;
  padding: 0 1rem;
  border: none;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.card {
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background-soft);
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.65rem;
  margin-bottom: 0.75rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-heading);
}

.field input,
.field select {
  min-height: 40px;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  font: inherit;
}

.inline-row {
  display: flex;
  gap: 0.35rem;
}

.inline-row input {
  flex: 1;
  min-width: 0;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.anatomy-viewport {
  width: 100%;
  overflow-x: auto;
}

.anatomy-svg {
  width: 100%;
  height: auto;
  min-width: 580px;
}

.an-board {
  fill: var(--color-background);
  stroke: var(--color-accent);
  stroke-width: 1.5;
}

.an-title {
  fill: var(--color-heading);
  font-size: 14px;
  font-weight: 700;
}

.an-sub {
  fill: var(--color-text-muted);
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.an-bus {
  stroke: var(--color-accent);
  stroke-width: 1.5;
  stroke-dasharray: 3 3;
}

.an-box {
  fill: var(--color-background);
  stroke: var(--color-border-hover);
}

.an-kicker {
  fill: var(--color-accent);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.an-main {
  fill: var(--color-heading);
  font-size: 12.5px;
  font-weight: 700;
}

.an-meta {
  fill: var(--color-text-muted);
  font-size: 10.5px;
}

.an-bay {
  fill: var(--color-background-soft);
  stroke: var(--color-accent);
  stroke-opacity: 0.55;
}

.an-bay-title {
  fill: var(--color-heading);
  font-size: 10px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.an-bay-sub {
  fill: var(--color-text-muted);
  font-size: 9.5px;
}

.sec-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.sec-head h2 {
  margin: 0;
}

.link-btn {
  font-size: 0.88rem;
  font-weight: 600;
}

.installed-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.installed-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.6rem 0;
  border-top: 1px solid var(--color-border);
}

.installed-list li:first-child {
  border-top: none;
}

.part-name {
  font-weight: 700;
  margin-right: 0.5rem;
}

.qty-badge {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-heading);
}

.serial-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.25rem;
}

.serial-chip {
  padding: 0.12rem 0.45rem;
  border-radius: 6px;
  background: var(--color-background-mute);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
}

.part-actions {
  display: flex;
  gap: 0.45rem;
}

.mini-action {
  min-height: 36px;
  padding: 0 0.7rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}

.mini-action:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.timeline {
  list-style: none;
  padding: 0;
  margin: 0;
}

.timeline li {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0;
  border-top: 1px solid var(--color-border);
  font-size: 0.88rem;
}

.timeline li:first-child {
  border-top: none;
}

.tl-badge {
  padding: 0.1rem 0.45rem;
  border-radius: 6px;
  font-size: 0.73rem;
  font-weight: 700;
  text-transform: uppercase;
  background: var(--color-background-mute);
}

.tl-clean,
.tl-applied {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.tl-drift_pending {
  background: hsla(35, 95%, 50%, 0.2);
  color: hsl(35, 90%, 45%);
}

.tl-date {
  margin-left: auto;
  color: var(--color-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
}

.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.dot-green {
  background: #10b981;
}
.dot-amber {
  background: #f59e0b;
}
.dot-blue {
  background: #3b82f6;
}
.dot-gray {
  background: #64748b;
}

.muted {
  color: var(--color-text-muted);
}

.error {
  color: hsl(0, 65%, 50%);
  font-weight: 600;
}
</style>
