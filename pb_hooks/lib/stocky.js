/// <reference path="../../pb_data/types.d.ts" />

// Shared server logic for Stocky's routes and hooks (spec §5–§8).
// JSVM handlers run in isolated contexts, so each handler loads this file
// with require(`${__hooks}/lib/stocky.js`) instead of sharing top-level code.

const TYPES = ['stock_in', 'stock_out', 'move', 'install', 'uninstall', 'found_installed']
const REASONS = ['used', 'retired', 'discarded']
const CURRENCIES = ['TWD', 'EUR', 'USD']
const MAX_QTY = 9999
const MAX_PRICE_MINOR = 99999999
const MAX_NOTE = 500
const UNDO_WINDOW_SECONDS = 24 * 60 * 60

// which kinds of place each side of a movement may use (spec §4.7 table,
// §13.4.1–2: found_installed has no source; stock_out may leave a host)
const SHAPES = {
  stock_in: { from: [], to: ['location'] },
  stock_out: { from: ['location', 'host'], to: [] },
  move: { from: ['location'], to: ['location'] },
  install: { from: ['location'], to: ['host'] },
  uninstall: { from: ['host'], to: ['location'] },
  found_installed: { from: [], to: ['host'] },
}

// spec §7.4 and §13.4.2: stock_out from a host reverses to found_installed
function reversalType(type, fromHost) {
  if (type === 'stock_out') return fromHost ? 'found_installed' : 'stock_in'
  return {
    stock_in: 'stock_out',
    move: 'move',
    install: 'uninstall',
    uninstall: 'install',
    found_installed: 'stock_out',
  }[type]
}

// types that may create their part in the same transaction (§4.6, §13.4.1)
const NEW_PART_TYPES = ['stock_in', 'found_installed']

// --- errors ------------------------------------------------------------------

// A 400 with a machine-readable code; the client maps codes to the §4 messages.
// PocketBase rewrites plain values in an ApiError's data into generic
// "validation_invalid_value" entries (and recases the message), so fail()
// throws a marked Error instead and respond() turns it into the JSON reply.
// The marker is in the message because only the message reliably survives
// the trip out of runInTransaction.
const MARK_START = '[[stocky]]'
const MARK_END = '[[/stocky]]'

function fail(code, message, extra) {
  const payload = { code: code, message: message, data: Object.assign({ code: code }, extra || {}) }
  throw new Error(MARK_START + JSON.stringify(payload) + MARK_END)
}

// run fn (which may throw inside a transaction, rolling it back) and send any
// fail() as { status: 400, message, data: { code, ... } }; other errors pass through
function respond(e, fn) {
  try {
    return fn()
  } catch (err) {
    const text = String((err && err.message) || err)
    const i = text.indexOf(MARK_START)
    const j = text.indexOf(MARK_END, i)
    if (i < 0 || j < 0) throw err
    const p = JSON.parse(text.slice(i + MARK_START.length, j))
    return e.json(400, { status: 400, message: p.message, data: p.data })
  }
}

// --- small helpers -------------------------------------------------------------

function nameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function isBlank(v) {
  return v === undefined || v === null || v === ''
}

function utcDate(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10)
}

// YYYY-MM-DD, a real day, and not later than tomorrow in UTC (time zones
// run to UTC+14, so "today" on the phone can already be tomorrow in UTC)
function checkDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fail('invalid_date', 'Date must be YYYY-MM-DD')
  }
  const d = new Date(date + 'T00:00:00Z')
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
    fail('invalid_date', 'Date is not a real day')
  }
  if (date > utcDate(1)) {
    fail('future_date', "Date can't be in the future")
  }
}

