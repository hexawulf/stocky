import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { reactive, ref } from 'vue'

const fx = vi.hoisted(() => ({ state: null, user: null, list: null }))
vi.mock('@/stores/inventory.js', () => ({ useInventory: () => fx.state }))
vi.mock('@/stores/auth.js', () => ({ useAuth: () => ({ user: fx.user }) }))
vi.mock('@/stores/movements.js', () => ({
  useMovementList: (getFilters) => ((fx.list.getFilters = getFilters), fx.list),
}))
vi.mock('@/lib/api.js', () => ({ updatePart: vi.fn(), undoMovement: vi.fn() }))
vi.mock('@/lib/dates.js', () => ({ todayLocal: () => '2026-10-04' }))

import { undoMovement, updatePart } from '@/lib/api.js'
import { useToast } from '@/stores/toast.js'
import PartDetailView from './PartDetailView.vue'
import { makeInventory, mountAt } from './testing.js'

const now = new Date()
const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString().replace('T', ' ')
const old = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString().replace('T', ' ')

function makeList(items) {
  return {
    items: ref(items),
    undone: reactive(new Set(items.filter((m) => m.reverses).map((m) => m.reverses))),
    loading: ref(false),
    done: ref(true),
    error: ref(null),
    start: vi.fn(),
    stop: vi.fn(),
    reload: vi.fn(),
    loadMore: vi.fn(),
  }
}

beforeEach(() => {
  fx.state = makeInventory({
    locations: {
      gone: { id: 'gone', label: 'Old shed', kind: 'site', sortOrder: 9, retired: true },
    },
  })
  fx.state.records.parts.p1.spare = { lab: 3, trn: 1, gone: 2 }
  fx.state.records.parts.p1.spareTotal = 6
  fx.user = ref({ id: 'u1', lastMovementId: 'm3' })
  fx.list = makeList([
    {
      id: 'm3',
      type: 'install',
      part: 'p1',
      quantity: 1,
      fromLocation: 'lab',
      toHost: 'pib',
      date: '2026-10-04',
      created: recent,
      reverses: '',
      note: '',
    },
    {
      id: 'm2',
      type: 'move',
      part: 'p1',
      quantity: 1,
      fromLocation: 'lab',
      toLocation: 'trn',
      date: '2026-10-03',
      created: old,
      reverses: '',
      note: 'LAB→HAM flight',
    },
    {
      id: 'm1',
      type: 'stock_in',
      part: 'p1',
      quantity: 5,
      toLocation: 'lab',
      priceMinor: 590,
      priceCurrency: 'TWD',
      date: '2026-09-12',
      created: old,
      reverses: '',
      note: '',
    },
  ])
  updatePart.mockReset().mockResolvedValue({})
  undoMovement.mockReset().mockResolvedValue({ movement: { id: 'm4' }, part: {} })
})
afterEach(() => (document.body.innerHTML = ''))

const mountDetail = (id = 'p1') => mountAt(PartDetailView, `/parts/${id}`, { routeName: 'part' })

