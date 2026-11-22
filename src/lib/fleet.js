// Fleet Hardware Topology,KPI Aggregation, Freshness, & Privacy-Safe Redacted Exports (Phases 3 & 4).
// Pure functions with zero browser dependencies so Vitest and Node suites can test them directly.

export const FORM_FACTORS = [
  { value: 'sbc', label: 'SBC', short: 'SBC' },
  { value: 'workstation', label: 'Workstation', short: 'Tower' },
  { value: 'server', label: 'Server', short: 'Rack' },
  { value: 'nas', label: 'NAS', short: 'NAS' },
  { value: 'vps', label: 'Cloud VPS', short: 'Cloud' },
  { value: 'vm', label: 'Virtual Machine', short: 'VM' },
  { value: 'laptop', label: 'Laptop', short: 'Laptop' },
  { value: 'network', label: 'Network / Edge', short: 'Net' },
  { value: 'other', label: 'Other', short: 'Host' },
]

export const FORM_FACTOR_LABELS = Object.fromEntries(FORM_FACTORS.map((f) => [f.value, f.label]))

export const DEFAULT_STALE_HOURS = 48

// Freshness state of a host:
// - 'online' (<24h green)
// - 'recent' (24-48h or within staleThresholdHours, amber if >24h)
// - 'stale' (>staleThresholdHours gray)
// - 'manual' (no lastSeenAt, blue)
export function hostFreshness(host, { now = Date.now(), staleHours = DEFAULT_STALE_HOURS } = {}) {
  const raw = host?.lastSeenAt
  if (!raw) return { state: 'manual', label: 'Manual only', ageHours: null, dot: 'blue' }
  const ts = Date.parse(raw)
  if (!Number.isFinite(ts))
    return { state: 'manual', label: 'Manual only', ageHours: null, dot: 'blue' }
  const ageHours = Math.max(0, (now - ts) / 3600000)
  if (ageHours < 24) {
    const mins = Math.round(ageHours * 60)
    const label = mins < 60 ? `${Math.max(1, mins)}m ago` : `${Math.round(ageHours)}h ago`
    return { state: 'online', label, ageHours, dot: 'green' }
  }
  if (ageHours <= Math.max(staleHours, 72)) {
    const days = Math.round(ageHours / 24)
    return {
      state: ageHours > staleHours ? 'stale' : 'recent',
      label: ageHours < 48 ? `${Math.round(ageHours)}h ago` : `${days}d ago`,
      ageHours,
      dot: ageHours > 72 ? 'gray' : 'amber',
    }
  }
  const days = Math.round(ageHours / 24)
  return { state: 'stale', label: `${days}d ago`, ageHours, dot: 'gray' }
}

export function inferHostFormFactor(host) {
  if (host?.formFactor && FORM_FACTOR_LABELS[host.formFactor]) return host.formFactor
  const vt = host?.virtualType || host?.specs?.virtualType || ''
  const t = `${host?.type || ''} ${host?.specs?.model || ''} ${host?.label || ''}`.toLowerCase()
  if (vt === 'nas' || /synology|qnap|truenas|ds\d+/i.test(t)) return 'nas'
  if (vt === 'kvm' || vt === 'cloud' || vt === 'xen' || /vps|cloud/i.test(t)) return 'vps'
  if (vt === 'wsl' || vt === 'vmware' || vt === 'hyperv' || vt === 'lxc' || /wsl|vm/i.test(t))
    return 'vm'
  if (/raspberry|pi\s?[345]|aarch64|sbc|rockpi|orange/i.test(t)) return 'sbc'
  if (/router|fritz|switch|gateway|ap/i.test(t)) return 'network'
  if (/thinkpad|macbook|laptop/i.test(t)) return 'laptop'
  if (/server|rack|epyc|xeon/i.test(t)) return 'server'
  return 'workstation'
}

export function formatRamGb(bytes) {
  if (!bytes || bytes <= 0) return '—'
  const gb = bytes / 1073741824
  return gb >= 10 ? `${Math.round(gb)} GB` : `${Math.round(gb * 10) / 10} GB`
}

