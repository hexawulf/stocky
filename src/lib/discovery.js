// Hardware discovery in the app (spec §13.3, §13.6, §13.8): checks on the
// uploaded file before sending it, the preview's groups and decisions, and
// what History needs to show and undo an import. The server validates and
// decides again; these only shape the screen.
import { formatQty } from './format.js'
import { formatDay, parsePbDate } from './movements.js'
import { todayLocal } from './dates.js'

export const SCHEMA = 'stocky.discovery/1'
export const MAX_SNAPSHOT_BYTES = 256 * 1024

// Browser-side checks before upload (spec §13.3.1 step 2, §13.3.2):
// -> { ok: true } or { ok: false, message }
export function checkSnapshotText(text) {
  const t = String(text ?? '')
  if (!t.trim()) return { ok: false, message: 'Pick a snapshot file or paste its contents' }
  if (new Blob([t]).size > MAX_SNAPSHOT_BYTES) {
    return { ok: false, message: 'The snapshot is larger than 256 KB' }
  }
  let v
  try {
    v = JSON.parse(t)
  } catch {
    return { ok: false, message: "That file isn't valid JSON" }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return { ok: false, message: "That file isn't a Stocky discovery snapshot" }
  }
  if (v.schema !== SCHEMA) {
    return { ok: false, message: `Unsupported snapshot format (expected ${SCHEMA})` }
  }
  if (v.host?.virtual === true) {
    return {
      ok: false,
      message: 'This snapshot is from a virtual machine; Stocky tracks physical hardware only',
    }
  }
  return { ok: true }
}

// the preview's groups, in the order of spec §13.3.1 step 4
export const GROUPS = [
  { value: 'unchanged', label: 'Unchanged', hint: 'Seen again; only "last seen" is updated' },
  { value: 'adopt', label: 'Serial added', hint: 'Recorded by hand before; no movement' },
  {
    value: 'conflict',
    label: 'Conflict',
    hint: 'Another model than the one recorded here: keep the record, or replace it',
  },
  { value: 'new', label: 'New', hint: 'Detected, not recorded here yet' },
  { value: 'missing', label: 'Missing', hint: 'Recorded here, not detected' },
  { value: 'replaced', label: 'Replaced', hint: 'Another one in the same slot' },
  { value: 'moved', label: 'Moved', hint: 'Last seen in another host' },
  { value: 'ignored', label: 'Ignored', hint: 'Not imported; check one to import it after all' },
]

// the group a row is shown in: rows declined on an earlier import wait
// under Ignored (spec §13.11.9)
export const shownGroup = (r) => (r.declined ? 'ignored' : r.group)

// [{ group, label, hint, entries }]; a replaced pair is one entry with both
// halves: { rows: [out, in] }, everything else { rows: [row] }
export function groupRows(rows = []) {
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
  return GROUPS.map((g) => {
    const entries = []
    for (const r of rows) {
      if (shownGroup(r) !== g.value) continue
      if (r.group === 'replaced') {
        if (r.role !== 'out') continue
        entries.push({ id: r.id, rows: [r, byId[r.pair]].filter(Boolean) })
      } else entries.push({ id: r.id, rows: [r] })
    }
    return { group: g.value, label: g.label, hint: g.hint, entries }
  }).filter((g) => g.entries.length)
}

// the preview's own suggestion for every row (spec §13.5 "What's proposed by default")
export function defaultDecisions(rows = []) {
  const out = {}
  for (const r of rows) {
    if (r.group === 'ignored') continue
    out[r.id] = {
      apply: !!r.checked,
      action: r.action,
      location: r.location ?? '',
      reason: r.reason ?? '',
      partId: '', // a new row: use this existing part instead of creating one
      newPart: r.newPart ? { ...r.newPart } : null,
    }
  }
  return out
}

