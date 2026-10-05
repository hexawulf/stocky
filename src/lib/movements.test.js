import { describe, expect, it } from 'vitest'
import {
  available,
  formatDay,
  groupByDay,
  canUndo,
  destinationsFor,
  findDuplicate,
  matchesFilters,
  nameKey,
  reversalOf,
  reversalSummary,
  sourcesFor,
  summary,
  validateMovement,
} from './movements.js'

const lab = { id: 'lab', label: 'Lab', kind: 'site', retired: false }
const office = { id: 'ofc', label: 'Office', kind: 'site', retired: false }
const transit = { id: 'trn', label: 'In transit', kind: 'transit', retired: false }
const oldSite = { id: 'old', label: 'Old', kind: 'site', retired: true }
const piB = { id: 'pib', label: 'pi-b', site: 'lab', retired: false }
const nasB = { id: 'nsb', label: 'nas-b', site: 'ofc', retired: false }
const locations = [lab, office, transit, oldSite]
const hosts = [piB, nasB]
const part = {
  id: 'p1',
  name: 'microSD 128 GB',
  nameKey: 'microsd 128 gb',
  unit: 'pcs',
  spare: { lab: 3, trn: 1 },
  installed: { pib: 1 },
}

describe('available amounts (spec §4.7)', () => {
  it('reads spare for locations and installed for hosts', () => {
    expect(available(part, 'lab')).toBe(3)
    expect(available(part, 'ofc')).toBe(0)
    expect(available(part, 'pib', 'host')).toBe(1)
    expect(available(null, 'lab')).toBe(0)
  })

  it('move/stock_out sources: active locations with their availability', () => {
    const s = sourcesFor('move', { part, locations, hosts })
    expect(s.map((x) => [x.id, x.available])).toEqual([
      ['lab', 3],
      ['ofc', 0],
      ['trn', 1],
    ])
  })

  it('install sources: only the host’s site and In transit (spec §8)', () => {
    expect(
      sourcesFor('install', { part, locations, hosts, toHost: nasB }).map((x) => x.id),
    ).toEqual(['ofc', 'trn'])
    expect(sourcesFor('install', { part, locations, hosts, toHost: null })).toEqual([])
  })

  it('uninstall sources: hosts that have the part installed', () => {
    expect(sourcesFor('uninstall', { part, locations, hosts }).map((x) => x.id)).toEqual(['pib'])
  })

  it('stock_in and found_installed have no source', () => {
    expect(sourcesFor('stock_in', { part, locations, hosts })).toEqual([])
    expect(sourcesFor('found_installed', { part, locations, hosts })).toEqual([])
  })

  it('stock_out sources: locations, then hosts with the part installed (spec §13.4.2)', () => {
    expect(
      sourcesFor('stock_out', { part, locations, hosts }).map((x) => [x.id, x.kind, x.available]),
    ).toEqual([
      ['lab', 'location', 3],
      ['ofc', 'location', 0],
      ['trn', 'location', 1],
      ['pib', 'host', 1],
    ])
  })

  it('found_installed destinations: active hosts', () => {
    expect(destinationsFor('found_installed', { locations, hosts }).map((h) => h.id)).toEqual(
      hosts.filter((h) => !h.retired).map((h) => h.id),
    )
  })

  it('destinations: a move can’t go back to its source; retired places excluded', () => {
    expect(destinationsFor('move', { locations, hosts, fromId: 'lab' }).map((l) => l.id)).toEqual([
      'ofc',
      'trn',
    ])
    expect(destinationsFor('install', { locations, hosts }).map((h) => h.id)).toEqual([
      'pib',
      'nsb',
    ])
    expect(destinationsFor('stock_out', { locations, hosts })).toEqual([])
  })
})

