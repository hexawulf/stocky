// Per-device conveniences in localStorage (spec §4.7, decision #21). Storage
// can be missing or throw (private mode, blocked site data), so every access
// is guarded and the app works without it.
import { CURRENCIES } from './format.js'

const LAST_CURRENCY = 'stocky.lastCurrency'
const FLEET_NAME = 'stocky.fleetName'
const STALE_HOURS = 'stocky.staleHours'
const THEME = 'stocky.theme'
export const THEMES = ['system', 'light', 'dark']

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

export function getFleetName() {
  try {
    const v = (storage()?.getItem(FLEET_NAME) ?? '').trim()
    return v ? v.slice(0, 60) : 'My Homelab Fleet'
  } catch {
    return 'My Homelab Fleet'
  }
}

export function setFleetName(name) {
  try {
    const v = String(name ?? '')
      .trim()
      .slice(0, 60)
    if (v) storage()?.setItem(FLEET_NAME, v)
  } catch {}
}

export function getStaleHours() {
  try {
    const n = Number(storage()?.getItem(STALE_HOURS))
    return Number.isInteger(n) && n >= 1 && n <= 720 ? n : 48
  } catch {
    return 48
  }
}

export function setStaleHours(hours) {
  try {
    const n = Number(hours)
    if (Number.isInteger(n) && n >= 1 && n <= 720) storage()?.setItem(STALE_HOURS, String(n))
  } catch {}
}

export function getTheme() {
  try {
    const v = storage()?.getItem(THEME) ?? 'system'
    return THEMES.includes(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

export function setTheme(theme) {
  if (!THEMES.includes(theme)) return
  try {
    storage()?.setItem(THEME, theme)
  } catch {}
}
