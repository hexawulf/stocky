import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

const fx = vi.hoisted(() => ({ state: null }))
vi.mock('@/stores/inventory.js', () => ({ useInventory: () => fx.state }))
vi.mock('@/lib/api.js', () => ({
  previewDiscovery: vi.fn(),
  applyDiscovery: vi.fn(),
  listImports: vi.fn(),
  createEntry: vi.fn(),
}))

import { applyDiscovery, createEntry, listImports, previewDiscovery } from '@/lib/api.js'
import { useToast } from '@/stores/toast.js'
import HostImportView from './HostImportView.vue'
import { makeInventory, mountAt } from './testing.js'

const SNAPSHOT = JSON.stringify({
  schema: 'stocky.discovery/1',
  collector: 'stocky-collect 1.0.0',
  host: { hostname: 'pi-b', virtual: false },
  items: [],
})

// what the server proposes (pb_hooks/lib/discovery.js), trimmed to what the screen reads
function proposal() {
  return {
    host: { id: 'pib', label: 'pi-b' },
    snapshot: {
      collector: 'stocky-collect 1.0.0',
      collectedAt: '2026-10-05T09:14:03+08:00',
      hostname: 'pi-b',
      platform: 'aarch64',
      model: 'Raspberry Pi 5 Model B Rev 1.0',
      items: 6,
    },
    previous: { id: 'i0', created: '2026-10-01 01:00:00.000Z', collector: 'stocky-collect 1.0.0' },
    warnings: ['Serial X reported twice; the second drive is matched by count'],
    skipped: [{ kind: 'memory', reason: 'dmidecode needs sudo (--no-sudo given)' }],
    ignored: [{ kind: 'gpu', reason: 'unknown kind' }],
    previewHash: 'h'.repeat(64),
    rows: [
      {
        id: 'r1',
        group: 'replaced',
        role: 'out',
        pair: 'r4',
        kind: 'drive',
        items: [],
        quantity: 1,
        partId: 'p1',
        partName: 'microSD 128 GB',
        matchedBy: 'serial',
        unitIds: ['u1'],
        serials: ['OLD123'],
        slot: 'mmc0',
        noSerial: false,
        options: ['uninstall', 'stock_out', 'ignore'],
        action: 'uninstall',
        location: 'lab',
        reason: 'retired',
        checked: true,
      },
      {
        id: 'r2',
        group: 'missing',
        kind: 'usb',
        items: [],
        quantity: 1,
        partId: 'p1',
        partName: 'microSD 128 GB',
        matchedBy: null,
        unitIds: [],
        serials: [],
        noSerial: true,
        options: ['uninstall', 'stock_out', 'ignore'],
        action: 'ignore',
        location: 'lab',
        reason: 'retired',
        checked: false,
      },
      {
        id: 'r3',
        group: 'new',
        kind: 'drive',
        items: [
          {
            index: 1,
            kind: 'drive',
            label: 'Samsung SSD 980 PRO 1TB',
            serial: 'S5GX',
            sizeBytes: 1000204886016,
            interface: 'nvme',
            slot: 'nvme0',
          },
        ],
        key: 'SAMSUNG SSD 980 PRO 1TB',
        quantity: 1,
        partId: '',
        partName: '',
        matchedBy: null,
        unitIds: [],
        serials: ['S5GX'],
        noSerial: false,
        newPart: {
          name: 'Samsung SSD 980 PRO 1TB NVMe',
          category: 'st',
          unit: 'pcs',
          manufacturer: '',
          model: 'Samsung SSD 980 PRO 1TB',
        },
        suggestions: [{ id: 'p1', name: 'microSD 128 GB' }],
        nameTaken: false,
        options: ['found_installed', 'ignore'],
        action: 'found_installed',
        checked: false,
      },
      {
        id: 'r4',
        group: 'replaced',
        role: 'in',
        pair: 'r1',
        kind: 'drive',
        items: [
          {
            index: 2,
            kind: 'drive',
            label: 'SanDisk SN256',
            serial: 'NEW456',
            sizeBytes: 255869321216,
            interface: 'sd',
            slot: 'mmc0',
          },
        ],
        key: 'SANDISK SN256',
        quantity: 1,
        partId: '',
        partName: '',
        matchedBy: null,
        unitIds: [],
        serials: ['NEW456'],
        noSerial: false,
        newPart: {
          name: 'SanDisk SN256 256 GB',
          category: 'st',
          unit: 'pcs',
          manufacturer: 'SanDisk',
          model: 'SN256',
        },
        suggestions: [],
        nameTaken: false,
        options: ['found_installed', 'ignore'],
        action: 'found_installed',
        checked: true,
      },
      {
        id: 'r5',
        group: 'unchanged',
        kind: 'system',
        items: [
          {
            index: 0,
            kind: 'system',
            label: 'Raspberry Pi Ltd Raspberry Pi 5 Model B Rev 1.0',
            serial: 'PI5',
          },
        ],
        quantity: 1,
        partId: 'p1',
        partName: 'microSD 128 GB',
        matchedBy: 'serial',
        unitIds: ['u5'],
        serials: ['PI5'],
        noSerial: false,
        options: ['none'],
        action: 'none',
        checked: true,
      },
      {
        id: 'r6',
        group: 'ignored',
        kind: 'drive',
        items: [{ index: 3, kind: 'drive', label: 'Old archived disk' }],
        quantity: 1,
        partId: 'px',
        partName: 'Old disk',
        matchedBy: 'serial',
        unitIds: [],
        serials: [],
        noSerial: true,
        reason: 'Old disk is archived',
        options: ['none'],
        action: 'none',
        checked: false,
      },
    ],
  }
}