function readMap(record, field) {
  const raw = record.getString(field)
  if (!raw) return {}
  const v = JSON.parse(raw)
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

function sumValues(map) {
  return Object.keys(map).reduce((total, k) => total + map[k], 0)
}

// store the maps without zero entries, plus the derived spareTotal
function writeStock(part, spare, installed) {
  const clean = (m) => {
    const out = {}
    for (const k of Object.keys(m)) {
      if (m[k] < 0) throw new Error(`negative quantity for ${k}`) // the invariant; never expected
      if (m[k] > 0) out[k] = m[k]
    }
    return out
  }
  const s = clean(spare)
  part.set('spare', s)
  part.set('installed', clean(installed))
  part.set('spareTotal', sumValues(s))
}

function findOwned(app, collection, id, uid, label) {
  let record = null
  try {
    record = app.findRecordById(collection, id)
  } catch (_) {
    record = null
  }
  if (!record || record.getString('user') !== uid) {
    fail('not_found', `${label} not found`)
  }
  return record
}

function markReferenced(app, record) {
  if (record && !record.getBool('referenced')) {
    record.set('referenced', true)
    app.save(record)
  }
}

// Run a request hook's work and its e.next() in one transaction: e.app is
// swapped for txApp so the default save/delete joins it (learned in step 1:
// without the swap, hook writes and the record write aren't atomic).
function inTransaction(e, fn) {
  e.app.runInTransaction((txApp) => {
    const originalApp = e.app
    e.app = txApp
    try {
      fn(txApp)
    } finally {
      e.app = originalApp
    }
  })
}

// --- parts -----------------------------------------------------------------------

// a category a part may use: yours (checked by the rule too) and not retired
function activeCategory(app, uid, categoryId) {
  const category = findOwned(app, 'categories', categoryId, uid, 'Category')
  if (category.getBool('retired')) {
    fail('retired', `${category.getString('label')} is retired`, { field: 'category' })
  }
  return category
}

// friendly duplicate check before the unique (user, nameKey) index fires
function checkDuplicateName(app, uid, key, exceptId) {
  const found = app.findRecordsByFilter(
    'parts',
    'user = {:uid} && nameKey = {:key} && id != {:except}',
    '',
    1,
    0,
    { uid: uid, key: key, except: exceptId || '' },
  )
  if (found.length > 0) {
    fail('duplicate_name', `You already have '${found[0].getString('name')}'`, {
      partId: found[0].id,
    })
  }
}

// set nameKey, run the duplicate and category checks; used by the parts
// hooks (records API) and by the movement route's newPart
function preparePart(app, uid, part, isNew) {
  const key = nameKey(part.getString('name'))
  part.set('name', String(part.getString('name')).trim())
  part.set('nameKey', key)
  if (key.length >= 2) checkDuplicateName(app, uid, key, isNew ? '' : part.id)

  const categoryChanged =
    isNew || part.getString('category') !== part.original().getString('category')
  return categoryChanged ? activeCategory(app, uid, part.getString('category')) : null
}

function createPart(app, uid, input) {
  if (!input || typeof input !== 'object') fail('invalid_part', 'newPart must be an object')
  const part = new Record(app.findCollectionByNameOrId('parts'))
  part.set('user', uid)
  for (const f of ['name', 'category', 'unit', 'manufacturer', 'model', 'notes']) {
    if (!isBlank(input[f])) part.set(f, input[f])
  }
  part.set('lowStockEnabled', input.lowStockEnabled === true)
  if (!isBlank(input.lowStockThreshold)) part.set('lowStockThreshold', input.lowStockThreshold)
  writeStock(part, {}, {})
  const category = preparePart(app, uid, part, true)
  app.save(part) // field validation: lengths, unit, threshold range
  markReferenced(app, category)
  return part
}

// --- movements ---------------------------------------------------------------------

function sideFields(input) {
  return {
    fromLocation: input.fromLocation || '',
    fromHost: input.fromHost || '',
    toLocation: input.toLocation || '',
    toHost: input.toHost || '',
  }
}

// Validate a movement against current state and apply it (spec §7.3, §8).
// Must run inside a transaction: app is the txApp.
function recordMovement(app, uid, input, opts) {
  const reversal = !!(opts && opts.reversal)
  const type = input.type
  if (TYPES.indexOf(type) < 0) fail('invalid_type', 'Unknown movement type')

  const qty = input.quantity
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    fail('invalid_quantity', `Quantity must be a whole number from 1 to ${MAX_QTY}`)
  }
  checkDate(input.date)
  const note = isBlank(input.note) ? '' : String(input.note)
  if (note.length > MAX_NOTE) fail('invalid_note', `Note can be up to ${MAX_NOTE} characters`)

  // shape: one place per side the type uses, of an allowed kind, nothing else
  const shape = SHAPES[type]
  const sides = sideFields(input)
  for (const side of ['from', 'to']) {
    const allowed = shape[side]
    const set = ['Location', 'Host'].filter((k) => !!sides[side + k])
    const field = set.length ? side + set[0] : side + (allowed[0] === 'host' ? 'Host' : 'Location')
    if (allowed.length === 0 && set.length > 0) {
      fail('invalid_shape', `${type} can't have ${field}`, { field: field })
    }
    if (allowed.length > 0 && set.length !== 1) {
      const want = allowed.map((k) => side + k.charAt(0).toUpperCase() + k.slice(1)).join(' or ')
      fail('invalid_shape', `${type} needs ${want}`, { field: field })
    }
    if (set.length === 1 && allowed.indexOf(set[0].toLowerCase()) < 0) {
      fail('invalid_shape', `${type} can't have ${field}`, { field: field })
    }
  }

  // reason: stock_out only, and not on a reversal
  const reason = isBlank(input.reason) ? '' : input.reason
  if (type === 'stock_out' && !reversal) {
    if (REASONS.indexOf(reason) < 0)
      fail('invalid_reason', 'Pick a reason: used, retired or discarded')
  } else if (reason) {
    fail('invalid_reason', 'Only a stock out has a reason')
  }

  // price: stock_in only; an empty currency means no price (spec §12 #18)
  const currency = isBlank(input.priceCurrency) ? '' : input.priceCurrency
  let priceMinor = 0
  if (currency) {
    if (type !== 'stock_in' || reversal) fail('invalid_price', 'Only a stock in has a price')
    if (CURRENCIES.indexOf(currency) < 0) fail('invalid_price', 'Currency must be TWD, EUR or USD')
    priceMinor = input.priceMinor
    if (!Number.isInteger(priceMinor) || priceMinor < 0 || priceMinor > MAX_PRICE_MINOR) {
      fail('invalid_price', 'Price must be a whole number in the minor unit')
    }
  }

  const user = app.findRecordById('users', uid)

  // the part: existing, or created here (§4.6 "Initial stock")
  let part
  // which units this concerns: set by discovery only (spec §13.4.3), never by Record
  if (!isBlank(input.units)) fail('invalid_units', "Units can't be chosen here")

  if (!isBlank(input.newPart)) {
    if (!isBlank(input.part)) fail('invalid_part', 'Send part or newPart, not both')
    if (NEW_PART_TYPES.indexOf(type) < 0) {
      fail('invalid_part', 'A new part can only start with a stock in or found installed')
    }
    part = createPart(app, uid, input.newPart)
  } else {
    if (isBlank(input.part)) fail('invalid_part', 'Pick a part', { field: 'part' })
    part = findOwned(app, 'parts', input.part, uid, 'Part')
    if (part.getBool('archived') && !reversal) {
      fail('part_archived', `${part.getString('name')} is archived; unarchive it first`)
    }
  }

  // the places, all yours, active unless this is a reversal
  const places = {}
  for (const f of Object.keys(sides)) {
    if (!sides[f]) continue
    const collection = f.endsWith('Host') ? 'hosts' : 'locations'
    const record = findOwned(
      app,
      collection,
      sides[f],
      uid,
      collection === 'hosts' ? 'Host' : 'Location',
    )
    if (record.getBool('retired') && !reversal) {
      fail('retired', `${record.getString('label')} is retired`, { field: f })
    }
    places[f] = record
  }
  if (type === 'move' && sides.fromLocation === sides.toLocation) {
    fail('same_location', 'From and to must be different locations')
  }
  if (type === 'install' && !reversal) {
    const from = places.fromLocation
    const host = places.toHost
    if (from.id !== host.getString('site') && from.getString('kind') !== 'transit') {
      fail(
        'install_source',
        `Install into ${host.getString('label')} only from its own site or In transit`,
      )
    }
  }

  // stock, read fresh inside the transaction
  const spare = readMap(part, 'spare')
  const installed = readMap(part, 'installed')
  const unit = part.getString('unit')
  const take = (map, place) => {
    const have = map[place.id] || 0
    if (have < qty) {
      // "1 pc" / "2 pcs": same display rule as src/lib/format.js (spec §4)
      const label = { pcs: ['pc', 'pcs'], sheets: ['sheet', 'sheets'], m: ['m', 'm'] }[unit]
      const shown = label ? label[have === 1 ? 0 : 1] : unit
      fail('insufficient_stock', `Only ${have} ${shown} available at ${place.getString('label')}`, {
        available: have,
      })
    }
    map[place.id] = have - qty
  }
  const give = (map, place) => {
    map[place.id] = (map[place.id] || 0) + qty
  }
  if (places.fromLocation) take(spare, places.fromLocation)
  if (places.fromHost) take(installed, places.fromHost)
  if (places.toLocation) give(spare, places.toLocation)
  if (places.toHost) give(installed, places.toHost)

  const unitList = unitsForMovement(app, uid, part, places, qty, spare, installed, opts)

  const movement = new Record(app.findCollectionByNameOrId('movements'))
  movement.set('user', uid)
  movement.set('part', part.id)
  movement.set('type', type)
  movement.set('quantity', qty)
  for (const f of Object.keys(sides)) movement.set(f, sides[f])
  movement.set('reason', reason)
  movement.set('priceMinor', priceMinor)
  movement.set('priceCurrency', currency)
  movement.set('date', input.date)
  movement.set('note', note)
  movement.set('reverses', (opts && opts.reverses) || '')
  movement.set(
    'units',
    unitList.map((u) => u.id),
  )
  movement.set('import', (opts && opts.importId) || '')
  app.save(movement)

  writeStock(part, spare, installed)
  app.save(part)

  moveUnits(app, unitList, places, opts)
  checkUnits(app, uid, part, places, spare, installed)

  for (const f of Object.keys(places)) markReferenced(app, places[f])

  user.set('lastMovementId', movement.id)
  app.save(user)

  return { movement: movement, part: part }
}

