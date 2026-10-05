import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

const fx = vi.hoisted(() => ({ state: null }))
vi.mock('@/stores/inventory.js', () => ({ useInventory: () => fx.state }))
vi.mock('@/lib/api.js', () => ({
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  listImports: vi.fn(),
}))

import { createEntry, deleteEntry, listImports, updateEntry } from '@/lib/api.js'
import ReferenceListView from './ReferenceListView.vue'
import { makeInventory, mountAt } from './testing.js'

beforeEach(() => {
  fx.state = makeInventory({
    locations: {
      gone: {
        id: 'gone',
        label: 'Old shed',
        kind: 'site',
        sortOrder: 9,
        retired: true,
        referenced: false,
      },
    },
  })
  for (const f of [createEntry, updateEntry, deleteEntry]) f.mockReset().mockResolvedValue({})
  listImports.mockReset().mockResolvedValue([])
})
afterEach(() => (document.body.innerHTML = ''))

const mountList = (kind) =>
  mountAt(ReferenceListView, `/settings/${kind}`, { routeName: 'settings-list' })
const rowOf = (w, id) => w.get(`li[data-id="${id}"]`)
// active list only (the collapsed Retired group uses the same list styling)
const labels = (w) =>
  w
    .findAll('ul.list')[0]
    .findAll('li .label')
    .map((l) => l.text())

describe('Sites (spec §4.10)', () => {
  it('active sites in order, In transit pinned last and rename-only; retired collapsed', async () => {
    const { wrapper: w } = await mountList('sites')
    expect(labels(w)).toEqual(['Lab', 'Office', 'Home', 'In transit'])
    const trn = rowOf(w, 'trn')
    expect(trn.text()).toContain('System entry: can be renamed')
    expect(trn.find('[data-test="retire"]').exists()).toBe(false)
    expect(trn.find('[data-test="delete"]').exists()).toBe(false)
    expect(trn.get('[data-test="edit"]').text()).toBe('Rename')
    expect(w.get('details.retired summary').text()).toBe('Retired (1)')
    w.unmount()
  })

  it('Delete only for entries never referenced', async () => {
    const { wrapper: w } = await mountList('sites')
    expect(rowOf(w, 'lab').find('[data-test="delete"]').exists()).toBe(false) // referenced
    expect(rowOf(w, 'home').find('[data-test="delete"]').exists()).toBe(true)
    await rowOf(w, 'home').get('[data-test="delete"]').trigger('click')
    expect(w.get('.sheet h2').text()).toBe('Delete Home?')
    await w
      .findAll('.sheet button')
      .find((b) => b.text() === 'Delete')
      .trigger('click')
    await flushPromises()
    expect(deleteEntry).toHaveBeenCalledWith('locations', 'home')
    w.unmount()
  })

  it('add a site with a default currency; it goes last', async () => {
    const { wrapper: w } = await mountList('sites')
    await w.get('.add').trigger('click')
    await w.get('#ef-label').setValue('Hamburg')
    await w.get('#ef-currency').setValue('EUR')
    await w.get('.entry-form').trigger('submit')
    await flushPromises()
    expect(createEntry).toHaveBeenCalledWith('locations', {
      label: 'Hamburg',
      defaultCurrency: 'EUR',
      sortOrder: 3,
      kind: 'site',
    })
    w.unmount()
  })

  it('duplicate label among active entries is caught before sending', async () => {
    const { wrapper: w } = await mountList('sites')
    await w.get('.add').trigger('click')
    await w.get('#ef-label').setValue('lab')
    await w.get('.entry-form').trigger('submit')
    await flushPromises()
    expect(createEntry).not.toHaveBeenCalled()
    expect(w.text()).toContain('A site named lab already exists')
    w.unmount()
  })

  it('↑/↓ reorder writes the new sortOrders', async () => {
    const { wrapper: w } = await mountList('sites')
    await rowOf(w, 'home').get('[aria-label="Move up"]').trigger('click')
    await flushPromises()
    expect(updateEntry.mock.calls).toEqual([
      ['locations', 'home', { sortOrder: 1 }],
      ['locations', 'ofc', { sortOrder: 2 }],
    ])
    expect(rowOf(w, 'lab').get('[aria-label="Move up"]').element.disabled).toBe(true)
    w.unmount()
  })

  it('retire: the server guard message is shown on the row', async () => {
    updateEntry.mockRejectedValueOnce({
      status: 400,
      response: {
        message:
          "Can't retire Lab — 1 part still has spare stock there. Move or stock them out first.",
        data: { code: 'in_use', parts: 1 },
      },
    })
    const { wrapper: w } = await mountList('sites')
    await rowOf(w, 'lab').get('[data-test="retire"]').trigger('click')
    await flushPromises()
    expect(updateEntry).toHaveBeenCalledWith('locations', 'lab', { retired: true })
    expect(rowOf(w, 'lab').get('.row-error').text()).toContain(
      "Can't retire Lab — 1 part still has spare stock there",
    )
    w.unmount()
  })

  it('unretire into a taken name: "A site named … already exists"', async () => {
    updateEntry.mockRejectedValueOnce({
      status: 400,
      response: {
        message: 'x',
        data: { label: { code: 'validation_not_unique', message: 'Value must be unique.' } },
      },
    })
    const { wrapper: w } = await mountList('sites')
    await w.get('details.retired').element.setAttribute('open', '')
    await rowOf(w, 'gone').get('[data-test="unretire"]').trigger('click')
    await flushPromises()
    expect(updateEntry).toHaveBeenCalledWith('locations', 'gone', { retired: false })
    expect(rowOf(w, 'gone').get('.row-error').text()).toBe('A site named Old shed already exists')
    w.unmount()
  })

  it('rename In transit sends only the label', async () => {
    const { wrapper: w } = await mountList('sites')
    await rowOf(w, 'trn').get('[data-test="edit"]').trigger('click')
    await w.get('#ef-label-trn').setValue('Suitcase')
    await rowOf(w, 'trn').get('form').trigger('submit')
    await flushPromises()
    expect(updateEntry).toHaveBeenCalledWith('locations', 'trn', { label: 'Suitcase' })
    w.unmount()
  })
})

