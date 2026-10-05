import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const fx = vi.hoisted(() => ({ state: null }))
vi.mock('@/stores/inventory.js', () => ({ useInventory: () => fx.state }))
vi.mock('@/stores/auth.js', () => ({
  useAuth: () => ({ user: ref({ email: 'me@test.local' }), logout: vi.fn() }),
}))
vi.mock('@/lib/api.js', () => ({ recalculatePart: vi.fn() }))

import { recalculatePart } from '@/lib/api.js'
import SettingsView from './SettingsView.vue'
import { useAbout } from '@/composables/useAbout.js'
import { makeInventory, mountAt } from './testing.js'

beforeEach(() => {
  fx.state = makeInventory()
  recalculatePart.mockReset()
})
afterEach(() => (document.body.innerHTML = ''))

const mountSettings = () => mountAt(SettingsView, '/settings', { routeName: 'settings' })

describe('Settings (spec §4.9)', () => {
  it('account and links to the three lists with active counts', async () => {
    const { wrapper: w } = await mountSettings()
    expect(w.text()).toContain('me@test.local')
    const links = w.findAll('.links a')
    expect(links.map((a) => a.attributes('href'))).toEqual([
      '/settings/sites',
      '/settings/hosts',
      '/settings/categories',
    ])
    expect(links[0].text()).toContain('4') // Lab, Office, Home, In transit
    expect(links[2].text()).toContain('2') // Old stuff is retired
    w.unmount()
  })
})

describe('Recalculate totals (spec §7.6)', () => {
  it('a check that matches', async () => {
    recalculatePart.mockResolvedValue({
      matches: true,
      fixed: false,
      movements: 3,
      stored: {},
      computed: {},
      dippedBelowZero: false,
    })
    const { wrapper: w } = await mountSettings()
    await w.get('[aria-label="Part to check"]').setValue('p1')
    await w
      .findAll('button')
      .find((b) => b.text() === 'Check')
      .trigger('click')
    await flushPromises()
    expect(recalculatePart).toHaveBeenCalledWith('p1', false)
    expect(w.get('[data-test="recalc-result"]').text()).toContain(
      'Stored totals match the history (3 movements)',
    )
    w.unmount()
  })

  it('a difference: table per place, then Fix writes', async () => {
    recalculatePart
      .mockResolvedValueOnce({
        matches: false,
        fixed: false,
        movements: 4,
        stored: { spare: { lab: 99 }, installed: { pib: 1 } },
        computed: { spare: { lab: 3, trn: 1 }, installed: { pib: 1 } },
        dippedBelowZero: true,
      })
      .mockResolvedValueOnce({
        matches: false,
        fixed: true,
        movements: 4,
        stored: {},
        computed: {},
        dippedBelowZero: true,
      })
    const { wrapper: w } = await mountSettings()
    await w.get('[aria-label="Part to check"]').setValue('p1')
    await w
      .findAll('button')
      .find((b) => b.text() === 'Check')
      .trigger('click')
    await flushPromises()
    // cells: place, stored, from history
    expect(
      w
        .findAll('tbody tr')[0]
        .findAll('td')
        .map((td) => td.text()),
    ).toEqual(['Lab', '99 pcs', '3 pcs'])
    expect(w.findAll('tbody tr.differs')).toHaveLength(2) // Lab, In transit
    expect(w.text()).toContain('dipped below zero')
    await w
      .findAll('button')
      .find((b) => b.text() === 'Fix')
      .trigger('click')
    await flushPromises()
    expect(recalculatePart).toHaveBeenLastCalledWith('p1', true)
    w.unmount()
  })
})

describe('Settings: About Stocky (spec §4)', () => {
  it('an "About Stocky" row opens the About dialog', async () => {
    const { wrapper: w } = await mountSettings()
    const row = w.get('[data-test="settings-about"]')
    expect(row.text()).toContain('About Stocky')
    await row.trigger('click')
    expect(useAbout().isOpen.value).toBe(true)
    useAbout().close()
    expect(document.activeElement).toBe(row.element) // focus comes back to the row
    w.unmount()
  })
})