// Undo the account's newest movement within 24 h (spec §7.4).
function undoMovement(app, uid, id, date) {
  const original = findOwned(app, 'movements', id, uid, 'Movement')
  if (original.getString('import')) {
    fail('import_movement', 'This movement is part of an import; use Undo import')
  }

  const undoneBy = app.findRecordsByFilter('movements', 'reverses = {:id}', '', 1, 0, { id: id })
  if (undoneBy.length > 0) fail('already_undone', 'This movement was already undone')
  if (original.getString('reverses')) fail('is_reversal', "An undo can't be undone")

  const user = app.findRecordById('users', uid)
  if (user.getString('lastMovementId') !== id) {
    fail('not_newest', "Can't undo — a newer movement was recorded")
  }

  const age = Date.now() / 1000 - original.getDateTime('created').time().unix()
  if (age >= UNDO_WINDOW_SECONDS) fail('window_passed', 'The 24-hour undo window has passed')

  return reverseMovement(app, uid, original, date)
}

// write the reversal of a movement (spec §7.4, §13.4.2): the same quantity
// back, sides swapped, and the same units back with it
function reverseMovement(app, uid, original, date) {
  const s = sideFields({
    fromLocation: original.getString('fromLocation'),
    fromHost: original.getString('fromHost'),
    toLocation: original.getString('toLocation'),
    toHost: original.getString('toHost'),
  })
  const reversed = {
    part: original.getString('part'),
    type: reversalType(original.getString('type'), !!s.fromHost),
    quantity: original.getInt('quantity'),
    fromLocation: s.toLocation,
    fromHost: s.toHost,
    toLocation: s.fromLocation,
    toHost: s.fromHost,
    date: isBlank(date) ? utcDate(0) : date,
    note: `Undo of ${original.getString('date')} ${original.getString('type')}`,
  }
  return recordMovement(app, uid, reversed, {
    reversal: true,
    reverses: original.id,
    units: original.getStringSlice('units'),
  })
}

