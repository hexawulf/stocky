import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fx = vi.hoisted(() => ({ state: null }))
vi.mock('@/stores/inventory.js', () => ({ useInventory: () => fx.state }))

import HomeView from './HomeView.vue'
import { makeInventory, mountAt } from './testing.js'

beforeEach(() => {
  fx.state = makeInventory({
    parts: {
      p2: {
        id: 'p2',
        name: 'Pi PSU 27W',
        category: 'pw',
        unit: 'pcs',
        spare: { lab: 2 },
        installed: {},
        spareTotal: 2,
        lowStockEnabled: false,
        lowStockThreshold: 0,
        archived: false,
      },
    },
  })
})
afterEach(() => (document.body.innerHTML = ''))

const mountHome = () => mountAt(HomeView, '/', { routeName: 'home' })
// "name qty" per list row (link text + badge)
const rows = (el) =>
  el.findAll('li').map((li) => `${li.get('a').text()} ${li.get('.badge').text()}`)

describe('Home (spec §4.3)', () => {
  it('low stock card: total incl. In transit, the transit share, the minimum', async () => {
    const { wrapper: w } = await mountHome()
    const card = w.get('[data-test="low-stock"]')
    expect(card.text()).toContain('microSD 128 GB')
    expect(card.text().replace(/\s+/g, ' ')).toContain('4 pcs (1 in transit) · min 4')
    expect(card.text()).not.toContain('Pi PSU') // alerts off
    w.unmount()
  })

  it('a section per active site in order, then In transit; grouped by category with badges', async () => {
    const { wrapper: w } = await mountHome()
    expect(w.findAll('.tabs button').map((b) => b.text().replace(/\s+/g, ' '))).toEqual([
      'Lab 5',
      'Office 0',
      'Home 0',
      'In transit 1',
    ])
    const lab = w.get('[data-location="lab"]')
    expect(lab.findAll('h3').map((h) => h.text())).toEqual(['Storage', 'Power'])
    expect(lab.text()).toContain('5 pcs')
    expect(rows(lab)).toEqual(['microSD 128 GB 3 pcs', 'Pi PSU 27W 2 pcs'])
    w.unmount()
  })

  it('phone tabs: one location shown at a time', async () => {
    const { wrapper: w } = await mountHome()
    expect(w.get('[data-location="lab"]').classes()).toContain('shown')
    expect(w.get('[data-location="trn"]').classes()).not.toContain('shown')
    await w.findAll('.tabs button')[3].trigger('click')
    expect(w.get('[data-location="trn"]').classes()).toContain('shown')
    expect(w.get('[data-location="lab"]').classes()).not.toContain('shown')
    w.unmount()
  })

  it('empty places: "Nothing spare in Office" with Record stock in; "Nothing in transit"', async () => {
    fx.state.records.parts.p1.spare = { lab: 3 }
    const { wrapper: w } = await mountHome()
    const ofc = w.get('[data-location="ofc"]')
    expect(ofc.text()).toContain('Nothing spare in Office')
    expect(ofc.get('a').attributes('href')).toBe('/record?type=stock_in')
    expect(w.get('[data-location="trn"]').text()).toContain('Nothing in transit')
    expect(w.get('[data-location="trn"]').find('a').exists()).toBe(false)
    w.unmount()
  })

  it('Installed: collapsed by default, hosts by site with their parts', async () => {
    const { wrapper: w } = await mountHome()
    const inst = w.get('[data-test="installed"]')
    expect(inst.attributes('open')).toBeUndefined()
    expect(inst.findAll('h3').map((h) => h.text())).toEqual(['Lab', 'Office'])
    const pib = inst.findAll('.host').find((h) => h.get('.host-name').text() === 'pi-b')
    expect(rows(pib)).toEqual(['microSD 128 GB 1 pc'])
    expect(inst.text()).toContain('Nothing recorded as installed') // nas-b
    w.unmount()
  })

  it('empty catalog: "Your catalog is empty" → Add your first part', async () => {
    fx.state.records.parts = {}
    const { wrapper: w } = await mountHome()
    expect(w.text()).toContain('Your catalog is empty')
    expect(w.get('a').attributes('href')).toBe('/parts/new')
    w.unmount()
  })
})
