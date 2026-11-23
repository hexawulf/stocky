<script setup>
// Global ⌘K / Ctrl+K Command Palette:
// Searches across Hosts (CPU, OS, site), Physical Drives & Serials, GPU/NIC/HATs,
// Spare Part Types, and Quick Actions (navigation, theme toggle, import).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useInventory } from '@/stores/inventory.js'
import { useTheme } from '@/composables/useTheme.js'

const emit = defineEmits(['close'])
const router = useRouter()
const inv = useInventory()
const { effectiveTheme, toggleTheme } = useTheme()

const query = ref('')
const selectedIndex = ref(0)
const inputEl = ref(null)

const locationLabelById = computed(() => {
  const map = {}
  const locs = inv.locations?.value || []
  for (const loc of locs) {
    map[loc.id] = loc.label
  }
  return map
})

const allItems = computed(() => {
  const list = []
  const hosts = inv.hosts?.value || []
  const parts = inv.parts?.value || []

  // 1. Hosts & discovered hardware inside hosts (drives, serials, GPUs, NICs, HATs)
  for (const h of hosts) {
    const specs =
      h.specs && typeof h.specs === 'object'
        ? h.specs
        : h.hardwareSnapshot && typeof h.hardwareSnapshot === 'object'
          ? h.hardwareSnapshot
          : {}
    const sys = specs.system || specs
    const osText =
      typeof specs.os === 'object' && specs.os
        ? [specs.os.name, specs.os.version].filter(Boolean).join(' ')
        : sys.os || ''
    const cpu = specs.cpu || {}
    const mem = specs.memory || {}
    const siteId = h.site || h.location
    const site = locationLabelById.value[siteId] || 'Unassigned'
    const ramGiB = mem.totalBytes ? `${Math.round(mem.totalBytes / 1024 ** 3)} GiB` : ''
    const subtitleParts = [
      site,
      osText || h.arch || specs.platform || sys.arch,
      cpu.model,
      ramGiB,
    ].filter(Boolean)

    list.push({
      id: `host-${h.id}`,
      group: 'Hosts',
      icon: '❖',
      title: h.label,
      subtitle: subtitleParts.join(' · ') || 'Fleet Host',
      keywords: [
        h.label,
        site,
        h.formFactor,
        h.role,
        h.provider,
        specs.hostname,
        specs.model,
        sys.model,
        osText,
        specs.os?.kernel,
        specs.platform,
        sys.arch,
        cpu.model,
        ...(Array.isArray(h.tags) ? h.tags : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
      run: () => router.push({ name: 'host-detail', params: { id: h.id } }),
    })

    // Drives inside host (searchable by serial, model, device name, SMART status)
    const drives = Array.isArray(specs.storage?.drives)
      ? specs.storage.drives
      : Array.isArray(specs.drives)
        ? specs.drives
        : []
    for (const d of drives) {
      const iface = d.interface || d.type || ''
      const sizeGiB = d.sizeBytes ? `${Math.round(d.sizeBytes / 1024 ** 3)} GiB` : ''
      const serialText = d.serial ? `S/N: ${d.serial}` : ''
      const smartStatus = d.smart?.status || d.smartStatus || ''
      const tempC = d.smart?.tempC ?? d.tempC
      const tempText = tempC != null ? `${tempC}°C` : ''
      list.push({
        id: `drive-${h.id}-${d.slot || d.name || d.serial || d.model}`,
        group: 'Hardware & Serials',
        icon: '▤',
        title: `${d.model || d.name || 'Drive'} (${h.label})`,
        subtitle: [iface.toUpperCase(), sizeGiB, serialText, smartStatus, tempText]
          .filter(Boolean)
          .join(' · '),
        keywords: [
          h.label,
          site,
          d.slot,
          d.name,
          d.vendor,
          d.model,
          d.serial,
          iface,
          smartStatus,
          'drive',
          'disk',
          'nvme',
          'sata',
          'smart',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
        run: () => router.push({ name: 'host-detail', params: { id: h.id } }),
      })
    }

    // GPUs inside host
    const gpus = Array.isArray(specs.gpus) ? specs.gpus : []
    for (const g of gpus) {
      if (!g?.model) continue
      const vramGiB = g.vramBytes
        ? `${Math.round(g.vramBytes / 1024 ** 3)} GiB VRAM`
        : g.vramMiB
          ? `${Math.round(g.vramMiB / 1024)} GiB VRAM`
          : ''
      list.push({
        id: `gpu-${h.id}-${g.model}`,
        group: 'Hardware & Serials',
        icon: '◈',
        title: `${g.model} (${h.label})`,
        subtitle: [g.vendor, vramGiB, site].filter(Boolean).join(' · '),
        keywords: [h.label, site, g.model, g.vendor, g.serial, 'gpu', 'vram']
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
        run: () => router.push({ name: 'host-detail', params: { id: h.id } }),
      })
    }

    // NICs inside host (searchable by MAC, IPv4, interface name)
    const nics = Array.isArray(specs.nics) ? specs.nics : []
    for (const n of nics) {
      const nicName = n.name || n.interface || n.model
      if (!nicName) continue
      const mac = n.mac || n.serial || ''
      list.push({
        id: `nic-${h.id}-${nicName}-${mac}`,
        group: 'Hardware & Serials',
        icon: '⇄',
        title: `${h.label} · ${nicName}${n.ipv4 ? ` (${n.ipv4})` : ''}`,
        subtitle: [mac ? `MAC ${mac}` : '', n.speedMbps ? `${n.speedMbps} Mbps` : '', site]
          .filter(Boolean)
          .join(' · '),
        keywords: [h.label, site, nicName, n.model, mac, n.ipv4, 'nic', 'mac', 'ip']
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
        run: () => router.push({ name: 'host-detail', params: { id: h.id } }),
      })
    }
  }

  // 2. Spare Parts catalog
  for (const p of parts) {
    list.push({
      id: `part-${p.id}`,
      group: 'Parts',
      icon: '☰',
      title: p.name,
      subtitle: `${p.spareTotal ?? 0} ${p.unit || 'pcs'} spare · ${p.installedTotal ?? 0} installed`,
      keywords: [p.name, p.notes, p.unit, 'part', 'spare'].filter(Boolean).join(' ').toLowerCase(),
      run: () => router.push({ name: 'part', params: { id: p.id } }),
    })
  }

  // 3. Quick Actions
  list.push(
    {
      id: 'act-fleet',
      group: 'Quick Actions',
      icon: '❖',
      title: 'Go to Fleet Overview',
      subtitle: 'Rack & Chassis cards, Topology SVG, and Spec Matrix',
      keywords: 'fleet home rack topology matrix hosts',
      run: () => router.push({ name: 'home' }),
    },
    {
      id: 'act-stock',
      group: 'Quick Actions',
      icon: '⌂',
      title: 'Go to Stock & Installed Overview',
      subtitle: 'Spare parts by site, low-stock alerts, and installed units',
      keywords: 'stock home spare low stock installed',
      run: () => router.push({ name: 'stock' }),
    },
    {
      id: 'act-record',
      group: 'Quick Actions',
      icon: '+',
      title: 'Record Stock Movement',
      subtitle: 'Add, use, move, install, uninstall, or adjust stock',
      keywords: 'record movement install swap add use move',
      run: () => router.push({ name: 'record' }),
    },
    {
      id: 'act-import',
      group: 'Quick Actions',
      icon: '↓',
      title: 'Connect Host / Import Discovery Snapshot',
      subtitle: 'Generate ingest token or upload stocky-collect.sh JSON',
      keywords: 'import connect host discovery token collect',
      run: () => router.push({ name: 'import' }),
    },
    {
      id: 'act-drift',
      group: 'Quick Actions',
      icon: '⚡',
      title: 'Open Drift Inbox',
      subtitle: 'Review and apply detected physical hardware changes',
      keywords: 'drift inbox changes review apply',
      run: () => router.push({ name: 'fleet-drift' }),
    },
    {
      id: 'act-theme',
      group: 'Quick Actions',
      icon: effectiveTheme.value === 'dark' ? '☀' : '☾',
      title: `Switch to ${effectiveTheme.value === 'dark' ? 'Light' : 'Dark'} Theme`,
      subtitle: `Current theme: ${effectiveTheme.value}`,
      keywords: 'theme light dark mode toggle appearance',
      run: () => toggleTheme(),
    },
  )

  return list
})

const filteredItems = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) {
    // Default view when empty: show all Hosts, top 5 Parts, and Quick Actions
    const hosts = allItems.value.filter((i) => i.group === 'Hosts')
    const parts = allItems.value.filter((i) => i.group === 'Parts').slice(0, 5)
    const actions = allItems.value.filter((i) => i.group === 'Quick Actions')
    return [...hosts, ...parts, ...actions]
  }
  const tokens = q.split(/\s+/).filter(Boolean)
  return allItems.value
    .filter((item) =>
      tokens.every(
        (t) =>
          item.keywords.includes(t) ||
          item.title.toLowerCase().includes(t) ||
          item.subtitle.toLowerCase().includes(t),
      ),
    )
    .slice(0, 25)
})

