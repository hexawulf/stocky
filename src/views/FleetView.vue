<script setup>
// Fleet Overview (/fleet — Phase 3.2):
// - Top Fleet Summary Strip (KPI cards: Hosts, Compute, Memory, Storage + SMART, Economics)
// - Filter & View Switcher Bar (Site, Form Factor, Arch, Status, Search + 3 Visual Modes:
//   Rack & Chassis View, Interactive Fleet Topology SVG, Comparison Matrix)
// - Action buttons: Connect a Host Wizard, Export Modal, Load Demo Fleet (when empty).
import { computed, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useInventory } from '@/stores/inventory.js'
import { showToast } from '@/stores/toast.js'
import { loadDemoFleet } from '@/lib/api.js'
import { describeError } from '@/lib/errors.js'
import { getFleetName, getStaleHours } from '@/lib/prefs.js'
import {
  FORM_FACTORS,
  FORM_FACTOR_LABELS,
  computeFleetSummary,
  filterFleetHosts,
  formatDriveShort,
  formatRamGb,
  formatStorageBytes,
  hostFreshness,
  inferHostFormFactor,
} from '@/lib/fleet.js'
import FleetTopologyMap from '@/components/FleetTopologyMap.vue'
import FleetMatrixView from '@/components/FleetMatrixView.vue'
import FleetExportDialog from '@/components/FleetExportDialog.vue'
import ConnectHostDialog from '@/components/ConnectHostDialog.vue'

const { status, retry, records, hosts, locations, parts, canWrite, start } = useInventory()

const fleetName = ref(getFleetName())
const staleHours = ref(getStaleHours())
const viewMode = ref('rack') // 'rack' | 'topology' | 'matrix'
const showExport = ref(false)
const showConnect = ref(false)
const demoBusy = ref(false)

const filters = reactive({
  q: '',
  site: '',
  formFactor: '',
  arch: '',
  status: '',
})

const sites = computed(() => locations.value.filter((l) => l.kind === 'site'))
const summary = computed(() => computeFleetSummary(hosts.value, { staleHours: staleHours.value }))
const filteredHosts = computed(() =>
  filterFleetHosts(hosts.value, filters, { staleHours: staleHours.value }),
)

const hasEconomics = computed(
  () =>
    Object.keys(summary.value.monthlyCostByCurrency).length > 0 || summary.value.totalTdpWatts > 0,
)

const economicsText = computed(() => {
  const costParts = Object.entries(summary.value.monthlyCostByCurrency).map(
    ([cur, amt]) => `${cur} ${amt}/mo`,
  )
  if (summary.value.totalTdpWatts > 0) costParts.push(`~${summary.value.totalTdpWatts}W TDP`)
  return costParts.join(' · ')
})

const groupedBySite = computed(() => {
  const map = {}
  const out = []
  for (const h of filteredHosts.value) {
    const s = records.locations[h.site] || { id: h.site, label: 'Unassigned', sortOrder: 99 }
    if (!map[s.id]) {
      map[s.id] = { site: s, hosts: [] }
      out.push(map[s.id])
    }
    map[s.id].hosts.push(h)
  }
  return out.sort((a, b) => (a.site.sortOrder ?? 0) - (b.site.sortOrder ?? 0))
})

function cardProps(h) {
  const specs = h.specs && typeof h.specs === 'object' ? h.specs : {}
  const ff = inferHostFormFactor(h)
  const fresh = hostFreshness(h, { staleHours: staleHours.value })
  const drives = specs.storage?.drives || []
  const gpus = specs.gpus || []
  const nics = specs.nics || []
  const hats = specs.hats || []
  const smart = h.smartSummary || {}
  return {
    ff,
    ffLabel: FORM_FACTOR_LABELS[ff] || ff,
    fresh,
    archOs: [
      specs.platform,
      specs.os ? `${specs.os.name || ''} ${specs.os.version || ''}`.trim() : '',
    ]
      .filter(Boolean)
      .join(' · '),
    cpuLabel: specs.cpu?.model
      ? `${specs.cpu.model}${specs.cpu.physicalCores ? ` (${specs.cpu.physicalCores}C)` : ''}`
      : h.type || '',
    ramLabel: specs.memory?.totalBytes
      ? `${formatRamGb(specs.memory.totalBytes)}${specs.memory.type ? ` ${specs.memory.type}` : ''}`
      : '',
    storageLabel: formatStorageBytes(specs.storage?.totalBytes),
    drives,
    gpus,
    nics,
    hats,
    smartStatus: smart.status || 'unknown',
    driftCount: Number(h.driftCount || 0),
  }
}

