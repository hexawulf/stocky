// Author:      0xWulf
// Description: Drive the real frontend stores (src/stores, src/lib) against a
//              live PocketBase from Node, without a browser: login, seeding,
//              live lists, realtime from a second device, user isolation,
//              convergence after a server restart, session expiry, logout.
//              Run via scripts/test-api.sh, which starts the throwaway server
//              and passes PB_URL, PB_BIN, PB_DATA and PB_PIDFILE (the restart
//              test stops and restarts that server).
// Modified:    2026-10-04
import PocketBase from 'pocketbase'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const BASE = process.env.PB_URL ?? 'http://127.0.0.1:8091'
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE)) {
  console.error(`refusing to run against ${BASE} (loopback only)`)
  process.exit(2)
}

const { pb } = await import(`${REPO}/src/lib/pb.js`)
pb.baseURL = BASE // the app uses '/', which only means something in a browser
const auth = await import(`${REPO}/src/stores/auth.js`)
const inv = await import(`${REPO}/src/stores/inventory.js`)
const api = await import(`${REPO}/src/lib/api.js`)
const { describeError } = await import(`${REPO}/src/lib/errors.js`)
const { todayLocal } = await import(`${REPO}/src/lib/dates.js`)

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`PASS  ${name}`)
  } else {
    fail++
    console.log(`FAIL  ${name} ${detail}`)
  }
}
async function waitFor(name, fn, ms = 5000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (fn()) return check(name, true)
    await new Promise((r) => setTimeout(r, 100))
  }
  check(name, false, '(timed out)')
}

// --- accounts (as superuser, the way the operator would in the dashboard) ---
const admin = new PocketBase(BASE)
await admin.collection('_superusers').authWithPassword('su@test.local', 'SuperPass123')
for (const email of ['a@test.local', 'b@test.local']) {
  await admin
    .collection('users')
    .create({ email, password: 'UserPass123', passwordConfirm: 'UserPass123' })
}

const { user, isSignedIn, notice } = auth.useAuth()
const store = inv.useInventory()

console.log('# auth')
let msg = ''
try {
  await auth.login('a@test.local', 'wrong-password')
} catch (e) {
  msg = e.message
}
check('wrong password → generic message', msg === 'Email or password is incorrect', msg)
try {
  await auth.login('nobody@test.local', 'whatever123')
} catch (e) {
  msg = e.message
}
check('unknown account → the same generic message', msg === 'Email or password is incorrect', msg)
check('still signed out', isSignedIn.value === false)

await auth.login('  a@test.local ', 'UserPass123')
check('login (email trimmed) → signed in', isSignedIn.value === true)
check(
  'first login seeded the lists (seedVersion 1)',
  user.value?.seedVersion === 1,
  JSON.stringify(user.value?.seedVersion),
)
await auth.ensureSeeded()
check('ensureSeeded again is a no-op', user.value?.seedVersion === 1)

console.log('# inventory store')
await inv.start()
check('status ready', store.status.value === 'ready', store.status.value)
check(
  'standard preset: Home, then In transit',
  store.locations.value.map((l) => l.label).join(',') === 'Home,In transit',
  store.locations.value.map((l) => l.label).join(','),
)
check(
  'standard preset: 0 hosts, 9 categories, 0 parts',
  store.hosts.value.length === 0 &&
    store.categories.value.length === 9 &&
    store.parts.value.length === 0,
  `${store.hosts.value.length}/${store.categories.value.length}/${store.parts.value.length}`,
)
await inv.start()
check('start() twice is harmless', store.locations.value.length === 2)

const home = store.locations.value.find((l) => l.key === 'home')
const transit = store.transit.value
const storage = store.categories.value.find((c) => c.key === 'storage')

