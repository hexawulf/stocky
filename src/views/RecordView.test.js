import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, reactive, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

// --- fixtures: example-like lists plus a Home site, one part ----------------------------
// each test gets a fresh inventory (makeInventory) through this holder
const fx = vi.hoisted(() => ({ state: null }))

vi.mock('@/stores/inventory.js', () => ({ useInventory: () => fx.state }))
vi.mock('@/lib/api.js', () => ({
  recordMovement: vi.fn(),
  undoMovement: vi.fn(),
}))
vi.mock('@/lib/dates.js', () => ({ todayLocal: () => '2026-10-04' }))

import { recordMovement } from '@/lib/api.js'
import { setLastCurrency } from '@/lib/prefs.js'
import RecordView from './RecordView.vue'

function makeInventory() {
  const locs = {
    lab: {
      id: 'lab',
      label: 'Lab',
      kind: 'site',
      sortOrder: 0,
      retired: false,
      defaultCurrency: 'TWD',
    },
    ofc: {
      id: 'ofc',
      label: 'Office',
      kind: 'site',
      sortOrder: 1,
      retired: false,
      defaultCurrency: 'EUR',
    },
    home: {
      id: 'home',
      label: 'Home',
      kind: 'site',
      sortOrder: 2,
      retired: false,
      defaultCurrency: '',
    },
    trn: {
      id: 'trn',
      label: 'In transit',
      kind: 'transit',
      sortOrder: 3,
      retired: false,
      defaultCurrency: '',
    },
  }
  const hostMap = {
    pib: { id: 'pib', label: 'pi-b', site: 'lab', sortOrder: 0, retired: false },
    nsb: { id: 'nsb', label: 'nas-b', site: 'ofc', sortOrder: 1, retired: false },
  }
  const partMap = {
    p1: {
      id: 'p1',
      name: 'microSD 128 GB',
      nameKey: 'microsd 128 gb',
      unit: 'pcs',
      spare: { lab: 3, trn: 1 },
      installed: { pib: 1 },
      spareTotal: 4,
      archived: false,
    },
  }
  const records = reactive({
    locations: locs,
    hosts: hostMap,
    parts: partMap,
    categories: { st: { id: 'st', label: 'Storage', sortOrder: 0, retired: false } },
  })
  const online = ref(true)
  const status = ref('ready')
  return {
    records,
    online,
    status,
    canWrite: computed(() => online.value && status.value === 'ready'),
    parts: computed(() => Object.values(records.parts).filter((p) => !p.archived)),
    locations: computed(() =>
      Object.values(records.locations)
        .filter((l) => !l.retired)
        .sort((a, b) =>
          a.kind === b.kind ? a.sortOrder - b.sortOrder : a.kind === 'transit' ? 1 : -1,
        ),
    ),
    hosts: computed(() => Object.values(records.hosts).filter((h) => !h.retired)),
    categories: computed(() => Object.values(records.categories)),
  }
}