async function handleLoadDemo() {
  if (demoBusy.value || !canWrite.value) return
  demoBusy.value = true
  try {
    await loadDemoFleet()
    await start()
    showToast('Demo Fleet loaded (4 hosts, spares & movements)')
  } catch (e) {
    showToast(describeError(e).message)
  } finally {
    demoBusy.value = false
  }
}
</script>

<template>
  <div v-if="status === 'loading' || status === 'idle'" class="skeleton" aria-busy="true">
    <div v-for="n in 4" :key="n" class="row"></div>
  </div>

  <div v-else-if="status === 'error'" class="state" role="alert">
    <p>Couldn't load your fleet inventory.</p>
    <button type="button" class="btn btn-secondary" @click="retry">Retry</button>
  </div>

  <section v-else class="fleet-page" data-test="fleet-view">
    <header class="page-head">
      <div>
        <h1>{{ fleetName }}</h1>
        <p class="subtitle">
          Automated hardware discovery, live chassis specs &amp; visual topology
        </p>
      </div>
      <div class="head-actions">
        <button
          type="button"
          class="btn btn-secondary"
          data-test="open-export"
          :disabled="!hosts.length"
          @click="showExport = true"
        >
          Export
        </button>
        <button
          type="button"
          class="btn btn-primary"
          data-test="open-connect"
          @click="showConnect = true"
        >
          + Connect Host
        </button>
      </div>
    </header>

    <!-- Top Fleet Summary Strip (KPI Cards) -->
    <div class="kpi-strip" data-test="fleet-kpis">
      <div class="kpi-card">
        <span class="kpi-label">Hosts</span>
        <strong class="kpi-val">{{ summary.totalHosts }}</strong>
        <span class="kpi-sub">
          {{ summary.online }} online · {{ summary.stale }} stale
          <template v-if="summary.driftHosts">
            ·
            <RouterLink :to="{ name: 'fleet-drift' }" class="drift-link"
              >{{ summary.driftHosts }} drift</RouterLink
            >
          </template>
        </span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Compute</span>
        <strong class="kpi-val">{{ summary.totalCores }} cores</strong>
        <span class="kpi-sub">
          {{ summary.physicalCores }} physical · {{ summary.cloudVcpus }} cloud ·
          {{ summary.arm64Count }} ARM64 / {{ summary.x86Count }} x86_64
        </span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Memory</span>
        <strong class="kpi-val">{{ summary.totalRamLabel }}</strong>
        <span class="kpi-sub">Total fleet RAM across physical &amp; cloud</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Storage &amp; SMART</span>
        <strong class="kpi-val">{{ summary.totalStorageLabel }}</strong>
        <span class="kpi-sub">
          {{ summary.totalDrives }} drives ·
          <span :class="summary.smartHealthy ? 'ok-text' : 'warn-text'">
            {{
              summary.smartHealthy
                ? 'All healthy'
                : `${summary.smartWarnings} drive warning${summary.smartWarnings === 1 ? '' : 's'}`
            }}
          </span>
        </span>
      </div>
      <div v-if="hasEconomics" class="kpi-card">
        <span class="kpi-label">Economics &amp; Power</span>
        <strong class="kpi-val">{{ economicsText }}</strong>
        <span class="kpi-sub">Cloud spend &amp; estimated physical TDP</span>
      </div>
    </div>

    <!-- Empty state with 1-click Demo Fleet or Connect Host -->
    <div v-if="!hosts.length" class="empty-fleet" data-test="empty-fleet">
      <h2>No hosts in your fleet yet</h2>
      <p class="muted">
        Connect your first Linux machine, Raspberry Pi, Cloud VPS, Synology NAS or WSL2 host — or
        load the 4-node Demo Fleet to preview the Rack Cards, Interactive Topology SVG and Host
        Inspector immediately.
      </p>
      <div class="empty-actions">
        <button
          type="button"
          class="btn btn-primary"
          data-test="connect-first-host"
          @click="showConnect = true"
        >
          + Connect a Host
        </button>
        <button
          v-if="!parts.length"
          type="button"
          class="btn btn-secondary"
          :disabled="demoBusy || !canWrite"
          data-test="load-demo-fleet"
          @click="handleLoadDemo"
        >
          {{ demoBusy ? 'Loading Demo Fleet…' : 'Load Demo Fleet' }}
        </button>
      </div>
    </div>

    <template v-else>
      <!-- Filter & View Switcher Bar -->
      <div class="filter-bar">
        <div class="filters">
          <input
            v-model="filters.q"
            type="search"
            placeholder="Search host, CPU, GPU, drive, serial…"
            aria-label="Search fleet"
            class="search-input"
            data-test="fleet-search"
          />
          <select v-model="filters.site" aria-label="Filter by site" data-test="filter-site">
            <option value="">All sites</option>
            <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
          <select
            v-model="filters.formFactor"
            aria-label="Filter by form factor"
            data-test="filter-form"
          >
            <option value="">All form factors</option>
            <option v-for="f in FORM_FACTORS" :key="f.value" :value="f.value">
              {{ f.label }}
            </option>
          </select>
          <select v-model="filters.arch" aria-label="Filter by architecture">
            <option value="">All architectures</option>
            <option value="arm64">ARM64</option>
            <option value="x86_64">x86_64</option>
          </select>
          <select v-model="filters.status" aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="online">Online</option>
            <option value="stale">Stale</option>
            <option value="drift">Pending Drift</option>
            <option value="smart_warn">SMART Warning</option>
          </select>
        </div>

        <div class="view-switcher" role="tablist" aria-label="Visual mode">
          <button
            type="button"
            role="tab"
            :aria-selected="viewMode === 'rack'"
            class="mode-btn"
            :class="{ active: viewMode === 'rack' }"
            data-test="mode-rack"
            @click="viewMode = 'rack'"
          >
            Rack Cards
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="viewMode === 'topology'"
            class="mode-btn"
            :class="{ active: viewMode === 'topology' }"
            data-test="mode-topology"
            @click="viewMode = 'topology'"
          >
            Topology SVG
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="viewMode === 'matrix'"
            class="mode-btn"
            :class="{ active: viewMode === 'matrix' }"
            data-test="mode-matrix"
            @click="viewMode = 'matrix'"
          >
            Spec Matrix
          </button>
        </div>
      </div>

      <p v-if="!filteredHosts.length" class="state">No hosts match the active filters.</p>

      <!-- Mode 1: Rack & Chassis View (default) -->
      <div v-else-if="viewMode === 'rack'" class="rack-groups" data-test="fleet-rack">
        <section
          v-for="group in groupedBySite"
          :key="group.site.id"
          class="site-section"
          :data-site-group="group.site.label"
        >
          <header class="site-head">
            <h2>{{ group.site.label }}</h2>
            <span class="site-count">
              {{ group.hosts.length }} machine{{ group.hosts.length === 1 ? '' : 's' }}
            </span>
          </header>

          <div class="chassis-grid">
            <article
              v-for="h in group.hosts"
              :key="h.id"
              class="chassis-card"
              :data-host-card="h.label"
            >
              <template v-for="cp in [cardProps(h)]" :key="h.id">
                <header class="chassis-head">
                  <div class="title-row">
                    <span
                      class="fresh-dot"
                      :class="`dot-${cp.fresh.dot}`"
                      :title="cp.fresh.label"
                    ></span>
                    <RouterLink
                      :to="{ name: 'host-detail', params: { id: h.id } }"
                      class="host-link"
                    >
                      {{ h.label }}
                    </RouterLink>
                    <span class="ff-pill">{{ cp.ffLabel }}</span>
                  </div>
                  <div class="status-pills">
                    <RouterLink
                      v-if="cp.driftCount > 0"
                      :to="{ name: 'fleet-drift' }"
                      class="pill pill-drift"
                      data-test="host-drift-badge"
                    >
                      {{ cp.driftCount }} drift
                    </RouterLink>
                    <span
                      v-if="cp.smartStatus === 'warn' || cp.smartStatus === 'fail'"
                      class="pill pill-warn"
                    >
                      SMART {{ cp.smartStatus.toUpperCase() }}
                    </span>
                  </div>
                </header>

                <p v-if="h.role || h.type" class="role-line">
                  {{ [h.role, h.type].filter(Boolean).join(' · ') }}
                </p>

                <div class="spec-pills">
                  <span v-if="cp.archOs" class="spec-chip">{{ cp.archOs }}</span>
                  <span v-if="cp.cpuLabel" class="spec-chip">{{ cp.cpuLabel }}</span>
                  <span v-if="cp.ramLabel" class="spec-chip">{{ cp.ramLabel }}</span>
                  <span v-if="cp.storageLabel !== '—'" class="spec-chip">
                    {{ cp.storageLabel }}
                  </span>
                </div>

                <!-- Visual Drive Bay Strip -->
                <div v-if="cp.drives.length" class="drive-bays" aria-label="Drive bays">
                  <div
                    v-for="(drv, idx) in cp.drives"
                    :key="idx"
                    class="bay-slot"
                    :class="`iface-${(drv.interface || 'disk').toLowerCase()}`"
                    :title="`${drv.model || 'Drive'} ${drv.tempC ? `(${drv.tempC}°C)` : ''}`"
                  >
                    <span
                      class="bay-dot"
                      :class="
                        drv.smartStatus === 'FAILED'
                          ? 'dot-red'
                          : drv.tempC >= 65
                            ? 'dot-amber'
                            : 'dot-green'
                      "
                    ></span>
                    <span class="bay-label">{{ formatDriveShort(drv) }}</span>
                    <span v-if="drv.tempC" class="bay-temp">{{ drv.tempC }}°C</span>
                  </div>
                </div>

                <!-- GPU & Peripheral Chips -->
                <div v-if="cp.gpus.length || cp.hats.length || cp.nics.length" class="periph-strip">
                  <span v-for="(g, i) in cp.gpus" :key="`g${i}`" class="periph-chip gpu-chip">
                    GPU: {{ g.model }}
                  </span>
                  <span v-for="(ht, i) in cp.hats" :key="`h${i}`" class="periph-chip hat-chip">
                    HAT: {{ ht.model }}
                  </span>
                  <span
                    v-for="(n, i) in cp.nics.slice(0, 2)"
                    :key="`n${i}`"
                    class="periph-chip nic-chip"
                    :title="`${n.interface || 'NIC'}: ${n.model}`"
                  >
                    {{ n.interface || 'NIC' }}: {{ n.model }}
                  </span>
                </div>

                <footer class="chassis-foot">
                  <span class="fresh-text">{{ cp.fresh.label }}</span>
                  <div class="card-links">
                    <RouterLink :to="{ name: 'host-import', params: { id: h.id } }">
                      Import
                    </RouterLink>
                    <RouterLink :to="{ name: 'host-detail', params: { id: h.id } }">
                      Inspect ›
                    </RouterLink>
                  </div>
                </footer>
              </template>
            </article>
          </div>
        </section>
      </div>

      <!-- Mode 2: Interactive Fleet Topology SVG -->
      <FleetTopologyMap
        v-else-if="viewMode === 'topology'"
        :hosts="filteredHosts"
        :locations-by-id="records.locations"
        :fleet-name="fleetName"
        :stale-hours="staleHours"
      />

      <!-- Mode 3: Comparison Matrix -->
      <FleetMatrixView
        v-else
        :hosts="filteredHosts"
        :locations-by-id="records.locations"
        :stale-hours="staleHours"
      />
    </template>

    <FleetExportDialog
      v-if="showExport"
      :hosts="filteredHosts.length ? filteredHosts : hosts"
      :locations-by-id="records.locations"
      :fleet-name="fleetName"
      @close="showExport = false"
    />

    <ConnectHostDialog
      v-if="showConnect"
      :sites="sites"
      :hosts="hosts"
      @close="showConnect = false"
    />
  </section>