describe('Part detail (spec §4.5)', () => {
  it('header: name, category chip, unit, maker, threshold', async () => {
    const { wrapper: w } = await mountDetail()
    expect(w.get('h1').text()).toBe('microSD 128 GB')
    expect(w.get('.chip').text()).toBe('Storage')
    expect(w.text()).toContain('SanDisk High Endurance')
    expect(w.text()).toContain('Low-stock alert at 4 pcs or less')
    w.unmount()
  })

  it('quantity grid: per active place, retired places only with stock, total; installed list', async () => {
    const { wrapper: w } = await mountDetail()
    const cells = w
      .findAll('.grid .cell')
      .map((c) => `${c.get('.label').text()} ${c.get('.value').text()}`)
    expect(cells).toEqual([
      'Lab 3 pcs',
      'Office 0 pcs',
      'Home 0 pcs',
      'In transit 1 pc',
      'Old shed (retired) 2 pcs',
      'Total spare 6 pcs',
    ])
    expect(w.get('.installed').text()).toContain('pi-b')
    expect(w.get('.installed').text()).toContain('1 pc')
    w.unmount()
  })

  it('actions link to Record with type and part; impossible ones are disabled with a hint', async () => {
    fx.state.records.parts.p1.installed = {}
    const { wrapper: w } = await mountDetail()
    expect(w.get('a[data-action="move"]').attributes('href')).toBe('/record?type=move&part=p1')
    const uninstall = w.get('[data-action="uninstall"]')
    expect(uninstall.element.tagName).toBe('SPAN')
    expect(uninstall.text()).toContain('Nothing installed')
    w.unmount()
  })

  it('no spare stock: Move, Install and Stock out disabled', async () => {
    fx.state.records.parts.p1.spare = {}
    fx.state.records.parts.p1.spareTotal = 0
    const { wrapper: w } = await mountDetail()
    expect(w.get('[data-action="move"]').text()).toContain('No spare stock to move')
    expect(w.get('[data-action="stock_out"]').element.tagName).toBe('SPAN')
    expect(w.get('a[data-action="stock_in"]').exists()).toBe(true)
    w.unmount()
  })

  it('archived: every action disabled with "unarchive it first"; menu offers Unarchive', async () => {
    fx.state.records.parts.p1.archived = true
    const { wrapper: w } = await mountDetail()
    expect(w.findAll('a[data-action]')).toHaveLength(0)
    expect(w.get('[data-action="stock_in"]').text()).toContain('unarchive it first')
    await w.get('.more').trigger('click')
    expect(w.get('.menu-list').text()).toContain('Unarchive')
    w.unmount()
  })

  it('history: recent movements filtered to this part, Show all → History', async () => {
    const { wrapper: w } = await mountDetail()
    expect(fx.list.getFilters()).toEqual({ part: 'p1' })
    expect(fx.list.start).toHaveBeenCalled()
    expect(w.findAll('.history .row')).toHaveLength(3)
    expect(w.text()).toContain('LAB→HAM flight')
    expect(w.text()).toMatch(/NT\$590|590/)
    expect(w.get('.show-all').attributes('href')).toBe('/history?part=p1')
    w.unmount()
  })

  it('Undo only on the newest eligible movement; confirm sheet shows the reversal', async () => {
    const { wrapper: w } = await mountDetail()
    const buttons = w.findAll('[data-test="undo"]')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].element.closest('[data-id]').dataset.id).toBe('m3')
    await buttons[0].trigger('click')
    expect(w.get('[data-test="reversal"]').text()).toBe(
      'Uninstall 1 × microSD 128 GB from pi-b → Lab on 2026-10-04',
    )
    await w
      .findAll('.sheet button')
      .find((b) => b.text() === 'Undo')
      .trigger('click')
    await flushPromises()
    expect(undoMovement).toHaveBeenCalledWith('m3')
    expect(w.find('.sheet').exists()).toBe(false)
    expect(useToast().toasts.value.at(-1).message).toBe('Undone')
    w.unmount()
  })

  it('an undo the server refuses keeps the sheet open with its message', async () => {
    undoMovement.mockRejectedValueOnce({
      status: 400,
      response: {
        message: "Can't undo — a newer movement was recorded",
        data: { code: 'not_newest' },
      },
    })
    const { wrapper: w } = await mountDetail()
    await w.get('[data-test="undo"]').trigger('click')
    await w
      .findAll('.sheet button')
      .find((b) => b.text() === 'Undo')
      .trigger('click')
    await flushPromises()
    expect(w.get('.sheet').text()).toContain("Can't undo — a newer movement was recorded")
    w.unmount()
  })

  it('undone movements are greyed with a badge; their reversal reads "Undo of: …"', async () => {
    fx.list = makeList([
      {
        id: 'm4',
        type: 'uninstall',
        part: 'p1',
        quantity: 1,
        fromHost: 'pib',
        toLocation: 'lab',
        date: '2026-10-04',
        created: recent,
        reverses: 'm3',
        note: 'Undo of 2026-10-04 install',
      },
      {
        id: 'm3',
        type: 'install',
        part: 'p1',
        quantity: 1,
        fromLocation: 'lab',
        toHost: 'pib',
        date: '2026-10-04',
        created: recent,
        reverses: '',
        note: '',
      },
    ])
    fx.user.value.lastMovementId = 'm4'
    const { wrapper: w } = await mountDetail()
    const [rev, orig] = w.findAll('.history .row')
    expect(rev.text()).toContain('Undo of: 2026-10-04 install')
    expect(orig.classes()).toContain('undone')
    expect(orig.text()).toContain('Undone')
    expect(w.findAll('[data-test="undo"]')).toHaveLength(0) // a reversal can't be undone
    w.unmount()
  })

  it('Archive from the menu', async () => {
    const { wrapper: w } = await mountDetail()
    await w.get('.more').trigger('click')
    await w
      .findAll('.menu-list button')
      .find((b) => b.text() === 'Archive')
      .trigger('click')
    await flushPromises()
    expect(updatePart).toHaveBeenCalledWith('p1', { archived: true })
    w.unmount()
  })

  it('a bad link: "Part not found"', async () => {
    const { wrapper: w } = await mountDetail('nope')
    expect(w.text()).toContain('Part not found')
    w.unmount()
  })
})