describe('validateMovement (spec §8)', () => {
  const today = '2026-10-04'
  const base = { type: 'move', partId: 'p1', quantity: 1, fromId: 'lab', toId: 'ofc', date: today }
  const ctx = { part, available: 3, fromPlace: lab, today }

  it('a valid move has no errors', () => {
    expect(validateMovement(base, ctx)).toEqual({})
  })

  it('quantity: whole, 1–9999, and no more than available', () => {
    expect(validateMovement({ ...base, quantity: 0 }, ctx).quantity).toMatch(/1 to 9999/)
    expect(validateMovement({ ...base, quantity: 1.5 }, ctx).quantity).toMatch(/whole number/)
    expect(validateMovement({ ...base, quantity: 4 }, ctx).quantity).toBe(
      'Only 3 pcs available at Lab',
    )
  })

  it('date: required, not in the future', () => {
    expect(validateMovement({ ...base, date: '' }, ctx).date).toBe('Pick a date')
    expect(validateMovement({ ...base, date: '2026-10-05' }, ctx).date).toMatch(/future/)
  })

  it('needs a part, and a new part only on a stock in or found installed', () => {
    expect(validateMovement({ ...base, partId: '' }, ctx).part).toBe('Pick a part')
    expect(validateMovement({ ...base, partId: '', newPart: { name: 'x' } }, ctx).part).toMatch(
      /stock in or found installed/,
    )
    const found = { type: 'found_installed', partId: '', newPart: { name: 'x' }, quantity: 1 }
    expect(
      validateMovement({ ...found, toId: 'pib', date: '2026-10-04' }, ctx).part,
    ).toBeUndefined()
  })

  it('move: from and to must differ', () => {
    expect(validateMovement({ ...base, toId: 'lab' }, ctx).to).toBe('Pick a different location')
  })

  it('stock_out needs a reason', () => {
    const d = { type: 'stock_out', partId: 'p1', quantity: 1, fromId: 'lab', date: today }
    expect(validateMovement(d, ctx).reason).toBe('Pick a reason')
    expect(validateMovement({ ...d, reason: 'used' }, ctx)).toEqual({})
  })

  it('install: only from the host’s site or In transit', () => {
    const d = {
      type: 'install',
      partId: 'p1',
      quantity: 1,
      fromId: 'lab',
      toId: 'nsb',
      date: today,
    }
    expect(validateMovement(d, { ...ctx, toHost: nasB }).from).toBe(
      'Install into nas-b only from its own site or In transit',
    )
    expect(
      validateMovement(
        { ...d, fromId: 'trn' },
        { ...ctx, available: 1, fromPlace: transit, toHost: nasB },
      ),
    ).toEqual({})
  })

  it('stock_in price: needs a currency, and a valid amount for it (decision #21)', () => {
    const d = { type: 'stock_in', partId: 'p1', quantity: 1, toId: 'lab', date: today }
    expect(validateMovement({ ...d, priceText: '12.99', currency: '' }, { today }).currency).toBe(
      'Pick a currency',
    )
    expect(validateMovement({ ...d, priceText: '12.5', currency: 'TWD' }, { today }).price).toBe(
      'Enter whole dollars',
    )
    expect(
      validateMovement({ ...d, priceText: '12.999', currency: 'USD' }, { today }).price,
    ).toMatch(/12\.99/)
    expect(validateMovement({ ...d, priceText: '12.99', currency: 'USD' }, { today })).toEqual({})
    expect(validateMovement({ ...d, priceText: '', currency: '' }, { today })).toEqual({})
  })

  it('missing sides are reported per type', () => {
    expect(
      validateMovement({ type: 'install', partId: 'p1', quantity: 1, date: today }, {}),
    ).toMatchObject({
      from: expect.any(String),
      to: 'Pick a host',
    })
  })
})

describe('summaries (spec §4.7, §4.8)', () => {
  it('describes each type', () => {
    const s = (o) => summary({ quantity: 2, partName: 'microSD', date: '2026-10-04', ...o })
    expect(s({ type: 'move', from: lab, to: transit })).toBe(
      'Move 2 × microSD from Lab → In transit on 2026-10-04',
    )
    expect(s({ type: 'stock_in', to: lab })).toBe('Stock in 2 × microSD → Lab on 2026-10-04')
    expect(s({ type: 'stock_out', from: lab, reason: 'used' })).toBe(
      'Stock out 2 × microSD from Lab (used) on 2026-10-04',
    )
    expect(s({ type: 'install', from: transit, to: nasB })).toBe(
      'Install 2 × microSD from In transit → nas-b on 2026-10-04',
    )
    expect(s({ type: 'uninstall', from: piB, to: oldSite })).toBe(
      'Uninstall 2 × microSD from pi-b → Old (retired) on 2026-10-04',
    )
    expect(s({ type: 'found_installed', to: piB })).toBe(
      'Found installed 2 × microSD in pi-b on 2026-10-04',
    )
    expect(s({ type: 'stock_out', from: piB, reason: 'discarded' })).toBe(
      'Stock out 2 × microSD from pi-b (discarded) on 2026-10-04',
    )
  })

  it('reversals follow spec §7.4’s table', () => {
    expect(
      reversalOf({ type: 'stock_in', part: 'p1', quantity: 5, toLocation: 'lab' }),
    ).toMatchObject({
      type: 'stock_out',
      fromLocation: 'lab',
      toLocation: '',
    })
    expect(
      reversalOf({ type: 'install', part: 'p1', quantity: 1, fromLocation: 'trn', toHost: 'nsb' }),
    ).toMatchObject({ type: 'uninstall', fromHost: 'nsb', toLocation: 'trn' })
    expect(
      reversalOf({ type: 'move', quantity: 1, fromLocation: 'lab', toLocation: 'ofc' }),
    ).toMatchObject({
      type: 'move',
      fromLocation: 'ofc',
      toLocation: 'lab',
    })
  })

  it('found_installed and stock_out from a host reverse each other (spec §13.4.2)', () => {
    expect(reversalOf({ type: 'found_installed', quantity: 1, toHost: 'pib' })).toMatchObject({
      type: 'stock_out',
      fromHost: 'pib',
      toHost: '',
    })
    expect(reversalOf({ type: 'stock_out', quantity: 1, fromHost: 'pib' })).toMatchObject({
      type: 'found_installed',
      fromHost: '',
      toHost: 'pib',
    })
    expect(reversalOf({ type: 'stock_out', quantity: 1, fromLocation: 'lab' })).toMatchObject({
      type: 'stock_in',
      toLocation: 'lab',
    })
  })

  it('reversal summary for the undo sheet', () => {
    const lookups = { locations: { lab: lab, trn: transit }, hosts: { nsb: nasB } }
    const m = { type: 'install', part: 'p1', quantity: 1, fromLocation: 'trn', toHost: 'nsb' }
    expect(reversalSummary(m, lookups, 'microSD', '2026-10-05')).toBe(
      'Uninstall 1 × microSD from nas-b → In transit on 2026-10-05',
    )
  })
})

