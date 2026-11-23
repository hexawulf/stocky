<script setup>
// Interactive Fleet Topology SVG (Phase 3.2.2):
// Pure Vue-rendered hierarchical SVG:
// - Root: Fleet title + totals badge
// - Tier 1: Site Containers (rounded dashed site zones with aggregate cores/RAM/storage badges)
// - Tier 2: Host Nodes (color-coded by form factor with inline CPU/RAM/Storage/GPU/Drive-Bay bars & freshness LEDs)
// - Tier 3: Expandable Hardware Sub-nodes (toggleable per host or open Host Inspector)
// Supports zoom/pan, fit-to-screen, compact vs detailed mode, and Light/Dark theme.
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  FORM_FACTOR_LABELS,
  computeFleetSummary,
  formatDriveShort,
  formatRamGb,
  formatStorageBytes,
  hostFreshness,
  inferHostFormFactor,
} from '@/lib/fleet.js'

const props = defineProps({
  hosts: { type: Array, required: true },
  locationsById: { type: Object, required: true },
  fleetName: { type: String, default: 'My Homelab Fleet' },
  staleHours: { type: Number, default: 48 },
})

const router = useRouter()
const zoom = ref(1)
const pan = reactive({ x: 0, y: 0 })
const detailedMode = ref(true)
const expandedHosts = reactive({})

function toggleExpand(hostId) {
  expandedHosts[hostId] = !expandedHosts[hostId]
}

function zoomIn() {
  zoom.value = Math.min(2, Math.round((zoom.value + 0.15) * 100) / 100)
}
function zoomOut() {
  zoom.value = Math.max(0.5, Math.round((zoom.value - 0.15) * 100) / 100)
}
function resetView() {
  zoom.value = 1
  pan.x = 0
  pan.y = 0
}

const summary = computed(() => computeFleetSummary(props.hosts, { staleHours: props.staleHours }))

const siteGroups = computed(() => {
  const map = {}
  const list = []
  for (const h of props.hosts) {
    const site = props.locationsById[h.site] || { id: h.site, label: 'Unassigned', sortOrder: 99 }
    if (!map[site.id]) {
      map[site.id] = { site, hosts: [] }
      list.push(map[site.id])
    }
    map[site.id].hosts.push(h)
  }
  list.sort((a, b) => (a.site.sortOrder ?? 0) - (b.site.sortOrder ?? 0))
  return list.map((g) => ({
    ...g,
    summary: computeFleetSummary(g.hosts, { staleHours: props.staleHours }),
  }))
})

const layout = computed(() => {
  const cols = Math.min(3, Math.max(1, props.hosts.length))
  const cardW = 290
  const gap = 22
  const width = Math.max(760, cols * (cardW + gap) + 72)

  let yCursor = 114
  const boxes = []
  for (const sg of siteGroups.value) {
    const hostCards = sg.hosts.map((h) => {
      const specs = h.specs && typeof h.specs === 'object' ? h.specs : {}
      const ff = inferHostFormFactor(h)
      const fresh = hostFreshness(h, { staleHours: props.staleHours })
      const drives = specs.storage?.drives || []
      const gpus = specs.gpus || []
      const nics = specs.nics || []
      const hats = specs.hats || []
      const isExpanded = !!expandedHosts[h.id]
      const subNodes = []
      if (isExpanded) {
        if (specs.cpu?.model) {
          subNodes.push({
            kind: 'CPU',
            label: `${specs.cpu.model.slice(0, 26)} (${specs.cpu.physicalCores || 1}C)`,
          })
        }
        if (specs.memory?.totalBytes) {
          subNodes.push({
            kind: 'RAM',
            label: `${formatRamGb(specs.memory.totalBytes)} ${specs.memory.type || ''}`.trim(),
          })
        }
        for (const d of drives.slice(0, 4)) {
          subNodes.push({
            kind: 'DRV',
            label: `${formatDriveShort(d)} · ${(d.model || 'Drive').slice(0, 20)}`,
          })
        }
        for (const g of gpus.slice(0, 2)) {
          subNodes.push({
            kind: 'GPU',
            label: `${(g.model || 'GPU').slice(0, 24)}`,
          })
        }
        for (const n of nics.slice(0, 2)) {
          subNodes.push({
            kind: 'NIC',
            label: `${n.interface || 'eth'} · ${(n.model || 'NIC').slice(0, 18)}`,
          })
        }
        for (const ht of hats.slice(0, 1)) {
          subNodes.push({
            kind: 'HAT',
            label: (ht.model || 'HAT').slice(0, 24),
          })
        }
      }
      const baseH = detailedMode.value ? 148 : 94
      const extraH = isExpanded ? subNodes.length * 24 + 12 : 0
      return {
        host: h,
        specs,
        ff,
        fresh,
        drives,
        gpus,
        isExpanded,
        subNodes,
        h: baseH + extraH,
      }
    })

    // Arrange cards in rows of `cols`
    const rows = []
    for (let i = 0; i < hostCards.length; i += cols) {
      const slice = hostCards.slice(i, i + cols)
      const rowH = Math.max(...slice.map((c) => c.h), 100)
      rows.push({ cards: slice, h: rowH })
    }

    let innerY = 50
    const positioned = []
    for (const r of rows) {
      r.cards.forEach((c, idx) => {
        positioned.push({
          ...c,
          x: 36 + idx * (cardW + gap),
          y: yCursor + innerY,
          w: cardW,
        })
      })
      innerY += r.h + gap
    }
    const boxH = Math.max(120, innerY + 6)
    boxes.push({
      site: sg.site,
      summary: sg.summary,
      y: yCursor,
      h: boxH,
      cards: positioned,
    })
    yCursor += boxH + 28
  }

  return {
    width,
    height: Math.max(340, yCursor + 20),
    boxes,
  }
})

