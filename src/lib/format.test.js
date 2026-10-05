import { describe, expect, it } from 'vitest'
import {
  currencyExponent,
  formatMoney,
  formatQty,
  parseMoney,
  placeLabel,
  priceHint,
  pricePreview,
} from './format.js'

describe('parseMoney (spec §5.2: minor units, EUR/USD cents, TWD whole dollars)', () => {
  it.each([
    ['12.99', 'EUR', 1299],
    ['12,99', 'EUR', 1299],
    ['12.9', 'USD', 1290],
    ['12', 'USD', 1200],
    ['0', 'EUR', 0],
    ['1290', 'TWD', 1290],
    [' 590 ', 'TWD', 590],
  ])('%s %s -> %s', (text, currency, minor) => {
    expect(parseMoney(text, currency)).toBe(minor)
  })

  it('blank is null (no price)', () => {
    expect(parseMoney('', 'EUR')).toBeNull()
    expect(parseMoney('   ', 'TWD')).toBeNull()
  })

  it.each([
    ['12.999', 'EUR'],
    ['12.5', 'TWD'],
    ['-3', 'EUR'],
    ['1,290.00', 'USD'],
    ['abc', 'EUR'],
  ])('%s %s is invalid (NaN)', (text, currency) => {
    expect(parseMoney(text, currency)).toBeNaN()
  })
})

describe('formatting', () => {
  it('quantities carry their unit (spec §4)', () => {
    expect(formatQty(3, 'pcs')).toBe('3 pcs')
    expect(formatQty(5, 'm')).toBe('5 m')
  })

  it('singular for exactly one (1 pc, 1 sheet), plural otherwise; m unchanged', () => {
    expect(formatQty(1, 'pcs')).toBe('1 pc')
    expect(formatQty(0, 'pcs')).toBe('0 pcs')
    expect(formatQty(1, 'sheets')).toBe('1 sheet')
    expect(formatQty(2, 'sheets')).toBe('2 sheets')
    expect(formatQty(1, 'm')).toBe('1 m')
  })

  it('money uses the currency exponent', () => {
    expect(currencyExponent('TWD')).toBe(0)
    expect(currencyExponent('USD')).toBe(2)
    expect(formatMoney(1299, 'EUR', 'en-IE')).toBe('€12.99')
    expect(formatMoney(1299, 'USD', 'en-US')).toBe('$12.99')
    expect(formatMoney(1290, 'TWD', 'en-US')).toMatch(/1,290$/)
    expect(formatMoney(1290, 'TWD', 'en-US')).not.toMatch(/\./)
  })

  it('retired places are marked (spec §4.8)', () => {
    expect(placeLabel({ label: 'Lab', retired: false })).toBe('Lab')
    expect(placeLabel({ label: 'Old site', retired: true })).toBe('Old site (retired)')
    expect(placeLabel(null)).toBe('—')
  })
})

describe('price field preview (major units, visible before saving)', () => {
  it('reads the amount back in the currency format', () => {
    expect(pricePreview('200', 'EUR', 1, 'en-IE')).toBe('= €200.00 each')
    expect(pricePreview('20000', 'EUR', 1, 'en-IE')).toBe('= €20,000.00 each') // the cents slip
    expect(pricePreview('12,5', 'EUR', 1, 'en-IE')).toBe('= €12.50 each')
    expect(pricePreview('1000', 'TWD', 1, 'en-US')).toMatch(/^= NT\$1,000 each$/)
  })

  it('adds the line total for more than one', () => {
    expect(pricePreview('39.90', 'USD', 3, 'en-US')).toBe('= $39.90 each · $119.70 total')
  })

  it('blank shows nothing; no currency or a bad amount says why', () => {
    expect(pricePreview('', 'EUR')).toBe('')
    expect(pricePreview('12', '')).toBe('Pick a currency')
    expect(pricePreview('1,290.00', 'EUR')).toMatch(/^Not a valid amount/)
    expect(pricePreview('12.5', 'TWD')).toMatch(/whole numbers only/)
  })

  it('the hint names the major unit', () => {
    expect(priceHint('EUR')).toMatch(/euros, not cents/)
    expect(priceHint('USD')).toMatch(/not cents/)
    expect(priceHint('TWD')).toMatch(/whole NT\$/)
    expect(priceHint('')).toMatch(/not cents/)
  })
})
