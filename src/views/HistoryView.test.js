import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { reactive, ref } from 'vue'

const fx = vi.hoisted(() => ({ state: null, user: null, list: null, quiet: [] }))
vi.mock('@/stores/inventory.js', () => ({ useInventory: () => fx.state }))
vi.mock('@/stores/auth.js', () => ({ useAuth: () => ({ user: fx.user }) }))
vi.mock('@/stores/movements.js', () => ({
  useMovementList: (getFilters) => ((fx.list.getFilters = getFilters), fx.list),
}))
vi.mock('@/lib/api.js', () => ({
  undoMovement: vi.fn(),
  undoImport: vi.fn(),
  listQuietImports: vi.fn(async () => fx.quiet ?? []),
}))
vi.mock('@/lib/dates.js', () => ({ todayLocal: () => '2026-10-04' }))

import { undoImport, undoMovement } from '@/lib/api.js'
import HistoryView from './HistoryView.vue'
import { makeInventory, mountAt } from './testing.js'

const recent = new Date(Date.now() - 3600e3).toISOString().replace('T', ' ')
const old = new Date(Date.now() - 72 * 3600e3).toISOString().replace('T', ' ')

function makeList(items, { done = true, imports = {} } = {}) {
  return {
    items: ref(items),
    undone: reactive(new Set(items.filter((m) => m.reverses).map((m) => m.reverses))),
    imports: reactive(imports),
    refreshImports: vi.fn(async () => {}),
    loading: ref(false),
    done: ref(done),
    error: ref(null),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    reload: vi.fn(),
    loadMore: vi.fn(),
  }
}

const movements = [
  {
    id: 'm3',
    type: 'move',
    part: 'p1',
    quantity: 2,
    fromLocation: 'lab',
    toLocation: 'trn',
    date: '2026-10-04',
    created: recent,
    reverses: '',
    note: '',
  },
  {
    id: 'm2',
    type: 'install',
    part: 'p1',
    quantity: 1,
    fromLocation: 'lab',
    toHost: 'pib',
    date: '2026-10-04',
    created: old,
    reverses: '',
    note: '',
  },
  {
    id: 'm1',
    type: 'stock_in',
    part: 'p1',
    quantity: 5,
    toLocation: 'lab',
    date: '2026-10-01',
    created: old,
    reverses: '',
    note: '',
  },
]

beforeEach(() => {
  fx.state = makeInventory({
    locations: {
      gone: { id: 'gone', label: 'Old shed', kind: 'site', sortOrder: 9, retired: true },
    },
    parts: {
      p9: {
        id: 'p9',
        name: 'Old HDD',
        unit: 'pcs',
        archived: true,
        spare: {},
        installed: {},
        spareTotal: 0,
      },
    },
  })
  fx.user = ref({ id: 'u1', lastMovementId: 'm3' })
  fx.list = makeList(movements)
  undoMovement.mockReset().mockResolvedValue({ movement: { id: 'm4' }, part: {} })
})
afterEach(() => (document.body.innerHTML = ''))

const mountHistory = (q = '') => mountAt(HistoryView, `/history${q}`, { routeName: 'history' })