function dotColor(dot) {
  if (dot === 'green') return '#10b981'
  if (dot === 'amber') return '#f59e0b'
  if (dot === 'blue') return '#3b82f6'
  return '#64748b'
}
</script>

<template>
  <div class="topo-wrap" data-test="fleet-topology">
    <div class="topo-toolbar">
      <div class="left-tools">
        <button type="button" class="tool-btn" aria-label="Zoom out" @click="zoomOut">−</button>
        <span class="zoom-readout">{{ Math.round(zoom * 100) }}%</span>
        <button type="button" class="tool-btn" aria-label="Zoom in" @click="zoomIn">+</button>
        <button type="button" class="tool-btn" @click="resetView">Fit</button>
      </div>
      <div class="right-tools">
        <button
          type="button"
          class="tool-btn"
          :class="{ active: detailedMode }"
          @click="detailedMode = !detailedMode"
        >
          {{ detailedMode ? 'Detailed' : 'Compact' }}
        </button>
      </div>
    </div>

    <div class="svg-viewport">
      <svg
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
        :style="{ transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)` }"
        class="topo-svg"
        role="img"
        :aria-label="`${fleetName} hardware topology map`"
      >
        <!-- Root Fleet Header Node -->
        <g class="root-node">
          <rect x="20" y="16" :width="layout.width - 40" height="66" rx="14" class="svg-root-box" />
          <text x="40" y="44" class="svg-root-title">{{ fleetName }}</text>
          <text x="40" y="65" class="svg-root-sub">
            {{ summary.totalHosts }} Hosts ({{ summary.online }} online) ·
            {{ summary.totalCores }} Cores · {{ summary.totalRamLabel }} RAM ·
            {{ summary.totalStorageLabel }} Storage ({{ summary.totalDrives }} drives)
          </text>
        </g>

        <!-- Tier 1: Site Containers -->
        <g v-for="box in layout.boxes" :key="box.site.id" class="site-zone">
          <line
            :x1="layout.width / 2"
            y1="82"
            :x2="layout.width / 2"
            :y2="box.y"
            class="svg-connector"
          />
          <rect
            x="20"
            :y="box.y"
            :width="layout.width - 40"
            :height="box.h"
            rx="14"
            class="svg-site-box"
          />
          <text x="38" :y="box.y + 28" class="svg-site-title">
            {{ box.site.label }}
          </text>
          <text :x="layout.width - 38" :y="box.y + 28" text-anchor="end" class="svg-site-badge">
            {{ box.cards.length }} host{{ box.cards.length === 1 ? '' : 's' }} ·
            {{ box.summary.totalCores }}C · {{ box.summary.totalRamLabel }} ·
            {{ box.summary.totalStorageLabel }}
          </text>

          <!-- Tier 2: Host Nodes -->
          <g
            v-for="card in box.cards"
            :key="card.host.id"
            :transform="`translate(${card.x}, ${card.y})`"
            class="host-node"
            :data-host-node="card.host.label"
          >
            <rect
              :width="card.w"
              :height="card.h"
              rx="11"
              class="svg-host-card"
              :class="`ff-${card.ff}`"
            />
            <!-- Freshness LED + Hostname -->
            <circle cx="18" cy="22" r="5" :fill="dotColor(card.fresh.dot)" />
            <text
              x="30"
              y="26"
              class="svg-host-title"
              @click="router.push({ name: 'host-detail', params: { id: card.host.id } })"
            >
              {{ card.host.label }}
            </text>
            <!-- Form factor badge -->
            <text :x="card.w - 14" y="25" text-anchor="end" class="svg-ff-badge">
              {{ (FORM_FACTOR_LABELS[card.ff] || card.ff).toUpperCase() }}
            </text>

            <!-- Role / OS line -->
            <text x="16" y="46" class="svg-host-meta">
              {{
                [
                  card.host.role || card.host.type,
                  card.specs.os
                    ? `${card.specs.os.name} ${card.specs.os.version || ''}`.trim()
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
                  .slice(0, 38) || 'Host node'
              }}
            </text>

            <!-- Compute + Memory bar -->
            <text x="16" y="66" class="svg-host-spec">
              {{
                `${(card.specs.cpu?.model || card.specs.platform || 'CPU').slice(0, 22)}${
                  card.specs.cpu?.physicalCores ? ` (${card.specs.cpu.physicalCores}C)` : ''
                } · ${formatRamGb(card.specs.memory?.totalBytes)}`
              }}
            </text>

            <!-- Detailed Drive Bays & GPU strip -->
            <template v-if="detailedMode">
              <text x="16" y="86" class="svg-host-meta">
                Storage: {{ formatStorageBytes(card.specs.storage?.totalBytes) }} ({{
                  card.drives.length
                }}
                bay{{ card.drives.length === 1 ? '' : 's' }})
              </text>
              <g
                v-for="(drv, dIdx) in card.drives.slice(0, 4)"
                :key="dIdx"
                :transform="`translate(${16 + dIdx * 65}, 96)`"
              >
                <rect width="60" height="22" rx="4" class="svg-bay-slot" />
                <text x="30" y="15" text-anchor="middle" class="svg-bay-text">
                  {{ formatDriveShort(drv).slice(0, 9) }}
                </text>
              </g>
              <text v-if="card.gpus.length" x="16" y="134" class="svg-gpu-chip">
                GPU: {{ card.gpus[0].model.slice(0, 26) }}
              </text>
            </template>

            <!-- Expand Tier-3 sub-nodes button -->
            <text
              :x="card.w - 14"
              :y="detailedMode ? 134 : 82"
              text-anchor="end"
              class="svg-expand-toggle"
              role="button"
              tabindex="0"
              @click.stop="toggleExpand(card.host.id)"
            >
              {{ card.isExpanded ? '▾ Hide parts' : '▸ Anatomy' }}
            </text>

            <!-- Tier 3: Expanded Hardware Sub-nodes -->
            <g v-if="card.isExpanded" :transform="`translate(16, ${detailedMode ? 146 : 92})`">
              <g
                v-for="(sn, sIdx) in card.subNodes"
                :key="sIdx"
                :transform="`translate(0, ${sIdx * 24})`"
              >
                <rect :width="card.w - 32" height="20" rx="4" class="svg-subnode" />
                <text x="8" y="14" class="svg-subnode-kind">{{ sn.kind }}</text>
                <text x="44" y="14" class="svg-subnode-text">{{ sn.label }}</text>
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.topo-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  padding: 0.75rem;
  background: var(--color-background-soft);
}

