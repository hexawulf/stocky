<script setup>
// Fleet Comparison Matrix (Phase 3.2.3):
// Sortable table comparing every host across Site, Form Factor, Arch/OS,
// CPU/Cores, RAM, Storage, GPUs, NICs, SMART, Monthly Cost, and Last Seen.
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  FORM_FACTOR_LABELS,
  formatRamGb,
  formatStorageBytes,
  hostFreshness,
  inferHostFormFactor,
} from '@/lib/fleet.js'

const props = defineProps({
  hosts: { type: Array, required: true },
  locationsById: { type: Object, required: true },
  staleHours: { type: Number, default: 48 },
})

const sortKey = ref('label')
const sortAsc = ref(true)

function sortBy(key) {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value
  } else {
    sortKey.value = key
    sortAsc.value = true
  }
}

const rows = computed(() => {
  const mapped = props.hosts.map((h) => {
    const specs = h.specs && typeof h.specs === 'object' ? h.specs : {}
    const ff = inferHostFormFactor(h)
    const fresh = hostFreshness(h, { staleHours: props.staleHours })
    const cores = Number(specs.cpu?.physicalCores || specs.cpu?.logicalCores || 0)
    const ramBytes = Number(specs.memory?.totalBytes || 0)
    const storageBytes = Number(specs.storage?.totalBytes || 0)
    const drives = specs.storage?.drives || []
    const gpus = specs.gpus || []
    const nics = specs.nics || []
    return {
      host: h,
      id: h.id,
      label: h.label,
      site: props.locationsById[h.site]?.label || '—',
      formFactor: FORM_FACTOR_LABELS[ff] || ff,
      archOs:
        [specs.platform, specs.os ? `${specs.os.name || ''} ${specs.os.version || ''}`.trim() : '']
          .filter(Boolean)
          .join(' · ') || '—',
      cpu: specs.cpu?.model || h.type || '—',
      cores,
      ramBytes,
      ramLabel: formatRamGb(ramBytes),
      storageBytes,
      storageLabel: formatStorageBytes(storageBytes),
      driveCount: drives.length,
      gpuLabel: gpus.map((g) => g.model).join(', ') || '—',
      nicCount: nics.length,
      smart: (h.smartSummary?.status || 'unknown').toUpperCase(),
      monthlyCost: Number(h.monthlyCost || 0),
      costLabel:
        Number(h.monthlyCost) > 0 ? `${h.currency || 'USD'} ${Number(h.monthlyCost)}` : '—',
      fresh,
    }
  })

  const dir = sortAsc.value ? 1 : -1
  const k = sortKey.value
  return mapped.sort((a, b) => {
    if (typeof a[k] === 'number' && typeof b[k] === 'number') {
      return (a[k] - b[k]) * dir || a.label.localeCompare(b.label)
    }
    return String(a[k] || '').localeCompare(String(b[k] || '')) * dir
  })
})
</script>

<template>
  <div class="matrix-wrap" data-test="fleet-matrix">
    <table class="matrix-table">
      <thead>
        <tr>
          <th>
            <button type="button" class="th-btn" @click="sortBy('label')">Host</button>
          </th>
          <th>
            <button type="button" class="th-btn" @click="sortBy('site')">Site</button>
          </th>
          <th>
            <button type="button" class="th-btn" @click="sortBy('formFactor')">Form</button>
          </th>
          <th>Arch / OS</th>
          <th>
            <button type="button" class="th-btn" @click="sortBy('cores')">CPU (Cores)</button>
          </th>
          <th>
            <button type="button" class="th-btn" @click="sortBy('ramBytes')">RAM</button>
          </th>
          <th>
            <button type="button" class="th-btn" @click="sortBy('storageBytes')">Storage</button>
          </th>
          <th>GPUs</th>
          <th>NICs</th>
          <th>SMART</th>
          <th>
            <button type="button" class="th-btn" @click="sortBy('monthlyCost')">Cost</button>
          </th>
          <th>Last Seen</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id" :data-matrix-host="r.label">
          <td class="host-col">
            <RouterLink :to="{ name: 'host-detail', params: { id: r.id } }">
              {{ r.label }}
            </RouterLink>
          </td>
          <td>{{ r.site }}</td>
          <td>{{ r.formFactor }}</td>
          <td class="mono">{{ r.archOs }}</td>
          <td>
            {{ r.cpu }}
            <span v-if="r.cores" class="muted">({{ r.cores }}C)</span>
          </td>
          <td class="mono">{{ r.ramLabel }}</td>
          <td class="mono">
            {{ r.storageLabel }}
            <span v-if="r.driveCount" class="muted">({{ r.driveCount }})</span>
          </td>
          <td>{{ r.gpuLabel }}</td>
          <td class="mono">{{ r.nicCount || '—' }}</td>
          <td>
            <span class="smart-pill" :class="`smart-${r.smart.toLowerCase()}`">
              {{ r.smart }}
            </span>
          </td>
          <td class="mono">{{ r.costLabel }}</td>
          <td class="mono">
            <span class="dot" :class="`dot-${r.fresh.dot}`"></span>
            {{ r.fresh.label }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.matrix-wrap {
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background);
}

.matrix-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
  min-width: 780px;
}

.matrix-table th,
.matrix-table td {
  padding: 0.65rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}

.matrix-table th {
  background: var(--color-background-soft);
  color: var(--color-text-muted);
  font-weight: 700;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.th-btn {
  border: none;
  background: none;
  padding: 0;
  color: inherit;
  font: inherit;
  text-transform: inherit;
  cursor: pointer;
}

.th-btn:hover {
  color: var(--color-accent);
}

.host-col a {
  font-weight: 700;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--color-text-muted);
}

.smart-pill {
  display: inline-block;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
}

.smart-ok {
  background: hsla(160, 80%, 40%, 0.15);
  color: var(--color-accent);
}

.smart-warn {
  background: hsla(40, 90%, 50%, 0.2);
  color: hsl(35, 90%, 40%);
}

.smart-fail {
  background: hsla(0, 80%, 50%, 0.2);
  color: hsl(0, 75%, 50%);
}

.smart-unknown {
  background: var(--color-background-mute);
  color: var(--color-text-muted);
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 0.3rem;
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
</style>