// what apply sends: only applied rows, only the fields that row uses
export function decisionsPayload(decisions, rows = []) {
  const out = {}
  for (const r of rows) {
    const d = decisions[r.id]
    if (!d?.apply) continue
    const p = { apply: true, action: d.action }
    if (['install', 'uninstall', 'replace_uninstall'].includes(d.action)) p.location = d.location
    if (d.action === 'stock_out' || d.action === 'replace_stock_out') p.reason = d.reason
    // the detected item's part, for the actions that put it in
    const putsIn = ['found_installed', 'install', 'replace_uninstall', 'replace_stock_out']
    if (r.newPart && putsIn.includes(d.action)) {
      if (d.partId) p.partId = d.partId
      else if (d.newPart) {
        p.newPart = {
          name: d.newPart.name.trim(),
          category: d.newPart.category,
          unit: d.newPart.unit,
        }
      }
    }
    out[r.id] = p
  }
  return out
}

// rows that will change something (unchanged rows only refresh "last seen")
export function countChanges(decisions, rows = []) {
  return rows.filter(
    (r) =>
      r.group !== 'unchanged' &&
      r.group !== 'ignored' &&
      decisions[r.id]?.apply &&
      !['ignore', 'keep'].includes(decisions[r.id].action),
  ).length
}

// field -> message for the rows about to be applied
export function validateDecisions(decisions, rows = [], partsById = {}) {
  const errors = {}
  for (const r of rows) {
    const d = decisions[r.id]
    if (!d?.apply || d.action === 'ignore' || d.action === 'keep') continue
    if (r.recorded && d.partId === r.recorded.partId) {
      errors[r.id] = `${r.recorded.name} is a different model: create a new part`
      continue
    }
    if (r.newPart && !d.partId) {
      const name = d.newPart?.name?.trim() ?? ''
      if (name.length < 2 || name.length > 80) errors[r.id] = 'Name: 2–80 characters'
      else if (!d.newPart.category) errors[r.id] = 'Pick a category'
      else if (
        Object.values(partsById).some((p) => p.nameKey === name.toLowerCase().replace(/\s+/g, ' '))
      ) {
        errors[r.id] = `You already have '${name}' — pick it under "Is this …?"`
      }
    }
    if (['install', 'uninstall', 'replace_uninstall'].includes(d.action) && !d.location) {
      errors[r.id] = 'Pick a location'
    }
    if (['stock_out', 'replace_stock_out'].includes(d.action) && !d.reason) {
      errors[r.id] = 'Pick a reason'
    }
  }
  return errors
}

export const ACTION_LABELS = {
  none: 'No change',
  adopt: 'Add the serial (no movement)',
  found_installed: 'Found installed (it was already there)',
  install: 'Installed from spares',
  move: 'Move it here',
  uninstall: 'Uninstall, keep as a spare',
  stock_out: 'Gone (stock out from this host)',
  ignore: 'Ignore this time',
  keep: 'Keep what is recorded (leave this one out)',
  replace_uninstall: 'Replace: uninstall the recorded one, keep it as a spare',
  replace_stock_out: 'Replace: the recorded one is gone (stock out)',
}

// "1 TB", "512 GB" (decimal, as drives are sold)
export function formatBytes(bytes) {
  if (!bytes) return ''
  if (bytes >= 1e12) return `${Math.round((bytes / 1e12) * 100) / 100} TB`
  return `${Math.round(bytes / 1e9)} GB`
}

