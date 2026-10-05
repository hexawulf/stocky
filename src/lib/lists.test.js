import { describe, expect, it } from 'vitest'
import { entryFields, nextSortOrder, reorder, validateEntry } from './lists.js'

const sites = [
  { id: 'lab', label: 'Lab', retired: false, sortOrder: 0 },
  { id: 'old', label: 'Old shed', retired: true, sortOrder: 5 },
]

describe('validateEntry (spec §4.10, §8)', () => {
  it('label: 1–40 characters', () => {
    expect(validateEntry('sites', { label: '  ' }, { entries: sites }).label).toMatch(/1–40/)
    expect(validateEntry('sites', { label: 'x'.repeat(41) }, { entries: sites }).label).toMatch(
      /1–40/,
    )
  })

  it('unique case-insensitively among ACTIVE entries, not against itself', () => {
    expect(validateEntry('sites', { label: 'LAB' }, { entries: sites }).label).toBe(
      'A site named LAB already exists',
    )
    expect(validateEntry('sites', { label: 'old shed' }, { entries: sites })).toEqual({}) // retired one
    expect(validateEntry('sites', { label: 'Lab' }, { entries: sites, exceptId: 'lab' })).toEqual(
      {},
    )
  })

  it('hosts need an active site; type ≤ 60', () => {
    const ctx = { entries: [], sites: [sites[0]] }
    expect(validateEntry('hosts', { label: 'nas' }, ctx).site).toBe('Pick a site')
    expect(validateEntry('hosts', { label: 'nas', site: 'old' }, ctx).site).toBe('Pick a site')
    expect(
      validateEntry('hosts', { label: 'nas', site: 'lab', type: 't'.repeat(61) }, ctx).type,
    ).toMatch(/60/)
    expect(validateEntry('hosts', { label: 'nas', site: 'lab' }, ctx)).toEqual({})
  })

  it('category description ≤ 120', () => {
    expect(
      validateEntry('categories', { label: 'Cables', description: 'd'.repeat(121) }, {})
        .description,
    ).toMatch(/120/)
  })
})

describe('entryFields', () => {
  it('per list, trimmed; In transit gets no currency', () => {
    expect(entryFields('sites', { label: ' Home ', defaultCurrency: 'USD' })).toEqual({
      label: 'Home',
      defaultCurrency: 'USD',
    })
    expect(entryFields('sites', { label: 'Bag', kind: 'transit', defaultCurrency: 'EUR' })).toEqual(
      { label: 'Bag' },
    )
    expect(entryFields('hosts', { label: 'nas', type: ' NAS ', site: 'lab' })).toEqual({
      label: 'nas',
      type: 'NAS',
      site: 'lab',
    })
    expect(entryFields('categories', { label: 'Cables', description: '' })).toEqual({
      label: 'Cables',
      description: '',
    })
  })
})

describe('reorder (up/down buttons)', () => {
  it('swaps neighbours and writes only changed rows', () => {
    const list = [
      { id: 'a', sortOrder: 0 },
      { id: 'b', sortOrder: 1 },
      { id: 'c', sortOrder: 2 },
    ]
    expect(reorder(list, 2, -1)).toEqual([
      { id: 'c', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
    ])
  })

  it('renumbers when entries share a sortOrder (added later, all 0)', () => {
    const list = [
      { id: 'a', sortOrder: 0 },
      { id: 'b', sortOrder: 0 },
      { id: 'c', sortOrder: 0 },
    ]
    expect(reorder(list, 0, 1)).toEqual([
      { id: 'a', sortOrder: 1 },
      { id: 'c', sortOrder: 2 },
    ])
  })

  it('no-op past either end', () => {
    expect(reorder([{ id: 'a', sortOrder: 0 }], 0, -1)).toEqual([])
    expect(reorder([{ id: 'a', sortOrder: 0 }], 0, 1)).toEqual([])
  })

  it('new entries go last', () => {
    expect(nextSortOrder([{ sortOrder: 0 }, { sortOrder: 7 }])).toBe(8)
    expect(nextSortOrder([])).toBe(0)
  })
})