describe('History (spec §4.8)', () => {
  it('grouped by day, newest first, with part names; loads on mount', async () => {
    const { wrapper: w } = await mountHistory()
    expect(fx.list.start).toHaveBeenCalled()
    const days = w.findAll('.day')
    expect(days).toHaveLength(2)
    expect(days[0].findAll('.row')).toHaveLength(2)
    expect(days[1].findAll('.row')).toHaveLength(1)
    expect(days[0].text()).toContain('microSD 128 GB')
    w.unmount()
  })

  it('filters come from the URL and reach the server filter (decision #22)', async () => {
    const { wrapper: w } = await mountHistory('?part=p1&type=move&place=trn&from=2026-10-01')
    expect(fx.list.getFilters()).toEqual({
      type: 'move',
      part: 'p1',
      place: 'trn',
      from: '2026-10-01',
      to: '',
    })
    expect(w.get('[data-filter="type"]').element.value).toBe('move')
    w.unmount()
  })

  it('changing a filter updates the URL and reloads', async () => {
    const { wrapper: w, router } = await mountHistory()
    await w.get('[data-filter="type"]').setValue('install')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ type: 'install' })
    expect(fx.list.reload).toHaveBeenCalled()
    expect(fx.list.getFilters().type).toBe('install')
    w.unmount()
  })

  it('filter options include retired places and archived parts, marked', async () => {
    const { wrapper: w } = await mountHistory()
    const places = w
      .get('[data-filter="place"]')
      .findAll('option')
      .map((o) => o.text())
    expect(places).toContain('Old shed (retired)')
    expect(places).toContain('pi-b')
    const parts = w
      .get('[data-filter="part"]')
      .findAll('option')
      .map((o) => o.text())
    expect(parts).toContain('Old HDD (archived)')
    w.unmount()
  })

  it('Undo on the newest eligible movement only, through the confirm sheet', async () => {
    const { wrapper: w } = await mountHistory()
    const undo = w.findAll('[data-test="undo"]')
    expect(undo).toHaveLength(1)
    await undo[0].trigger('click')
    expect(w.get('[data-test="reversal"]').text()).toBe(
      'Move 2 × microSD 128 GB from In transit → Lab on 2026-10-04',
    )
    await w
      .findAll('.sheet button')
      .find((b) => b.text() === 'Undo')
      .trigger('click')
    await flushPromises()
    expect(undoMovement).toHaveBeenCalledWith('m3')
    w.unmount()
  })

  it('undone movement greyed with a badge; its reversal shows "Undo of: …"', async () => {
    fx.list = makeList([
      {
        id: 'm4',
        type: 'move',
        part: 'p1',
        quantity: 2,
        fromLocation: 'trn',
        toLocation: 'lab',
        date: '2026-10-04',
        created: recent,
        reverses: 'm3',
        note: 'Undo of 2026-10-04 move',
      },
      ...movements,
    ])
    fx.user.value.lastMovementId = 'm4'
    const { wrapper: w } = await mountHistory()
    const m3 = w.get('[data-id="m3"]')
    expect(m3.classes()).toContain('undone')
    expect(m3.text()).toContain('Undone')
    expect(w.get('[data-id="m4"]').text()).toContain('Undo of: 2026-10-04 move')
    expect(w.findAll('[data-test="undo"]')).toHaveLength(0)
    w.unmount()
  })

  it('empty: "No movements yet"; with filters: message plus Clear filters', async () => {
    fx.list = makeList([])
    const { wrapper: w } = await mountHistory()
    expect(w.text()).toContain('No movements yet')
    w.unmount()
    const { wrapper: w2, router } = await mountHistory('?type=uninstall')
    expect(w2.text()).toContain('No movements match these filters')
    await w2
      .findAll('button')
      .find((b) => b.text() === 'Clear filters')
      .trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
    w2.unmount()
  })

  it('more pages: a Load more button (infinite scroll fallback)', async () => {
    fx.list = makeList(movements, { done: false })
    const { wrapper: w } = await mountHistory()
    await w.get('.more').trigger('click')
    expect(fx.list.loadMore).toHaveBeenCalled()
    w.unmount()
  })
})

