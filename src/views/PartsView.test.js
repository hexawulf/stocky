import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

const fx = vi.hoisted(() => ({ state: null }))
vi.mock('@/stores/inventory.js', () => ({ useInventory: () => fx.state }))

import PartsView from './PartsView.vue'
import { makeInventory, mountAt } from './testing.js'

beforeEach(() => {
  fx.state = makeInventory({
    parts: {
      p2: {
        id: 'p2',
        name: 'ATX PSU 650W',
        nameKey: 'atx psu 650w',
        category: 'pw',
        unit: 'pcs',
        manufacturer: 'Seasonic',
        model: 'Focus',
        spare: {},
        installed: {},
        spareTotal: 0,
        lowStockEnabled: false,
        lowStockThreshold: 0,
        archived: false,
      },
      p3: {
        id: 'p3',
        name: 'Old HDD 500 GB',
        nameKey: 'old hdd 500 gb',
        category: 'old',
        unit: 'pcs',
        manufacturer: '',
        model: '',
        spare: {},
        installed: {},
        spareTotal: 0,
        lowStockEnabled: false,
        lowStockThreshold: 0,
        archived: true,
      },
    },
  })
})
afterEach(() => (document.body.innerHTML = ''))

const names = (w) => w.findAll('.list .name').map((n) => n.text().replace('Archived', '').trim())
const mountParts = (path = '/parts') => mountAt(PartsView, path, { routeName: 'parts' })

describe('Parts list (spec §4.4)', () => {
  it('rows: name, category, maker, spares with unit, low-stock dot; archived hidden', async () => {
    const { wrapper: w } = await mountParts()
    expect(names(w)).toEqual(['ATX PSU 650W', 'microSD 128 GB'])
    const row = w.findAll('.list li')[1]
    expect(row.text()).toContain('Storage · SanDisk High Endurance')
    expect(row.text()).toContain('4 pcs')
    expect(row.find('.low').exists()).toBe(true) // 4 ≤ 4
    expect(w.findAll('.list li')[0].find('.low').exists()).toBe(false) // alerts off
    w.unmount()
  })

  it('search matches name, manufacturer and model', async () => {
    const { wrapper: w } = await mountParts()
    await w.get('input[type="search"]').setValue('seasonic')
    expect(names(w)).toEqual(['ATX PSU 650W'])
    await w.get('input[type="search"]').setValue('high end')
    expect(names(w)).toEqual(['microSD 128 GB'])
    w.unmount()
  })

  it('category chips filter, a second tap clears; retired categories have no chip', async () => {
    const { wrapper: w } = await mountParts()
    const chips = w.findAll('.chips button')
    expect(chips.map((c) => c.text())).toEqual(['Storage', 'Power'])
    await chips[1].trigger('click')
    expect(names(w)).toEqual(['ATX PSU 650W'])
    await chips[1].trigger('click')
    expect(names(w)).toHaveLength(2)
    w.unmount()
  })

  it('archived toggle shows archived parts, marked, with a retired category label', async () => {
    const { wrapper: w } = await mountParts()
    await w.get('.toggle input').setValue(true)
    expect(names(w)).toContain('Old HDD 500 GB')
    const row = w.findAll('.list li').find((li) => li.text().includes('Old HDD'))
    expect(row.text()).toContain('Archived')
    expect(row.text()).toContain('Old stuff (retired)')
    w.unmount()
  })

  it('no results: message plus "Add … as a new part" prefilled', async () => {
    const { wrapper: w } = await mountParts()
    await w.get('input[type="search"]').setValue('evo 2tb')
    await flushPromises()
    expect(w.text()).toContain("No parts match 'evo 2tb'")
    const link = w.findAll('a').find((a) => a.text().includes('Add "evo 2tb" as a new part'))
    expect(link.attributes('href')).toBe('/parts/new?name=evo+2tb')
    w.unmount()
  })

  it('empty catalog: "Your catalog is empty" with Add your first part', async () => {
    fx.state = makeInventory()
    delete fx.state.records.parts.p1
    const { wrapper: w } = await mountParts()
    expect(w.text()).toContain('Your catalog is empty')
    expect(w.text()).toContain('Add your first part')
    w.unmount()
  })

  it('loading shows skeleton rows, not a blank screen', async () => {
    fx.state = makeInventory({ status: 'loading' })
    const { wrapper: w } = await mountParts()
    expect(w.find('.skeleton').exists()).toBe(true)
    w.unmount()
  })
})
