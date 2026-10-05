import { describe, expect, it } from 'vitest'
import {
  emptyPartForm,
  isLowStock,
  partFieldsFromForm,
  partFormFromRecord,
  searchParts,
  validatePart,
} from './parts.js'
import { describeError } from './errors.js'

const categories = [
  { id: 'st', label: 'Storage', retired: false },
  { id: 'old', label: 'Old stuff', retired: true },
]
const parts = [
  { id: 'p1', name: 'Samsung 990 EVO 1TB NVMe', manufacturer: 'Samsung', model: 'MZ-V9E1T0' },
]
const valid = { ...emptyPartForm('Cat6 patch cable 1 m'), category: 'st' }

describe('validatePart (spec §4.6, §8)', () => {
  it('a minimal valid part has no errors', () => {
    expect(validatePart(valid, { parts, categories })).toEqual({})
  })

  it('name: 2–80 characters, trimmed', () => {
    expect(validatePart({ ...valid, name: ' x ' }, { parts, categories }).name).toMatch(/2–80/)
    expect(validatePart({ ...valid, name: 'x'.repeat(81) }, { parts, categories }).name).toMatch(
      /2–80/,
    )
  })

  it('duplicate name (case/whitespace-insensitive), but not against itself', () => {
    expect(
      validatePart({ ...valid, name: 'samsung  990 evo 1tb nvme' }, { parts, categories }).name,
    ).toBe('duplicate')
    expect(
      validatePart(
        { ...valid, name: 'Samsung 990 EVO 1TB NVMe' },
        { parts, categories, exceptId: 'p1' },
      ),
    ).toEqual({})
  })

  it('category: required; a retired one only if the part already had it', () => {
    expect(validatePart({ ...valid, category: '' }, { parts, categories }).category).toBe(
      'Pick a category',
    )
    expect(validatePart({ ...valid, category: 'old' }, { parts, categories }).category).toBe(
      'Old stuff is retired',
    )
    expect(
      validatePart({ ...valid, category: 'old' }, { parts, categories, originalCategory: 'old' }),
    ).toEqual({})
  })

  it('threshold: blank, or a whole number 0–9999', () => {
    for (const t of ['', '0', '9999', ' 2 ']) {
      expect(
        validatePart({ ...valid, threshold: t }, { parts, categories }).threshold,
      ).toBeUndefined()
    }
    for (const t of ['-1', '1.5', '10000', 'abc']) {
      expect(validatePart({ ...valid, threshold: t }, { parts, categories }).threshold).toMatch(
        /0 to 9999/,
      )
    }
  })

  it('length limits: manufacturer/model 60, notes 500', () => {
    const e = validatePart(
      { ...valid, manufacturer: 'm'.repeat(61), model: 'm'.repeat(61), notes: 'n'.repeat(501) },
      { parts, categories },
    )
    expect(Object.keys(e).sort()).toEqual(['manufacturer', 'model', 'notes'])
  })
})

describe('form <-> record (decision #18)', () => {
  it('blank threshold means no alert', () => {
    expect(partFieldsFromForm(valid)).toMatchObject({
      lowStockEnabled: false,
      lowStockThreshold: 0,
    })
    expect(partFieldsFromForm({ ...valid, threshold: '0' })).toMatchObject({
      lowStockEnabled: true,
      lowStockThreshold: 0,
    })
  })

  it('round-trips a record, trimming text', () => {
    const rec = {
      name: 'NVMe',
      category: 'st',
      unit: 'pcs',
      manufacturer: ' Samsung ',
      model: '',
      notes: '',
      lowStockEnabled: true,
      lowStockThreshold: 2,
    }
    const form = partFormFromRecord(rec)
    expect(form.threshold).toBe('2')
    expect(partFieldsFromForm(form)).toMatchObject({
      manufacturer: 'Samsung',
      lowStockThreshold: 2,
    })
    expect(partFormFromRecord({ ...rec, lowStockEnabled: false }).threshold).toBe('')
  })
})

describe('search and low stock (spec §4.4, §4.3)', () => {
  it('matches name, manufacturer or model, case-insensitively', () => {
    expect(searchParts(parts, 'evo')).toHaveLength(1)
    expect(searchParts(parts, 'samsung')).toHaveLength(1)
    expect(searchParts(parts, 'mz-v9')).toHaveLength(1)
    expect(searchParts(parts, 'wd')).toHaveLength(0)
    expect(searchParts(parts, '  ')).toHaveLength(1)
  })

  it('low stock: enabled and spares (incl. In transit) at or below the threshold', () => {
    expect(isLowStock({ lowStockEnabled: true, lowStockThreshold: 2, spareTotal: 2 })).toBe(true)
    expect(isLowStock({ lowStockEnabled: true, lowStockThreshold: 0, spareTotal: 0 })).toBe(true)
    expect(isLowStock({ lowStockEnabled: false, lowStockThreshold: 5, spareTotal: 0 })).toBe(false)
  })
})

describe('describeError: PocketBase field errors', () => {
  it('maps data.<field> to fields', () => {
    const d = describeError({
      status: 400,
      response: {
        message: 'Failed to create record.',
        data: { label: { code: 'validation_not_unique', message: 'Value must be unique.' } },
      },
    })
    expect(d.kind).toBe('fields')
    expect(d.fields.label.code).toBe('validation_not_unique')
  })

  it('Stocky codes still win (data.code is a string)', () => {
    const d = describeError({
      status: 400,
      response: { message: 'x', data: { code: 'retired', field: 'site' } },
    })
    expect(d.kind).toBe('validation')
  })
})