</template>

<style scoped>
.fleet-page {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.75rem;
}

h1 {
  font-size: 1.5rem;
  font-weight: 700;
}

.subtitle {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.head-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.btn {
  min-height: 44px;
  padding: 0 1rem;
}

.btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.kpi-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
}

.kpi-card {
  padding: 0.8rem 0.9rem;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.kpi-card:last-child:nth-child(odd) {
  grid-column: 1 / -1;
}

@media (min-width: 768px) {
  .kpi-strip {
    grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
    gap: 0.75rem;
  }

  .kpi-card:last-child:nth-child(odd) {
    grid-column: auto;
  }
}

.kpi-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

.kpi-val {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--color-heading);
  font-variant-numeric: tabular-nums;
}

.kpi-sub {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.ok-text {
  color: var(--color-accent);
  font-weight: 600;
}

.warn-text,
.drift-link {
  color: var(--color-warn);
  font-weight: 700;
}

.empty-fleet {
  padding: 2.25rem 1.25rem;
  border: 1px dashed var(--color-border-hover);
  border-radius: 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.85rem;
}

.empty-fleet p {
  max-width: 36rem;
}

.empty-actions {
  display: flex;
  gap: 0.65rem;
  flex-wrap: wrap;
  justify-content: center;
}

.filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  flex: 1;
}

