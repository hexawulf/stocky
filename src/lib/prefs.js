// Per-device conveniences in localStorage (spec §4.7, decision #21). Storage
// can be missing or throw (private mode, blocked site data), so every access
// is guarded and the app works without it.
import { CURRENCIES } from './format.js'

const LAST_CURRENCY = 'stocky.lastCurrency'

function storage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

// '' when nothing (valid) is stored
export function getLastCurrency() {
  try {
    const v = storage()?.getItem(LAST_CURRENCY) ?? ''
    return CURRENCIES.includes(v) ? v : ''
  } catch {
    return ''
  }
}

export function setLastCurrency(currency) {
  if (!CURRENCIES.includes(currency)) return
  try {
    storage()?.setItem(LAST_CURRENCY, currency)
  } catch {
    // not saved; next time the user picks again
  }
}