describe('duplicate check (spec §4.6)', () => {
  const parts = [part, { id: 'p2', name: 'Cat6 patch cable 1 m' }]

  it('matches case- and whitespace-insensitively', () => {
    expect(nameKey('  MicroSD   128 GB ')).toBe('microsd 128 gb')
    expect(findDuplicate(parts, 'MICROSD  128 gb')?.id).toBe('p1')
    expect(findDuplicate(parts, 'cat6 PATCH cable 1 m')?.id).toBe('p2') // no nameKey stored
  })

  it('ignores the part being edited and very short names', () => {
    expect(findDuplicate(parts, 'microsd 128 gb', 'p1')).toBeNull()
    expect(findDuplicate(parts, 'm')).toBeNull()
    expect(findDuplicate(parts, 'something new')).toBeNull()
  })
})

describe('History filter matching (spec §4.8, decision #22)', () => {
  const m = { type: 'move', part: 'p1', fromLocation: 'lab', toLocation: 'trn', date: '2026-10-03' }

  it('matches type, part, place on any side, and an inclusive date range', () => {
    expect(matchesFilters(m, {})).toBe(true)
    expect(matchesFilters(m, { type: 'move', part: 'p1' })).toBe(true)
    expect(matchesFilters(m, { type: 'install' })).toBe(false)
    expect(matchesFilters(m, { place: 'trn' })).toBe(true)
    expect(matchesFilters(m, { place: 'ofc' })).toBe(false)
    expect(matchesFilters(m, { from: '2026-10-03', to: '2026-10-03' })).toBe(true)
    expect(matchesFilters(m, { from: '2026-10-04' })).toBe(false)
  })
})

describe('canUndo (spec §7.4)', () => {
  const now = Date.parse('2026-10-04T12:00:00Z')
  const m = { id: 'm9', created: '2026-10-04 06:00:00.000Z', reverses: '' }
  const ctx = { lastMovementId: 'm9', undone: new Set(), now }

  it('the newest movement, under 24 h, not a reversal, not undone', () => {
    expect(canUndo(m, ctx)).toBe(true)
  })

  it('not when another movement is newer, it is a reversal, or already undone', () => {
    expect(canUndo(m, { ...ctx, lastMovementId: 'm10' })).toBe(false)
    expect(canUndo({ ...m, reverses: 'm1' }, ctx)).toBe(false)
    expect(canUndo(m, { ...ctx, undone: new Set(['m9']) })).toBe(false)
  })

  it('not for a movement written by an import (that has Undo import, spec §13.4.4)', () => {
    expect(canUndo({ ...m, import: 'imp1' }, ctx)).toBe(false)
  })

  it('not after 24 h', () => {
    expect(canUndo({ ...m, created: '2026-10-03 11:59:59.000Z' }, ctx)).toBe(false)
    expect(canUndo({ ...m, created: '2026-10-03 12:00:01.000Z' }, ctx)).toBe(true)
  })
})

describe('History grouping (spec §4.8)', () => {
  it('groups consecutive movements by day, keeping order', () => {
    const g = groupByDay([
      { id: 'a', date: '2026-10-04' },
      { id: 'b', date: '2026-10-04' },
      { id: 'c', date: '2026-10-01' },
    ])
    expect(g.map((x) => [x.date, x.items.map((m) => m.id)])).toEqual([
      ['2026-10-04', ['a', 'b']],
      ['2026-10-01', ['c']],
    ])
  })

  it('formats a day without time-zone drift', () => {
    expect(formatDay('2026-10-04', 'en-GB')).toBe('Sun, 4 Oct 2026')
    expect(formatDay('bad', 'en-GB')).toBe('bad')
  })
})