describe('History: discovery imports (spec §4.8, §13.4.4)', () => {
  const imported = (id, extra = {}) => ({
    id,
    type: 'found_installed',
    part: 'p1',
    quantity: 1,
    toHost: 'pib',
    date: '2026-10-04',
    created: recent,
    reverses: '',
    note: 'Discovery: pi-b 2026-10-04',
    import: 'i1',
    ...extra,
  })
  const importRecord = (extra = {}) => ({
    i1: {
      id: 'i1',
      host: 'pib',
      created: recent,
      undone: false,
      lastMovementAfter: 'm6',
      ...extra,
    },
  })
  const setup = (importExtra = {}) => {
    fx.user = ref({ id: 'u1', lastMovementId: 'm6' })
    fx.list = makeList(
      [
        imported('m6', { expand: { units: [{ id: 'u1', serial: 'S5GX' }] } }),
        imported('m5'),
        ...movements,
      ],
      { imports: importRecord(importExtra) },
    )
  }

  it("an import's rows are one collapsed group, titled with the host and count", async () => {
    setup()
    const { wrapper: w } = await mountHistory()
    const g = w.get('[data-import="i1"]')
    expect(g.element.tagName).toBe('DETAILS')
    expect(g.attributes('open')).toBeUndefined()
    expect(g.get('summary').text()).toContain('Discovery import · pi-b · 2 movements')
    expect(g.findAll('.row')).toHaveLength(2)
    // the rest of the day stays as plain rows
    expect(w.findAll('.day')[0].findAll(':scope > .row')).toHaveLength(2)
    w.unmount()
  })

  it('rows list the serials of their units', async () => {
    setup()
    const { wrapper: w } = await mountHistory()
    expect(w.get('[data-id="m6"] [data-test="serials"]').text()).toBe('S/N S5GX')
    expect(w.find('[data-id="m5"] [data-test="serials"]').exists()).toBe(false)
    w.unmount()
  })

  it('no single Undo inside an import, even on the newest movement', async () => {
    setup()
    const { wrapper: w } = await mountHistory()
    expect(w.findAll('[data-test="undo"]')).toHaveLength(0)
    w.unmount()
  })

  it('Undo import through a confirm sheet, then the import is looked up again', async () => {
    setup()
    undoImport.mockReset().mockResolvedValue({ import: { id: 'i1' }, reversed: 2 })
    const { wrapper: w } = await mountHistory()
    await w.get('[data-test="undo-import"]').trigger('click')
    expect(w.get('[data-test="undo-import-text"]').text().replace(/\s+/g, ' ')).toContain(
      'Its 2 movements are reversed, serials it added are removed',
    )
    await w
      .findAll('.sheet button')
      .find((b) => b.text() === 'Undo import')
      .trigger('click')
    await flushPromises()
    expect(undoImport).toHaveBeenCalledWith('i1')
    expect(fx.list.refreshImports).toHaveBeenCalled()
    expect(w.find('.sheet').exists()).toBe(false)
    w.unmount()
  })

  it('Undo import errors stay on the sheet', async () => {
    setup()
    undoImport.mockReset().mockRejectedValue({
      status: 400,
      response: {
        message: "Can't undo this import — something newer was recorded",
        data: { code: 'not_newest' },
      },
    })
    const { wrapper: w } = await mountHistory()
    await w.get('[data-test="undo-import"]').trigger('click')
    await w
      .findAll('.sheet button')
      .find((b) => b.text() === 'Undo import')
      .trigger('click')
    await flushPromises()
    expect(w.get('.sheet').text()).toContain(
      "Can't undo this import — something newer was recorded",
    )
    w.unmount()
  })

  it.each([
    ['undone: a badge, no button', { undone: true }, true],
    ['something newer was recorded', { lastMovementAfter: 'm4' }, false],
    ['older than 24 h', { created: old }, false],
  ])('no Undo import when %s', async (_, extra, badge) => {
    setup(extra)
    const { wrapper: w } = await mountHistory()
    expect(w.find('[data-test="undo-import"]').exists()).toBe(false)
    expect(w.get('[data-import="i1"] summary').text().includes('Undone')).toBe(badge)
    w.unmount()
  })
})

describe('History: imports that only linked serials (spec §13.11.11)', () => {
  const quiet = (extra = {}) => ({
    id: 'q1',
    host: 'pib',
    created: recent,
    undone: false,
    lastMovementAfter: 'm3',
    summary: { adopt: 1, serialsLinked: 2 },
    ...extra,
  })
  afterEach(() => (fx.quiet = []))

  it('shown on its day with what it did, and Undo import while newest', async () => {
    fx.quiet = [quiet()]
    const { wrapper: w } = await mountHistory()
    await flushPromises()
    const g = w.get('[data-import="q1"]')
    expect(g.get('summary').text()).toContain(
      'Discovery import · pi-b · 0 movements, 2 serials linked',
    )
    expect(g.get('[data-test="quiet-import"]').text()).toContain('No quantities changed')
    expect(g.find('[data-test="undo-import"]').exists()).toBe(true)
    w.unmount()
  })

  it('not with a type filter; not when it linked nothing', async () => {
    fx.quiet = [quiet(), quiet({ id: 'q2', summary: { serialsLinked: 0 } })]
    let { wrapper: w } = await mountHistory()
    await flushPromises()
    expect(w.find('[data-import="q2"]').exists()).toBe(false)
    w.unmount()
    ;({ wrapper: w } = await mountHistory('?type=move'))
    await flushPromises()
    expect(w.find('[data-import="q1"]').exists()).toBe(false)
    w.unmount()
  })
})
