// Live copies of the signed-in user's parts, locations, hosts and categories
// (spec §5.6): loaded once, then kept current by realtime, and searched in
// memory. A plain composable (spec decision #13). Movements aren't kept here;
// they're paginated where they're shown.
import { computed, reactive, ref } from 'vue'
import { pb } from '../lib/pb.js'
import { confirmSession } from './auth.js'

const COLLECTIONS = ['parts', 'locations', 'hosts', 'categories']

// collection -> { [id]: record }
const records = reactive({ parts: {}, locations: {}, hosts: {}, categories: {} })
const status = ref('idle') // idle | loading | ready | error
const error = ref(null)
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => (online.value = true))
  window.addEventListener('offline', () => (online.value = false))
}

let running = false
let loadedClientId = ''
let unsubscribers = []

// keep whichever copy of a record is newer (a list response and a realtime
// event for the same record can arrive in either order)
function put(collection, record) {
  const current = records[collection][record.id]
  if (!current || current.updated <= record.updated) records[collection][record.id] = record
}

async function loadAll() {
  const lists = await Promise.all(
    COLLECTIONS.map((c) => pb.collection(c).getFullList({ batch: 500 })),
  )
  COLLECTIONS.forEach((c, i) => {
    const ids = new Set(lists[i].map((r) => r.id))
    for (const id of Object.keys(records[c])) if (!ids.has(id)) delete records[c][id]
    for (const r of lists[i]) put(c, r)
  })
  loadedClientId = pb.realtime.clientId
}

// Subscribe first, then load, so no change between the two is missed.
// The list rules scope realtime events to this user (spec §6.2).
export async function start() {
  if (running) return
  running = true
  status.value = 'loading'
  error.value = null
  // an invalid token would load as a guest, i.e. silently empty lists
  if (!(await confirmSession())) {
    running = false
    status.value = 'idle'
    return
  }
  try {
    for (const c of COLLECTIONS) {
      unsubscribers.push(
        await pb.collection(c).subscribe('*', (e) => {
          if (e.action === 'delete') delete records[c][e.record.id]
          else put(c, e.record)
        }),
      )
    }
    // Your own user record: lastMovementId (which row shows Undo, spec §7.4)
    // changes when any of your devices records a movement.
    const uid = pb.authStore.record?.id
    if (uid) {
      unsubscribers.push(
        await pb.collection('users').subscribe(uid, (e) => {
          if (e.action === 'update' && pb.authStore.isValid) {
            pb.authStore.save(pb.authStore.token, e.record)
          }
        }),
      )
    }
    // A reconnect gets a new client id, and events sent while disconnected
    // are lost: reload when that happens.
    unsubscribers.push(
      await pb.realtime.subscribe('PB_CONNECT', (e) => {
        if (running && loadedClientId && e.clientId !== loadedClientId) {
          confirmSession()
            .then((ok) => ok && running && loadAll())
            .catch((err) => console.error('Reload after reconnect failed', err))
        }
      }),
    )
    await loadAll()
    status.value = 'ready'
  } catch (err) {
    console.error('Loading inventory failed', err)
    error.value = err
    status.value = 'error'
    await stop({ keepStatus: true })
  }
}

export async function stop({ keepStatus = false } = {}) {
  running = false
  const pending = unsubscribers
  unsubscribers = []
  await Promise.allSettled(pending.map((unsubscribe) => unsubscribe()))
  for (const c of COLLECTIONS) records[c] = {}
  loadedClientId = ''
  if (!keepStatus) {
    status.value = 'idle'
    error.value = null
  }
}

export function retry() {
  return start()
}

const bySortOrder = (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)
const active = (list) => list.filter((r) => !r.retired).sort(bySortOrder)

// sites in your order, then In transit (spec §4.3)
const locations = computed(() => {
  const all = active(Object.values(records.locations))
  return [...all.filter((l) => l.kind === 'site'), ...all.filter((l) => l.kind === 'transit')]
})
const transit = computed(() => Object.values(records.locations).find((l) => l.kind === 'transit'))
const hosts = computed(() => active(Object.values(records.hosts)))
const categories = computed(() => active(Object.values(records.categories)))
const parts = computed(() =>
  Object.values(records.parts)
    .filter((p) => !p.archived)
    .sort((a, b) => a.name.localeCompare(b.name)),
)
// spec §4.3 / §12 #18: total spares, In transit included, at or below the threshold
const lowStock = computed(() =>
  parts.value.filter((p) => p.lowStockEnabled && p.spareTotal <= p.lowStockThreshold),
)
// spec §7.5: no writes while offline (or before the data is there)
const canWrite = computed(() => online.value && status.value === 'ready')

export function useInventory() {
  return {
    records,
    status,
    error,
    online,
    locations,
    transit,
    hosts,
    categories,
    parts,
    lowStock,
    canWrite,
    start,
    stop,
    retry,
  }
}