watch(filteredItems, () => {
  selectedIndex.value = 0
})

async function triggerItem(item) {
  if (!item) return
  await item.run()
  emit('close')
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (filteredItems.value.length > 0) {
      selectedIndex.value = (selectedIndex.value + 1) % filteredItems.value.length
    }
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (filteredItems.value.length > 0) {
      selectedIndex.value =
        (selectedIndex.value - 1 + filteredItems.value.length) % filteredItems.value.length
    }
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const item = filteredItems.value[selectedIndex.value]
    if (item) triggerItem(item)
  }
}

onMounted(async () => {
  await nextTick()
  inputEl.value?.focus()
})

onBeforeUnmount(() => {})
</script>

<template>
  <div
    class="cmd-backdrop"
    data-test="cmd-backdrop"
    @click.self="emit('close')"
    @keydown="onKeydown"
  >
    <section
      class="cmd-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      data-test="cmd-dialog"
    >
      <div class="cmd-search-bar">
        <span class="cmd-search-icon" aria-hidden="true">⌘</span>
        <input
          ref="inputEl"
          v-model="query"
          type="search"
          class="cmd-input"
          placeholder="Search hosts, drive serials, GPUs, MAC/IPs, parts, or actions…"
          aria-label="Command palette search"
          data-test="cmd-input"
        />
        <button
          type="button"
          class="cmd-esc"
          aria-label="Close command palette"
          data-test="cmd-close"
          @click="emit('close')"
        >
          Esc
        </button>
      </div>

      <ul v-if="filteredItems.length > 0" class="cmd-list" role="listbox" data-test="cmd-list">
        <li
          v-for="(item, idx) in filteredItems"
          :key="item.id"
          class="cmd-item"
          :class="{ selected: idx === selectedIndex }"
          role="option"
          :aria-selected="idx === selectedIndex"
          :data-test="`cmd-item-${item.id}`"
          @mouseenter="selectedIndex = idx"
          @click="triggerItem(item)"
        >
          <span class="cmd-item-icon" aria-hidden="true">{{ item.icon }}</span>
          <div class="cmd-item-body">
            <div class="cmd-item-title">{{ item.title }}</div>
            <div class="cmd-item-sub">{{ item.subtitle }}</div>
          </div>
          <span class="cmd-item-group">{{ item.group }}</span>
        </li>
      </ul>

      <p v-else class="cmd-empty" data-test="cmd-empty">
        No hosts, drives, serials, parts, or actions matching "{{ query }}".
      </p>

      <footer class="cmd-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
        <span><kbd>↵</kbd> Open</span>
        <span><kbd>Esc</kbd> Close</span>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.cmd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 8vh 1rem 1rem;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}