beforeEach(() => {
  fx.state = makeInventory()
  previewDiscovery.mockReset().mockResolvedValue(proposal())
  applyDiscovery.mockReset().mockResolvedValue({ import: { id: 'i1' }, movements: 3, summary: {} })
  listImports.mockReset().mockResolvedValue([])
  createEntry.mockReset()
  useToast().toasts.value = []
})
afterEach(() => (document.body.innerHTML = ''))

const mountImport = (id = 'pib') =>
  mountAt(HostImportView, `/settings/hosts/${id}/import`, { routeName: 'host-import' })
async function previewWith(w, text = SNAPSHOT) {
  await w.get('#hi-paste').setValue(text)
  await w.get('[data-test="preview"]').trigger('click')
  await flushPromises()
}
const row = (w, id) => w.get(`[data-row="${id}"]`)

describe('Import discovery: upload (spec §13.3.1 steps 1–2)', () => {
  it('names the host, shows the collector command, and needs a file before Preview', async () => {
    const { wrapper: w } = await mountImport()
    expect(w.get('h1').text()).toBe('Import discovery: pi-b')
    expect(w.get('.cmd').text()).toBe('stocky-collect.sh -o pi-b.json')
    expect(w.get('[data-test="preview"]').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it.each([
    ['{"schema": "stocky.discovery/1", items: [}', "That file isn't valid JSON"],
    ['{"schema": "something/2"}', 'Unsupported snapshot format (expected stocky.discovery/1)'],
    [
      '{"schema": "stocky.discovery/1", "host": {"virtual": true}, "items": []}',
      'This snapshot is from a virtual machine; Stocky tracks physical hardware only',
    ],
  ])('checked in the browser first: %s', async (text, message) => {
    const { wrapper: w } = await mountImport()
    await previewWith(w, text)
    expect(w.text()).toContain(message)
    expect(previewDiscovery).not.toHaveBeenCalled()
    w.unmount()
  })

  it("sends the file's text, and shows the server's message if it refuses", async () => {
    previewDiscovery.mockRejectedValueOnce({
      status: 400,
      response: {
        message: 'A snapshot can have at most 200 items',
        data: { code: 'too_many_items' },
      },
    })
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    expect(previewDiscovery).toHaveBeenCalledWith('pib', SNAPSHOT)
    expect(w.text()).toContain('A snapshot can have at most 200 items')
    w.unmount()
  })

  it('an unknown host or a retired one', async () => {
    let { wrapper: w } = await mountImport('nope')
    expect(w.text()).toContain("This host doesn't exist.")
    w.unmount()
    fx.state.records.hosts.nsb.retired = true
    ;({ wrapper: w } = await mountImport('nsb'))
    expect(w.text()).toContain('nas-b (retired) is retired. Unretire it to import.')
    w.unmount()
  })
})

describe('Import discovery: preview (spec §13.3.1 step 4, §13.6, §13.8)', () => {
  it('snapshot line, last import, warnings, skipped and left-out items at the top', async () => {
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    expect(w.get('[data-test="snapshot"]').text().replace(/\s+/g, ' ')).toBe(
      'From pi-b (Raspberry Pi 5 Model B Rev 1.0) · stocky-collect 1.0.0 · 6 items · collected 2026-10-05 09:14',
    )
    expect(w.text()).toMatch(/Last import \w{3}, (1 Oct|Oct 1), 2026 \(stocky-collect 1\.0\.0\)/)
    const notices = w
      .get('[data-test="notices"]')
      .findAll('li')
      .map((li) => li.text())
    expect(notices).toEqual([
      'Serial X reported twice; the second drive is matched by count',
      'memory skipped: dmidecode needs sudo (--no-sudo given)',
      'Left out (gpu): unknown kind',
    ])
    w.unmount()
  })

  it('groups in order; a replaced pair shows both halves', async () => {
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    expect(w.findAll('section.group').map((s) => s.attributes('data-group'))).toEqual([
      'unchanged',
      'new',
      'missing',
      'replaced',
      'ignored',
    ])
    const pair = w.get('section[data-group="replaced"] .pair')
    expect(pair.findAll('.title').map((t) => t.text().replace(/\s+/g, ' '))).toEqual([
      'Out: microSD 128 GB',
      'In: SanDisk SN256 256 GB',
    ])
    expect(row(w, 'r1').text()).toContain('Not detected: S/N OLD123 · was in mmc0')
    w.unmount()
  })

  it('rows show what was detected and how it matched; unchanged has no checkbox', async () => {
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    expect(row(w, 'r3').text()).toContain('1 TB · nvme · nvme0 · S/N S5GX')
    expect(row(w, 'r3').text()).toContain('New part')
    expect(row(w, 'r1').text()).toContain('Matched by serial')
    expect(row(w, 'r2').text()).toContain('no serial: matched by count only')
    expect(row(w, 'r6').text()).toContain('Old disk is archived')
    expect(row(w, 'r5').find('[data-test="apply"]').exists()).toBe(false)
    expect(row(w, 'r6').find('[data-test="apply"]').exists()).toBe(false)
    w.unmount()
  })

  it('defaults: certain rows checked, uncertain ones not', async () => {
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    const checked = (id) => row(w, id).get('[data-test="apply"]').element.checked
    expect([checked('r1'), checked('r2'), checked('r3'), checked('r4')]).toEqual([
      true,
      false,
      false,
      true,
    ])
    expect(w.get('button[data-test="apply"]').text()).toBe('Apply 2 changes')
    w.unmount()
  })

  it('checking a count-only missing row picks a real action, with where it goes', async () => {
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    await row(w, 'r2').get('[data-test="apply"]').setValue(true)
    expect(row(w, 'r2').get('#ir-r2-action').element.value).toBe('uninstall')
    expect(row(w, 'r2').get('#ir-r2-location').element.value).toBe('lab')
    await row(w, 'r2').get('#ir-r2-action').setValue('stock_out')
    expect(row(w, 'r2').get('#ir-r2-reason').element.value).toBe('retired')
    expect(w.get('button[data-test="apply"]').text()).toBe('Apply 3 changes')
    w.unmount()
  })

  it('"Is this …?" uses an existing part instead of creating one', async () => {
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    await row(w, 'r3').get('[data-test="apply"]').setValue(true)
    expect(row(w, 'r3').get('#ir-r3-name').element.value).toBe('Samsung SSD 980 PRO 1TB NVMe')
    await row(w, 'r3').get('[data-test="suggestion"]').trigger('click')
    expect(row(w, 'r3').text()).toContain('Using your part microSD 128 GB')
    expect(row(w, 'r3').find('#ir-r3-name').exists()).toBe(false)
    w.unmount()
  })

  it('a part recorded here by hand is suggested with its count; linking adds the serial only', async () => {
    const p = proposal()
    p.rows[2].suggestions = [{ id: 'p1', name: 'microSD 128 GB', here: 1 }]
    previewDiscovery.mockResolvedValueOnce(p)
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    await row(w, 'r3').get('[data-test="apply"]').setValue(true)
    expect(row(w, 'r3').get('[data-test="suggestion"]').text()).toBe(
      'microSD 128 GB (1 recorded here)',
    )
    await row(w, 'r3').get('[data-test="suggestion"]').trigger('click')
    expect(row(w, 'r3').text().replace(/\s+/g, ' ')).toContain(
      'Using your part microSD 128 GB, already recorded here: adds the serial, no movement.',
    )
    await w.get('button[data-test="apply"]').trigger('click')
    await flushPromises()
    expect(applyDiscovery.mock.calls[0][0].decisions.r3).toEqual({
      apply: true,
      action: 'found_installed',
      partId: 'p1',
    })
    w.unmount()
  })

  it('"Not detectable" panel links to Record → Found installed for this host', async () => {
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    const panel = w.get('[data-test="not-detectable"]')
    expect(panel.text()).toContain(
      "Cases, power supplies, cables, fans and passive adapters can't be detected",
    )
    expect(panel.get('a').attributes('href')).toBe('/record?type=found_installed&host=pib')
    w.unmount()
  })

  it('hostile strings from a snapshot are shown as text, never as markup', async () => {
    const p = proposal()
    p.rows[2].items[0].label = '<img src=x onerror=alert(1)> "q" \\b'
    p.rows[2].newPart.name = '<b>bold</b>'
    previewDiscovery.mockResolvedValueOnce(p)
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('[data-row="r3"] b')).toBeNull()
    expect(row(w, 'r3').text()).toContain('<img src=x onerror=alert(1)> "q" \\b')
    w.unmount()
  })
})

describe('Import discovery: apply (spec §13.3.1 step 5)', () => {
  it('sends the hash and the decisions, then goes back to Hosts with a toast', async () => {
    const { wrapper: w, router } = await mountImport()
    await previewWith(w)
    await row(w, 'r4').get('#ir-r4-name').setValue('SanDisk Extreme 256 GB')
    await w.get('button[data-test="apply"]').trigger('click')
    await flushPromises()
    expect(applyDiscovery).toHaveBeenCalledWith({
      hostId: 'pib',
      snapshotText: SNAPSHOT,
      previewHash: 'h'.repeat(64),
      decisions: {
        r1: { apply: true, action: 'uninstall', location: 'lab' },
        r4: {
          apply: true,
          action: 'found_installed',
          newPart: { name: 'SanDisk Extreme 256 GB', category: 'st', unit: 'pcs' },
        },
        r5: { apply: true, action: 'none' },
      },
    })
    expect(router.currentRoute.value.fullPath).toBe('/settings/hosts')
    expect(useToast().toasts.value.at(-1).message).toBe('Imported for pi-b: 3 movements')
    w.unmount()
  })

  it('a new part needs a name and a category before applying', async () => {
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    await row(w, 'r4').get('#ir-r4-name').setValue('x')
    await w.get('button[data-test="apply"]').trigger('click')
    await flushPromises()
    expect(applyDiscovery).not.toHaveBeenCalled()
    expect(row(w, 'r4').text()).toContain('Name: 2–80 characters')
    w.unmount()
  })

  it('preview_stale: says so, blocks apply, and Review again previews afresh', async () => {
    applyDiscovery.mockRejectedValueOnce({
      status: 400,
      response: {
        message: 'Your inventory changed since this preview; review it again',
        data: { code: 'preview_stale' },
      },
    })
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    await w.get('button[data-test="apply"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Your inventory changed since this preview; review it again')
    expect(w.get('button[data-test="apply"]').attributes('disabled')).toBeDefined()
    const again = w.findAll('button').find((b) => b.text() === 'Review again')
    await again.trigger('click')
    await flushPromises()
    expect(previewDiscovery).toHaveBeenCalledTimes(2)
    expect(w.get('button[data-test="apply"]').attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  it('a row the server refuses is named', async () => {
    applyDiscovery.mockRejectedValueOnce({
      status: 400,
      response: { message: 'Pick a category', data: { code: 'invalid_category', row: 'r4' } },
    })
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    await w.get('button[data-test="apply"]').trigger('click')
    await flushPromises()
    expect(w.get('.form-error').text()).toBe('Pick a category (row 4)')
    w.unmount()
  })

  it('Start over goes back to the upload', async () => {
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    await w
      .findAll('button')
      .find((b) => b.text() === 'Start over')
      .trigger('click')
    expect(w.find('#hi-paste').exists()).toBe(true)
    expect(w.get('#hi-paste').element.value).toBe('')
    w.unmount()
  })
})

describe('Import from the top bar: the file first, then the host (spec §4.11)', () => {
  const snapshotFor = (hostname, machineIdHash = '') =>
    JSON.stringify({
      schema: 'stocky.discovery/1',
      collector: 'stocky-collect 1.0.0',
      host: { hostname, machineIdHash, virtual: false, model: 'Raspberry Pi 5 Model B Rev 1.0' },
      items: [],
    })
  const mountTop = () => mountAt(HostImportView, '/import', { routeName: 'import' })
  const paste = async (w, text) => {
    await w.get('#hi-paste').setValue(text)
    await flushPromises()
  }

  it('no host picker until the file reads as a snapshot; Preview needs a host', async () => {
    const { wrapper: w } = await mountTop()
    expect(w.get('h1').text()).toBe('Import discovery')
    expect(w.get('.cmd').text()).toBe('stocky-collect.sh -o $(hostname).json')
    expect(w.find('[data-test="host-pick"]').exists()).toBe(false)
    await paste(w, snapshotFor('mystery-box'))
    expect(w.find('[data-test="host-pick"]').exists()).toBe(true)
    expect(w.get('#hi-host').element.value).toBe('')
    expect(w.get('[data-test="no-match"]').text()).toContain('No host matches “mystery-box”')
    expect(w.get('[data-test="preview"]').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('suggests the host whose name matches the hostname', async () => {
    const { wrapper: w } = await mountTop()
    await paste(w, snapshotFor('PI-B'))
    expect(w.get('#hi-host').element.value).toBe('pib')
    expect(w.get('[data-test="suggestion"]').text()).toMatch(/name matches the snapshot's hostname/)
    await w.get('[data-test="preview"]').trigger('click')
    await flushPromises()
    expect(previewDiscovery).toHaveBeenCalledWith('pib', snapshotFor('PI-B'))
    expect(w.get('h1').text()).toBe('Import discovery: pi-b')
    w.unmount()
  })

  it('a previous import of the same machine beats the hostname', async () => {
    listImports.mockResolvedValue([
      { id: 'i9', host: 'nsb', machineIdHash: 'sha256:' + 'c'.repeat(64), undone: false },
    ])
    const { wrapper: w } = await mountTop()
    await paste(w, snapshotFor('pi-b', 'sha256:' + 'c'.repeat(64)))
    expect(w.get('#hi-host').element.value).toBe('nsb')
    expect(w.get('[data-test="suggestion"]').text()).toMatch(/this machine was imported/)
    w.unmount()
  })

  it('picking another host by hand sticks', async () => {
    const { wrapper: w } = await mountTop()
    await paste(w, snapshotFor('pi-b'))
    await w.get('#hi-host').setValue('nsb')
    await paste(w, snapshotFor('pi-b') + ' ')
    expect(w.get('#hi-host').element.value).toBe('nsb')
    expect(w.find('[data-test="suggestion"]').exists()).toBe(false)
    w.unmount()
  })

  it('no match: Add host, pre-filled from the snapshot, then preview for it', async () => {
    createEntry.mockResolvedValue({ id: 'new1', label: 'mystery-box', site: 'lab', retired: false })
    const { wrapper: w } = await mountTop()
    await paste(w, snapshotFor('mystery-box'))
    await w.get('[data-test="add-host"]').trigger('click')
    expect(w.get('#hi-new-label').element.value).toBe('mystery-box')
    expect(w.get('#hi-new-type').element.value).toBe('Raspberry Pi 5 Model B Rev 1.0')
    expect(w.get('#hi-new-site').element.value).toBe('lab')
    await w.get('.add-host').trigger('submit')
    await flushPromises()
    expect(createEntry).toHaveBeenCalledWith('hosts', {
      label: 'mystery-box',
      type: 'Raspberry Pi 5 Model B Rev 1.0',
      site: 'lab',
      sortOrder: 2,
    })
    expect(w.get('#hi-host').element.value).toBe('new1')
    await w.get('[data-test="preview"]').trigger('click')
    await flushPromises()
    expect(previewDiscovery).toHaveBeenCalledWith('new1', snapshotFor('mystery-box'))
    w.unmount()
  })

  it('Add host: a name already taken is said so', async () => {
    createEntry.mockRejectedValue({
      status: 400,
      response: {
        message: 'Failed',
        data: { label: { code: 'validation_not_unique', message: 'Value must be unique.' } },
      },
    })
    const { wrapper: w } = await mountTop()
    await paste(w, snapshotFor('mystery-box'))
    await w.get('[data-test="add-host"]').trigger('click')
    await w.get('.add-host').trigger('submit')
    await flushPromises()
    expect(w.get('.add-host').text()).toContain('A host named mystery-box already exists')
    w.unmount()
  })

  it('after applying, History filtered to that host', async () => {
    const { wrapper: w, router } = await mountTop()
    await paste(w, snapshotFor('pi-b'))
    await w.get('[data-test="preview"]').trigger('click')
    await flushPromises()
    await w.get('button[data-test="apply"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/history?place=pib')
    w.unmount()
  })
})

describe('Conflict and declined rows (spec §13.11.9–10)', () => {
  function withConflict() {
    const p = proposal()
    p.rows.push(
      {
        id: 'r7',
        group: 'conflict',
        kind: 'cpu',
        items: [{ index: 4, kind: 'cpu', label: 'AMD Ryzen 7 5700G with Radeon Graphics' }],
        key: 'AMD RYZEN 7 5700G WITH RADEON GRAPHICS',
        quantity: 1,
        partId: '',
        partName: '',
        matchedBy: null,
        unitIds: [],
        serials: [],
        noSerial: true,
        recorded: { partId: 'p1', name: 'Ryzen 7 5700X3D' },
        newPart: { name: 'AMD Ryzen 7 5700G with Radeon Graphics', category: 'st', unit: 'pcs' },
        suggestions: [],
        options: ['keep', 'replace_uninstall', 'replace_stock_out'],
        action: 'keep',
        location: 'lab',
        reason: 'retired',
        checked: true,
      },
      {
        id: 'r8',
        group: 'new',
        declined: true,
        kind: 'usb',
        items: [{ index: 5, kind: 'usb', label: 'Logitech K120 Keyboard' }],
        key: 'LOGITECH K120 KEYBOARD',
        quantity: 1,
        partId: '',
        partName: '',
        matchedBy: null,
        unitIds: [],
        serials: [],
        noSerial: true,
        newPart: { name: 'Logitech K120 Keyboard', category: 'st', unit: 'pcs' },
        suggestions: [],
        options: ['found_installed', 'ignore'],
        action: 'found_installed',
        checked: false,
      },
    )
    return p
  }

  it('a conflict names both models and defaults to keeping the record', async () => {
    previewDiscovery.mockResolvedValueOnce(withConflict())
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    const c = row(w, 'r7')
    expect(c.element.closest('section').dataset.group).toBe('conflict')
    expect(c.get('[data-test="recorded"]').text().replace(/\s+/g, ' ')).toBe(
      'Recorded here: Ryzen 7 5700X3D · detected: AMD Ryzen 7 5700G with Radeon Graphics',
    )
    expect(c.get('#ir-r7-action').element.value).toBe('keep')
    expect(c.find('#ir-r7-name').exists()).toBe(false) // no part needed to keep
    w.unmount()
  })

  it('replace asks where the recorded one goes and what the detected one is', async () => {
    previewDiscovery.mockResolvedValueOnce(withConflict())
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    await row(w, 'r7').get('#ir-r7-action').setValue('replace_uninstall')
    expect(row(w, 'r7').get('#ir-r7-location').element.value).toBe('lab')
    expect(row(w, 'r7').get('#ir-r7-name').element.value).toBe(
      'AMD Ryzen 7 5700G with Radeon Graphics',
    )
    await w.get('button[data-test="apply"]').trigger('click')
    await flushPromises()
    expect(applyDiscovery.mock.calls[0][0].decisions.r7).toEqual({
      apply: true,
      action: 'replace_uninstall',
      location: 'lab',
      newPart: { name: 'AMD Ryzen 7 5700G with Radeon Graphics', category: 'st', unit: 'pcs' },
    })
    w.unmount()
  })

  it('rows declined before wait under Ignored, unchecked, and can be checked', async () => {
    previewDiscovery.mockResolvedValueOnce(withConflict())
    const { wrapper: w } = await mountImport()
    await previewWith(w)
    const d = row(w, 'r8')
    expect(d.element.closest('section').dataset.group).toBe('ignored')
    expect(d.get('[data-test="declined"]').text()).toContain('You left this out before')
    expect(d.get('[data-test="apply"]').element.checked).toBe(false)
    await d.get('[data-test="apply"]').setValue(true)
    await w.get('button[data-test="apply"]').trigger('click')
    await flushPromises()
    expect(applyDiscovery.mock.calls[0][0].decisions.r8).toMatchObject({
      apply: true,
      action: 'found_installed',
    })
    w.unmount()
  })
})