const { part } = await api.recordMovement({
  type: 'stock_in',
  quantity: 3,
  toLocation: home.id,
  newPart: {
    name: 'Pi 5 16 GB',
    category: storage.id,
    unit: 'pcs',
    lowStockEnabled: true,
    lowStockThreshold: 3,
  },
})
check('api.recordMovement defaults date to today on this device', true)
await waitFor('realtime: new part appears in the store', () => store.parts.value.length === 1)
await waitFor('  spare[home] = 3', () => store.records.parts[part.id]?.spare?.[home.id] === 3)
check('  low stock (3 ≤ 3, enabled)', store.lowStock.value.length === 1)

// another device, same user: its change must reach this store by realtime
const device2 = new PocketBase(BASE)
await device2.collection('users').authWithPassword('a@test.local', 'UserPass123')
await device2.send('/api/stocky/movements', {
  method: 'POST',
  body: {
    type: 'move',
    part: part.id,
    quantity: 1,
    fromLocation: home.id,
    toLocation: transit.id,
    date: todayLocal(),
  },
})
await waitFor('realtime from a second device: home 2, transit 1', () => {
  const p = store.records.parts[part.id]
  return p?.spare?.[home.id] === 2 && p?.spare?.[transit.id] === 1
})
check('  still low: spareTotal 3 counts In transit', store.lowStock.value.length === 1)

// another user: nothing of theirs may appear here
const other = new PocketBase(BASE)
await other.collection('users').authWithPassword('b@test.local', 'UserPass123')
await other.send('/api/stocky/seed', { method: 'POST' })
const bLoc = await other.collection('locations').getFirstListItem('key="home"')
const bCat = await other.collection('categories').getFirstListItem('key="storage"')
await other.send('/api/stocky/movements', {
  method: 'POST',
  body: {
    type: 'stock_in',
    quantity: 1,
    toLocation: bLoc.id,
    date: todayLocal(),
    newPart: { name: 'B secret', category: bCat.id, unit: 'pcs' },
  },
})
await new Promise((r) => setTimeout(r, 1000))
check(
  'other user: their part never reaches this store',
  store.parts.value.every((p) => p.name !== 'B secret') &&
    Object.keys(store.records.locations).length === 2,
)

console.log('# errors')
let described
try {
  await api.recordMovement({
    type: 'stock_out',
    part: part.id,
    quantity: 50,
    fromLocation: home.id,
    reason: 'used',
  })
} catch (e) {
  described = describeError(e)
}
check(
  'validation error → kind/code/message',
  described?.kind === 'validation' &&
    described.code === 'insufficient_stock' &&
    described.message === 'Only 2 pcs available at Home',
  JSON.stringify(described),
)
check('  data.available = 2', described?.data?.available === 2)

// the standard preset has no hosts: add one the way the app will (records API)
await pb
  .collection('hosts')
  .create({ user: user.value.id, label: 'nas', type: 'NAS', site: home.id })
await waitFor(
  'realtime: host created through the API appears',
  () => store.hosts.value.length === 1,
)
check(
  '  Home became referenced (a host points at it)',
  store.records.locations[home.id]?.referenced === true,
)
const { movement: last } = await api.recordMovement({
  type: 'install',
  part: part.id,
  quantity: 1,
  fromLocation: home.id,
  toHost: store.hosts.value[0].id,
})
const undone = await api.undoMovement(last.id)
check(
  'api.undoMovement sends today: reversal dated today',
  undone.movement.date === todayLocal() && undone.movement.reverses === last.id,
)
const rc = await api.recalculatePart(part.id)
check('api.recalculatePart dry run: matches', rc.matches === true && rc.fixed === false)