.cmd-modal {
  width: 100%;
  max-width: 38rem;
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid var(--color-border-hover);
  background: var(--color-background);
  color: var(--color-text);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.32);
  overflow: hidden;
}

.cmd-search-bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem 0.9rem;
  border-bottom: 1px solid var(--color-border);
}

.cmd-search-icon {
  font-size: 1.05rem;
  color: var(--color-accent);
  font-weight: 700;
}

.cmd-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--color-heading);
  font: inherit;
  font-size: 0.98rem;
  outline: none;
}

.cmd-esc {
  padding: 0.2rem 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-background-mute);
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.cmd-list {
  list-style: none;
  margin: 0;
  padding: 0.4rem;
  overflow-y: auto;
  flex: 1;
}

.cmd-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 0.7rem;
  border-radius: 9px;
  cursor: pointer;
}

.cmd-item.selected {
  background: var(--color-accent-soft);
}

.cmd-item-icon {
  width: 1.8rem;
  height: 1.8rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: var(--color-background-mute);
  color: var(--color-heading);
  font-size: 0.95rem;
  flex: none;
}

.cmd-item-body {
  flex: 1;
  min-width: 0;
}

.cmd-item-title {
  font-weight: 600;
  font-size: 0.92rem;
  color: var(--color-heading);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cmd-item-sub {
  font-size: 0.78rem;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cmd-item-group {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-muted);
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  background: var(--color-background-soft);
  flex: none;
}

.cmd-empty {
  padding: 1.75rem 1rem;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.cmd-footer {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.45rem 0.9rem;
  border-top: 1px solid var(--color-border);
  background: var(--color-background-soft);
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.cmd-footer kbd {
  display: inline-block;
  padding: 0.05rem 0.35rem;
  margin-right: 0.2rem;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.7rem;
}
</style>