describe('Hosts and categories (spec §4.10)', () => {
  it('hosts show type and site; adding needs a site', async () => {
    const { wrapper: w } = await mountList('hosts')
    expect(rowOf(w, 'pib').text()).toContain('Raspberry Pi 5 (8 GB) · Lab')
    await w.get('.add').trigger('click')
    await w.get('#ef-label').setValue('nas')
    await w.get('#ef-site').setValue('home')
    await w.get('#ef-type').setValue('NAS')
    await w.get('.entry-form').trigger('submit')
    await flushPromises()
    expect(createEntry).toHaveBeenCalledWith('hosts', {
      label: 'nas',
      type: 'NAS',
      site: 'home',
      sortOrder: 2,
    })
    w.unmount()
  })

  it('hosts link to Import discovery and show their last import (spec §13.4.6)', async () => {
    listImports.mockResolvedValue([
      {
        id: 'i3',
        host: 'pib',
        created: '2026-10-05 01:00:00.000Z',
        collector: 'stocky-collect 1.0.0',
        undone: true,
      },
      {
        id: 'i2',
        host: 'pib',
        created: '2026-10-04 01:00:00.000Z',
        collector: 'stocky-collect 1.0.0',
        undone: false,
      },
      {
        id: 'i1',
        host: 'pib',
        created: '2026-10-01 01:00:00.000Z',
        collector: 'stocky-collect 0.9',
        undone: false,
      },
    ])
    const { wrapper: w } = await mountList('hosts')
    expect(rowOf(w, 'pib').get('[data-test="import"]').attributes('href')).toBe(
      '/settings/hosts/pib/import',
    )
    // the newest import that wasn't undone
    expect(rowOf(w, 'pib').get('[data-test="last-import"]').text()).toMatch(
      /^Last import \w{3}, (4 Oct|Oct 4), 2026 · stocky-collect 1\.0\.0$/,
    )
    expect(rowOf(w, 'nsb').find('[data-test="last-import"]').exists()).toBe(false)
    w.unmount()
  })

  it('sites and categories have no Import link and load no imports', async () => {
    const { wrapper: w } = await mountList('sites')
    expect(w.find('[data-test="import"]').exists()).toBe(false)
    expect(listImports).not.toHaveBeenCalled()
    w.unmount()
  })

  it('a site retired since keeps showing for its host', async () => {
    fx.state.records.locations.ofc.retired = true
    const { wrapper: w } = await mountList('hosts')
    await rowOf(w, 'nsb').get('[data-test="edit"]').trigger('click')
    const options = w
      .get('#ef-site-nsb')
      .findAll('option')
      .map((o) => o.text())
    expect(options).toContain('Office (retired)')
    w.unmount()
  })

  it('categories: add with a description', async () => {
    const { wrapper: w } = await mountList('categories')
    expect(labels(w)).toEqual(['Storage', 'Power'])
    await w.get('.add').trigger('click')
    await w.get('#ef-label').setValue('Cables')
    await w.get('#ef-description').setValue('Ethernet, USB')
    await w.get('.entry-form').trigger('submit')
    await flushPromises()
    expect(createEntry).toHaveBeenCalledWith('categories', {
      label: 'Cables',
      description: 'Ethernet, USB',
      sortOrder: 2,
    })
    w.unmount()
  })

  it('empty hosts list: "No hosts yet"', async () => {
    fx.state.records.hosts = {}
    const { wrapper: w } = await mountList('hosts')
    expect(w.text()).toContain('No hosts yet')
    w.unmount()
  })
})