// --- units (spec §13.4.3) -------------------------------------------------------------

// serials compare upper-cased without spaces and dashes
function serialKey(serial) {
  return String(serial || '')
    .toUpperCase()
    .replace(/[\s-]+/g, '')
}

// a part's units recorded at a host (installed) or a location (spare),
// least recently seen first
function unitsAt(app, uid, partId, place, kind) {
  const filter =
    kind === 'host'
      ? "user = {:uid} && part = {:part} && status = 'installed' && host = {:place}"
      : "user = {:uid} && part = {:part} && status = 'spare' && location = {:place}"
  return app.findRecordsByFilter('units', filter, 'lastSeen,serialKey', 0, 0, {
    uid: uid,
    part: partId,
    place: place.id,
  })
}

function unitIsAt(unit, place, kind) {
  return kind === 'host'
    ? unit.getString('status') === 'installed' && unit.getString('host') === place.id
    : unit.getString('status') === 'spare' && unit.getString('location') === place.id
}

// The units a movement carries: the ones discovery names (opts.units), plus,
// when the source would be left with fewer items than units recorded there,
// the excess (least recently seen first), so units never outnumber the
// quantity at a place. spare/installed are the maps after the movement.
function unitsForMovement(app, uid, part, places, qty, spare, installed, opts) {
  const ids = (opts && opts.units) || []
  const list = []
  const seen = {}
  for (const id of ids) {
    if (seen[id]) continue
    seen[id] = true
    const unit = findOwned(app, 'units', id, uid, 'Unit')
    if (unit.getString('part') !== part.id) fail('invalid_units', 'A unit belongs to another part')
    list.push(unit)
  }
  if (list.length > qty) fail('invalid_units', 'More units than the quantity')

  const source = places.fromHost
    ? { place: places.fromHost, kind: 'host', left: installed[places.fromHost.id] || 0 }
    : places.fromLocation
      ? { place: places.fromLocation, kind: 'location', left: spare[places.fromLocation.id] || 0 }
      : null
  for (const unit of list) {
    if (
      source ? !unitIsAt(unit, source.place, source.kind) : unit.getString('status') === 'installed'
    ) {
      fail('invalid_units', `Unit ${unit.getString('serial')} isn't where this movement starts`)
    }
  }
  if (source) {
    const staying = unitsAt(app, uid, part.id, source.place, source.kind).filter((u) => !seen[u.id])
    const excess = staying.length - source.left
    for (let i = 0; i < excess; i++) list.push(staying[i])
  }
  return list
}