export function formatStorageBytes(bytes) {
  if (!bytes || bytes <= 0) return '—'
  if (bytes >= 1e12) return `${Math.round((bytes / 1e12) * 10) / 10} TB`
  if (bytes >= 1e9) return `${Math.round(bytes / 1e9)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

export function formatDriveShort(drive) {
  const iface = String(drive?.interface || 'disk').toUpperCase()
  const b = drive?.sizeBytes || 0
  let sz = ''
  if (b >= 1e12) sz = `${Math.round((b / 1e12) * 10) / 10}T`
  else if (b >= 1e9) sz = `${Math.round(b / 1e9)}G`
  return [iface, sz].filter(Boolean).join(' ')
}

// Compute Fleet Overview KPI summary strip from active hosts
export function computeFleetSummary(
  hosts = [],
  { now = Date.now(), staleHours = DEFAULT_STALE_HOURS } = {},
) {
  let online = 0
  let stale = 0
  let manual = 0
  let driftHosts = 0
  let totalDriftItems = 0
  let physicalCores = 0
  let cloudVcpus = 0
  let arm64Count = 0
  let x86Count = 0
  let totalRamBytes = 0
  let totalStorageBytes = 0
  let totalDrives = 0
  let smartWarnings = 0
  let monthlyCostByCurrency = {}
  let totalTdpWatts = 0

  for (const h of hosts) {
    if (h.retired) continue
    const f = hostFreshness(h, { now, staleHours })
    if (f.state === 'online' || f.state === 'recent') online++
    else if (f.state === 'stale') stale++
    else manual++

    const dc = Number(h.driftCount || 0)
    if (dc > 0) {
      driftHosts++
      totalDriftItems += dc
    }

    const specs = h.specs && typeof h.specs === 'object' ? h.specs : {}
    const ff = inferHostFormFactor(h)
    const isVirtual = specs.virtual === true || ff === 'vps' || ff === 'vm'
    const cores = Number(specs.cpu?.physicalCores || specs.cpu?.logicalCores || 0)
    if (isVirtual) cloudVcpus += cores
    else physicalCores += cores

    const plat = String(specs.platform || '').toLowerCase()
    if (/aarch64|arm/.test(plat) || ff === 'sbc') arm64Count++
    else if (/x86_64|amd64|i686/.test(plat) || specs.cpu?.model) x86Count++

    totalRamBytes += Number(specs.memory?.totalBytes || 0)
    totalStorageBytes += Number(specs.storage?.totalBytes || 0)
    totalDrives += Number(specs.storage?.driveCount || (specs.storage?.drives || []).length || 0)

    const smart = h.smartSummary && typeof h.smartSummary === 'object' ? h.smartSummary : {}
    if (smart.status === 'warn' || smart.status === 'fail') {
      smartWarnings += Math.max(1, (smart.unhealthyDrives || []).length)
    }

    if (Number(h.monthlyCost) > 0) {
      const cur = h.currency || 'USD'
      monthlyCostByCurrency[cur] = (monthlyCostByCurrency[cur] || 0) + Number(h.monthlyCost)
    }
    if (Number(h.tdpWatts) > 0) {
      totalTdpWatts += Number(h.tdpWatts)
    }
  }

  return {
    totalHosts: hosts.filter((h) => !h.retired).length,
    online,
    stale,
    manual,
    driftHosts,
    totalDriftItems,
    physicalCores,
    cloudVcpus,
    totalCores: physicalCores + cloudVcpus,
    arm64Count,
    x86Count,
    totalRamBytes,
    totalRamLabel: formatRamGb(totalRamBytes),
    totalStorageBytes,
    totalStorageLabel: formatStorageBytes(totalStorageBytes),
    totalDrives,
    smartWarnings,
    smartHealthy: smartWarnings === 0,
    monthlyCostByCurrency,
    totalTdpWatts,
  }
}

// Filter hosts by site, formFactor, arch, status, and search query
export function filterFleetHosts(
  hosts = [],
  filters = {},
  { now = Date.now(), staleHours = DEFAULT_STALE_HOURS } = {},
) {
  const q = String(filters.q || '')
    .trim()
    .toLowerCase()
  return hosts.filter((h) => {
    if (h.retired) return false
    if (filters.site && h.site !== filters.site) return false
    const ff = inferHostFormFactor(h)
    if (filters.formFactor && ff !== filters.formFactor) return false
    const specs = h.specs && typeof h.specs === 'object' ? h.specs : {}
    if (filters.arch) {
      const plat = String(specs.platform || '').toLowerCase()
      const isArm = /aarch64|arm/.test(plat) || ff === 'sbc'
      if (filters.arch === 'arm64' && !isArm) return false
      if (filters.arch === 'x86_64' && isArm) return false
    }
    if (filters.status) {
      const f = hostFreshness(h, { now, staleHours })
      const smart = h.smartSummary || {}
      if (filters.status === 'online' && f.state !== 'online' && f.state !== 'recent') return false
      if (filters.status === 'stale' && f.state !== 'stale') return false
      if (filters.status === 'drift' && !(Number(h.driftCount) > 0)) return false
      if (filters.status === 'smart_warn' && smart.status !== 'warn' && smart.status !== 'fail')
        return false
    }
    if (q) {
      const hay = [
        h.label,
        h.type,
        h.role,
        h.provider,
        specs.hostname,
        specs.model,
        specs.platform,
        specs.os?.name,
        specs.os?.version,
        specs.os?.kernel,
        specs.cpu?.model,
        ...(specs.storage?.drives || []).map(
          (d) => `${d.vendor} ${d.model} ${d.serial} ${d.interface}`,
        ),
        ...(specs.gpus || []).map((g) => `${g.vendor} ${g.model} ${g.serial}`),
        ...(specs.nics || []).map((n) => `${n.vendor} ${n.model} ${n.serial}`),
        ...(specs.hats || []).map((x) => `${x.vendor} ${x.model}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// --- Privacy Redaction & Export Generators (Phase 4) --------------------------------------

export const DEFAULT_REDACT_OPTIONS = {
  stripSerials: true,
  stripMacsAndIds: true,
  hideCosts: true,
  anonymizeHosts: false,
}

export function prepareExportData(
  hosts = [],
  locationsById = {},
  options = {},
  { fleetName = 'Homelab Fleet' } = {},
) {
  const opts = { ...DEFAULT_REDACT_OPTIONS, ...options }
  const counters = {}
  const activeHosts = hosts.filter((h) => !h.retired)

  const outHosts = activeHosts.map((h) => {
    const ff = inferHostFormFactor(h)
    counters[ff] = (counters[ff] || 0) + 1
    const anonLabel = `${ff}-${String(counters[ff]).padStart(2, '0')}`
    const label = opts.anonymizeHosts ? anonLabel : h.label
    const siteRec = locationsById[h.site]
    const siteLabel = opts.anonymizeHosts
      ? `Site ${String(siteRec?.sortOrder ?? 1)}`
      : siteRec?.label || 'Default Site'

    const specs = h.specs && typeof h.specs === 'object' ? JSON.parse(JSON.stringify(h.specs)) : {}
    if (opts.anonymizeHosts) specs.hostname = anonLabel

    if (opts.stripSerials) {
      for (const d of specs.storage?.drives || []) delete d.serial
      for (const m of specs.memory?.modules || []) delete m.serial
      for (const g of specs.gpus || []) delete g.serial
      for (const x of specs.hats || []) delete x.serial
      for (const u of specs.usb || []) delete u.serial
    }
    if (opts.stripMacsAndIds) {
      for (const n of specs.nics || []) delete n.serial
    }

    const item = {
      id: opts.anonymizeHosts ? anonLabel : h.id,
      label,
      site: siteLabel,
      siteId: h.site,
      formFactor: ff,
      virtualType: h.virtualType || specs.virtualType || 'bare-metal',
      role: h.role || '',
      type: h.type || specs.model || '',
      platform: specs.platform || '',
      os: specs.os ? `${specs.os.name || ''} ${specs.os.version || ''}`.trim() : '',
      kernel: specs.os?.kernel || '',
      cpu: specs.cpu?.model || '',
      cores: specs.cpu?.physicalCores || specs.cpu?.logicalCores || 0,
      ramBytes: specs.memory?.totalBytes || 0,
      ramLabel: formatRamGb(specs.memory?.totalBytes || 0),
      ramType: specs.memory?.type || '',
      storageBytes: specs.storage?.totalBytes || 0,
      storageLabel: formatStorageBytes(specs.storage?.totalBytes || 0),
      drives: (specs.storage?.drives || []).map((d) => ({
        model: [d.vendor, d.model].filter(Boolean).join(' ') || 'Drive',
        interface: d.interface || '',
        sizeBytes: d.sizeBytes || 0,
        sizeLabel: formatStorageBytes(d.sizeBytes || 0),
        shortLabel: formatDriveShort(d),
        smartStatus: d.smartStatus || 'UNKNOWN',
        tempC: d.tempC ?? null,
        ...(opts.stripSerials || !d.serial ? {} : { serial: d.serial }),
      })),
      gpus: (specs.gpus || []).map((g) => ({
        model: g.model || 'GPU',
        vramLabel: formatRamGb(g.vramBytes || 0),
        ...(opts.stripSerials || !g.serial ? {} : { serial: g.serial }),
      })),
      nics: (specs.nics || []).map((n) => ({
        model: n.model || 'NIC',
        interface: n.interface || '',
        ...(opts.stripMacsAndIds || !n.serial ? {} : { mac: n.serial }),
      })),
      smartStatus: h.smartSummary?.status || 'unknown',
      lastSeenAt: h.lastSeenAt || '',
    }

    if (!opts.stripMacsAndIds && h.machineIdHash) {
      item.machineIdHash = h.machineIdHash
    }
    if (!opts.hideCosts) {
      if (h.provider) item.provider = h.provider
      if (Number(h.monthlyCost) > 0) {
        item.monthlyCost = Number(h.monthlyCost)
        item.currency = h.currency || 'USD'
      }
      if (Number(h.tdpWatts) > 0) item.tdpWatts = Number(h.tdpWatts)
    }

    return item
  })

  return {
    fleetName,
    exportedAt: new Date().toISOString().slice(0, 19) + 'Z',
    redacted: {
      serialsStripped: !!opts.stripSerials,
      macsStripped: !!opts.stripMacsAndIds,
      costsHidden: !!opts.hideCosts,
      hostsAnonymized: !!opts.anonymizeHosts,
    },
    summary: computeFleetSummary(activeHosts),
    hosts: outHosts,
  }
}

export function generateFleetMarkdown(hosts = [], locationsById = {}, options = {}, meta = {}) {
  const data = prepareExportData(hosts, locationsById, options, meta)
  const s = data.summary
  const lines = [
    `# ${data.fleetName} — Hardware Topology & Spec Matrix`,
    '',
    `> **Hosts:** ${s.totalHosts} · **Compute:** ${s.totalCores} cores (${s.arm64Count} ARM64 / ${s.x86Count} x86_64) · **Memory:** ${s.totalRamLabel} · **Storage:** ${s.totalStorageLabel} (${s.totalDrives} drives)`,
    '',
    '| Host | Site | Form Factor | Arch / OS | CPU (Cores) | RAM | Storage | Drives | GPUs | SMART |',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
  ]

  for (const h of data.hosts) {
    const archOs = [h.platform, h.os].filter(Boolean).join(' · ') || '—'
    const cpuCol = h.cpu ? `${h.cpu}${h.cores ? ` (${h.cores}C)` : ''}` : '—'
    const ramCol = [h.ramLabel, h.ramType].filter((x) => x && x !== '—').join(' ') || '—'
    const drivesCol = h.drives.map((d) => d.shortLabel).join(', ') || '—'
    const gpusCol = h.gpus.map((g) => g.model).join(', ') || '—'
    const smartCol = h.smartStatus.toUpperCase()
    lines.push(
      `| **${h.label}** | ${h.site} | ${FORM_FACTOR_LABELS[h.formFactor] || h.formFactor} | ${archOs} | ${cpuCol} | ${ramCol} | ${h.storageLabel} | ${drivesCol} | ${gpusCol} | ${smartCol} |`,
    )
  }

  return lines.join('\n') + '\n'
}

function escXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Standalone publication-ready SVG generator for Fleet Topology (Phase 3 & 4)
export function generateFleetSvg(
  hosts = [],
  locationsById = {},
  options = {},
  { fleetName = 'Homelab Fleet', theme = 'dark' } = {},
) {
  const data = prepareExportData(hosts, locationsById, options, { fleetName })
  const isDark = theme !== 'light'
  const palette = isDark
    ? {
        bg: '#0f172a',
        surface: '#1e293b',
        card: '#0b1120',
        border: '#334155',
        accent: '#14b8a6',
        accentSoft: '#0f766e',
        text: '#f8fafc',
        muted: '#94a3b8',
        bayBg: '#1e293b',
        ok: '#10b981',
        warn: '#f59e0b',
        fail: '#ef4444',
      }
    : {
        bg: '#f8fafc',
        surface: '#f1f5f9',
        card: '#ffffff',
        border: '#cbd5e1',
        accent: '#0d9488',
        accentSoft: '#ccfbf1',
        text: '#0f172a',
        muted: '#475569',
        bayBg: '#e2e8f0',
        ok: '#059669',
        warn: '#d97706',
        fail: '#dc2626',
      }

  // Group hosts by site
  const siteGroups = []
  const bySite = {}
  for (const h of data.hosts) {
    if (!bySite[h.site]) {
      bySite[h.site] = { label: h.site, hosts: [] }
      siteGroups.push(bySite[h.site])
    }
    bySite[h.site].hosts.push(h)
  }

  const cardW = 280
  const cardH = 148
  const cardGap = 20
  const cols = Math.min(3, Math.max(1, data.hosts.length))
  const width = Math.max(760, cols * (cardW + cardGap) + 80)

  let yCursor = 110
  const siteBoxes = []
  for (const sg of siteGroups) {
    const rows = Math.ceil(sg.hosts.length / cols) || 1
    const boxH = 54 + rows * (cardH + cardGap)
    siteBoxes.push({ ...sg, y: yCursor, h: boxH })
    yCursor += boxH + 28
  }
  const height = Math.max(320, yCursor + 24)

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escXml(data.fleetName)} topology">`,
    `<style>`,
    `  .title { font: 700 20px system-ui, -apple-system, sans-serif; fill: ${palette.text}; }`,
    `  .sub { font: 500 13px system-ui, -apple-system, sans-serif; fill: ${palette.muted}; }`,
    `  .site-title { font: 700 14px system-ui, -apple-system, sans-serif; fill: ${palette.accent}; }`,
    `  .host-title { font: 700 14px system-ui, -apple-system, sans-serif; fill: ${palette.text}; }`,
    `  .host-meta { font: 500 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: ${palette.muted}; }`,
    `  .chip { font: 600 10px ui-monospace, SFMono-Regular, Menlo, monospace; fill: ${palette.text}; }`,
    `</style>`,
    `<rect width="${width}" height="${height}" rx="16" fill="${palette.bg}" />`,
    `<rect x="24" y="20" width="${width - 48}" height="64" rx="12" fill="${palette.surface}" stroke="${palette.border}" />`,
    `<text x="44" y="48" class="title">${escXml(data.fleetName)}</text>`,
    `<text x="44" y="68" class="sub">${data.summary.totalHosts} Hosts · ${data.summary.totalCores} Cores · ${escXml(data.summary.totalRamLabel)} RAM · ${escXml(data.summary.totalStorageLabel)} Storage</text>`,
  ]

  for (const sb of siteBoxes) {
    parts.push(
      `<line x1="${width / 2}" y1="84" x2="${width / 2}" y2="${sb.y}" stroke="${palette.border}" stroke-dasharray="4 4" />`,
      `<rect x="24" y="${sb.y}" width="${width - 48}" height="${sb.h}" rx="14" fill="${palette.surface}" fill-opacity="0.55" stroke="${palette.border}" stroke-dasharray="6 4" />`,
      `<text x="44" y="${sb.y + 28}" class="site-title">${escXml(sb.label)} (${sb.hosts.length})</text>`,
    )

    sb.hosts.forEach((h, idx) => {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      const cx = 44 + col * (cardW + cardGap)
      const cy = sb.y + 44 + row * (cardH + cardGap)
      const ledColor =
        h.smartStatus === 'fail'
          ? palette.fail
          : h.smartStatus === 'warn'
            ? palette.warn
            : palette.ok

      parts.push(
        `<g transform="translate(${cx}, ${cy})">`,
        `  <rect width="${cardW}" height="${cardH}" rx="10" fill="${palette.card}" stroke="${palette.border}" />`,
        `  <circle cx="18" cy="22" r="5" fill="${ledColor}" />`,
        `  <text x="30" y="26" class="host-title">${escXml(h.label)}</text>`,
        `  <text x="${cardW - 14}" y="25" text-anchor="end" class="host-meta">${escXml((FORM_FACTOR_LABELS[h.formFactor] || h.formFactor).toUpperCase())}</text>`,
        `  <text x="16" y="48" class="host-meta">${escXml([h.platform, h.os].filter(Boolean).join(' · ').slice(0, 36) || h.type.slice(0, 36))}</text>`,
        `  <text x="16" y="68" class="host-meta">${escXml(`${h.cpu ? h.cpu.slice(0, 24) : 'CPU'} (${h.cores}C) · ${h.ramLabel}`)}</text>`,
        `  <text x="16" y="88" class="host-meta">Storage: ${escXml(h.storageLabel)} (${h.drives.length} bay${h.drives.length === 1 ? '' : 's'})</text>`,
      )

      // Drive bays strip
      const maxBays = Math.min(4, h.drives.length)
      for (let b = 0; b < maxBays; b++) {
        const d = h.drives[b]
        const bx = 16 + b * 63
        parts.push(
          `  <rect x="${bx}" y="102" width="58" height="22" rx="4" fill="${palette.bayBg}" stroke="${palette.accent}" stroke-opacity="0.6" />`,
          `  <text x="${bx + 29}" y="117" text-anchor="middle" class="chip">${escXml(d.shortLabel.slice(0, 9))}</text>`,
        )
      }
      if (h.gpus.length > 0) {
        parts.push(
          `  <text x="16" y="139" class="chip" fill="${palette.accent}">GPU: ${escXml(h.gpus[0].model.slice(0, 30))}</text>`,
        )
      }
      parts.push(`</g>`)
    })
  }

  parts.push(`</svg>`)
  return parts.join('\n')
}
