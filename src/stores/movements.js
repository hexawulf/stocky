// Paginated movements for History and Part detail (spec §4.5, §4.8, §5.2).
// Filters run on the server (decision #22); each page also looks up the
// movements that reverse it, so "Undone" shows even when a filter hides the
// reversal row, and the discovery imports its rows belong to (§13.4.4).
// Units come expanded (serials on a row). New movements arrive by realtime
// and are inserted in order.
import { getCurrentScope, onScopeDispose, reactive, ref } from 'vue'
import { pb } from '../lib/pb.js'
import { matchesFilters } from '../lib/movements.js'

// History filters -> PocketBase filter string (safely parameterised)
// f: { type, part, place, from, to } (from/to are YYYY-MM-DD, inclusive)
export function buildMovementFilter(f = {}) {
  const parts = []
  const params = {}
  if (f.type) {
    parts.push('type = {:type}')
    params.type = f.type
  }
  if (f.part) {
    parts.push('part = {:part}')
    params.part = f.part
  }
  if (f.place) {
    parts.push(
      '(fromLocation = {:place} || fromHost = {:place} || toLocation = {:place} || toHost = {:place})',
    )
    params.place = f.place
  }
  if (f.from) {
    parts.push('date >= {:from}')
    params.from = f.from
  }
  if (f.to) {
    parts.push('date <= {:to}')
    params.to = f.to
  }
  return parts.length ? pb.filter(parts.join(' && '), params) : ''
}

// newest first: date, then when it was recorded (spec §4.8)
function newerFirst(a, b) {
  return a.date === b.date ? (a.created < b.created ? 1 : -1) : a.date < b.date ? 1 : -1
}

export function useMovementList(getFilters, { pageSize = 50 } = {}) {
  const items = ref([])
  const undone = reactive(new Set()) // ids of movements that have a reversal
  const imports = reactive({}) // import id -> import record (without its snapshot)
  const loading = ref(false)
  const done = ref(false)
  const error = ref(null)
  let page = 0
  let generation = 0 // drops responses that arrive after a reload
  let unsubscribe = null

  async function lookupReversals(list) {
    for (const m of list) if (m.reverses) undone.add(m.reverses)
    if (!list.length) return
    const params = {}
    const expr = list.map((m, i) => ((params[`r${i}`] = m.id), `reverses = {:r${i}}`)).join(' || ')
    const reversals = await pb.collection('movements').getFullList({
      filter: pb.filter(expr, params),
      fields: 'id,reverses',
    })
    for (const r of reversals) undone.add(r.reverses)
  }

  const IMPORT_FIELDS =
    'id,host,created,collector,collectedAt,hostname,summary,undone,lastMovementAfter'
  async function lookupImports(list, { refresh = false } = {}) {
    const ids = [
      ...new Set(list.map((m) => m.import).filter((id) => id && (refresh || !imports[id]))),
    ]
    if (!ids.length) return
    const params = {}
    const expr = ids.map((id, i) => ((params[`i${i}`] = id), `id = {:i${i}}`)).join(' || ')
    const found = await pb.collection('imports').getFullList({
      filter: pb.filter(expr, params),
      fields: IMPORT_FIELDS,
    })
    for (const imp of found) imports[imp.id] = imp
  }
  // after an import is undone (or anything else changed it)
  const refreshImports = () => lookupImports(items.value, { refresh: true })

  async function loadMore() {
    if (loading.value || done.value) return
    loading.value = true
    error.value = null
    const mine = generation
    try {
      const res = await pb.collection('movements').getList(page + 1, pageSize, {
        filter: buildMovementFilter(getFilters()),
        sort: '-date,-created',
        expand: 'units',
      })
      if (mine !== generation) return
      page += 1
      items.value.push(...res.items.filter((m) => !items.value.some((x) => x.id === m.id)))
      done.value = page >= res.totalPages
      await Promise.all([lookupReversals(res.items), lookupImports(res.items)])
    } catch (err) {
      if (mine === generation) error.value = err
    } finally {
      if (mine === generation) loading.value = false
    }
  }

  function reload() {
    generation += 1
    page = 0
    items.value = []
    undone.clear()
    for (const k of Object.keys(imports)) delete imports[k]
    done.value = false
    loading.value = false
    return loadMore()
  }

  // movements are append-only, so only creates arrive (spec §6.7)
  async function start() {
    if (unsubscribe) return
    unsubscribe = await pb.collection('movements').subscribe(
      '*',
      (e) => {
        if (e.action !== 'create') return
        const m = e.record
        if (m.reverses) undone.add(m.reverses)
        if (m.import) lookupImports([m]).catch(() => {})
        if (!matchesFilters(m, getFilters()) || items.value.some((x) => x.id === m.id)) return
        const at = items.value.findIndex((x) => newerFirst(m, x) < 0)
        // older than everything loaded and more pages remain: it'll come with them
        if (at === -1 && !done.value) return
        items.value.splice(at === -1 ? items.value.length : at, 0, m)
      },
      { expand: 'units' },
    )
    await reload()
  }

  async function stop() {
    const u = unsubscribe
    unsubscribe = null
    if (u) await u()
  }

  if (getCurrentScope()) onScopeDispose(stop)

  return {
    items,
    undone,
    imports,
    loading,
    done,
    error,
    loadMore,
    reload,
    refreshImports,
    start,
    stop,
  }
}