async function mountRecord(query = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/record', name: 'record', component: RecordView },
      { path: '/parts/:id', name: 'part', component: { template: '<div />' } },
      { path: '/settings', name: 'settings', component: { template: '<div />' } },
    ],
  })
  router.push({ name: 'record', query })
  await router.isReady()
  const wrapper = mount(RecordView, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const setType = async (w, type) => {
  await w.get(`[data-type="${type}"]`).trigger('click')
  await flushPromises()
}
const options = (w, sel) =>
  w
    .get(sel)
    .findAll('option')
    .map((o) => ({ value: o.element.value, text: o.text(), disabled: o.element.disabled }))
const submit = async (w) => {
  await w.get('form').trigger('submit')
  await flushPromises()
}

beforeEach(() => {
  fx.state = makeInventory()
  recordMovement.mockReset()
  recordMovement.mockResolvedValue({ movement: { id: 'm1' }, part: { id: 'p1' } })
  try {
    localStorage.clear()
  } catch {}
})
afterEach(() => {
  document.body.innerHTML = ''
})

describe('Record: fields per type (spec §4.7 table)', () => {
  it.each([
    ['stock_in', { from: false, to: true, reason: false, price: true }],
    ['stock_out', { from: true, to: false, reason: true, price: false }],
    ['move', { from: true, to: true, reason: false, price: false }],
    ['install', { from: true, to: true, reason: false, price: false }],
    ['uninstall', { from: true, to: true, reason: false, price: false }],
    ['found_installed', { from: false, to: true, reason: false, price: false }],
  ])('%s', async (type, want) => {
    const w = await mountRecord({ part: 'p1' })
    await setType(w, type)
    expect(w.find('#rec-from').exists()).toBe(want.from)
    expect(w.find('#rec-to').exists()).toBe(want.to)
    expect(w.find('[aria-labelledby="rec-reason-label"]').exists()).toBe(want.reason)
    expect(w.find('#rec-price').exists()).toBe(want.price)
    w.unmount()
  })
})

describe('Record: each type submits the right request', () => {
  it('stock_in with a price (currency from the site)', async () => {
    const w = await mountRecord({ part: 'p1', type: 'stock_in' })
    await w.get('#rec-to').setValue('lab')
    await flushPromises()
    expect(w.get('select[aria-label="Currency"]').element.value).toBe('TWD')
    await w.get('#rec-price').setValue('590')
    await w.get('#rec-qty').setValue('5')
    await flushPromises()
    // live reading in major units, with the line total
    expect(w.get('[data-test="price-preview"]').text()).toMatch(
      /^= NT\$590 each · NT\$2,950 total$/,
    )
    expect(w.text()).toContain('In whole NT$')
    expect(w.get('[data-test="summary"]').text()).toBe(
      'Stock in 5 × microSD 128 GB → Lab on 2026-10-04',
    )
    await submit(w)
    expect(recordMovement).toHaveBeenCalledWith({
      type: 'stock_in',
      quantity: 5,
      date: '2026-10-04',
      note: '',
      part: 'p1',
      toLocation: 'lab',
      priceMinor: 590,
      priceCurrency: 'TWD',
    })
    w.unmount()
  })

  it('stock_out needs a reason, then sends it', async () => {
    const w = await mountRecord({ part: 'p1', type: 'stock_out' })
    expect(w.get('#rec-from').element.value).toBe('lab') // first source with stock
    await submit(w)
    expect(recordMovement).not.toHaveBeenCalled()
    expect(w.text()).toContain('Pick a reason')
    await w.get('[aria-labelledby="rec-reason-label"] button').trigger('click') // Used
    await submit(w)
    expect(recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stock_out',
        part: 'p1',
        fromLocation: 'lab',
        reason: 'used',
        quantity: 1,
      }),
    )
    expect(recordMovement.mock.calls[0][0]).not.toHaveProperty('priceCurrency')
    w.unmount()
  })

  it('move: sources show availability, zero ones disabled; can’t move to the source', async () => {
    const w = await mountRecord({ part: 'p1', type: 'move' })
    const from = options(w, '#rec-from').filter((o) => o.value)
    expect(from).toEqual([
      { value: 'lab', text: 'Lab (3 pcs available)', disabled: false },
      { value: 'ofc', text: 'Office (0 pcs available)', disabled: true },
      { value: 'home', text: 'Home (0 pcs available)', disabled: true },
      { value: 'trn', text: 'In transit (1 pc available)', disabled: false },
    ])
    expect(options(w, '#rec-to').map((o) => o.value)).not.toContain('lab')
    await w.get('#rec-to').setValue('trn')
    await w.get('#rec-qty').setValue('2')
    await w.get('#rec-note').setValue('LAB→HAM flight')
    await submit(w)
    expect(recordMovement).toHaveBeenCalledWith({
      type: 'move',
      quantity: 2,
      date: '2026-10-04',
      note: 'LAB→HAM flight',
      part: 'p1',
      fromLocation: 'lab',
      toLocation: 'trn',
    })
    w.unmount()
  })

  it('install: host first, then only its site or In transit (spec §8)', async () => {
    const w = await mountRecord({ part: 'p1', type: 'install' })
    expect(w.get('#rec-from').element.disabled).toBe(true)
    await w.get('#rec-to').setValue('nsb') // Office host
    await flushPromises()
    expect(
      options(w, '#rec-from')
        .filter((o) => o.value)
        .map((o) => o.value),
    ).toEqual(['ofc', 'trn'])
    expect(w.get('#rec-from').element.value).toBe('trn') // Office has none
    await submit(w)
    expect(recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'install', part: 'p1', fromLocation: 'trn', toHost: 'nsb' }),
    )
    w.unmount()
  })

  it('uninstall: from a host that has it, to the host’s site by default', async () => {
    const w = await mountRecord({ part: 'p1', type: 'uninstall' })
    expect(w.get('#rec-from').element.value).toBe('pib')
    expect(w.get('#rec-to').element.value).toBe('lab')
    await submit(w)
    expect(recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'uninstall',
        part: 'p1',
        fromHost: 'pib',
        toLocation: 'lab',
      }),
    )
    w.unmount()
  })
})