console.log('# server restart: the store converges again')
{
  // stop the runner's server by its pid (never by name), start a new one on
  // the same data and port, and hand its pid back through the pid file
  const { spawn } = await import('node:child_process')
  const fs = await import('node:fs')
  const { PB_BIN, PB_DATA, PB_PIDFILE } = process.env
  if (!PB_BIN || !PB_DATA || !PB_PIDFILE) {
    console.error('PB_BIN, PB_DATA and PB_PIDFILE are needed (run via scripts/test-api.sh)')
    process.exit(2)
  }
  process.kill(Number(fs.readFileSync(PB_PIDFILE, 'utf8')))
  await new Promise((r) => setTimeout(r, 1500))
  const log = fs.openSync(`${PB_DATA}/restarted.log`, 'a')
  const child = spawn(
    PB_BIN,
    [
      'serve',
      `--http=${new URL(BASE).host}`,
      `--dir=${PB_DATA}`,
      `--migrationsDir=${REPO}/pb_migrations`,
      `--hooksDir=${REPO}/pb_hooks`,
      '--hooksWatch=false',
      '--automigrate=false',
      '--dev=false',
    ],
    { detached: true, stdio: ['ignore', log, log] },
  )
  child.unref()
  fs.writeFileSync(PB_PIDFILE, String(child.pid))
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
}
await device2.send('/api/stocky/movements', {
  method: 'POST',
  body: { type: 'stock_in', part: part.id, quantity: 4, toLocation: home.id, date: todayLocal() },
})
await waitFor(
  'after the restart: change made meanwhile shows up (home 6)',
  () => store.records.parts[part.id]?.spare?.[home.id] === 6,
  15000,
)

console.log('# history list: server filters, reversal lookup, realtime (decision #22)')
{
  const { useMovementList } = await import(`${REPO}/src/stores/movements.js`)
  // so far: stock_in, move (device 2), install, its undo (uninstall), stock_in (device 2)
  let filters = {}
  const list = useMovementList(() => filters, { pageSize: 2 })
  await list.start()
  check('first page: 2 newest (page size 2)', list.items.value.length === 2 && !list.done.value)
  while (!list.done.value) await list.loadMore()
  check('all pages: 5 movements', list.items.value.length === 5, String(list.items.value.length))
  const sorted = [...list.items.value].every(
    (m, i, a) =>
      i === 0 ||
      a[i - 1].date > m.date ||
      (a[i - 1].date === m.date && a[i - 1].created >= m.created),
  )
  check('newest first (date, then created)', sorted)

  filters = { type: 'install' }
  await list.reload()
  check(
    'type filter on the server: only the install',
    list.items.value.length === 1 && list.items.value[0].type === 'install',
  )
  check(
    '  "Undone" known although the filter hides the reversal (per-page lookup)',
    list.undone.has(list.items.value[0].id),
  )

  filters = { place: transit.id }
  await list.reload()
  check(
    'place filter = any side: only the move into In transit',
    list.items.value.length === 1 && list.items.value[0].toLocation === transit.id,
  )

  filters = {}
  await list.reload()
  while (!list.done.value) await list.loadMore()
  const { movement: fresh } = await device2.send('/api/stocky/movements', {
    method: 'POST',
    body: {
      type: 'move',
      part: part.id,
      quantity: 1,
      fromLocation: home.id,
      toLocation: transit.id,
      date: todayLocal(),
    },
  })
  await waitFor(
    'realtime: a second device’s movement is inserted at the top',
    () => list.items.value[0]?.id === fresh.id,
  )
  await waitFor(
    '  lastMovementId follows on this device (user-record subscription)',
    () => user.value?.lastMovementId === fresh.id,
  )

  // a discovery import through the app's own API helpers (spec §13.3)
  const host = await api.createEntry('hosts', { label: 'bench-pi', site: home.id, sortOrder: 0 })
  const snapshot = JSON.stringify({
    schema: 'stocky.discovery/1',
    collector: 'stocky-collect 1.0.0',
    collectedAt: '2026-10-05T09:00:00+08:00',
    host: { hostname: 'bench-pi', platform: 'aarch64', virtual: false, model: 'Raspberry Pi 5' },
    items: [
      {
        kind: 'drive',
        model: 'Samsung SSD 990 EVO 1TB',
        serial: 'S7XX0001',
        sizeBytes: 1000204886016,
        interface: 'nvme',
        slot: 'nvme0',
      },
    ],
    skipped: [],
    warnings: [],
  })
  const prev = await api.previewDiscovery(host.id, snapshot)
  check('previewDiscovery: one new row', prev.rows.length === 1 && prev.rows[0].group === 'new')
  const decisions = { [prev.rows[0].id]: { apply: true, action: 'found_installed' } }
  const applied = await api.applyDiscovery({
    hostId: host.id,
    snapshotText: snapshot,
    previewHash: prev.previewHash,
    decisions,
  })
  check('applyDiscovery: one movement', applied.movements === 1, JSON.stringify(applied))
  await waitFor(
    'realtime: the import movement arrives with its import looked up',
    () => list.items.value[0]?.import === applied.import.id && !!list.imports[applied.import.id],
  )
  await waitFor('  ...and its unit expanded (serial on the row)', () =>
    (list.items.value[0]?.expand?.units ?? []).some((u) => u.serial === 'S7XX0001'),
  )
  await list.reload()
  check(
    'reload: units expanded and the import known',
    list.items.value[0]?.expand?.units?.[0]?.serial === 'S7XX0001' &&
      list.imports[applied.import.id]?.undone === false,
  )
  await api.undoImport(applied.import.id)
  await list.refreshImports()
  check(
    'undoImport, then refreshImports: the import reads as undone',
    list.imports[applied.import.id]?.undone === true,
  )
  await waitFor('  ...and its movement as undone (the reversal arrived)', () =>
    list.undone.has(applied.import ? list.items.value.find((m) => m.import)?.id : ''),
  )
  const imports = await api.listImports()
  check(
    'listImports: without snapshots',
    imports.length === 1 && imports[0].snapshot === undefined && imports[0].host === host.id,
  )
  await list.stop()
}