.search-input {
  min-width: 13rem;
  flex: 1;
}

.filters input,
.filters select {
  min-height: 42px;
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font: inherit;
  font-size: 0.88rem;
}

.view-switcher {
  display: flex;
  border: 1px solid var(--color-border-hover);
  border-radius: 999px;
  padding: 0.15rem;
  background: var(--color-background-soft);
}

.mode-btn {
  min-height: 36px;
  padding: 0 0.85rem;
  border: none;
  border-radius: 999px;
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
}

.mode-btn.active {
  background: var(--color-accent);
  color: var(--color-on-accent);
}

.rack-groups {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.site-section {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.site-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.35rem;
}

.site-head h2 {
  font-size: 1.1rem;
  font-weight: 700;
}

.site-count {
  font-size: 0.84rem;
  color: var(--color-text-muted);
}

.chassis-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18.5rem, 1fr));
  gap: 0.85rem;
}

.chassis-card {
  border: 1px solid var(--color-border);
  border-radius: 14px;
  padding: 0.9rem 1rem;
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  transition: border-color 0.15s;
}

.chassis-card:hover {
  border-color: var(--color-accent);
}

.chassis-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}

.host-link {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--color-heading);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host-link:hover {
  color: var(--color-accent);
}

.ff-pill {
  padding: 0.1rem 0.45rem;
  border-radius: 6px;
  background: var(--color-background-mute);
  color: var(--color-text-muted);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
}