// one detected item, for a row: "1 TB · nvme0 · S/N S5GX…"
export function itemDetail(item) {
  return [
    formatBytes(item.sizeBytes),
    item.interface,
    item.slot,
    item.serial ? `S/N ${item.serial}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export const MATCHED_BY = {
  serial: 'Matched by serial',
  learned: 'Matched by an earlier import',
  model: 'Matched by manufacturer + model',
}

// "Sun, 4 Oct 2026": the day an import was made, in this device's time zone
export function importDay(pbDate, locale) {
  const t = parsePbDate(pbDate)
  return Number.isFinite(t) ? formatDay(todayLocal(new Date(t)), locale) : ''
}

// --- History (spec §4.8, §13.4.4) ---------------------------------------------------------

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000

// Undo import is offered while the import is the newest thing recorded:
// not undone, under 24 h old, and users.lastMovementId still what it left.
// The server checks again (and also that no later import is in effect).
export function canUndoImport(imp, { lastMovementId, now = Date.now() } = {}) {
  if (!imp || imp.undone) return false
  if ((imp.lastMovementAfter ?? '') !== (lastMovementId ?? '')) return false
  const created = parsePbDate(imp.created)
  return Number.isFinite(created) && now - created < UNDO_WINDOW_MS
}

// a day's movements with an import's consecutive rows gathered:
// [{ kind: 'movement', movement } | { kind: 'import', importId, items }]
export function gatherImports(list) {
  const out = []
  for (const m of list) {
    const last = out.at(-1)
    if (m.import && last?.kind === 'import' && last.importId === m.import) last.items.push(m)
    else if (m.import) out.push({ kind: 'import', importId: m.import, items: [m] })
    else out.push({ kind: 'movement', movement: m })
  }
  return out
}

// "Discovery import · pi-b · 3 movements" for an import's header, plus
// the serials it linked without a movement ("0 movements, 2 serials linked")
export function importTitle(imp, items, hosts = {}) {
  const host = hosts[imp?.host]?.label ?? imp?.hostname ?? 'a host'
  const n = items.length
  const linked = imp?.summary?.serialsLinked ?? 0
  const serials = linked ? `, ${linked} serial${linked === 1 ? '' : 's'} linked` : ''
  return `Discovery import · ${host} · ${n} movement${n === 1 ? '' : 's'}${serials}`
}

// Imports that wrote no movement but linked serials (spec §13.11.11): placed
// at the top of their day in History (this device's day of `created`), as
// blocks { kind: 'import', importId, items: [], quiet: true }. Shown only
// when the filters could match an import (none, a host, a date range), and
// for days History has reached (or all, once every page is loaded).
export function placeQuietImports(groups, imports = [], { filters = {}, done = true } = {}) {
  if (filters.type || filters.part) return groups
  const out = groups.map((g) => ({ ...g, blocks: [...g.blocks] }))
  const oldest = out.at(-1)?.date
  for (const imp of imports) {
    if (!(imp?.summary?.serialsLinked > 0)) continue
    if (filters.place && filters.place !== imp.host) continue
    const t = parsePbDate(imp.created)
    if (!Number.isFinite(t)) continue
    const day = todayLocal(new Date(t))
    if ((filters.from && day < filters.from) || (filters.to && day > filters.to)) continue
    if (!done && oldest && day < oldest) continue
    const block = { kind: 'import', importId: imp.id, items: [], quiet: true }
    const g = out.find((x) => x.date === day)
    if (g) g.blocks.unshift(block)
    else {
      const at = out.findIndex((x) => x.date < day)
      const fresh = { date: day, items: [], blocks: [block] }
      if (at === -1) out.push(fresh)
      else out.splice(at, 0, fresh)
    }
  }
  return out
}

// --- which host a snapshot belongs to (spec §4.11) -------------------------------------------

const hostnameKey = (v) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/[\s_.-]+/g, '')

// -> { hostId, reason: 'machine' | 'hostname' } or null. A previous import
// from the same machine wins (it survives a rename), then the hostname.
// snapshot: the parsed file; hosts: active hosts; imports: listImports()
export function suggestHost(snapshot, hosts = [], imports = []) {
  const ids = new Set(hosts.map((h) => h.id))
  const mid = snapshot?.host?.machineIdHash
  if (mid) {
    const prev = imports.find((i) => !i.undone && i.machineIdHash === mid && ids.has(i.host))
    if (prev) return { hostId: prev.host, reason: 'machine' }
  }
  const name = hostnameKey(snapshot?.host?.hostname)
  if (name) {
    const h = hosts.find((x) => hostnameKey(x.label) === name || hostnameKey(x.key) === name)
    if (h) return { hostId: h.id, reason: 'hostname' }
  }
  return null
}

// the parsed snapshot, or null (after checkSnapshotText said ok)
export function parseSnapshot(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// quantities with units for the preview: "2 pcs"
export const rowQty = (row, partsById = {}) =>
  formatQty(row.quantity, partsById[row.partId]?.unit ?? row.newPart?.unit ?? 'pcs')