describe('Record: validation and errors', () => {
  it('an empty form explains what’s missing and sends nothing', async () => {
    const w = await mountRecord({ type: 'move' })
    await submit(w)
    expect(recordMovement).not.toHaveBeenCalled()
    expect(w.text()).toContain('Pick a part')
    w.unmount()
  })

  it('quantity can’t exceed what’s available', async () => {
    const w = await mountRecord({ part: 'p1', type: 'stock_out' })
    expect(w.get('#rec-qty').attributes('max')).toBe('3')
    w.unmount()
  })

  it('price: a site without a default and nothing remembered → must pick a currency', async () => {
    const w = await mountRecord({ part: 'p1', type: 'stock_in' })
    await w.get('#rec-to').setValue('home')
    await w.get('#rec-price').setValue('12.99')
    await submit(w)
    expect(recordMovement).not.toHaveBeenCalled()
    expect(w.text()).toContain('Pick a currency')
    w.unmount()
  })

  it('price: the last currency used on this device is the fallback', async () => {
    setLastCurrency('USD')
    const w = await mountRecord({ part: 'p1', type: 'stock_in' })
    await w.get('#rec-to').setValue('home')
    await flushPromises()
    expect(w.get('select[aria-label="Currency"]').element.value).toBe('USD')
    w.unmount()
  })

  it('stale stock on this device → "Stock changed on another device"', async () => {
    recordMovement.mockRejectedValue({
      status: 400,
      response: {
        message: 'Only 1 pc available at Lab',
        data: { code: 'insufficient_stock', available: 1 },
      },
    })
    const w = await mountRecord({ part: 'p1', type: 'move' })
    await w.get('#rec-to').setValue('ofc')
    await w.get('#rec-qty').setValue('2')
    await submit(w)
    expect(w.text()).toContain('Stock changed on another device, please review')
    expect(w.get('#rec-to').element.value).toBe('ofc') // values kept on error
    w.unmount()
  })

  it('offline: the Record button is disabled', async () => {
    fx.state.online.value = false
    const w = await mountRecord({ part: 'p1' })
    expect(w.get('button[type="submit"]').element.disabled).toBe(true)
    expect(w.text()).toContain("You're offline")
    w.unmount()
  })
})

describe('Record: new part inline (stock in)', () => {
  it('offered only for a stock in', async () => {
    const w = await mountRecord({ type: 'move' })
    await w.get('#rec-part').trigger('focus')
    expect(w.text()).not.toContain('＋ new part')
    await setType(w, 'stock_in')
    await w.get('#rec-part').trigger('focus')
    expect(w.text()).toContain('＋ new part')
    w.unmount()
  })

  it('duplicate check, then a new part is sent as newPart', async () => {
    const w = await mountRecord({ type: 'stock_in' })
    await w.get('#rec-part').setValue('MICROSD  128 gb')
    await w
      .findAll('button')
      .find((b) => b.text().startsWith('＋ new part'))
      .trigger('click')
    await flushPromises()
    expect(w.text()).toContain("You already have 'microSD 128 GB'")
    await w.get('#rec-new-name').setValue('NVMe SSD 512 GB')
    await w.get('#rec-new-category').setValue('st')
    await w.get('#rec-to').setValue('ofc')
    await flushPromises()
    expect(w.text()).not.toContain('You already have')
    await submit(w)
    expect(recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stock_in',
        newPart: { name: 'NVMe SSD 512 GB', category: 'st', unit: 'pcs' },
        toLocation: 'ofc',
      }),
    )
    expect(recordMovement.mock.calls[0][0]).not.toHaveProperty('part')
    w.unmount()
  })

  it('"use it" switches to the existing part', async () => {
    const w = await mountRecord({ type: 'stock_in' })
    await w.get('#rec-part').setValue('microsd 128 gb')
    await w
      .findAll('button')
      .find((b) => b.text().startsWith('＋ new part'))
      .trigger('click')
    await flushPromises()
    await w
      .findAll('button')
      .find((b) => b.text() === 'use it')
      .trigger('click')
    await flushPromises()
    expect(w.find('#rec-new-name').exists()).toBe(false)
    expect(w.get('#rec-part').element.value).toBe('microSD 128 GB')
    w.unmount()
  })
})