.topo-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.left-tools,
.right-tools {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.tool-btn {
  min-height: 36px;
  min-width: 36px;
  padding: 0 0.65rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.tool-btn.active {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.zoom-readout {
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
  min-width: 3rem;
  text-align: center;
}

.svg-viewport {
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  border-radius: 10px;
}

.topo-svg {
  width: 100%;
  height: auto;
  min-width: 640px;
  transform-origin: top left;
  transition: transform 0.15s ease;
}

.svg-root-box {
  fill: var(--color-background);
  stroke: var(--color-accent);
  stroke-width: 1.5;
}

.svg-root-title {
  fill: var(--color-heading);
  font-size: 18px;
  font-weight: 700;
}

.svg-root-sub {
  fill: var(--color-text-muted);
  font-size: 12px;
}

.svg-connector {
  stroke: var(--color-border-hover);
  stroke-width: 1.5;
  stroke-dasharray: 4 4;
}

.svg-site-box {
  fill: var(--color-background-mute);
  fill-opacity: 0.45;
  stroke: var(--color-border-hover);
  stroke-width: 1.25;
  stroke-dasharray: 6 4;
}

.svg-site-title {
  fill: var(--color-accent);
  font-size: 14px;
  font-weight: 700;
}

.svg-site-badge {
  fill: var(--color-text-muted);
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.svg-host-card {
  fill: var(--color-background);
  stroke: var(--color-border-hover);
  stroke-width: 1.25;
}

.svg-host-title {
  fill: var(--color-heading);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.svg-host-title:hover {
  fill: var(--color-accent);
  text-decoration: underline;
}

.svg-ff-badge {
  fill: var(--color-accent);
  font-size: 10px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.svg-host-meta {
  fill: var(--color-text-muted);
  font-size: 11px;
}

.svg-host-spec {
  fill: var(--color-text);
  font-size: 11.5px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.svg-bay-slot {
  fill: var(--color-background-mute);
  stroke: var(--color-accent);
  stroke-opacity: 0.55;
}

.svg-bay-text {
  fill: var(--color-heading);
  font-size: 9.5px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.svg-gpu-chip {
  fill: var(--color-accent);
  font-size: 10.5px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.svg-expand-toggle {
  fill: var(--color-accent);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
}

.svg-subnode {
  fill: var(--color-background-soft);
  stroke: var(--color-border);
}

.svg-subnode-kind {
  fill: var(--color-accent);
  font-size: 9.5px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.svg-subnode-text {
  fill: var(--color-text);
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
