/// <reference path="../../pb_data/types.d.ts" />

// Hardware discovery (spec §13): validate a collector snapshot, compare it
// with a host's recorded state, propose rows, apply the confirmed ones in one
// transaction, and undo an import. Loaded with require() like stocky.js.

const s = require(`${__hooks}/lib/stocky.js`)

const SCHEMA = 'stocky.discovery/1'
const MAX_SNAPSHOT_CHARS = 256 * 1024
const MAX_ITEMS = 200
const MAX_MATCH_KEYS = 50
const KINDS = ['system', 'board', 'cpu', 'memory', 'drive', 'nic', 'usb', 'hat']

// preferred category keys per kind, across both presets (spec §13.5); then
// `other`; then the user picks
const CATEGORY_KEYS = {
  drive: ['storage'],
  memory: ['components'],
  cpu: ['components'],
  nic: ['networking'],
  usb: ['peripherals'],
  hat: ['computers', 'sbc'],
  system: ['computers', 'sbc'],
  board: ['components'],
}

// --- validation (spec §13.3.2) -------------------------------------------------------

// text: trimmed, control characters removed, capped; anything else -> null
function text(v, max) {
  if (typeof v === 'number' || typeof v === 'boolean') v = String(v)
  if (typeof v !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()
  return t ? t.slice(0, max) : null
}

function int(v, max) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null
}

function bool(v) {
  return typeof v === 'boolean' ? v : null
}

// raw: a flat object of short strings and numbers, for troubleshooting only
function raw(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out = {}
  let n = 0
  for (const k of Object.keys(v)) {
    if (n >= 30) break
    const key = text(k, 40)
    if (!key) continue
    const val = typeof v[k] === 'number' && isFinite(v[k]) ? v[k] : text(v[k], 200)
    if (val === null) continue
    out[key] = val
    n++
  }
  return n ? out : null
}

function cleanItem(v) {
  const item = {
    kind: v.kind,
    vendor: text(v.vendor, 80),
    model: text(v.model, 120),
    serial: text(v.serial, 80),
    sizeBytes: int(v.sizeBytes, Number.MAX_SAFE_INTEGER),
    memoryBytes: int(v.memoryBytes, Number.MAX_SAFE_INTEGER),
    interface: text(v.interface, 20),
    slot: text(v.slot, 120),
    memoryType: text(v.memoryType, 20),
    speedMTs: int(v.speedMTs, 100000),
    formFactor: text(v.formFactor, 20),
    bus: text(v.bus, 20),
    onboard: bool(v.onboard),
    removable: bool(v.removable),
    raw: raw(v.raw),
  }
  for (const k of Object.keys(item)) if (item[k] === null) delete item[k]
  return item
}

// The snapshot arrives as the file's text: parse it here, so anything that
// isn't JSON is rejected before every other check. Returns the validated copy.
function validateSnapshot(snapshotText) {
  if (typeof snapshotText !== 'string') s.fail('invalid_json', "That file isn't valid JSON")
  if (snapshotText.length > MAX_SNAPSHOT_CHARS) {
    s.fail('too_large', 'The snapshot is larger than 256 KB')
  }
  let v
  try {
    v = JSON.parse(snapshotText)
  } catch (_) {
    s.fail('invalid_json', "That file isn't valid JSON")
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    s.fail('invalid_snapshot', "That file isn't a Stocky discovery snapshot")
  }
  if (v.schema !== SCHEMA) {
    s.fail('invalid_schema', `Unsupported snapshot format (expected ${SCHEMA})`)
  }
  const host = v.host && typeof v.host === 'object' && !Array.isArray(v.host) ? v.host : {}
  if (host.virtual === true) {
    s.fail(
      'virtual_host',
      'This snapshot is from a virtual machine; Stocky tracks physical hardware only',
    )
  }
  if (!Array.isArray(v.items)) s.fail('invalid_snapshot', 'The snapshot has no items list')
  if (v.items.length > MAX_ITEMS) {
    s.fail('too_many_items', `A snapshot can have at most ${MAX_ITEMS} items`)
  }

  const warnings = []
  const ignored = []
  const items = []
  const serials = {}
  for (const entry of v.items) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      ignored.push({ kind: '', reason: 'not an item' })
      continue
    }
    if (KINDS.indexOf(entry.kind) < 0) {
      ignored.push({ kind: text(entry.kind, 20) || '', reason: 'unknown kind' })
      continue
    }
    const item = cleanItem(entry)
    // a serial reported twice can't identify two items
    const key = s.serialKey(item.serial)
    if (key) {
      if (serials[key]) {
        warnings.push(
          `Serial ${item.serial} reported twice; the second ${item.kind} is matched by count`,
        )
        delete item.serial
      } else serials[key] = true
    }
    items.push(item)
  }
  const list = (a, fn) =>
    Array.isArray(a)
      ? a
          .slice(0, 50)
          .map(fn)
          .filter((x) => x)
      : []
  const machineIdHash = text(host.machineIdHash, 80)
  return {
    schema: SCHEMA,
    collector: text(v.collector, 60) || '',
    collectedAt: text(v.collectedAt, 40) || '',
    host: {
      hostname: text(host.hostname, 80) || '',
      machineIdHash:
        machineIdHash && /^sha256:[0-9a-f]{64}$/.test(machineIdHash) ? machineIdHash : '',
      platform: text(host.platform, 40) || '',
      virtual: false,
      model: text(host.model, 120) || '',
    },
    items: items,
    skipped: list(v.skipped, (x) =>
      x && typeof x === 'object'
        ? { kind: text(x.kind, 20) || '', reason: text(x.reason, 200) || '' }
        : null,
    ),
    warnings: list(v.warnings, (x) => text(x, 200)).concat(warnings),
    ignored: ignored,
  }
}

// --- names and keys (spec §13.5) ---------------------------------------------------------

function upper(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function collapse(v) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .trim()
}

