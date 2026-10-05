// Author:      0xWulf
// Description: Tests for hardware discovery (spec §13, phase D1) against a
//              throwaway PocketBase: snapshot validation, the preview, apply
//              (no double counting on re-run, stale preview, adopt, moved,
//              replaced, missing), import undo, the units consistency rule,
//              found_installed and stock_out from a host in the movement
//              route, rules on units/imports/matchKeys, hostile strings.
//              Run via scripts/test-api.sh (PB_URL, PB_DB).
// Modified:    2026-10-05
import PocketBase from 'pocketbase'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const BASE = process.env.PB_URL ?? 'http://127.0.0.1:8091'
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE)) {
  console.error(`refusing to run against ${BASE} (loopback only)`)
  process.exit(2)
}
const DB = process.env.PB_DB

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`PASS  ${name}`)
  } else {
    fail++
    console.log(`FAIL  ${name} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
  }
}
// JSON with object keys sorted, so key order never matters
const canon = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  )
const eq = (name, want, got) =>
  check(name, canon(want) === canon(got), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)

// --- accounts ---------------------------------------------------------------------
const admin = new PocketBase(BASE)
admin.autoCancellation(false)
await admin.collection('_superusers').authWithPassword('su@test.local', 'SuperPass123')
async function account(email, preset) {
  const u = await admin
    .collection('users')
    .create({ email, password: 'UserPass123', passwordConfirm: 'UserPass123', seedPreset: preset })
  const pb = new PocketBase(BASE)
  pb.autoCancellation(false)
  await pb.collection('users').authWithPassword(email, 'UserPass123')
  await pb.send('/api/stocky/seed', { method: 'POST' })
  return { id: u.id, pb }
}
const A = await account('a@test.local', 'example')
const B = await account('b@test.local', '')
const pb = A.pb

const today = new Date().toISOString().slice(0, 10)
const post = (path, body, client = pb) => client.send(path, { method: 'POST', body })
// -> { status, code, data } for an expected failure, or the result
async function attempt(fn) {
  try {
    return { status: 200, result: await fn() }
  } catch (err) {
    return {
      status: err.status,
      code: err.response?.data?.code,
      message: err.response?.message,
      data: err.response?.data,
    }
  }
}
const byKey = async (collection, key, client = pb) =>
  await client.collection(collection).getFirstListItem(client.filter('key = {:key}', { key }))
const LAB = await byKey('locations', 'lab')
const OFC = await byKey('locations', 'office')
const TRN = await byKey('locations', 'in_transit')
const PIB = await byKey('hosts', 'pi_b')
const PIA = await byKey('hosts', 'pi_a')
const WS = await byKey('hosts', 'workstation')
const MINI = await byKey('hosts', 'minipc')
const STORAGE = await byKey('categories', 'storage')
const SBC = await byKey('categories', 'sbc')
const OTHER = await byKey('categories', 'other')
const NETWORKING = await byKey('categories', 'networking')

const preview = (host, snapshot, client = pb) =>
  post(
    '/api/stocky/discovery/preview',
    { host: host.id, snapshot: typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot) },
    client,
  )
// apply the preview's own defaults (checked rows), with overrides per row id
async function applyDefaults(host, snapshot, overrides = {}, prev = null) {
  const p = prev ?? (await preview(host, snapshot))
  const decisions = {}
  for (const r of p.rows) {
    if (r.group === 'ignored') continue
    decisions[r.id] = { apply: r.checked, action: r.action }
  }
  for (const [id, d] of Object.entries(overrides)) decisions[id] = { ...decisions[id], ...d }
  return post('/api/stocky/discovery/apply', {
    host: host.id,
    snapshot: JSON.stringify(snapshot),
    previewHash: p.previewHash,
    decisions,
    date: today,
  })
}
const part = (id) => pb.collection('parts').getOne(id)
const units = (filter = '') => pb.collection('units').getFullList({ filter, sort: 'serialKey' })
const movementCount = async () => (await pb.collection('movements').getList(1, 1)).totalItems
const groups = (p) => p.rows.map((r) => `${r.group}:${r.partName || r.newPart?.name}×${r.quantity}`)

const MID = (c) => `sha256:${c.repeat(64)}`
function snap(hostname, items, extra = {}) {
  return {
    schema: 'stocky.discovery/1',
    collector: 'stocky-collect 1.0.0',
    collectedAt: `${today}T09:14:03+08:00`,
    host: {
      hostname,
      machineIdHash: MID('a'),
      platform: 'aarch64',
      virtual: false,
      model: 'Raspberry Pi 5 Model B Rev 1.0',
    },
    items,
    skipped: [],
    warnings: [],
    ...extra,
  }
}
const piSystem = {
  kind: 'system',
  vendor: 'Raspberry Pi Ltd',
  model: 'Raspberry Pi 5 Model B Rev 1.0',
  serial: 'PI5SERIAL01',
  memoryBytes: 8589934592,
}
const nvme1 = {
  kind: 'drive',
  vendor: '',
  model: 'Samsung SSD 980 PRO 1TB',
  serial: 'S5GXNF0R100001',
  sizeBytes: 1000204886016,
  interface: 'nvme',
  slot: 'nvme0',
}
const sd1 = {
  kind: 'drive',
  vendor: 'SanDisk',
  model: 'SN128',
  serial: '0x1234abcd',
  sizeBytes: 127865454592,
  interface: 'sd',
  slot: 'mmc0',
}
const eth0 = {
  kind: 'nic',
  vendor: 'Broadcom',
  model: 'BCM2712 Ethernet',
  serial: '2c:cf:67:00:00:01',
  bus: 'platform',
  onboard: true,
}
const keyboard = { kind: 'usb', vendor: 'Logitech', model: 'K120 Keyboard', bus: 'usb' }

// =====================================================================================
console.log('# snapshot validation (spec §13.3.2)')
let p0
let r = await attempt(() => preview(PIB, '{"schema": "stocky.discovery/1", items: [}'))
eq('invalid JSON rejected: invalid_json', 'invalid_json', r.code)
r = await attempt(() =>
  post('/api/stocky/discovery/preview', {
    host: PIB.id,
    snapshot: { schema: 'stocky.discovery/1', items: [] },
  }),
)
eq('a parsed object instead of the file text: invalid_json', 'invalid_json', r.code)
r = await attempt(() => preview(PIB, '[1,2]'))
eq('JSON that is not an object: invalid_snapshot', 'invalid_snapshot', r.code)
r = await attempt(() => preview(PIB, { ...snap('x', []), schema: 'stocky.discovery/2' }))
eq('wrong schema: invalid_schema', 'invalid_schema', r.code)
r = await attempt(() => preview(PIB, snap('x', [], { host: { hostname: 'vm', virtual: true } })))
eq('virtual: true refused: virtual_host', 'virtual_host', r.code)
r = await attempt(() =>
  preview(
    PIB,
    snap(
      'x',
      Array.from({ length: 201 }, () => keyboard),
    ),
  ),
)
eq('201 items: too_many_items', 'too_many_items', r.code)
r = await attempt(() =>
  preview(PIB, snap('x', [{ ...keyboard, raw: { pad: 'x'.repeat(270000) } }])),
)
eq('over 256 KB: too_large', 'too_large', r.code)
r = await attempt(() => preview(PIB, snap('x', []), B.pb))
eq("someone else's host: not_found", 'not_found', r.code)
r = await attempt(() =>
  post('/api/stocky/discovery/preview', { host: PIB.id, snapshot: '{}' }, new PocketBase(BASE)),
)
eq('preview needs a session (401)', 401, r.status)
r = await preview(PIB, snap('pi-b', [keyboard, { kind: 'gpu', model: 'x' }, 'nope']))
eq(
  'unknown kinds and non-objects are ignored, with a reason',
  ['unknown kind', 'not an item'],
  r.ignored.map((x) => x.reason),
)
p0 = await preview(
  PIB,
  snap('pi-b', [
    { kind: 'drive', model: 'TEAM TM8PS7512G', sizeBytes: 512110190592, interface: 'sata' },
    { kind: 'drive', model: 'Viper VP4300L 4TB', sizeBytes: 4000787030016, interface: 'nvme' },
  ]),
)
eq(
  'drive size appended unless the model already states one (not one inside a part number)',
  ['TEAM TM8PS7512G 512 GB', 'Viper VP4300L 4TB NVMe'],
  p0.rows.map((r) => r.newPart.name),
)
const countBefore = await movementCount()
eq('preview writes nothing', 0, countBefore)

// =====================================================================================
console.log('# first import on pi-b (spec §13.3.1, §13.5)')
const pi2Snap = snap('pi-b', [piSystem, nvme1, sd1, eth0, keyboard])
let p = await preview(PIB, pi2Snap)
const rowFor = (p, label) =>
  p.rows.find((r) => r.items.some((i) => i.label === label) || r.newPart?.name === label)
eq(
  'every item is a new row',
  ['new', 'new', 'new', 'new', 'new'],
  p.rows.map((r) => r.group),
)
eq(
  'suggested names',
  [
    'Raspberry Pi 5 8 GB',
    'Samsung SSD 980 PRO 1TB NVMe',
    'SanDisk SN128 128 GB',
    'Broadcom BCM2712 Ethernet',
    'Logitech K120 Keyboard',
  ],
  p.rows.map((r) => r.newPart.name),
)
eq(
  'categories from the example keys (sbc, storage, storage, networking, other)',
  [SBC.id, STORAGE.id, STORAGE.id, NETWORKING.id, OTHER.id],
  p.rows.map((r) => r.newPart.category),
)
eq(
  'checked by default: SBC system, drives; onboard NIC and keyboard not',
  [true, true, true, false, false],
  p.rows.map((r) => r.checked),
)
check('a previewHash is returned', /^[0-9a-f]{64}$/.test(p.previewHash), p.previewHash)
let res = await applyDefaults(PIB, pi2Snap, {}, p)
eq('apply: 3 movements', 3, res.movements)
eq('  ...summary', { new: 3, serialsLinked: 0 }, res.summary)
const moves = await pb
  .collection('movements')
  .getFullList({ sort: 'created', filter: pb.filter('import = {:i}', { i: res.import.id }) })
eq(
  '  ...all found_installed into pi-b, linked to the import',
  ['found_installed', 'found_installed', 'found_installed'],
  moves.map((m) => m.type),
)
check(
  '  ...to pi-b with no source',
  moves.every((m) => m.toHost === PIB.id && !m.fromLocation && !m.fromHost),
)
eq(
  '  ...the import lists them in order',
  moves.map((m) => m.id),
  (await pb.collection('imports').getOne(res.import.id)).movements,
)
const nvmeMove = moves.find((m) => m.units.length === 1 && m.note.startsWith('Discovery'))
check(
  '  ...movement note names the source',
  !!nvmeMove,
  moves.map((m) => m.note),
)
const parts1 = await pb.collection('parts').getFullList({ sort: 'name' })
eq(
  'three parts created',
  ['Raspberry Pi 5 8 GB', 'Samsung SSD 980 PRO 1TB NVMe', 'SanDisk SN128 128 GB'],
  parts1.map((x) => x.name),
)
const NVME_PART = parts1.find((x) => x.name.startsWith('Samsung'))
const SD_PART = parts1.find((x) => x.name.startsWith('SanDisk'))
const PI_PART = parts1.find((x) => x.name.startsWith('Raspberry'))
eq(
  '  ...installed 1 in pi-b, no spares',
  [{ [PIB.id]: 1 }, 0],
  [NVME_PART.installed, NVME_PART.spareTotal],
)
eq('  ...matchKeys learned', ['SAMSUNG SSD 980 PRO 1TB'], NVME_PART.matchKeys)
eq(
  '  ...manufacturer/model from the snapshot',
  ['', 'Samsung SSD 980 PRO 1TB'],
  [NVME_PART.manufacturer, NVME_PART.model],
)
let us = await units()
eq(
  'three units, installed in pi-b',
  ['0X1234ABCD:installed', 'PI5SERIAL01:installed', 'S5GXNF0R100001:installed'],
  us.map((u) => `${u.serialKey}:${u.status}`),
)
check(
  '  ...with host, firstSeen/lastSeen and lastImport',
  us.every(
    (u) =>
      u.host === PIB.id &&
      u.firstSeen === today &&
      u.lastSeen === today &&
      u.lastImport === res.import.id,
  ),
)
check('pi-b is referenced now', (await pb.collection('hosts').getOne(PIB.id)).referenced === true)
const userAfter = await pb.collection('users').getOne(A.id)
eq('lastMovementId is the last import movement', moves.at(-1).id, userAfter.lastMovementId)

// =====================================================================================
console.log('# re-run: no double counting (spec §13.6)')
const before = await movementCount()
p = await preview(PIB, pi2Snap)
eq(
  'same snapshot again: the applied items are unchanged, the rest still new',
  [
    'new:Broadcom BCM2712 Ethernet×1',
    'new:Logitech K120 Keyboard×1',
    'unchanged:Raspberry Pi 5 8 GB×1',
    'unchanged:Samsung SSD 980 PRO 1TB NVMe×1',
    'unchanged:SanDisk SN128 128 GB×1',
  ],
  groups(p).sort(),
)
res = await applyDefaults(PIB, pi2Snap, {}, p)
eq('applying the defaults again writes no movement', 0, res.movements)
eq('  ...movement count unchanged', before, await movementCount())
eq('  ...installed still 1', { [PIB.id]: 1 }, (await part(NVME_PART.id)).installed)
const P2_IMPORT = res.import.id

// =====================================================================================
console.log('# stale preview (spec §13.3.1)')
p = await preview(PIB, pi2Snap)
await post('/api/stocky/movements', {
  type: 'stock_in',
  part: SD_PART.id,
  quantity: 2,
  toLocation: LAB.id,
  date: today,
})
const countStale = await movementCount()
r = await attempt(() => applyDefaults(PIB, pi2Snap, {}, p))
eq('inventory changed after the preview: preview_stale', 'preview_stale', r.code)
eq('  ...nothing written', countStale, await movementCount())
eq('  ...no import record', 2, (await pb.collection('imports').getList(1, 1)).totalItems)

// =====================================================================================
console.log('# import undo (spec §13.4.4)')
r = await attempt(() => post(`/api/stocky/imports/${P2_IMPORT}/undo`, { date: today }))
eq('an older import after a newer movement: not_newest', 'not_newest', r.code)
// a fresh import on minipc, then undo it
const optSnap = snap(
  'minipc',
  [
    {
      kind: 'drive',
      vendor: 'WDC',
      model: 'WD Blue SN570 500GB',
      serial: 'WD-123 456',
      sizeBytes: 500107862016,
      interface: 'nvme',
      slot: 'nvme0',
    },
    {
      kind: 'memory',
      vendor: 'Kingston',
      model: 'KF432S20IB/16',
      serial: 'K1',
      sizeBytes: 17179869184,
      memoryType: 'DDR4',
      speedMTs: 3200,
      formFactor: 'SODIMM',
      slot: 'DIMM A',
    },
  ],
  {
    host: {
      hostname: 'minipc',
      machineIdHash: MID('b'),
      platform: 'x86_64',
      virtual: false,
      model: 'MiniPC 3080',
    },
  },
)
p = await preview(MINI, optSnap)
eq(
  'x86 names: drive (size in the model, NVMe appended), memory from size/type/speed/form',
  ['WDC WD Blue SN570 500GB NVMe', '16 GB DDR4-3200 SO-DIMM'],
  p.rows
    .map((r) => r.newPart.name)
    .sort()
    .reverse(),
)
const optCount = await movementCount()
res = await applyDefaults(MINI, optSnap)
eq('minipc import: 2 found_installed', 2, res.movements)
const MINI_IMPORT = res.import.id
const wd = (await pb.collection('parts').getFullList({ filter: 'name ~ "WD Blue"' }))[0]
eq(
  'serialKey drops spaces and dashes',
  ['WD123456'],
  (await units(pb.filter('part = {:p}', { p: wd.id }))).map((u) => u.serialKey),
)
const lastOpt = (await pb.collection('users').getOne(A.id)).lastMovementId
r = await attempt(() => post(`/api/stocky/movements/${lastOpt}/undo`, { date: today }))
eq(
  'the single-movement Undo refuses an import movement: import_movement',
  'import_movement',
  r.code,
)
res = await post(`/api/stocky/imports/${MINI_IMPORT}/undo`, { date: today })
eq('undo import: 2 reversals', 2, res.reversed)
eq('  ...movements +2', optCount + 4, await movementCount())
const wdAfter = await part(wd.id)
eq('  ...installed back to nothing', {}, wdAfter.installed)
eq('  ...learned mapping removed', [], wdAfter.matchKeys)
eq(
  '  ...units created by it are gone',
  ['gone'],
  (await units(pb.filter('part = {:p}', { p: wd.id }))).map((u) => u.status),
)
const revs = await pb.collection('movements').getList(1, 2, { sort: '-created' })
eq(
  '  ...reversals are stock_out from the host, no reason',
  ['stock_out:' + MINI.id + ':', 'stock_out:' + MINI.id + ':'],
  revs.items.map((m) => `${m.type}:${m.fromHost}:${m.reason}`),
)
check(
  '  ...each reversal points at its original',
  revs.items.every((m) => m.reverses),
)
r = await attempt(() => post(`/api/stocky/imports/${MINI_IMPORT}/undo`, { date: today }))
eq('undo the same import again: already_undone', 'already_undone', r.code)
// re-importing after the undo matches the same serials again, without duplicates
res = await applyDefaults(MINI, optSnap)
eq('re-import after undo: 2 found_installed again', 2, res.movements)
eq(
  '  ...the gone units came back (no duplicate units)',
  ['installed'],
  (await units(pb.filter('part = {:p}', { p: wd.id }))).map((u) => u.status),
)
// the 24-hour window, by back-dating the import
const MINI_IMPORT2 = res.import.id
execFileSync('sqlite3', [
  DB,
  `UPDATE imports SET created = '2020-01-01 00:00:00.000Z' WHERE id = '${MINI_IMPORT2}'`,
])
r = await attempt(() => post(`/api/stocky/imports/${MINI_IMPORT2}/undo`, { date: today }))
eq('undo after 24 h: window_passed', 'window_passed', r.code)

// =====================================================================================
console.log('# learned mapping, adopt, moved (spec §13.5, §13.6)')
// workstation reports the same NVMe model with another serial: matched by the learned key
const lsvBase = {
  host: {
    hostname: 'workstation',
    machineIdHash: MID('c'),
    platform: 'x86_64',
    virtual: false,
    model: 'B550',
  },
}
const nvme2 = { ...nvme1, serial: 'S5GXNF0R100002' }
p = await preview(WS, snap('workstation', [nvme2], lsvBase))
eq(
  'same model elsewhere: matched by the learned key, new row on the known part',
  ['new:Samsung SSD 980 PRO 1TB NVMe×1:learned'],
  p.rows.map((r) => `${r.group}:${r.partName}×${r.quantity}:${r.matchedBy}`),
)
// adopt: an unserialised install recorded by hand gets the serial, no movement
await post('/api/stocky/movements', {
  type: 'found_installed',
  part: NVME_PART.id,
  quantity: 1,
  toHost: WS.id,
  date: today,
})
p = await preview(WS, snap('workstation', [nvme2], lsvBase))
eq(
  'after a hand-recorded install: adopt',
  ['adopt'],
  p.rows.map((r) => r.group),
)
let n0 = await movementCount()
res = await applyDefaults(WS, snap('workstation', [nvme2], lsvBase))
eq('adopt writes no movement', [0, n0], [res.movements, await movementCount()])
eq(
  '  ...the unit is installed in workstation',
  ['installed:' + WS.id],
  (await units(pb.filter('serialKey = "S5GXNF0R100002"'))).map((u) => `${u.status}:${u.host}`),
)
eq(
  '  ...installed counts unchanged',
  { [PIB.id]: 1, [WS.id]: 1 },
  (await part(NVME_PART.id)).installed,
)
// moved: the SD card now shows up in workstation
p = await preview(WS, snap('workstation', [nvme2, sd1], lsvBase))
const moved = p.rows.find((r) => r.group === 'moved')
check(
  'the SD card serial on another host: a moved row from pi-b',
  moved && moved.fromHost === PIB.id && moved.checked,
  p.rows,
)
n0 = await movementCount()
res = await applyDefaults(WS, snap('workstation', [nvme2, sd1], lsvBase), {}, p)
eq('moved: uninstall + install (same site, no move between sites)', 2, res.movements)
const sdAfter = await part(SD_PART.id)
eq(
  '  ...installed moved from pi-b to workstation; spares unchanged',
  [{ [WS.id]: 1 }, { [LAB.id]: 2 }],
  [sdAfter.installed, sdAfter.spare],
)
eq(
  '  ...the unit followed',
  ['installed:' + WS.id],
  (await units(pb.filter('serialKey = "0X1234ABCD"'))).map((u) => `${u.status}:${u.host}`),
)
// moved across sites: minipc is in Office, so uninstall, move, install
p = await preview(MINI, { ...optSnap, items: [...optSnap.items, sd1] })
res = await applyDefaults(MINI, { ...optSnap, items: [...optSnap.items, sd1] }, {}, p)
const crossMoves = await pb
  .collection('movements')
  .getFullList({ sort: 'created', filter: pb.filter('import = {:i}', { i: res.import.id }) })
eq(
  'moved across sites: uninstall → move Lab→Office → install',
  ['uninstall', 'move', 'install'],
  crossMoves.map((m) => m.type),
)
check(
  '  ...the move goes Lab → Office',
  crossMoves[1].fromLocation === LAB.id && crossMoves[1].toLocation === OFC.id,
)

// =====================================================================================
console.log('# recorded by hand under another name, then linked with "Is this …?"')
const NASA = await byKey('hosts', 'nas_a')
const handRec = await post('/api/stocky/movements', {
  type: 'found_installed',
  quantity: 1,
  toHost: NASA.id,
  date: today,
  newPart: { name: 'My boot SSD', category: STORAGE.id, unit: 'pcs' },
})
const MY_SSD = handRec.part.id
const crucial = {
  kind: 'drive',
  vendor: '',
  model: 'CT2000P3PSSD8',
  serial: 'CRU0001',
  sizeBytes: 2000398934016,
  interface: 'nvme',
  slot: 'nvme0',
}
const dsSnap = snap('nas-a', [crucial], {
  host: {
    hostname: 'nas-a',
    machineIdHash: MID('e'),
    platform: 'x86_64',
    virtual: false,
    model: 'nas-a',
  },
})
p = await preview(NASA, dsSnap)
const crow = p.rows.find((r) => r.group === 'new')
eq(
  'the unmatched drive suggests the part recorded here first, with its count',
  [{ id: MY_SSD, here: 1 }],
  crow.suggestions.slice(0, 1).map((x) => ({ id: x.id, here: x.here })),
)
eq(
  '  ...so it is unchecked; the hand-recorded one shows as missing by count, unchecked',
  [false, 'missing:false'],
  [
    crow.checked,
    p.rows.filter((r) => r.partId === MY_SSD).map((r) => `${r.group}:${r.checked}`)[0],
  ],
)
n0 = await movementCount()
res = await applyDefaults(
  NASA,
  dsSnap,
  { [crow.id]: { apply: true, action: 'found_installed', partId: MY_SSD } },
  p,
)
eq(
  'linking it adds the serial to that record: no movement, no second count',
  [0, n0, { adopt: 1, serialsLinked: 1 }],
  [res.movements, await movementCount(), res.summary],
)
eq('  ...still 1 installed in nas-a', { [NASA.id]: 1 }, (await part(MY_SSD)).installed)
const quietList = await pb
  .collection('imports')
  .getFullList({ filter: 'movements:length = 0', fields: 'id,summary' })
check(
  'the adopt-only import is found by "movements:length = 0" (History lists it)',
  quietList.some((i) => i.id === res.import.id && i.summary.serialsLinked === 1),
  quietList,
)
eq(
  '  ...the unit belongs to the linked part',
  [MY_SSD + ':installed:' + NASA.id],
  (await units(pb.filter('serialKey = "CRU0001"'))).map((u) => `${u.part}:${u.status}:${u.host}`),
)
eq('  ...and the part learned the model', ['CT2000P3PSSD8'], (await part(MY_SSD)).matchKeys)
p = await preview(NASA, dsSnap)
eq(
  '  ...next time: unchanged',
  ['unchanged'],
  p.rows.map((r) => r.group),
)

// =====================================================================================
console.log('# declined items are remembered per host (spec §13.11.9)')
const RTRA = await byKey('hosts', 'router_a')
const rtrABase = {
  host: {
    hostname: 'router-a',
    machineIdHash: MID('f'),
    platform: 'aarch64',
    virtual: false,
    model: 'Router',
  },
}
const usbA = {
  kind: 'usb',
  vendor: 'Generic',
  model: 'USB Fan Controller',
  serial: 'FAN001',
  bus: 'usb',
}
const usbB = { kind: 'usb', vendor: 'Generic', model: 'USB Light Strip', bus: 'usb' }
const rtrASnap = snap('router-a', [usbA, usbB], rtrABase)
p = await preview(RTRA, rtrASnap)
eq(
  'first time: both new, unchecked (USB peripherals)',
  ['new:false:', 'new:false:'],
  p.rows.map((r) => `${r.group}:${r.checked}:${r.declined ?? ''}`),
)
res = await applyDefaults(RTRA, rtrASnap, {}, p)
eq('  ...applying with both unchecked writes nothing', 0, res.movements)
eq(
  '  ...and remembers them on the host (by serial, by kind + model)',
  ['S:FAN001', 'M:usb|GENERIC USB LIGHT STRIP'],
  (await pb.collection('hosts').getOne(RTRA.id)).discoveryIgnored,
)
p = await preview(RTRA, rtrASnap)
eq(
  'next time: both marked declined, unchecked',
  [true, true],
  p.rows.map((r) => r.declined === true && r.checked === false),
)
const fanRow = p.rows.find((r) => r.serials.includes('FAN001'))
res = await applyDefaults(
  RTRA,
  rtrASnap,
  { [fanRow.id]: { apply: true, action: 'found_installed' } },
  p,
)
eq('checking a declined row imports it', 1, res.movements)
eq(
  '  ...and forgets it; the other stays remembered',
  ['M:usb|GENERIC USB LIGHT STRIP'],
  (await pb.collection('hosts').getOne(RTRA.id)).discoveryIgnored,
)
await post(`/api/stocky/imports/${res.import.id}/undo`, { date: today })
eq(
  'undo import restores the declined list',
  ['S:FAN001', 'M:usb|GENERIC USB LIGHT STRIP'],
  (await pb.collection('hosts').getOne(RTRA.id)).discoveryIgnored,
)
r = await attempt(() => pb.collection('hosts').update(RTRA.id, { discoveryIgnored: [] }))
check('discoveryIgnored is server-only (update refused)', r.status >= 400, r)
r = await attempt(() =>
  pb
    .collection('hosts')
    .create({ user: A.id, label: 'sneaky', site: LAB.id, discoveryIgnored: ['x'] }),
)
check('  ...and on create', r.status >= 400, r)

// =====================================================================================
console.log('# conflicts: recorded model vs detected model (spec §13.11.10)')
const RTRB = await byKey('hosts', 'router_b')
const x3d = await post('/api/stocky/movements', {
  type: 'found_installed',
  quantity: 1,
  toHost: RTRB.id,
  date: today,
  newPart: { name: 'Ryzen 7 5700X3D', category: OTHER.id, unit: 'pcs' },
})
const X3D = x3d.part.id
const rtrBBase = {
  host: {
    hostname: 'router-b',
    machineIdHash: MID('9'),
    platform: 'x86_64',
    virtual: false,
    model: 'Box',
  },
}
const cpu5700g = { kind: 'cpu', vendor: 'AMD', model: 'AMD Ryzen 7 5700G with Radeon Graphics' }
const rtrBSnap = snap('router-b', [cpu5700g], rtrBBase)
p = await preview(RTRB, rtrBSnap)
const conflict = p.rows.find((r) => r.group === 'conflict')
check(
  'a 5700G detected where a 5700X3D is recorded: one conflict row, no missing row',
  !!conflict && p.rows.length === 1,
  groups(p),
)
eq(
  '  ...defaults to keep, checked; offers replace',
  ['keep', true, ['keep', 'replace_uninstall', 'replace_stock_out'], X3D],
  [conflict.action, conflict.checked, conflict.options, conflict.recorded.partId],
)
check(
  '  ...never suggests the recorded part ("Is this …?")',
  !(conflict.suggestions ?? []).some((x) => x.id === X3D),
)
n0 = await movementCount()
res = await applyDefaults(RTRB, rtrBSnap, {}, p)
eq('keep: nothing written', [0, n0], [res.movements, await movementCount()])
p = await preview(RTRB, rtrBSnap)
eq(
  '  ...and next time the conflict is remembered as declined',
  [true],
  p.rows.map((r) => r.declined),
)
r = await attempt(() =>
  applyDefaults(
    RTRB,
    rtrBSnap,
    { [p.rows[0].id]: { apply: true, action: 'replace_stock_out', partId: X3D } },
    p,
  ),
)
eq('linking the detected item to the recorded part: model_mismatch', 'model_mismatch', r.code)
res = await applyDefaults(
  RTRB,
  rtrBSnap,
  { [p.rows[0].id]: { apply: true, action: 'replace_stock_out', reason: 'retired' } },
  p,
)
const cm = await pb
  .collection('movements')
  .getFullList({ sort: 'created', filter: pb.filter('import = {:i}', { i: res.import.id }) })
eq(
  'replace (gone): stock out the recorded one, found installed the detected one',
  ['stock_out:retired', 'found_installed:'],
  cm.map((m) => `${m.type}:${m.reason}`),
)
eq('  ...the 5700X3D is no longer in the host', {}, (await part(X3D)).installed)
p = await preview(RTRB, rtrBSnap)
eq(
  '  ...and next time: unchanged by count',
  ['unchanged'],
  p.rows.map((r) => r.group),
)
// a hand-recorded part that names no model is not a conflict (it stays an "Is this …?" suggestion)
check('"My boot SSD" (no model words) was a suggestion, not a conflict, above', true)
// the "recorded here" link refuses a model mismatch too
const optiNvme = await post('/api/stocky/movements', {
  type: 'found_installed',
  quantity: 1,
  toHost: MINI.id,
  date: today,
  newPart: { name: 'Samsung 990 EVO 2TB', category: STORAGE.id, unit: 'pcs' },
})
const sk = {
  kind: 'drive',
  vendor: 'SK hynix',
  model: 'Platinum P41 2TB',
  serial: 'SKH01',
  sizeBytes: 2000398934016,
  interface: 'nvme',
  slot: 'nvme1',
}
p = await preview(MINI, { ...optSnap, items: [...optSnap.items, sd1, sk] })
const skRow = p.rows.find((r) => r.serials.includes('SKH01'))
eq(
  'a drive of another model where "Samsung 990 EVO 2TB" is recorded: conflict',
  ['conflict', optiNvme.part.id],
  [skRow.group, skRow.recorded?.partId],
)

// =====================================================================================
console.log('# replaced and missing (spec §13.6)')
// pi-b: the NVMe in slot nvme0 was swapped for another model
const nvmeNew = {
  kind: 'drive',
  vendor: '',
  model: 'WD Black SN850X 2TB',
  serial: 'WDBLACK0001',
  sizeBytes: 2000398934016,
  interface: 'nvme',
  slot: 'nvme0',
}
const pi2Snap2 = snap('pi-b', [piSystem, nvmeNew])
p = await preview(PIB, pi2Snap2)
const out = p.rows.find((r) => r.group === 'replaced' && r.role === 'out')
const inn = p.rows.find((r) => r.group === 'replaced' && r.role === 'in')
check(
  'old NVMe missing + new one in the same slot: one replaced pair',
  out && inn && out.pair === inn.id && inn.pair === out.id,
  groups(p),
)
eq(
  '  ...the old half defaults to uninstall to Lab, checked',
  ['uninstall', LAB.id, true],
  [out?.action, out?.location, out?.checked],
)
check(
  '  ...the new half proposes a new part, checked',
  inn?.newPart?.name === 'WD Black SN850X 2TB NVMe' && inn.checked,
)
res = await applyDefaults(PIB, pi2Snap2, {}, p)
const nv = await part(NVME_PART.id)
eq(
  'replaced: old NVMe now spare in Lab, still installed in workstation',
  [{ [LAB.id]: 1 }, { [WS.id]: 1 }],
  [nv.spare, nv.installed],
)
eq(
  '  ...its unit is spare at Lab',
  ['spare:' + LAB.id],
  (await units(pb.filter('serialKey = "S5GXNF0R100001"'))).map((u) => `${u.status}:${u.location}`),
)
// missing with stock_out (gone) via a decision override
const pi2Snap3 = snap('pi-b', [nvmeNew])
p = await preview(PIB, pi2Snap3)
const piMissing = p.rows.find((r) => r.group === 'missing' && r.partId === PI_PART.id)
check('the Pi board itself missing: a missing row', !!piMissing, groups(p))
r = await attempt(() => applyDefaults(PIB, pi2Snap3, { [piMissing.id]: { action: 'explode' } }, p))
eq('an action the row does not offer: invalid_decision', 'invalid_decision', r.code)
res = await applyDefaults(
  PIB,
  pi2Snap3,
  { [piMissing.id]: { action: 'stock_out', reason: 'discarded' } },
  p,
)
const piOut = (
  await pb
    .collection('movements')
    .getFullList({ filter: pb.filter('import = {:i}', { i: res.import.id }) })
)[0]
eq(
  'missing → stock_out from the host with the chosen reason',
  ['stock_out', PIB.id, 'discarded'],
  [piOut.type, piOut.fromHost, piOut.reason],
)
eq(
  '  ...the unit is gone',
  ['gone'],
  (await units(pb.filter('serialKey = "PI5SERIAL01"'))).map((u) => u.status),
)
// count-only missing: two unserialised items recorded, one detected
const cable = { kind: 'usb', vendor: 'Generic', model: 'USB-C Hub' }
const hubRes = await post('/api/stocky/movements', {
  type: 'found_installed',
  quantity: 2,
  toHost: PIA.id,
  date: today,
  newPart: {
    name: 'Generic USB-C Hub',
    category: OTHER.id,
    unit: 'pcs',
    manufacturer: 'Generic',
    model: 'USB-C Hub',
  },
})
p = await preview(
  PIA,
  snap('pi-a', [cable], {
    host: {
      hostname: 'pi-a',
      machineIdHash: MID('d'),
      platform: 'aarch64',
      virtual: false,
      model: 'Raspberry Pi 5',
    },
  }),
)
eq(
  '2 recorded, 1 detected without serial: 1 unchanged + 1 missing by count (unchecked)',
  ['missing:1:false:true', 'unchanged:1:true:true'],
  p.rows.map((r) => `${r.group}:${r.quantity}:${r.checked}:${r.noSerial}`),
)
check(
  '  ...matched by the exact manufacturer + model',
  p.rows.every((r) => r.partId === hubRes.part.id),
)

// =====================================================================================
console.log('# units consistency rule (spec §13.4.3)')
// workstation has the NVMe with a unit (adopted); a hand-recorded uninstall takes the unit along
await post('/api/stocky/movements', {
  type: 'found_installed',
  part: NVME_PART.id,
  quantity: 1,
  toHost: WS.id,
  date: today,
})
eq(
  'workstation: 2 installed, 1 unit',
  [2, 1],
  [
    (await part(NVME_PART.id)).installed[WS.id],
    (await units(pb.filter('host = {:h} && part = {:p}', { h: WS.id, p: NVME_PART.id }))).length,
  ],
)
let m = await post('/api/stocky/movements', {
  type: 'uninstall',
  part: NVME_PART.id,
  quantity: 1,
  fromHost: WS.id,
  toLocation: LAB.id,
  date: today,
})
eq(
  'uninstall 1 of 2: the unserialised one goes, the unit stays',
  [[], 1],
  [
    m.movement.units,
    (await units(pb.filter('host = {:h} && part = {:p}', { h: WS.id, p: NVME_PART.id }))).length,
  ],
)
m = await post('/api/stocky/movements', {
  type: 'uninstall',
  part: NVME_PART.id,
  quantity: 1,
  fromHost: WS.id,
  toLocation: LAB.id,
  date: today,
})
eq('uninstall the last one: the unit follows the movement', 1, m.movement.units.length)
eq(
  '  ...the unit is spare in Lab now',
  ['spare:' + LAB.id],
  (await units(pb.filter('serialKey = "S5GXNF0R100002"'))).map((u) => `${u.status}:${u.location}`),
)
const undo = await post(`/api/stocky/movements/${m.movement.id}/undo`, { date: today })
eq(
  'undoing it carries the unit back',
  [m.movement.units, ['installed:' + WS.id]],
  [
    undo.movement.units,
    (await units(pb.filter('serialKey = "S5GXNF0R100002"'))).map((u) => `${u.status}:${u.host}`),
  ],
)
// invariant across the whole account: units never outnumber the quantity at their place
const allParts = await pb.collection('parts').getFullList()
const allUnits = await units()
const broken = []
for (const pt of allParts) {
  const at = {}
  for (const u of allUnits.filter((u) => u.part === pt.id && u.status !== 'gone')) {
    const k = u.status === 'installed' ? `i:${u.host}` : `s:${u.location}`
    at[k] = (at[k] ?? 0) + 1
  }
  for (const [k, c] of Object.entries(at)) {
    const have = k.startsWith('i:') ? (pt.installed[k.slice(2)] ?? 0) : (pt.spare[k.slice(2)] ?? 0)
    if (c > have) broken.push(`${pt.name} ${k} ${c}>${have}`)
  }
}
eq('consistency holds for every part and place', [], broken)

// =====================================================================================
console.log('# found_installed and stock_out from a host in the movement route (spec §13.4.1–2)')
const mvAttempt = (input) => attempt(() => post('/api/stocky/movements', { date: today, ...input }))
r = await mvAttempt({ type: 'found_installed', part: SD_PART.id, quantity: 1, toLocation: LAB.id })
eq('found_installed to a location: invalid_shape', 'invalid_shape', r.code)
r = await mvAttempt({
  type: 'found_installed',
  part: SD_PART.id,
  quantity: 1,
  toHost: PIA.id,
  fromLocation: LAB.id,
})
eq('found_installed with a source: invalid_shape', 'invalid_shape', r.code)
r = await mvAttempt({
  type: 'found_installed',
  part: SD_PART.id,
  quantity: 1,
  toHost: PIA.id,
  priceMinor: 100,
  priceCurrency: 'TWD',
})
eq('found_installed with a price: invalid_price', 'invalid_price', r.code)
r = await mvAttempt({
  type: 'found_installed',
  part: SD_PART.id,
  quantity: 1,
  toHost: PIA.id,
  reason: 'used',
})
eq('found_installed with a reason: invalid_reason', 'invalid_reason', r.code)
r = await mvAttempt({
  type: 'found_installed',
  part: SD_PART.id,
  quantity: 1,
  toHost: PIA.id,
  units: ['abc'],
})
eq('units from the client: invalid_units', 'invalid_units', r.code)
const sdBefore = await part(SD_PART.id)
m = await post('/api/stocky/movements', {
  type: 'found_installed',
  part: SD_PART.id,
  quantity: 3,
  toHost: PIA.id,
  date: today,
})
const sdMid = await part(SD_PART.id)
eq(
  'found_installed 3: installed +3, spares unchanged',
  [(sdBefore.installed[PIA.id] ?? 0) + 3, sdBefore.spareTotal],
  [sdMid.installed[PIA.id], sdMid.spareTotal],
)
r = await mvAttempt({ type: 'stock_out', part: SD_PART.id, quantity: 1, fromHost: PIA.id })
eq('stock_out from a host needs a reason', 'invalid_reason', r.code)
r = await mvAttempt({
  type: 'stock_out',
  part: SD_PART.id,
  quantity: 9,
  fromHost: PIA.id,
  reason: 'used',
})
eq(
  'stock_out from a host beyond what is installed: insufficient_stock',
  'insufficient_stock',
  r.code,
)
r = await mvAttempt({
  type: 'stock_out',
  part: SD_PART.id,
  quantity: 1,
  fromHost: PIA.id,
  fromLocation: LAB.id,
  reason: 'used',
})
eq('stock_out from both a host and a location: invalid_shape', 'invalid_shape', r.code)
const so = await post('/api/stocky/movements', {
  type: 'stock_out',
  part: SD_PART.id,
  quantity: 1,
  fromHost: PIA.id,
  reason: 'discarded',
  date: today,
})
eq('stock_out 1 from pi-a', sdMid.installed[PIA.id] - 1, so.part.installed[PIA.id])
const soUndo = await post(`/api/stocky/movements/${so.movement.id}/undo`, { date: today })
eq(
  'its undo is found_installed into the host, no reason',
  ['found_installed', PIA.id, ''],
  [soUndo.movement.type, soUndo.movement.toHost, soUndo.movement.reason],
)
const fi = await post('/api/stocky/movements', {
  type: 'found_installed',
  part: SD_PART.id,
  quantity: 1,
  toHost: PIA.id,
  date: today,
})
const fiUndo = await post(`/api/stocky/movements/${fi.movement.id}/undo`, { date: today })
eq(
  'found_installed undo: stock_out from the host',
  ['stock_out', PIA.id, ''],
  [fiUndo.movement.type, fiUndo.movement.fromHost, fiUndo.movement.reason],
)
const np = await post('/api/stocky/movements', {
  type: 'found_installed',
  quantity: 1,
  toHost: PIA.id,
  date: today,
  newPart: { name: 'Pi 5 Active Cooler', category: OTHER.id, unit: 'pcs' },
})
eq(
  'found_installed may create its part (newPart)',
  [{ [PIA.id]: 1 }, 0],
  [np.part.installed, np.part.spareTotal],
)
r = await mvAttempt({
  type: 'install',
  quantity: 1,
  fromLocation: LAB.id,
  toHost: PIA.id,
  newPart: { name: 'Nope part', category: OTHER.id, unit: 'pcs' },
})
eq('install with newPart is still refused', 'invalid_part', r.code)
const recalc = await post(`/api/stocky/parts/${SD_PART.id}/recalculate`, {})
check(
  'recalculate agrees with the stored totals after all of this',
  recalc.matches === true,
  recalc,
)

// =====================================================================================
console.log('# rules: units, imports, matchKeys (spec §13.7)')
const anyUnit = (await units())[0]
const anyImport = (await pb.collection('imports').getList(1, 1)).items[0]
eq(
  "B sees none of A's units or imports",
  [0, 0],
  [
    (await B.pb.collection('units').getList(1, 1)).totalItems,
    (await B.pb.collection('imports').getList(1, 1)).totalItems,
  ],
)
r = await attempt(() => B.pb.collection('units').getOne(anyUnit.id))
eq("B can't view A's unit", 404, r.status)
r = await attempt(() =>
  pb
    .collection('units')
    .create({ user: A.id, part: SD_PART.id, serial: 'X', serialKey: 'X', status: 'spare' }),
)
eq('units create: superusers only', 403, r.status)
r = await attempt(() => pb.collection('units').update(anyUnit.id, { status: 'gone' }))
eq('units update: superusers only', 403, r.status)
r = await attempt(() => pb.collection('units').delete(anyUnit.id))
eq('units delete: superusers only', 403, r.status)
r = await attempt(() => pb.collection('imports').create({ user: A.id, host: PIB.id }))
eq('imports create: superusers only', 403, r.status)
r = await attempt(() => pb.collection('imports').update(anyImport.id, { undone: true }))
eq('imports update: superusers only', 403, r.status)
r = await attempt(() => pb.collection('imports').delete(anyImport.id))
eq('imports delete: superusers only', 403, r.status)
r = await attempt(() => pb.collection('parts').update(SD_PART.id, { matchKeys: ['HACK'] }))
check('matchKeys are server-only on update', r.status >= 400, r)
r = await attempt(() =>
  pb
    .collection('parts')
    .create({ user: A.id, name: 'Sneaky', category: OTHER.id, unit: 'pcs', matchKeys: ['X'] }),
)
check('matchKeys are server-only on create', r.status >= 400, r)
r = await attempt(() =>
  post(
    '/api/stocky/discovery/apply',
    { host: PIB.id, snapshot: JSON.stringify(pi2Snap), previewHash: 'x', decisions: {} },
    B.pb,
  ),
)
eq("B can't apply to A's host", 'not_found', r.code)

// =====================================================================================
console.log('# hostile strings (spec §13.3.2, decision #23.7)')
const hostile = {
  kind: 'drive',
  vendor: 'Evil "Corp"',
  model: `Q'uote" \\back\\slash\u0000\u0007\u001b[31m <script>alert(1)</script> ' || 1=1 -- 日本語 ✓ ${'x'.repeat(200)}`,
  serial: `SER"IAL'\\\u0001-ü-${'9'.repeat(100)}`,
  sizeBytes: 256060514304,
  interface: 'sata',
  slot: 'ata1"; DROP TABLE parts; --',
  raw: { 'weird key "x"': 'v\u0000al', n: 5, nested: { no: 1 } },
}
const hostileSnap = snap('workstation', [hostile], lsvBase)
p = await preview(WS, hostileSnap)
const hr = p.rows.find((r) => r.group === 'new')
const it = hr.items[0]
check(
  'control characters removed',
  !/[\u0000-\u001f]/.test(it.label + it.serial + it.slot),
  JSON.stringify(it),
)
check(
  'quotes, backslashes, markup, SQL-ish and non-ASCII kept as text',
  it.label.includes(`Q'uote" \\back\\slash`) &&
    it.label.includes('<script>alert(1)</script>') &&
    it.label.includes("' || 1=1 --") &&
    it.label.includes('日本語 ✓'),
  it.label,
)
eq(
  'model capped at 120, serial at 80',
  [true, 80],
  [it.label.length <= 120 + 'Evil "Corp" '.length, it.serial.length],
)
res = await applyDefaults(WS, hostileSnap, {}, p)
const hp = (await pb.collection('parts').getFullList({ filter: 'manufacturer ~ "Evil"' }))[0]
check(
  'stored verbatim but inert: the part exists with the quoted name',
  !!hp && hp.name.includes(`Q'uote"`),
  hp?.name,
)
const hu = (await units(pb.filter('part = {:p}', { p: hp.id })))[0]
check(
  '  ...the unit serial keeps quotes/backslash/ü, minus the control char',
  hu.serial.startsWith(`SER"IAL'\\-ü-`),
  hu.serial,
)
eq('  ...the slot is stored as plain text', 'ata1"; DROP TABLE parts; --', hu.slot)
const snapStored = (await pb.collection('imports').getOne(res.import.id)).snapshot
eq(
  '  ...the stored snapshot is the validated copy (raw: no nested objects, no control chars)',
  { 'weird key "x"': 'val', n: 5 },
  snapStored.items[0].raw,
)
check('  ...collections still intact', (await pb.collection('parts').getList(1, 1)).totalItems > 0)

// =====================================================================================
console.log('# collector fixtures (tools/fixtures, phase D2)')
const FIX = `${REPO}/tools/fixtures`
if (existsSync(FIX)) {
  for (const f of readdirSync(FIX)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const text = readFileSync(`${FIX}/${f}`, 'utf8')
    const want = f.startsWith('invalid-')
      ? 'invalid_json'
      : f.startsWith('vm-')
        ? 'virtual_host'
        : null
    r = await attempt(() => preview(MINI, text))
    if (want) eq(`fixture ${f}: ${want}`, want, r.code)
    else
      check(
        `fixture ${f}: previews (${r.result?.rows?.length ?? '-'} rows)`,
        r.status === 200 && r.result.rows.length > 0,
        r,
      )
  }
} else {
  console.log('(no fixtures yet)')
}

// =====================================================================================
console.log('# deleting the user removes units and imports too')
await admin.collection('users').delete(A.id)
eq(
  'no units or imports left for A',
  [0, 0],
  [
    (
      await admin
        .collection('units')
        .getList(1, 1, { filter: admin.filter('user = {:u}', { u: A.id }) })
    ).totalItems,
    (
      await admin
        .collection('imports')
        .getList(1, 1, { filter: admin.filter('user = {:u}', { u: A.id }) })
    ).totalItems,
  ],
)

console.log(`passed: ${pass}  failed: ${fail}`)
process.exit(fail ? 1 : 0)