// units follow the movement to its destination: installed in a host, spare
// at a location, or gone when it has none
function moveUnits(app, list, places) {
  for (const unit of list) {
    if (places.toHost) {
      unit.set('status', 'installed')
      unit.set('host', places.toHost.id)
      unit.set('location', '')
    } else if (places.toLocation) {
      unit.set('status', 'spare')
      unit.set('host', '')
      unit.set('location', places.toLocation.id)
    } else {
      unit.set('status', 'gone')
      unit.set('host', '')
      unit.set('location', '')
    }
    app.save(unit)
  }
}

// the consistency rule (spec §13.4.3): at each place a movement touched,
// a part's units never outnumber its quantity there
function checkUnits(app, uid, part, places, spare, installed) {
  for (const f of Object.keys(places)) {
    const place = places[f]
    const kind = f.endsWith('Host') ? 'host' : 'location'
    const have = (kind === 'host' ? installed : spare)[place.id] || 0
    const count = unitsAt(app, uid, part.id, place, kind).length
    if (count > have) {
      fail(
        'units_inconsistent',
        `${count} units recorded at ${place.getString('label')}, only ${have} there`,
      )
    }
  }
}

// --- recalculate (spec §7.6) ---------------------------------------------------------

// replay a part's movements in date, then created order
function replay(app, uid, partId) {
  const movements = app.findRecordsByFilter(
    'movements',
    'user = {:uid} && part = {:part}',
    'date,created',
    0,
    0,
    { uid: uid, part: partId },
  )
  const spare = {}
  const installed = {}
  const add = (map, id, n) => {
    if (id) map[id] = (map[id] || 0) + n
  }
  // A dip below zero partway through is normal with back-dating (validation
  // uses current totals, spec §7.6); only negative final totals mean trouble.
  let dipped = false
  for (const m of movements) {
    const q = m.getInt('quantity')
    add(spare, m.getString('fromLocation'), -q)
    add(installed, m.getString('fromHost'), -q)
    add(spare, m.getString('toLocation'), q)
    add(installed, m.getString('toHost'), q)
    for (const map of [spare, installed]) {
      for (const k of Object.keys(map)) if (map[k] < 0) dipped = true
    }
  }
  const nonZero = (m) => {
    const out = {}
    for (const k of Object.keys(m).sort()) if (m[k] !== 0) out[k] = m[k]
    return out
  }
  const finalNegative = [spare, installed].some((map) => Object.keys(map).some((k) => map[k] < 0))
  return {
    spare: nonZero(spare),
    installed: nonZero(installed),
    dipped: dipped,
    finalNegative: finalNegative,
    count: movements.length,
  }
}