// "1 TB", "512 GB", "128 GB" (decimal, as drives are sold)
function driveSize(bytes) {
  if (!bytes) return ''
  if (bytes >= 1e12) return `${Math.round((bytes / 1e12) * 100) / 100} TB`
  return `${Math.round(bytes / 1e9)} GB`
}

// memory is binary: 17179869184 -> "16 GB"
function memorySize(bytes) {
  return bytes ? `${Math.round(bytes / 1073741824)} GB` : ''
}

// vendor + model, without the vendor twice ("Samsung" + "Samsung SSD 980")
function vendorModel(item) {
  const v = collapse(item.vendor)
  const m = collapse(item.model)
  if (!m) return v
  if (!v || upper(m).indexOf(upper(v)) === 0) return m
  return `${v} ${m}`
}

function suggestName(item) {
  let name = ''
  switch (item.kind) {
    case 'drive': {
      name = vendorModel(item)
      // a size already in the model ("990 PRO 1TB"), not one inside a part number ("TM8PS7512G")
      if (!/\b\d+(\.\d+)?\s?(GB|TB|G|T)\b/i.test(name))
        name = `${name} ${driveSize(item.sizeBytes)}`
      if (item.interface === 'nvme' && !/nvme/i.test(name)) name += ' NVMe'
      break
    }
    case 'memory': {
      const typeSpeed = [item.memoryType, item.speedMTs].filter((x) => x).join('-')
      const form = item.formFactor === 'SODIMM' ? 'SO-DIMM' : item.formFactor || ''
      name = [memorySize(item.sizeBytes), typeSpeed, form].filter((x) => x).join(' ')
      break
    }
    case 'cpu':
      name = collapse(
        String(item.model || '')
          .replace(/\((R|TM|tm|r)\)/g, '')
          .replace(/\s+CPU\s+@.*$/i, '')
          .replace(/\s+@\s+[\d.]+\s*GHz.*$/i, ''),
      )
      break
    case 'system': {
      const model = collapse(
        String(item.model || '')
          .replace(/\s+Rev\s+\S+$/i, '')
          .replace(/\s+Model\s+[A-Z]\+?$/i, ''),
      )
      name = /raspberry pi/i.test(model)
        ? [model, memorySize(item.memoryBytes)].filter((x) => x).join(' ')
        : vendorModel({ vendor: item.vendor, model: model })
      break
    }
    default:
      name = vendorModel(item)
  }
  name = collapse(name).slice(0, 80)
  return name.length >= 2 ? name : `${item.kind} (unnamed)`
}

// what a part learns to recognise (spec §13.5 step 2): the normalised raw
// model, or for items without one, kind + suggested name
function itemKey(item) {
  const vm = upper(vendorModel(item))
  return (vm || `${upper(item.kind)}:${upper(suggestName(item))}`).slice(0, 160)
}

// kinds where a detected item that differs from what's recorded is a
// Conflict, never a silent new install (spec §13.11.10)
const CONFLICT_KINDS = ['cpu', 'memory', 'board', 'drive']

// what kind of hardware a part is: from its units, else from its words
function partKind(part, state) {
  const u = state.units.filter((x) => x.getString('part') === part.id && x.getString('kind'))[0]
  if (u) return u.getString('kind')
  const t = `${part.getString('name')} ${part.getString('manufacturer')} ${part.getString('model')}`
  if (/\b(ddr[2-5]\w*|so-?dimm|dimm|ram)\b/i.test(t)) return 'memory'
  if (/\b(ryzen|threadripper|epyc|athlon|core\s?i[3579]|xeon|celeron|pentium|cpu)\b/i.test(t)) {
    return 'cpu'
  }
  if (/\b(motherboard|mainboard)\b/i.test(t)) return 'board'
  if (/\b(ssd|nvme|hdd|m\.2|sata)\b/i.test(t) || /\b\d+(\.\d+)?\s?TB\b/i.test(t)) return 'drive'
  return ''
}

// "5700X3D", "990", "DDR4": the words that say which model a part is (a
// size like "2TB" or "16GB" doesn't: two different drives share it)
function identityTokens(text) {
  return tokens(text).filter(
    (t) => /\d/.test(t) && t.length >= 3 && !/^\d+(\.\d+)?(TB|GB|MB|T|G)$/.test(t),
  )
}

// a recorded part names a model and the detected item shares none of its
// model words: "Ryzen 7 5700X3D" vs "AMD Ryzen 7 5700G" (but not "My boot
// SSD", which names no model)
function modelMismatch(part, item) {
  const ids = identityTokens(`${part.getString('name')} ${part.getString('model')}`)
  if (!ids.length) return false
  const have = tokens(`${vendorModel(item)} ${suggestName(item)}`)
  return !ids.some((t) => have.indexOf(t) >= 0)
}

// what a declined detected item is remembered by, per host (spec §13.11.9)
function ignoreKeys(row) {
  return row.items.map((it) =>
    it.serial ? `S:${s.serialKey(it.serial)}` : `M:${row.kind}|${row.key}`,
  )
}

function readJsonArray(record, field) {
  try {
    const v = JSON.parse(record.getString(field) || '[]')
    return Array.isArray(v) ? v : []
  } catch (_) {
    return []
  }
}

function partModelKey(part) {
  if (!collapse(part.getString('model'))) return ''
  return upper(
    vendorModel({ vendor: part.getString('manufacturer'), model: part.getString('model') }),
  )
}

function tokens(v) {
  return upper(v)
    .split(/[^A-Z0-9.]+/)
    .filter((t) => t.length >= 2)
}

// "Is this …?" (spec §13.5 step 4): parts sharing at least two words
function suggestParts(item, parts) {
  const want = tokens(`${vendorModel(item)} ${suggestName(item)}`)
  if (want.length === 0) return []
  const scored = []
  for (const p of parts) {
    const have = tokens(
      `${p.getString('name')} ${p.getString('manufacturer')} ${p.getString('model')}`,
    )
    const shared = want.filter((t, i) => want.indexOf(t) === i && have.indexOf(t) >= 0).length
    if (shared >= 2) scored.push({ part: p, score: shared })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 3).map((x) => ({ id: x.part.id, name: x.part.getString('name') }))
}