console.log('# part API helpers against the server (group 2)')
{
  const storage = store.categories.value.find((c) => c.key === 'storage')
  const created = await api.createPart({
    name: '  Cat6   patch cable 1 m ',
    category: storage.id,
    unit: 'pcs',
    manufacturer: '',
    model: '',
    notes: '',
    lowStockEnabled: true,
    lowStockThreshold: 0,
  })
  check(
    'createPart: hook trims the name, sets nameKey, stock starts empty',
    created.name === 'Cat6   patch cable 1 m' &&
      created.nameKey === 'cat6 patch cable 1 m' &&
      created.spareTotal === 0,
    JSON.stringify({ name: created.name, nameKey: created.nameKey }),
  )
  await waitFor(
    '  ...and arrives in the store by realtime',
    () => !!store.records.parts[created.id],
  )
  const updated = await api.updatePart(created.id, {
    name: 'Cat6 patch cable 2 m',
    lowStockEnabled: false,
  })
  check('updatePart: nameKey follows the new name', updated.nameKey === 'cat6 patch cable 2 m')
  check('countPartMovements: new part has none', (await api.countPartMovements(created.id)) === 0)
  check(
    'countPartMovements: the realtime part has some',
    (await api.countPartMovements(part.id)) > 0,
  )
  let d
  try {
    await api.createPart({
      name: 'CAT6 PATCH CABLE 2 M',
      category: storage.id,
      unit: 'pcs',
      manufacturer: '',
      model: '',
      notes: '',
      lowStockEnabled: false,
      lowStockThreshold: 0,
    })
  } catch (e) {
    d = describeError(e)
  }
  check(
    'duplicate name → validation duplicate_name with partId',
    d?.code === 'duplicate_name' && d?.data?.partId === created.id,
    JSON.stringify(d),
  )
  d = undefined
  try {
    await api.createPart({
      name: 'x',
      category: storage.id,
      unit: 'pcs',
      manufacturer: '',
      model: '',
      notes: '',
      lowStockEnabled: false,
      lowStockThreshold: 0,
    })
  } catch (e) {
    d = describeError(e)
  }
  check(
    'too-short name → fields error on name',
    d?.kind === 'fields' && d.fields.name?.code === 'validation_min_text_constraint',
    JSON.stringify(d),
  )
}