function sortedJson(map) {
  const out = {}
  for (const k of Object.keys(map).sort()) if (map[k] !== 0) out[k] = map[k]
  return JSON.stringify(out)
}

function recalculate(app, uid, partId, fix) {
  const part = findOwned(app, 'parts', partId, uid, 'Part')
  const computed = replay(app, uid, partId)
  const stored = { spare: readMap(part, 'spare'), installed: readMap(part, 'installed') }
  const matches =
    sortedJson(stored.spare) === sortedJson(computed.spare) &&
    sortedJson(stored.installed) === sortedJson(computed.installed) &&
    part.getInt('spareTotal') === sumValues(stored.spare)

  let fixed = false
  if (fix && !matches) {
    if (computed.finalNegative) {
      fail('replay_negative', 'Replaying the history ends below zero; fix it by hand')
    }
    writeStock(part, computed.spare, computed.installed)
    app.save(part)
    fixed = true
  }
  return {
    matches: matches,
    fixed: fixed,
    movements: computed.count,
    stored: stored,
    computed: { spare: computed.spare, installed: computed.installed },
    dippedBelowZero: computed.dipped,
  }
}

// --- seed (spec §5.4) --------------------------------------------------------------------

// Seed the account's preset once (decision #20). The preset is read here and
// nowhere else, so setting seedPreset after the first login has no effect.
function seed(app, uid) {
  const user = app.findRecordById('users', uid)
  if (user.getInt('seedVersion') >= 1) return { seeded: false }

  const loaded = require(`${__hooks}/lib/presets.js`).load(app)
  const presetName = user.getString('seedPreset') || 'standard'
  const SEED = loaded.presets[presetName]
  if (!SEED) {
    // set before the file changed: say why, and seed nothing
    fail(
      'unknown_preset',
      `Unknown seed preset "${presetName}"${loaded.error ? `: ${loaded.error}` : ''}`,
    )
  }

  const create = (collectionName, fields) => {
    const record = new Record(app.findCollectionByNameOrId(collectionName))
    record.set('user', uid)
    for (const k of Object.keys(fields)) record.set(k, fields[k])
    app.save(record)
    return record
  }

  // a site starts referenced exactly when the preset gives it hosts (spec §5.4)
  const sitesWithHosts = new Set(SEED.hosts.map((h) => h.site))
  const siteIds = {}
  SEED.locations.forEach((l, i) => {
    const record = create(
      'locations',
      Object.assign({ sortOrder: i, referenced: sitesWithHosts.has(l.key) }, l),
    )
    siteIds[l.key] = record.id
  })
  SEED.hosts.forEach((h, i) => {
    create('hosts', {
      key: h.key,
      label: h.label,
      type: h.type,
      site: siteIds[h.site],
      sortOrder: i,
    })
  })
  SEED.categories.forEach((c, i) => {
    create('categories', Object.assign({ sortOrder: i }, c))
  })

  user.set('seedVersion', 1)
  app.save(user)
  return { seeded: true, preset: presetName }
}