// --- state ---------------------------------------------------------------------------------

function loadState(app, uid, hostId) {
  const host = s.findOwned(app, 'hosts', hostId, uid, 'Host')
  if (host.getBool('retired')) s.fail('retired', `${host.getString('label')} is retired`)
  const all = (name, sort) =>
    app.findRecordsByFilter(name, 'user = {:uid}', sort || '', 0, 0, { uid: uid })
  const state = {
    uid: uid,
    host: host,
    user: app.findRecordById('users', uid),
    parts: all('parts', 'name'),
    units: all('units', 'serialKey'),
    hosts: all('hosts'),
    locations: all('locations'),
    categories: all('categories', 'sortOrder'),
  }
  const index = (list) => {
    const m = {}
    for (const r of list) m[r.id] = r
    return m
  }
  state.partsById = index(state.parts)
  state.hostsById = index(state.hosts)
  state.locationsById = index(state.locations)
  state.site = state.locationsById[host.getString('site')]
  state.ignored = readJsonArray(host, 'discoveryIgnored')
  state.transit = state.locations.filter((l) => l.getString('kind') === 'transit')[0] || null
  return state
}

// what a preview depends on: if any of it changes, apply refuses (preview_stale)
function fingerprint(state) {
  const part = (list) => list.map((r) => `${r.id}@${r.getString('updated')}`).join(',')
  return [
    state.host.id,
    state.user.getString('lastMovementId'),
    part(state.parts),
    part(state.units),
    part(state.hosts),
    part(state.locations),
    part(state.categories),
  ].join('|')
}

function categoryFor(kind, state) {
  const active = state.categories.filter((c) => !c.getBool('retired'))
  for (const key of (CATEGORY_KEYS[kind] || []).concat(['other'])) {
    const c = active.filter((x) => x.getString('key') === key)[0]
    if (c) return c.id
  }
  return ''
}

function isSbc(snapshot) {
  return (
    /^(aarch64|arm)/i.test(snapshot.host.platform) ||
    /raspberry pi/i.test(snapshot.host.model) ||
    snapshot.items.some((i) => i.kind === 'system' && /raspberry pi/i.test(i.model || ''))
  )
}

// proposed (checked) by default (spec §13.5, decision #23.4)
function checkedByDefault(item, sbc) {
  switch (item.kind) {
    case 'drive':
    case 'memory':
    case 'hat':
      return true
    case 'nic':
      return item.bus === 'usb' || item.onboard === false
    case 'cpu':
      return !sbc
    case 'system':
      return sbc
    default:
      return false
  }
}

// --- the proposal (spec §13.6) -----------------------------------------------------------

function itemSummary(item, i) {
  const out = { index: i, kind: item.kind, label: vendorModel(item) || suggestName(item) }
  for (const k of ['serial', 'slot', 'sizeBytes', 'interface'])
    if (item[k] !== undefined) out[k] = item[k]
  return out
}

function spareAt(part, locationId) {
  return s.readMap(part, 'spare')[locationId] || 0
}

function installSources(state, part, qty) {
  const out = []
  for (const l of [state.site, state.transit]) {
    if (l && !l.getBool('retired') && part && spareAt(part, l.id) >= qty) out.push(l.id)
  }
  return out
}