.status-pills {
  display: flex;
  gap: 0.3rem;
}

.pill {
  padding: 0.12rem 0.5rem;
  border-radius: 999px;
  font-size: 0.73rem;
  font-weight: 700;
}

.pill-drift {
  background: hsla(35, 95%, 50%, 0.2);
  color: var(--color-warn);
}

.pill-warn {
  background: hsla(0, 85%, 50%, 0.18);
  color: var(--color-danger);
}

.role-line {
  font-size: 0.83rem;
  color: var(--color-text-muted);
}

.spec-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.spec-chip {
  padding: 0.18rem 0.5rem;
  border-radius: 7px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.76rem;
  color: var(--color-heading);
}

.drive-bays {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding-top: 0.15rem;
}

.bay-slot {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.5rem;
  border-radius: 6px;
  background: var(--color-background-mute);
  border-left: 3px solid var(--color-accent);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
  font-weight: 600;
}

.bay-temp {
  color: var(--color-text-muted);
  font-size: 0.7rem;
}

.periph-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.periph-chip {
  padding: 0.15rem 0.45rem;
  border-radius: 6px;
  font-size: 0.74rem;
  font-weight: 600;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  max-width: 100%;
}

.nic-chip {
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chassis-foot {
  margin-top: auto;
  padding-top: 0.4rem;
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
}

.fresh-text {
  color: var(--color-text-muted);
}

.card-links {
  display: flex;
  gap: 0.75rem;
  font-weight: 600;
}

.fresh-dot,
.bay-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
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
.dot-red {
  background: #ef4444;
}

.muted {
  color: var(--color-text-muted);
}

.state {
  padding: 2rem 0;
  text-align: center;
}

.skeleton .row {
  height: 72px;
  margin-bottom: 0.75rem;
  border-radius: 14px;
  background: var(--color-background-mute);
}
</style>
