import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

const fx = vi.hoisted(() => ({ state: null }))
vi.mock('@/stores/inventory.js', () => ({ useInventory: () => fx.state }))
vi.mock('@/lib/api.js', () => ({
  createPart: vi.fn(),
  updatePart: vi.fn(),
  recordMovement: vi.fn(),
  countPartMovements: vi.fn(),
}))
vi.mock('@/lib/dates.js', () => ({ todayLocal: () => '2026-10-04' }))

import { countPartMovements, createPart, recordMovement, updatePart } from '@/lib/api.js'
import { useToast } from '@/stores/toast.js'
import PartFormView from './PartFormView.vue'
import { makeInventory, mountAt } from './testing.js'

beforeEach(() => {
  fx.state = makeInventory()
  for (const f of [createPart, updatePart, recordMovement, countPartMovements]) f.mockReset()
  createPart.mockResolvedValue({ id: 'new1' })
  updatePart.mockResolvedValue({ id: 'p1' })
  recordMovement.mockResolvedValue({ movement: { id: 'm1' }, part: { id: 'new2' } })
  countPartMovements.mockResolvedValue(3)
})
afterEach(() => (document.body.innerHTML = ''))

const mountNew = (q = '') => mountAt(PartFormView, `/parts/new${q}`, { routeName: 'part-new' })
const mountEdit = (id = 'p1') =>
  mountAt(PartFormView, `/parts/${id}/edit`, { routeName: 'part-edit' })
const save = async (w) => {
  await w.get('form').trigger('submit')
  await flushPromises()
}

describe('New part (spec §4.6)', () => {
  it('?name= prefills; a minimal part is created through the records API', async () => {
    const { wrapper: w, router } = await mountNew('?name=Cat6%20patch%20cable')
    expect(w.get('#pf-name').element.value).toBe('Cat6 patch cable')
    await w.get('#pf-category').setValue('pw')
    await save(w)
    expect(createPart).toHaveBeenCalledWith({
      name: 'Cat6 patch cable',
      category: 'pw',
      unit: 'pcs',
      manufacturer: '',
      model: '',
      notes: '',
      lowStockEnabled: false,
      lowStockThreshold: 0,
    })
    expect(router.currentRoute.value.fullPath).toBe('/parts/new1')
    expect(useToast().toasts.value.at(-1).message).toBe('Part added')
    w.unmount()
  })

  it('required fields and limits are explained; nothing is sent', async () => {
    const { wrapper: w } = await mountNew()
    await w.get('#pf-threshold').setValue('1.5')
    await save(w)
    expect(createPart).not.toHaveBeenCalled()
    expect(w.text()).toContain('Name: 2–80 characters')
    expect(w.text()).toContain('Pick a category')
    expect(w.text()).toContain('or blank for no alert')
    w.unmount()
  })

  it('duplicate name: inline "open it?" link, save blocked', async () => {
    const { wrapper: w } = await mountNew()
    await w.get('#pf-name').setValue('MICROSD  128 gb')
    await w.get('#pf-category').setValue('st')
    expect(w.get('[data-test="duplicate"]').text()).toContain("You already have 'microSD 128 GB'")
    expect(w.get('[data-test="duplicate"] a').attributes('href')).toBe('/parts/p1')
    await save(w)
    expect(createPart).not.toHaveBeenCalled()
    w.unmount()
  })

  it('retired categories are not offered for a new part', async () => {
    const { wrapper: w } = await mountNew()
    const labels = w
      .get('#pf-category')
      .findAll('option')
      .map((o) => o.text())
    expect(labels).not.toContain('Old stuff (retired)')
    w.unmount()
  })

  it('initial stock: one stock in with newPart (part and stock together)', async () => {
    const { wrapper: w, router } = await mountNew()
    await w.get('#pf-name').setValue('NVMe 512 GB')
    await w.get('#pf-category').setValue('st')
    await w.get('#pf-threshold').setValue('1')
    await w.get('[data-test="with-stock"]').setValue(true)
    await w.get('#pf-location').setValue('ofc')
    await flushPromises()
    expect(w.get('select[aria-label="Currency"]').element.value).toBe('EUR')
    await w.get('#pf-price').setValue('39.90')
    await w.get('#pf-qty').setValue('2')
    expect(w.text()).toContain('In euros, not cents')
    expect(w.get('[data-test="price-preview"]').text()).toMatch(/^= €39\.90 each · €79\.80 total$/)
    await save(w)
    expect(createPart).not.toHaveBeenCalled()
    expect(recordMovement).toHaveBeenCalledWith({
      type: 'stock_in',
      quantity: 2,
      toLocation: 'ofc',
      date: '2026-10-04',
      priceMinor: 3990,
      priceCurrency: 'EUR',
      newPart: expect.objectContaining({
        name: 'NVMe 512 GB',
        category: 'st',
        lowStockEnabled: true,
        lowStockThreshold: 1,
      }),
    })
    expect(router.currentRoute.value.fullPath).toBe('/parts/new2')
    w.unmount()
  })

  it('initial stock needs a location', async () => {
    const { wrapper: w } = await mountNew()
    await w.get('#pf-name').setValue('NVMe 512 GB')
    await w.get('#pf-category').setValue('st')
    await w.get('[data-test="with-stock"]').setValue(true)
    await save(w)
    expect(recordMovement).not.toHaveBeenCalled()
    expect(w.text()).toContain('Pick where it goes')
    w.unmount()
  })

  it('server field errors land on the fields; a network error offers Retry', async () => {
    createPart.mockRejectedValueOnce({
      status: 400,
      response: {
        message: 'x',
        data: {
          model: {
            code: 'validation_max_text_constraint',
            message: 'Must be no more than 60 character(s).',
          },
        },
      },
    })
    const { wrapper: w } = await mountNew()
    await w.get('#pf-name').setValue('Thing')
    await w.get('#pf-category').setValue('pw')
    await save(w)
    expect(w.text()).toContain('Must be no more than 60 character(s).')
    createPart.mockRejectedValueOnce({ status: 0 })
    await save(w)
    const t = useToast().toasts.value.at(-1)
    expect(t.message).toBe("Can't reach the server")
    expect(t.actions[0].label).toBe('Retry')
    w.unmount()
  })
})