// --- reference-list guards (spec §4.10, §6.5) ------------------------------------------------

// parts holding stock at a location (spare) or host (installed)
function partsHolding(app, uid, field, placeId) {
  const parts = app.findRecordsByFilter('parts', 'user = {:uid}', '', 0, 0, { uid: uid })
  return parts.filter((p) => (readMap(p, field)[placeId] || 0) > 0)
}

function guardLocationRetire(app, location) {
  const uid = location.getString('user')
  const label = location.getString('label')
  const holding = partsHolding(app, uid, 'spare', location.id)
  if (holding.length > 0) {
    fail(
      'in_use',
      `Can't retire ${label} — ${holding.length} part${holding.length === 1 ? ' still has' : 's still have'} spare stock there. Move or stock them out first.`,
      { parts: holding.length },
    )
  }
  const hosts = app.findRecordsByFilter(
    'hosts',
    'site = {:id} && retired = false',
    'sortOrder',
    0,
    0,
    {
      id: location.id,
    },
  )
  if (hosts.length > 0) {
    const names = hosts
      .slice(0, 3)
      .map((h) => h.getString('label'))
      .join(', ')
    fail('has_hosts', `Retire or move ${names}${hosts.length > 3 ? '…' : ''} first`, {
      hosts: hosts.length,
    })
  }
}

function guardHostRetire(app, host) {
  const holding = partsHolding(app, host.getString('user'), 'installed', host.id)
  if (holding.length > 0) {
    fail(
      'in_use',
      `Can't retire ${host.getString('label')} — ${holding.length} part${holding.length === 1 ? ' is' : 's are'} installed in it. Uninstall them first.`,
      { parts: holding.length },
    )
  }
}

// the stock-map scan behind the referenced = false delete rule (spec §6.5)
function guardDelete(app, record, field) {
  const holding = partsHolding(app, record.getString('user'), field, record.id)
  if (holding.length > 0) {
    fail('in_use', `${record.getString('label')} still holds stock and can't be deleted`, {
      parts: holding.length,
    })
  }
}

// a host's site: yours (checked by the rule too), a site, and not retired
function activeSite(app, host) {
  const site = findOwned(app, 'locations', host.getString('site'), host.getString('user'), 'Site')
  if (site.getString('kind') !== 'site')
    fail('invalid_site', 'A host belongs to a site', { field: 'site' })
  if (site.getBool('retired'))
    fail('retired', `${site.getString('label')} is retired`, { field: 'site' })
  return site
}

// users.seedPreset must name a preset that exists now: built in, or in
// <pb_data>/stocky-presets.json (decision #27). Checked when it's set or
// changed through the records API (the superuser in the dashboard).
function checkSeedPreset(app, user) {
  const name = user.getString('seedPreset')
  if (!name || (!user.isNew() && name === user.original().getString('seedPreset'))) return
  const loaded = require(`${__hooks}/lib/presets.js`).load(app)
  if (!loaded.presets[name]) {
    fail(
      'unknown_preset',
      `Unknown seed preset "${name}". Available: ${Object.keys(loaded.presets).join(', ')}` +
        (loaded.error ? ` (${loaded.error})` : ''),
      { field: 'seedPreset' },
    )
  }
}

function becameRetired(record) {
  return record.getBool('retired') && !record.original().getBool('retired')
}

module.exports = {
  TYPES,
  fail,
  respond,
  nameKey,
  isBlank,
  utcDate,
  readMap,
  createPart,
  reverseMovement,
  serialKey,
  unitsAt,
  inTransaction,
  markReferenced,
  activeCategory,
  preparePart,
  writeStock,
  recordMovement,
  undoMovement,
  recalculate,
  seed,
  guardLocationRetire,
  guardHostRetire,
  guardDelete,
  activeSite,
  becameRetired,
  checkSeedPreset,
  findOwned,
}
