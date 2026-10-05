import { describe, expect, it } from 'vitest'
import {
  canUndoImport,
  checkSnapshotText,
  countChanges,
  decisionsPayload,
  defaultDecisions,
  formatBytes,
  gatherImports,
  groupRows,
  importTitle,
  itemDetail,
  placeQuietImports,
  shownGroup,
  suggestHost,
  validateDecisions,
} from './discovery.js'

const snap = (extra = {}) =>
  JSON.stringify({ schema: 'stocky.discovery/1', host: { virtual: false }, items: [], ...extra })

describe('checks before upload (spec §13.3.1–2)', () => {
  it('a valid snapshot passes', () => {
    expect(checkSnapshotText(snap())).toEqual({ ok: true })
  })

  it.each([
    ['', /Pick a snapshot/],
    ['{"schema": "stocky.discovery/1", items: [}', /isn't valid JSON/],
    ['[1, 2]', /isn't a Stocky discovery snapshot/],
    [snap({ schema: 'other/1' }), /Unsupported snapshot format/],
    [snap({ host: { virtual: true } }), /virtual machine/],
    [snap({ pad: 'x'.repeat(256 * 1024) }), /larger than 256 KB/],
  ])('%#: rejected with a reason', (text, message) => {
    const r = checkSnapshotText(text)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(message)
  })

  it('size counts bytes, not characters', () => {
    const multiByte = snap({ pad: '日'.repeat(90000) }) // ~270 KB in UTF-8
    expect(checkSnapshotText(multiByte).ok).toBe(false)
  })
})

const rows = [
  {
    id: 'r1',
    group: 'missing',
    role: 'out',
    pair: 'r3',
    checked: true,
    action: 'uninstall',
    location: 'lab',
    reason: 'retired',
    options: ['uninstall', 'stock_out', 'ignore'],
    items: [],
  },
  {
    id: 'r2',
    group: 'missing',
    checked: false,
    action: 'ignore',
    location: 'lab',
    reason: 'retired',
    options: ['uninstall', 'stock_out', 'ignore'],
    items: [],
  },
  {
    id: 'r3',
    group: 'new',
    role: 'in',
    pair: 'r1',
    checked: true,
    action: 'found_installed',
    options: ['found_installed', 'ignore'],
    newPart: { name: 'WD Black 2TB', category: 'st', unit: 'pcs' },
    items: [],
  },
  { id: 'r4', group: 'unchanged', checked: true, action: 'none', options: ['none'], items: [] },
  { id: 'r5', group: 'ignored', checked: false, action: 'none', options: ['none'], items: [] },
  {
    id: 'r6',
    group: 'new',
    checked: false,
    action: 'found_installed',
    location: 'lab',
    sources: ['lab'],
    options: ['found_installed', 'install', 'ignore'],
    partId: 'p1',
    items: [],
  },
]
rows[0].group = 'replaced'
rows[2].group = 'replaced'

describe('preview groups and decisions (spec §13.3.1 step 4, §13.6)', () => {
  it('groups in screen order; a replaced pair is one entry with both halves', () => {
    const g = groupRows(rows)
    expect(g.map((x) => [x.group, x.entries.map((e) => e.rows.map((r) => r.id))])).toEqual([
      ['unchanged', [['r4']]],
      ['new', [['r6']]],
      ['missing', [['r2']]],
      ['replaced', [['r1', 'r3']]],
      ['ignored', [['r5']]],
    ])
  })

  it('defaults follow the proposal; ignored rows have no decision', () => {
    const d = defaultDecisions(rows)
    expect(Object.keys(d)).toEqual(['r1', 'r2', 'r3', 'r4', 'r6'])
    expect(d.r1).toMatchObject({ apply: true, action: 'uninstall', location: 'lab' })
    expect(d.r2.apply).toBe(false)
    expect(d.r3.newPart).toEqual({ name: 'WD Black 2TB', category: 'st', unit: 'pcs' })
    expect(d.r3.newPart).not.toBe(rows[2].newPart) // a copy, edited in place
  })

  it('the payload sends only applied rows and the fields each action uses', () => {
    const d = defaultDecisions(rows)
    d.r6.apply = true
    d.r6.action = 'install'
    d.r3.newPart.name = '  WD Black SN850X 2TB  '
    expect(decisionsPayload(d, rows)).toEqual({
      r1: { apply: true, action: 'uninstall', location: 'lab' },
      r3: {
        apply: true,
        action: 'found_installed',
        newPart: { name: 'WD Black SN850X 2TB', category: 'st', unit: 'pcs' },
      },
      r4: { apply: true, action: 'none' },
      r6: { apply: true, action: 'install', location: 'lab' },
    })
    d.r3.partId = 'p9' // "Is this …?" picked an existing part
    d.r1.action = 'stock_out'
    const p = decisionsPayload(d, rows)
    expect(p.r3).toEqual({ apply: true, action: 'found_installed', partId: 'p9' })
    expect(p.r1).toEqual({ apply: true, action: 'stock_out', reason: 'retired' })
  })

  it('counts the rows that change something', () => {
    const d = defaultDecisions(rows)
    expect(countChanges(d, rows)).toBe(2) // r1, r3 (r4 is unchanged)
    d.r2.apply = true // still "ignore"
    expect(countChanges(d, rows)).toBe(2)
    d.r2.action = 'uninstall'
    expect(countChanges(d, rows)).toBe(3)
  })

  it('validates applied rows: new part name, category, a taken name, location, reason', () => {
    const d = defaultDecisions(rows)
    expect(validateDecisions(d, rows)).toEqual({})
    d.r3.newPart.name = 'x'
    expect(validateDecisions(d, rows).r3).toMatch(/2–80/)
    d.r3.newPart.name = 'microSD 128 GB'
    expect(validateDecisions(d, rows, { p1: { nameKey: 'microsd 128 gb' } }).r3).toMatch(
      /already have/,
    )
    d.r3.partId = 'p1' // using the existing part instead: fine
    expect(validateDecisions(d, rows).r3).toBeUndefined()
    d.r1.location = ''
    expect(validateDecisions(d, rows).r1).toBe('Pick a location')
    d.r1.action = 'stock_out'
    d.r1.reason = ''
    expect(validateDecisions(d, rows).r1).toBe('Pick a reason')
  })
})

describe('display', () => {
  it('sizes as drives are sold, and an item detail line', () => {
    expect(formatBytes(1000204886016)).toBe('1 TB')
    expect(formatBytes(1920383410176)).toBe('1.92 TB')
    expect(formatBytes(127865454592)).toBe('128 GB')
    expect(
      itemDetail({ sizeBytes: 1000204886016, interface: 'nvme', slot: 'nvme0', serial: 'S5' }),
    ).toBe('1 TB · nvme · nvme0 · S/N S5')
    expect(itemDetail({})).toBe('')
  })
})

describe('imports in History (spec §4.8, §13.4.4)', () => {
  const now = Date.parse('2026-10-05T12:00:00Z')
  const imp = {
    id: 'i1',
    host: 'pib',
    created: '2026-10-05 06:00:00.000Z',
    undone: false,
    lastMovementAfter: 'm9',
  }

  it('Undo import while it is the newest thing, under 24 h, not undone', () => {
    expect(canUndoImport(imp, { lastMovementId: 'm9', now })).toBe(true)
    expect(canUndoImport(imp, { lastMovementId: 'm10', now })).toBe(false)
    expect(canUndoImport({ ...imp, undone: true }, { lastMovementId: 'm9', now })).toBe(false)
    expect(
      canUndoImport({ ...imp, created: '2026-10-04 11:59:00.000Z' }, { lastMovementId: 'm9', now }),
    ).toBe(false)
    expect(canUndoImport(undefined, { lastMovementId: 'm9', now })).toBe(false)
    // an import that wrote no movement leaves lastMovementId as it was
    expect(canUndoImport({ ...imp, lastMovementAfter: '' }, { lastMovementId: '', now })).toBe(true)
  })

  it("gathers an import's consecutive rows into one block", () => {
    const list = [
      { id: 'm5' },
      { id: 'm4', import: 'i1' },
      { id: 'm3', import: 'i1' },
      { id: 'm2', import: 'i0' },
      { id: 'm1' },
    ]
    expect(
      gatherImports(list).map((b) =>
        b.kind === 'import' ? `${b.importId}:${b.items.map((m) => m.id)}` : b.movement.id,
      ),
    ).toEqual(['m5', 'i1:m4,m3', 'i0:m2', 'm1'])
  })

  it('titles name the host and the count', () => {
    expect(importTitle(imp, [{}, {}], { pib: { label: 'pi-b' } })).toBe(
      'Discovery import · pi-b · 2 movements',
    )
    expect(importTitle({ hostname: 'raw-name' }, [{}], {})).toBe(
      'Discovery import · raw-name · 1 movement',
    )
  })
})

describe('conflicts and declined rows (spec §13.11.9–10)', () => {
  const conflict = {
    id: 'c1',
    group: 'conflict',
    checked: true,
    action: 'keep',
    location: 'lab',
    reason: 'retired',
    options: ['keep', 'replace_uninstall', 'replace_stock_out'],
    recorded: { partId: 'p7', name: 'Ryzen 7 5700X3D' },
    newPart: { name: 'AMD Ryzen 7 5700G with Radeon Graphics', category: 'cpu', unit: 'pcs' },
    items: [],
  }

  it('keep changes nothing and needs nothing; replace sends where or why, and the new part', () => {
    const d = defaultDecisions([conflict])
    expect(countChanges(d, [conflict])).toBe(0)
    expect(validateDecisions(d, [conflict])).toEqual({})
    expect(decisionsPayload(d, [conflict])).toEqual({ c1: { apply: true, action: 'keep' } })
    d.c1.action = 'replace_uninstall'
    expect(countChanges(d, [conflict])).toBe(1)
    expect(decisionsPayload(d, [conflict]).c1).toEqual({
      apply: true,
      action: 'replace_uninstall',
      location: 'lab',
      newPart: { name: 'AMD Ryzen 7 5700G with Radeon Graphics', category: 'cpu', unit: 'pcs' },
    })
    d.c1.action = 'replace_stock_out'
    expect(decisionsPayload(d, [conflict]).c1.reason).toBe('retired')
  })

  it('never links the detected item to the recorded part', () => {
    const d = defaultDecisions([conflict])
    d.c1.action = 'replace_uninstall'
    d.c1.partId = 'p7'
    expect(validateDecisions(d, [conflict]).c1).toMatch(/different model/)
  })

  it('declined rows are shown under Ignored', () => {
    expect(shownGroup({ group: 'new', declined: true })).toBe('ignored')
    expect(shownGroup({ group: 'new' })).toBe('new')
    const g = groupRows([{ id: 'r1', group: 'new', declined: true, items: [] }, conflict])
    expect(g.map((x) => x.group)).toEqual(['conflict', 'ignored'])
  })
})

describe('imports without movements in History (spec §13.11.11)', () => {
  const quiet = {
    id: 'q1',
    host: 'pib',
    created: '2026-10-04 08:00:00.000Z',
    summary: { adopt: 1, serialsLinked: 2 },
  }
  const day = (date, ids) => ({
    date,
    items: [],
    blocks: ids.map((id) => ({ kind: 'movement', movement: { id } })),
  })

  it('titles count linked serials', () => {
    expect(importTitle(quiet, [], { pib: { label: 'pi-b' } })).toBe(
      'Discovery import · pi-b · 0 movements, 2 serials linked',
    )
  })

  it('placed at the top of their day; a new day group in order when needed', () => {
    const groups = [day('2026-10-05', ['m3']), day('2026-10-03', ['m1'])]
    const out = placeQuietImports(groups, [quiet])
    expect(out.map((g) => [g.date, g.blocks.map((b) => b.importId ?? b.movement.id)])).toEqual([
      ['2026-10-05', ['m3']],
      ['2026-10-04', ['q1']],
      ['2026-10-03', ['m1']],
    ])
    const same = placeQuietImports([day('2026-10-04', ['m2'])], [quiet])
    expect(same[0].blocks.map((b) => b.importId ?? b.movement.id)).toEqual(['q1', 'm2'])
    expect(groups[0].blocks).toHaveLength(1) // inputs untouched
  })

  it('only imports that linked serials; only when filters could match one', () => {
    const g = [day('2026-10-04', ['m2'])]
    expect(
      placeQuietImports(g, [{ ...quiet, summary: { serialsLinked: 0 } }])[0].blocks,
    ).toHaveLength(1)
    expect(placeQuietImports(g, [quiet], { filters: { type: 'move' } })[0].blocks).toHaveLength(1)
    expect(placeQuietImports(g, [quiet], { filters: { part: 'p1' } })[0].blocks).toHaveLength(1)
    expect(placeQuietImports(g, [quiet], { filters: { place: 'nsb' } })[0].blocks).toHaveLength(1)
    expect(placeQuietImports(g, [quiet], { filters: { place: 'pib' } })[0].blocks).toHaveLength(2)
    expect(
      placeQuietImports(g, [quiet], { filters: { from: '2026-10-05' } })[0].blocks,
    ).toHaveLength(1)
  })

  it('not on days History has not reached yet', () => {
    const g = [day('2026-10-05', ['m3'])]
    expect(placeQuietImports(g, [quiet], { done: false })).toHaveLength(1)
    expect(placeQuietImports(g, [quiet], { done: true })).toHaveLength(2)
  })
})

describe('which host a snapshot is (spec §4.11)', () => {
  const hosts = [
    { id: 'h1', label: 'pi-b', key: 'pi_b' },
    { id: 'h2', label: 'Bench Pi', key: '' },
    { id: 'h3', label: 'workstation', key: 'workstation' },
  ]
  const snap = (hostname, machineIdHash) => ({ host: { hostname, machineIdHash } })

  it('a previous import of the same machine wins (it survives a rename)', () => {
    const imports = [{ host: 'h3', machineIdHash: 'sha256:aa', undone: false }]
    expect(suggestHost(snap('pi-b', 'sha256:aa'), hosts, imports)).toEqual({
      hostId: 'h3',
      reason: 'machine',
    })
  })

  it('then the hostname, ignoring case, spaces, dots, dashes and underscores', () => {
    expect(suggestHost(snap('PI-B'), hosts)).toEqual({ hostId: 'h1', reason: 'hostname' })
    expect(suggestHost(snap('bench-pi'), hosts)).toEqual({ hostId: 'h2', reason: 'hostname' })
  })

  it('undone imports and hosts no longer active do not count; no match is null', () => {
    const imports = [
      { host: 'h3', machineIdHash: 'sha256:aa', undone: true },
      { host: 'gone', machineIdHash: 'sha256:bb', undone: false },
    ]
    expect(suggestHost(snap('nas', 'sha256:aa'), hosts, imports)).toBeNull()
    expect(suggestHost(snap('nas', 'sha256:bb'), hosts, imports)).toBeNull()
    expect(suggestHost(snap(''), hosts)).toBeNull()
  })
})