describe('Record: after success', () => {
  it('shows "Recorded" with Undo and View part, resets but keeps the type', async () => {
    const { useToast } = await import('@/stores/toast.js')
    const w = await mountRecord({ part: 'p1', type: 'move' })
    await w.get('#rec-to').setValue('trn')
    await submit(w)
    const t = useToast().toasts.value.at(-1)
    expect(t.message).toBe('Recorded')
    expect(t.actions.map((a) => a.label)).toEqual(['Undo', 'View part'])
    expect(w.get('[data-type="move"]').attributes('aria-checked')).toBe('true')
    expect(w.get('#rec-part').element.value).toBe('')
    w.unmount()
  })
})

describe('Record: found installed and stock out from a host (spec §13.4.1–2)', () => {
  it('found installed: a host, no source, no price; says what it is for', async () => {
    const w = await mountRecord({ part: 'p1', type: 'found_installed' })
    expect(w.get('[data-test="found-hint"]').text()).toMatch(/already in a host/)
    expect(w.get('label[for="rec-to"]').text()).toBe('Found in')
    expect(options(w, '#rec-to').map((o) => o.value)).toEqual(['', 'pib', 'nsb'])
    await w.get('#rec-to').setValue('nsb')
    await w.get('#rec-qty').setValue('2')
    await flushPromises()
    expect(w.get('[data-test="summary"]').text()).toBe(
      'Found installed 2 × microSD 128 GB in nas-b on 2026-10-04',
    )
    await submit(w)
    expect(recordMovement).toHaveBeenCalledWith({
      type: 'found_installed',
      quantity: 2,
      date: '2026-10-04',
      note: '',
      part: 'p1',
      toHost: 'nsb',
    })
    w.unmount()
  })

  it('?host= pre-selects the host (the import screen\'s "Not detectable" link)', async () => {
    const w = await mountRecord({ type: 'found_installed', host: 'nsb' })
    expect(w.get('#rec-to').element.value).toBe('nsb')
    w.unmount()
    // ignored for other types, and for unknown hosts
    const w2 = await mountRecord({ type: 'install', host: 'nsb', part: 'p1' })
    expect(w2.get('#rec-to').element.value).toBe('')
    w2.unmount()
    const w3 = await mountRecord({ type: 'found_installed', host: 'nope' })
    expect(w3.get('#rec-to').element.value).toBe('')
    w3.unmount()
  })

  it('found installed can start a new part', async () => {
    const w = await mountRecord({ type: 'found_installed' })
    await w.get('#rec-part').setValue('Pi 5 Active Cooler')
    await flushPromises()
    const add = w.findAll('button').find((b) => b.text().startsWith('＋ new part'))
    expect(add).toBeTruthy()
    await add.trigger('click')
    await flushPromises()
    await w.get('#rec-new-category').setValue('st')
    await w.get('#rec-to').setValue('pib')
    await submit(w)
    expect(recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'found_installed',
        toHost: 'pib',
        newPart: { name: 'Pi 5 Active Cooler', category: 'st', unit: 'pcs' },
      }),
    )
    w.unmount()
  })

  it('stock out lists hosts with the part installed, and sends fromHost', async () => {
    const w = await mountRecord({ part: 'p1', type: 'stock_out' })
    const groups = w
      .get('#rec-from')
      .findAll('optgroup')
      .map((g) => g.attributes('label'))
    expect(groups).toEqual(['Spares', 'Installed in'])
    expect(w.get('#rec-from').text()).toContain('pi-b (1 pc installed)')
    await w.get('#rec-from').setValue('pib')
    await flushPromises()
    expect(w.text()).toContain('of 1 pc installed')
    await w.get('[aria-labelledby="rec-reason-label"] button').trigger('click') // Used
    await submit(w)
    expect(recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'stock_out', part: 'p1', fromHost: 'pib', reason: 'used' }),
    )
    expect(recordMovement.mock.calls[0][0]).not.toHaveProperty('fromLocation')
    w.unmount()
  })
})