function compute(state, snapshot) {
  const H = state.host
  const sbc = isSbc(snapshot)
  const activeParts = state.parts.filter((p) => !p.getBool('archived'))
  const unitsByKey = {}
  for (const u of state.units) {
    const k = u.getString('serialKey')
    ;(unitsByKey[k] = unitsByKey[k] || []).push(u)
  }
  // prefer the unit installed here, then any still in use, then the newest
  const unitFor = (key) => {
    const list = unitsByKey[key] || []
    const rank = (u) =>
      u.getString('status') === 'installed' && u.getString('host') === H.id
        ? 0
        : u.getString('status') !== 'gone'
          ? 1
          : 2
    return list.slice().sort((a, b) => rank(a) - rank(b))[0] || null
  }
  const byMatchKey = {}
  for (const p of activeParts) {
    let keys = []
    try {
      keys = JSON.parse(p.getString('matchKeys') || '[]') || []
    } catch (_) {
      keys = []
    }
    for (const k of keys) if (!byMatchKey[k]) byMatchKey[k] = p
  }
  const byModel = {}
  for (const p of activeParts) {
    const k = partModelKey(p)
    if (k && !byModel[k]) byModel[k] = p
  }

  // 1. what each detected item is
  const entries = snapshot.items.map((item, i) => {
    const key = itemKey(item)
    const e = { i: i, item: item, key: key, serialKey: s.serialKey(item.serial), unit: null }
    if (e.serialKey) e.unit = unitFor(e.serialKey)
    if (e.unit) {
      e.part = state.partsById[e.unit.getString('part')]
      e.matchedBy = 'serial'
    } else if (byMatchKey[key]) {
      e.part = byMatchKey[key]
      e.matchedBy = 'learned'
    } else if (byModel[key]) {
      e.part = byModel[key]
      e.matchedBy = 'model'
    } else {
      e.part = null
      e.matchedBy = null
    }
    return e
  })

  const rows = []
  const add = (row) => {
    rows.push(row)
    return row
  }
  const base = (group, e, part) => ({
    group: group,
    kind: e ? e.item.kind : '',
    items: e ? [itemSummary(e.item, e.i)] : [],
    key: e ? e.key : '',
    quantity: 1,
    partId: part ? part.id : '',
    partName: part ? part.getString('name') : '',
    matchedBy: e ? e.matchedBy : null,
    unitIds: [],
    serials: e && e.item.serial ? [e.item.serial] : [],
    noSerial: !!e && !e.item.serial,
  })
  const ignore = (e, reason) => {
    const r = add(base('ignored', e, e.part))
    r.reason = reason
    r.options = ['none']
    r.action = 'none'
    r.checked = false
  }

  // 2. serial matches that settle the row by themselves
  const free = {} // partId -> entries still to count against the host
  const freeNew = [] // entries with no part
  for (const e of entries) {
    if (e.part && e.part.getBool('archived')) {
      ignore(e, `${e.part.getString('name')} is archived`)
      continue
    }
    const u = e.unit
    const status = u ? u.getString('status') : ''
    if (u && status === 'installed' && u.getString('host') === H.id) {
      const r = add(base('unchanged', e, e.part))
      r.unitIds = [u.id]
      r.options = ['none']
      r.action = 'none'
      r.checked = true
      e.done = true
      continue
    }
    if (u && status === 'installed') {
      const from = state.hostsById[u.getString('host')]
      const r = add(base('moved', e, e.part))
      r.unitIds = [u.id]
      r.fromHost = from ? from.id : ''
      r.fromHostLabel = from ? from.getString('label') : ''
      r.options = ['move', 'ignore']
      r.action = 'move'
      r.checked = !!from && !from.getBool('retired')
      e.done = true
      continue
    }
    if (e.part) (free[e.part.id] = free[e.part.id] || []).push(e)
    else freeNew.push(e)
  }

  // 3. per part: count what's left against what's recorded at this host
  const partIds = Object.keys(free)
  for (const p of activeParts) {
    const here = (s.readMap(p, 'installed')[H.id] || 0) > 0
    if (here && partIds.indexOf(p.id) < 0) partIds.push(p.id)
  }
  const missingUnitRows = []
  const newRows = []
  const unexplained = {} // partId -> items recorded at this host that nothing detected matched
  for (const pid of partIds) {
    const part = state.partsById[pid]
    if (!part || part.getBool('archived')) continue
    const installedQty = s.readMap(part, 'installed')[H.id] || 0
    const unitsHere = state.units.filter(
      (u) =>
        u.getString('part') === pid &&
        u.getString('status') === 'installed' &&
        u.getString('host') === H.id,
    )
    const seen = {}
    for (const e of entries) if (e.unit) seen[e.unit.id] = true
    let slots = installedQty - unitsHere.length
    for (const e of free[pid] || []) {
      if (slots > 0) {
        slots--
        if (e.item.serial) {
          const r = add(base('adopt', e, part))
          r.unitIds = e.unit ? [e.unit.id] : []
          r.options = ['adopt', 'ignore']
          r.action = 'adopt'
          r.checked = true
        } else {
          const r = add(base('unchanged', e, part))
          r.options = ['none']
          r.action = 'none'
          r.checked = true
        }
        continue
      }
      const r = add(base('new', e, part))
      r.unitIds = e.unit ? [e.unit.id] : []
      const fromSpare =
        e.unit && e.unit.getString('status') === 'spare' ? e.unit.getString('location') : ''
      r.sources = installSources(state, part, 1)
      r.options = r.sources.length
        ? ['found_installed', 'install', 'ignore']
        : ['found_installed', 'ignore']
      r.action = fromSpare && r.sources.indexOf(fromSpare) >= 0 ? 'install' : 'found_installed'
      r.location = r.action === 'install' ? fromSpare : r.sources[0] || ''
      r.checked = checkedByDefault(e.item, sbc)
      newRows.push(r)
    }
    for (const u of unitsHere) {
      if (seen[u.id]) continue
      const r = add({
        group: 'missing',
        kind: u.getString('kind'),
        items: [],
        key: '',
        quantity: 1,
        partId: pid,
        partName: part.getString('name'),
        matchedBy: 'serial',
        unitIds: [u.id],
        serials: [u.getString('serial')],
        slot: u.getString('slot'),
        noSerial: false,
        options: ['uninstall', 'stock_out', 'ignore'],
        action: 'uninstall',
        location: state.site ? state.site.id : '',
        reason: 'retired',
        checked: true,
      })
      missingUnitRows.push(r)
    }
    if (slots > 0) {
      unexplained[pid] = slots
      add({
        group: 'missing',
        kind: (free[pid] && free[pid][0] && free[pid][0].item.kind) || '',
        items: [],
        key: '',
        quantity: slots,
        partId: pid,
        partName: part.getString('name'),
        matchedBy: null,
        unitIds: [],
        serials: [],
        noSerial: true,
        options: ['uninstall', 'stock_out', 'ignore'],
        action: 'ignore',
        location: state.site ? state.site.id : '',
        reason: 'retired',
        checked: false,
      })
    }
  }

  // 4. items with no part: a new part, with suggestions when unsure
  const newPartRows = {}
  for (const e of freeNew) {
    const name = suggestName(e.item)
    // parts recorded here that nothing detected accounts for come first: most
    // likely what this item is, recorded by hand under another name
    const suggestions = Object.keys(unexplained)
      .filter((pid) => {
        const k = partKind(state.partsById[pid], state)
        return (!k || k === e.item.kind) && !modelMismatch(state.partsById[pid], e.item)
      })
      .map((pid) => ({
        id: pid,
        name: state.partsById[pid].getString('name'),
        here: unexplained[pid],
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const sug of suggestParts(e.item, activeParts)) {
      if (!suggestions.some((x) => x.id === sug.id))
        suggestions.push(Object.assign({ here: 0 }, sug))
    }
    suggestions.splice(4)
    const nameTaken = activeParts.some((p) => p.getString('nameKey') === s.nameKey(name))
    const r = add(base('new', e, null))
    r.newPart = {
      name: name,
      category: categoryFor(e.item.kind, state),
      unit: 'pcs',
      manufacturer: collapse(e.item.vendor).slice(0, 60),
      model: collapse(e.item.model).slice(0, 60),
    }
    r.suggestions = suggestions
    r.nameTaken = nameTaken
    r.options = ['found_installed', 'ignore']
    r.action = 'found_installed'
    r.checked =
      checkedByDefault(e.item, sbc) &&
      suggestions.length === 0 &&
      !nameTaken &&
      !!r.newPart.category
    newRows.push(r)
    newPartRows[e.key] = newPartRows[e.key] || []
    newPartRows[e.key].push(r)
  }

  // 5. Replaced: a missing unit and a new serial of the same kind in the same slot
  for (const m of missingUnitRows) {
    if (!m.slot || !m.kind) continue
    const n = newRows.filter(
      (r) => !r.pair && r.kind === m.kind && r.serials.length === 1 && r.items[0].slot === m.slot,
    )[0]
    if (!n) continue
    m.group = 'replaced'
    n.group = 'replaced'
    m.role = 'out'
    n.role = 'in'
    m.pair = n
    n.pair = m
    n.checked = n.newPart ? !!n.newPart.category && !n.nameTaken : true
  }

  // 5b. Conflict: a part recorded here by hand (count only) and a detected
  // item of the same kind that names another model. Offered as keep or
  // replace; never adopted (spec §13.11.10)
  for (const m of rows) {
    if (m.group !== 'missing' || !m.noSerial || m.quantity < 1) continue
    const recorded = state.partsById[m.partId]
    const kind = partKind(recorded, state)
    if (CONFLICT_KINDS.indexOf(kind) < 0) continue
    for (const n of newRows) {
      if (m.quantity < 1) break
      if (n.pair || n.group !== 'new' || n.kind !== kind || n.partId === m.partId) continue
      if (!modelMismatch(recorded, snapshot.items[n.items[0].index])) continue
      n.group = 'conflict'
      n.recorded = { partId: recorded.id, name: recorded.getString('name') }
      n.options = ['keep', 'replace_uninstall', 'replace_stock_out']
      n.action = 'keep'
      n.location = state.site ? state.site.id : ''
      n.reason = 'retired'
      n.checked = true
      if (n.suggestions) n.suggestions = n.suggestions.filter((x) => x.id !== recorded.id)
      m.quantity -= 1
    }
  }

  // 6. one row per part (or new part) and group, unless a row stands for one unit
  const merged = []
  const byGroupKey = {}
  for (const r of rows) {
    if (r.group === 'missing' && r.quantity < 1) continue // all of it went into conflicts
    const mergeable =
      (r.group === 'unchanged' || r.group === 'new' || r.group === 'adopt') &&
      !r.pair &&
      !(r.group === 'new' && r.unitIds.length) // a known unit coming back stays its own row
    const gk = mergeable ? `${r.group}|${r.partId || 'new:' + r.key}` : ''
    if (gk && byGroupKey[gk]) {
      const t = byGroupKey[gk]
      t.quantity += r.quantity
      t.items = t.items.concat(r.items)
      t.serials = t.serials.concat(r.serials)
      t.unitIds = t.unitIds.concat(r.unitIds)
      t.noSerial = t.noSerial || r.noSerial
      t.checked = t.checked && r.checked
      if (t.sources) {
        t.sources = installSources(state, state.partsById[t.partId], t.quantity)
        if (t.sources.indexOf(t.location) < 0) t.location = t.sources[0] || ''
      }
      continue
    }
    if (gk) byGroupKey[gk] = r
    merged.push(r)
  }

  // stable ids in a fixed order, and pairs by id
  const order = ['missing', 'replaced', 'conflict', 'moved', 'new', 'adopt', 'unchanged', 'ignored']
  merged.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
  merged.forEach((r, i) => (r.id = `r${i + 1}`))
  for (const r of merged) {
    if (r.pair) r.pair = r.pair.id
    if (r.sources && r.action === 'install' && r.sources.indexOf(r.location) < 0) {
      r.action = 'found_installed'
    }
    if (r.group === 'new' && r.sources && !r.sources.length) {
      r.options = r.options.filter((o) => o !== 'install')
    }
    // declined on an earlier import: shown as ignored until checked again
    if ((r.group === 'new' || r.group === 'conflict') && !r.pair && r.items.length) {
      if (ignoreKeys(r).every((k) => state.ignored.indexOf(k) >= 0)) {
        r.declined = true
        r.checked = false
      }
    }
  }
  return merged
}

function previousImport(app, state) {
  const list = app.findRecordsByFilter(
    'imports',
    'user = {:uid} && host = {:host} && undone = false',
    '-created',
    1,
    0,
    { uid: state.uid, host: state.host.id },
  )
  return list[0] || null
}

function hostWarnings(app, state, snapshot) {
  const out = []
  const prev = previousImport(app, state)
  if (prev) {
    if (
      prev.getString('hostname') &&
      snapshot.host.hostname &&
      prev.getString('hostname') !== snapshot.host.hostname
    ) {
      out.push(
        `The last import for ${state.host.getString('label')} came from hostname ${prev.getString('hostname')}; this one is ${snapshot.host.hostname}`,
      )
    }
    if (
      prev.getString('machineIdHash') &&
      snapshot.host.machineIdHash &&
      prev.getString('machineIdHash') !== snapshot.host.machineIdHash
    ) {
      out.push(
        `This snapshot is from a different machine than the last import for ${state.host.getString('label')}`,
      )
    }
  }
  if (snapshot.host.machineIdHash) {
    const other = app.findRecordsByFilter(
      'imports',
      'user = {:uid} && host != {:host} && machineIdHash = {:mid} && undone = false',
      '-created',
      1,
      0,
      { uid: state.uid, host: state.host.id, mid: snapshot.host.machineIdHash },
    )[0]
    if (other) {
      const h = state.hostsById[other.getString('host')]
      out.push(`This machine was imported as ${h ? h.getString('label') : 'another host'} before`)
    }
  }
  return out
}

function preview(app, uid, body) {
  const snapshot = validateSnapshot(body.snapshot)
  const state = loadState(app, uid, body.host)
  const rows = compute(state, snapshot)
  const prev = previousImport(app, state)
  return {
    host: { id: state.host.id, label: state.host.getString('label') },
    snapshot: {
      collector: snapshot.collector,
      collectedAt: snapshot.collectedAt,
      hostname: snapshot.host.hostname,
      platform: snapshot.host.platform,
      model: snapshot.host.model,
      items: snapshot.items.length,
    },
    previous: prev
      ? { id: prev.id, created: prev.getString('created'), collector: prev.getString('collector') }
      : null,
    warnings: snapshot.warnings.concat(hostWarnings(app, state, snapshot)),
    skipped: snapshot.skipped,
    ignored: snapshot.ignored,
    rows: rows,
    previewHash: hashOf(rows, state),
  }
}

function hashOf(rows, state) {
  return $security.sha256(JSON.stringify(rows) + '#' + fingerprint(state))
}

// --- apply (spec §13.3.1 step 5) -----------------------------------------------------------

function apply(app, uid, body) {
  const snapshot = validateSnapshot(body.snapshot)
  const state = loadState(app, uid, body.host)
  const rows = compute(state, snapshot)
  if (body.previewHash !== hashOf(rows, state)) {
    s.fail('preview_stale', 'Your inventory changed since this preview; review it again')
  }
  const date = s.isBlank(body.date) ? s.utcDate(0) : body.date
  const seenDate = /^\d{4}-\d{2}-\d{2}/.test(snapshot.collectedAt)
    ? snapshot.collectedAt.slice(0, 10)
    : date
  const decisions = body.decisions && typeof body.decisions === 'object' ? body.decisions : {}
  const H = state.host

  const imp = new Record(app.findCollectionByNameOrId('imports'))
  imp.set('user', uid)
  imp.set('host', H.id)
  imp.set('collectedAt', snapshot.collectedAt)
  imp.set('collector', snapshot.collector)
  imp.set('hostname', snapshot.host.hostname)
  imp.set('machineIdHash', snapshot.host.machineIdHash)
  imp.set('snapshot', snapshot)
  app.save(imp)

  const movements = []
  const unitsBefore = {}
  const mappingsAdded = []
  const summary = {}
  let serialsLinked = 0 // units attached without a movement (adopt)
  const note = `Discovery: ${snapshot.host.hostname || H.getString('label')} ${seenDate}`.slice(
    0,
    500,
  )

  const remember = (unit) => {
    if (unit.id in unitsBefore) return
    unitsBefore[unit.id] = {
      host: unit.getString('host'),
      location: unit.getString('location'),
      status: unit.getString('status'),
      firstSeen: unit.getString('firstSeen'),
      lastSeen: unit.getString('lastSeen'),
      lastImport: unit.getString('lastImport'),
      slot: unit.getString('slot'),
      kind: unit.getString('kind'),
    }
  }
  const unitRecord = (id) => app.findRecordById('units', id)
  const seenNow = (unit, item) => {
    remember(unit)
    unit.set('lastSeen', seenDate)
    unit.set('lastImport', imp.id)
    if (item && item.slot) unit.set('slot', item.slot)
    if (item) unit.set('kind', item.kind)
    app.save(unit)
  }
  // a unit for a detected serial: the known one, or a new one (status gone
  // until a movement or an adopt places it)
  const unitForItem = (part, item) => {
    const key = s.serialKey(item.serial)
    const found = app.findRecordsByFilter(
      'units',
      'user = {:uid} && part = {:part} && serialKey = {:key}',
      '',
      1,
      0,
      { uid: uid, part: part.id, key: key },
    )[0]
    if (found) return found
    const u = new Record(app.findCollectionByNameOrId('units'))
    u.set('user', uid)
    u.set('part', part.id)
    u.set('serial', item.serial)
    u.set('serialKey', key)
    u.set('kind', item.kind)
    u.set('slot', item.slot || '')
    u.set('status', 'gone')
    u.set('firstSeen', seenDate)
    u.set('lastSeen', seenDate)
    u.set('lastImport', imp.id)
    app.save(u)
    unitsBefore[u.id] = null
    return u
  }
  const mv = (input, unitIds) => {
    const res = s.recordMovement(app, uid, Object.assign({ date: date, note: note }, input), {
      units: unitIds || [],
      importId: imp.id,
    })
    movements.push(res.movement.id)
    return res
  }
  const learn = (part, key) => {
    if (!key) return
    part = app.findRecordById('parts', part.id) // fresh: movements save it too
    let keys = []
    try {
      keys = JSON.parse(part.getString('matchKeys') || '[]') || []
    } catch (_) {
      keys = []
    }
    if (keys.indexOf(key) >= 0 || keys.length >= MAX_MATCH_KEYS) return
    keys.push(key)
    part.set('matchKeys', keys)
    app.save(part)
    mappingsAdded.push({ part: part.id, key: key })
  }
  const itemOf = (summaryItem) => snapshot.items[summaryItem.index]

  const createdParts = {}
  const partForRow = (row, d) => {
    if (row.partId) return state.partsById[row.partId]
    if (d.partId) {
      const chosen = s.findOwned(app, 'parts', d.partId, uid, 'Part')
      if (chosen.getBool('archived'))
        s.fail('part_archived', `${chosen.getString('name')} is archived`, { row: row.id })
      return chosen
    }
    if (createdParts[row.key]) return createdParts[row.key]
    const np = Object.assign(
      {},
      row.newPart,
      d.newPart && typeof d.newPart === 'object' ? d.newPart : {},
    )
    if (!np.category) s.fail('invalid_category', 'Pick a category', { row: row.id })
    let part
    try {
      part = s.createPart(app, uid, {
        name: np.name,
        category: np.category,
        unit: np.unit || 'pcs',
        manufacturer: row.newPart.manufacturer,
        model: row.newPart.model,
      })
    } catch (err) {
      // name it the row that failed, for the preview screen
      const t = String((err && err.message) || err)
      if (t.indexOf('[[stocky]]') >= 0 && t.indexOf('"row"') < 0) {
        throw new Error(t.replace('"data":{', `"data":{"row":"${row.id}",`))
      }
      throw err
    }
    createdParts[row.key] = part
    return part
  }

  const order = [
    'missing',
    'replaced:out',
    'conflict',
    'moved',
    'new',
    'replaced:in',
    'adopt',
    'unchanged',
  ]
  const rank = (r) => order.indexOf(r.group === 'replaced' ? `replaced:${r.role}` : r.group)
  const applied = rows
    .filter((r) => r.group !== 'ignored')
    .map((r) => ({
      row: r,
      d: decisions[r.id] && typeof decisions[r.id] === 'object' ? decisions[r.id] : null,
    }))
    .filter((x) => x.d && x.d.apply === true)
    .sort((a, b) => rank(a.row) - rank(b.row))

  for (const x of applied) {
    const row = x.row
    const d = x.d
    const action = s.isBlank(d.action) ? row.action : d.action
    if (row.options.indexOf(action) < 0) {
      s.fail('invalid_decision', `Row ${row.id} can't ${action}`, { row: row.id })
    }
    if (action === 'ignore') continue
    const qty = row.quantity

    if (row.group === 'unchanged') {
      for (const id of row.unitIds) {
        const unit = unitRecord(id)
        const it = row.items.filter((x) => s.serialKey(x.serial) === unit.getString('serialKey'))[0]
        seenNow(unit, it ? itemOf(it) : null)
      }
    } else if (row.group === 'adopt') {
      const part = state.partsById[row.partId]
      row.items.forEach((it) => {
        const item = itemOf(it)
        const unit = unitForItem(part, item)
        remember(unit)
        unit.set('status', 'installed')
        unit.set('host', H.id)
        unit.set('location', '')
        seenNow(unit, item)
        if (item.serial) serialsLinked++
      })
      checkUnitsAt(app, uid, part.id, H)
      learn(part, row.key)
    } else if (row.group === 'moved') {
      const part = state.partsById[row.partId]
      const from = s.findOwned(app, 'hosts', row.fromHost, uid, 'Host')
      const unit = unitRecord(row.unitIds[0])
      remember(unit)
      const fromSite = from.getString('site')
      mv(
        { type: 'uninstall', part: part.id, quantity: 1, fromHost: from.id, toLocation: fromSite },
        [unit.id],
      )
      // Stocky has no host-to-host type: out to the old site, over to this
      // host's site if it's another one, then in (spec §13.6)
      let via = fromSite
      const H_site = H.getString('site')
      if (fromSite !== H_site) {
        mv(
          { type: 'move', part: part.id, quantity: 1, fromLocation: fromSite, toLocation: H_site },
          [unit.id],
        )
        via = H_site
      }
      mv({ type: 'install', part: part.id, quantity: 1, fromLocation: via, toHost: H.id }, [
        unit.id,
      ])
      seenNow(unitRecord(unit.id), itemOf(row.items[0]))
      learn(part, row.key)
    } else if (row.group === 'missing' || (row.group === 'replaced' && row.role === 'out')) {
      const part = state.partsById[row.partId]
      for (const id of row.unitIds) remember(unitRecord(id))
      if (action === 'uninstall') {
        const to = d.location || row.location
        if (!to) s.fail('invalid_decision', 'Pick where it goes', { row: row.id })
        mv(
          { type: 'uninstall', part: part.id, quantity: qty, fromHost: H.id, toLocation: to },
          row.unitIds,
        )
      } else {
        const reason = d.reason || row.reason
        mv(
          { type: 'stock_out', part: part.id, quantity: qty, fromHost: H.id, reason: reason },
          row.unitIds,
        )
      }
    } else if (row.group === 'conflict') {
      if (action === 'keep') continue // remembered as declined below
      if (d.partId === row.recorded.partId) {
        s.fail('model_mismatch', `${row.recorded.name} is a different model`, { row: row.id })
      }
      const recorded = s.findOwned(app, 'parts', row.recorded.partId, uid, 'Part')
      if (action === 'replace_uninstall') {
        const to = d.location || row.location
        if (!to) s.fail('invalid_decision', 'Pick where it goes', { row: row.id })
        mv({ type: 'uninstall', part: recorded.id, quantity: qty, fromHost: H.id, toLocation: to })
      } else {
        const reason = d.reason || row.reason
        mv({ type: 'stock_out', part: recorded.id, quantity: qty, fromHost: H.id, reason: reason })
      }
      installDetected(row, d, 'found_installed')
    } else {
      // new, replaced (in): found installed, or installed from spares
      if (installDetected(row, d, action) === 'adopted') {
        summary.adopt = (summary.adopt || 0) + 1
        continue
      }
    }
    summary[row.group] = (summary[row.group] || 0) + 1
  }

  // a detected item put in (or linked to) this host: the part, its units,
  // the movement, what it learned. -> 'adopted' when it only linked serials
  function installDetected(row, d, action) {
    const qty = row.quantity
    const part = partForRow(row, d)
    // linked by "Is this …?" to a part already recorded here by hand: add
    // the serials to that record (like Serial added), never a second count,
    // and never across a model mismatch (spec §13.11.8, §13.11.10)
    if (!row.partId && d.partId && action === 'found_installed') {
      const fresh = app.findRecordById('parts', part.id)
      const room =
        (s.readMap(fresh, 'installed')[H.id] || 0) - s.unitsAt(app, uid, part.id, H, 'host').length
      if (room >= qty) {
        if (modelMismatch(fresh, itemOf(row.items[0]))) {
          s.fail(
            'model_mismatch',
            `${fresh.getString('name')} is recorded here as another model than this one`,
            { row: row.id },
          )
        }
        row.items.forEach((it) => {
          const item = itemOf(it)
          if (!item.serial) return
          const unit = unitForItem(part, item)
          remember(unit)
          unit.set('status', 'installed')
          unit.set('host', H.id)
          unit.set('location', '')
          seenNow(unit, item)
          serialsLinked++
        })
        checkUnitsAt(app, uid, part.id, H)
        learn(part, row.key)
        return 'adopted'
      }
    }
    const unitIds = []
    for (const id of row.unitIds) {
      remember(unitRecord(id))
      unitIds.push(id)
    }
    row.items.forEach((it) => {
      const item = itemOf(it)
      if (!item.serial) return
      const u = unitForItem(part, item)
      if (unitIds.indexOf(u.id) < 0) {
        remember(u)
        unitIds.push(u.id)
      }
    })
    if (action === 'install') {
      const from = d.location || row.location
      mv(
        { type: 'install', part: part.id, quantity: qty, fromLocation: from, toHost: H.id },
        unitIds,
      )
    } else {
      mv({ type: 'found_installed', part: part.id, quantity: qty, toHost: H.id }, unitIds)
    }
    row.items.forEach((it) => {
      const item = itemOf(it)
      if (!item.serial) return
      seenNow(unitForItem(part, item), item)
    })
    learn(part, row.key)
    return 'installed'
  }

  // remember what was declined here (left unchecked, ignored, or kept out
  // of a conflict); forget what was imported after all (spec §13.11.9)
  let ignoredList = state.ignored.slice()
  for (const r of rows) {
    if ((r.group !== 'new' && r.group !== 'conflict') || r.pair || !r.items.length) continue
    const d = decisions[r.id]
    const act = d && typeof d === 'object' && d.apply === true ? d.action || r.action : ''
    const keys = ignoreKeys(r)
    if (!act || act === 'ignore' || act === 'keep') {
      for (const k of keys) if (ignoredList.indexOf(k) < 0) ignoredList.push(k)
    } else {
      ignoredList = ignoredList.filter((k) => keys.indexOf(k) < 0)
    }
  }
  ignoredList = ignoredList.slice(-500)

  s.markReferenced(app, app.findRecordById('hosts', H.id))
  if (JSON.stringify(ignoredList) !== JSON.stringify(state.ignored)) {
    const hostRecord = app.findRecordById('hosts', H.id)
    hostRecord.set('discoveryIgnored', ignoredList)
    app.save(hostRecord)
    imp.set('ignoredBefore', state.ignored)
  }
  summary.serialsLinked = serialsLinked
  const user = app.findRecordById('users', uid)
  imp.set('movements', movements)
  imp.set('summary', summary)
  imp.set('unitsBefore', unitsBefore)
  imp.set('mappingsAdded', mappingsAdded)
  imp.set('lastMovementAfter', user.getString('lastMovementId'))
  app.save(imp)
  return { import: imp, movements: movements.length, summary: summary }
}

function checkUnitsAt(app, uid, partId, host) {
  const part = app.findRecordById('parts', partId)
  const have = s.readMap(part, 'installed')[host.id] || 0
  const count = s.unitsAt(app, uid, partId, host, 'host').length
  if (count > have) {
    s.fail(
      'units_inconsistent',
      `${count} units recorded at ${host.getString('label')}, only ${have} there`,
    )
  }
}

// --- undo an import (spec §13.4.4) ---------------------------------------------------------

function undoImport(app, uid, id, date) {
  const imp = s.findOwned(app, 'imports', id, uid, 'Import')
  if (imp.getBool('undone')) s.fail('already_undone', 'This import was already undone')
  const age = Date.now() / 1000 - imp.getDateTime('created').time().unix()
  if (age >= 24 * 60 * 60) s.fail('window_passed', 'The 24-hour undo window has passed')
  const later = app.findRecordsByFilter(
    'imports',
    'user = {:uid} && undone = false && created > {:created} && id != {:id}',
    '',
    1,
    0,
    { uid: uid, created: imp.getString('created'), id: imp.id },
  )
  const user = app.findRecordById('users', uid)
  if (later.length > 0 || user.getString('lastMovementId') !== imp.getString('lastMovementAfter')) {
    s.fail('not_newest', "Can't undo this import — something newer was recorded")
  }

  const ids = imp.getStringSlice('movements')
  for (let i = ids.length - 1; i >= 0; i--) {
    s.reverseMovement(app, uid, app.findRecordById('movements', ids[i]), date)
  }

  let before = {}
  try {
    before = JSON.parse(imp.getString('unitsBefore') || '{}') || {}
  } catch (_) {
    before = {}
  }
  for (const unitId of Object.keys(before)) {
    let unit
    try {
      unit = app.findRecordById('units', unitId)
    } catch (_) {
      continue
    }
    const b = before[unitId]
    if (b === null) {
      const used = app.findRecordsByFilter('movements', 'units ~ {:id}', '', 1, 0, { id: unitId })
      if (used.length === 0) {
        app.delete(unit)
        continue
      }
      unit.set('status', 'gone')
      unit.set('host', '')
      unit.set('location', '')
    } else {
      for (const k of Object.keys(b)) unit.set(k, b[k])
    }
    app.save(unit)
  }

  let mappings = []
  try {
    mappings = JSON.parse(imp.getString('mappingsAdded') || '[]') || []
  } catch (_) {
    mappings = []
  }
  for (const m of mappings) {
    let part
    try {
      part = app.findRecordById('parts', m.part)
    } catch (_) {
      continue
    }
    let keys = []
    try {
      keys = JSON.parse(part.getString('matchKeys') || '[]') || []
    } catch (_) {
      keys = []
    }
    part.set(
      'matchKeys',
      keys.filter((k) => k !== m.key),
    )
    app.save(part)
  }

  // the host's declined list as it was before this import
  const ignoredBefore = imp.getString('ignoredBefore')
  if (ignoredBefore && ignoredBefore !== 'null') {
    const hostRecord = app.findRecordById('hosts', imp.getString('host'))
    hostRecord.set('discoveryIgnored', JSON.parse(ignoredBefore))
    app.save(hostRecord)
  }

  imp.set('undone', true)
  app.save(imp)
  return { import: imp, reversed: ids.length }
}

module.exports = { validateSnapshot, suggestName, itemKey, preview, apply, undoImport }