describe('Edit part (spec §4.6)', () => {
  it('loads the record; threshold shown; update sends the fields', async () => {
    const { wrapper: w, router } = await mountEdit()
    expect(w.get('#pf-name').element.value).toBe('microSD 128 GB')
    expect(w.get('#pf-threshold').element.value).toBe('4')
    expect(w.find('[data-test="with-stock"]').exists()).toBe(false)
    await w.get('#pf-threshold').setValue('')
    await save(w)
    expect(updatePart).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ name: 'microSD 128 GB', lowStockEnabled: false }),
    )
    expect(router.currentRoute.value.fullPath).toBe('/parts/p1')
    w.unmount()
  })

  it('warns before changing the unit of a part with movements', async () => {
    const { wrapper: w } = await mountEdit()
    expect(w.text()).not.toContain('Existing quantities will be shown in the new unit')
    await w.get('#pf-unit').setValue('m')
    expect(w.text()).toContain('Existing quantities will be shown in the new unit')
    w.unmount()
  })

  it('keeps a retired category it already has', async () => {
    fx.state.records.parts.p1.category = 'old'
    const { wrapper: w } = await mountEdit()
    expect(
      w
        .get('#pf-category')
        .findAll('option')
        .map((o) => o.text()),
    ).toContain('Old stuff (retired)')
    await save(w)
    expect(updatePart).toHaveBeenCalled()
    w.unmount()
  })

  it('unknown id: "Part not found"', async () => {
    const { wrapper: w } = await mountEdit('nope')
    expect(w.text()).toContain('Part not found')
    w.unmount()
  })
})

describe('Part form: price slip is visible before saving', () => {
  it('"20000" in EUR reads back as €20,000.00', async () => {
    const { wrapper: w } = await mountNew()
    await w.get('[data-test="with-stock"]').setValue(true)
    await w.get('#pf-location').setValue('ofc')
    await flushPromises()
    await w.get('#pf-price').setValue('20000')
    expect(w.get('[data-test="price-preview"]').text()).toBe('= €20,000.00 each')
    await w.get('#pf-price').setValue('200')
    expect(w.get('[data-test="price-preview"]').text()).toBe('= €200.00 each')
    w.unmount()
  })
})
