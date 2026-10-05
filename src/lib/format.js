// Display and input helpers shared by the screens (spec §4, §5.2).

export const UNITS = ['pcs', 'sheets', 'm']
export const CURRENCIES = ['TWD', 'EUR', 'USD']

// digits after the decimal point, as stored in priceMinor (spec §5.2, #21)
const EXPONENT = { TWD: 0, EUR: 2, USD: 2 }

export function currencyExponent(currency) {
  return EXPONENT[currency] ?? 2
}

// unit labels for display: singular for exactly one (spec §4); the stored
// value stays pcs / sheets / m
const UNIT_LABELS = { pcs: ['pc', 'pcs'], sheets: ['sheet', 'sheets'], m: ['m', 'm'] }

export function unitLabel(n, unit) {
  const labels = UNIT_LABELS[unit]
  return labels ? labels[n === 1 ? 0 : 1] : unit
}

// "1 pc", "3 pcs", "1 sheet", "5 m" (spec §4: always with the unit)
export function formatQty(n, unit) {
  return `${n} ${unitLabel(n, unit)}`
}

// User input -> priceMinor. Blank -> null; not a valid amount for this
// currency -> NaN. Accepts "." or "," as the decimal point, no thousands
// separators: EUR/USD "12.99" or "12,99" -> 1299; TWD "1290" -> 1290.
export function parseMoney(text, currency) {
  const t = String(text ?? '').trim()
  if (t === '') return null
  const exp = currencyExponent(currency)
  const pattern = exp === 0 ? /^\d+$/ : new RegExp(`^\\d+([.,]\\d{1,${exp}})?$`)
  if (!pattern.test(t)) return NaN
  const [whole, frac = ''] = t.replace(',', '.').split('.')
  return Number(whole) * 10 ** exp + Number(frac.padEnd(exp, '0') || 0)
}

// priceMinor -> "NT$1,290" / "€12.99" / "$12.99" (locale-aware)
export function formatMoney(minor, currency, locale) {
  const exp = currencyExponent(currency)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(minor / 10 ** exp)
}

// what the price field expects, in major units (an "€20000" meant as cents
// should look wrong before it's saved)
const PRICE_HINTS = {
  TWD: 'In whole NT$, e.g. 1290',
  EUR: 'In euros, not cents, e.g. 12.99',
  USD: 'In dollars, not cents, e.g. 12.99',
}

export function priceHint(currency) {
  return PRICE_HINTS[currency] ?? 'In whole currency units, not cents'
}

// Live reading of the price field: '' while blank, otherwise
// "= €200.00 each" (plus "· €400.00 total" for more than one), or why it
// can't be read yet.
export function pricePreview(text, currency, quantity = 1, locale) {
  const minor = parseMoney(text, currency)
  if (minor === null) return ''
  if (!CURRENCIES.includes(currency)) return 'Pick a currency'
  if (Number.isNaN(minor)) {
    return currencyExponent(currency) === 0
      ? 'Not a valid amount: whole numbers only'
      : 'Not a valid amount: digits with up to 2 decimals, no thousands separator'
  }
  const each = `= ${formatMoney(minor, currency, locale)} each`
  return quantity > 1 ? `${each} · ${formatMoney(minor * quantity, currency, locale)} total` : each
}

// a place's label, marked when retired (spec §4.8 filters, §5.3)
export function placeLabel(place) {
  if (!place) return '—'
  return place.retired ? `${place.label} (retired)` : place.label
}