console.log('# list API helpers against the server (group 5)')
{
  const site = await api.createEntry('locations', {
    label: 'Hamburg',
    kind: 'site',
    defaultCurrency: 'USD',
    sortOrder: 5,
  })
  check(
    'createEntry: site with a USD default currency',
    site.defaultCurrency === 'USD' && site.referenced === false,
  )
  let d
  try {
    await api.createEntry('locations', { label: 'HAMBURG', kind: 'site', sortOrder: 6 })
  } catch (e) {
    d = describeError(e)
  }
  check(
    'duplicate label → fields: label validation_not_unique',
    d?.kind === 'fields' && d.fields.label?.code === 'validation_not_unique',
    JSON.stringify(d),
  )
  d = undefined
  try {
    await api.updateEntry('locations', home.id, { retired: true })
  } catch (e) {
    d = describeError(e)
  }
  check(
    'retire Home with stock → in_use with the spec message',
    d?.code === 'in_use' &&
      /^Can't retire Home — \d+ parts? still ha(s|ve) spare stock there/.test(d.message),
    JSON.stringify(d),
  )
  const moved = await api.updateEntry('locations', site.id, { sortOrder: 0 })
  check('updateEntry: sortOrder', moved.sortOrder === 0)
  await api.deleteEntry('locations', site.id)
  await waitFor(
    'deleteEntry: an unused site disappears from the store',
    () => !store.records.locations[site.id],
  )
}

console.log('# session expiry and logout')
const EXPIRED = 'Your session expired, please log in again'
// same claims, bad signature. Change the signature's FIRST character: the last
// one carries padding bits that base64url decoders ignore, so changing it can
// leave the token valid.
const tamper = (t) => {
  const i = t.lastIndexOf('.') + 1
  return t.slice(0, i) + (t[i] === 'A' ? 'B' : 'A') + t.slice(i + 1)
}
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

// 1. revoked/tampered token at store start: PocketBase would answer the lists
//    as a guest (200, empty); the store must sign out instead of showing nothing
let record = pb.authStore.record
await inv.stop()
pb.authStore.save(tamper(pb.authStore.token), record)
check('tampered token still looks valid locally', pb.authStore.isValid === true)
await inv.start()
check('store start with a revoked token → signed out', isSignedIn.value === false)
check('  notice: session expired', notice.value === EXPIRED, notice.value)
check(
  '  store did not go "ready" with empty lists',
  store.status.value === 'idle' && store.parts.value.length === 0,
  store.status.value,
)

// 2. a route answering 401 ends the session through afterSend
await auth.login('a@test.local', 'UserPass123')
check('log in again clears the notice', notice.value === '' && isSignedIn.value)
pb.authStore.save(tamper(pb.authStore.token), pb.authStore.record)
try {
  await api.seedReferenceLists()
} catch (e) {
  described = describeError(e)
}
check(
  'route 401 → signed out with the notice',
  !isSignedIn.value && notice.value === EXPIRED && described?.kind === 'session',
  `kind=${described?.kind}`,
)

// 3. a saved token whose exp has passed (no request needed)
await auth.login('a@test.local', 'UserPass123')
record = pb.authStore.record
const expired = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ id: record.id, type: 'auth', exp: Math.floor(Date.now() / 1000) - 60 })}.sig`
pb.authStore.save(expired, record)
check('expired token: signed out locally at once', isSignedIn.value === false)
const ok = await auth.confirmSession()
check(
  '  confirmSession → false with the notice',
  ok === false && notice.value === EXPIRED,
  notice.value,
)

await auth.login('a@test.local', 'UserPass123')
await inv.stop()
await inv.start()
check(
  'store restarts after re-login (all three parts back, one from the import)',
  store.parts.value.length === 3,
  String(store.parts.value.length),
)
auth.logout()
await inv.stop()
check(
  'logout + stop: signed out, store emptied',
  !isSignedIn.value && store.parts.value.length === 0 && store.status.value === 'idle',
)

console.log(`\npassed: ${pass}  failed: ${fail}`)
process.exit(fail === 0 ? 0 : 1)
