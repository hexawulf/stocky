import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getFleetName,
  getLastCurrency,
  getStaleHours,
  getTheme,
  setFleetName,
  setLastCurrency,
  setStaleHours,
  setTheme,
} from './prefs.js'

afterEach(() => {
  vi.unstubAllGlobals()
  try {
    localStorage.clear()
  } catch {}
})

describe('last used currency (spec §4.7, decision #21)', () => {
  it('round-trips a valid currency', () => {
    expect(getLastCurrency()).toBe('')
    setLastCurrency('USD')
    expect(getLastCurrency()).toBe('USD')
  })

  it('ignores invalid values, stored or given', () => {
    setLastCurrency('JPY')
    expect(getLastCurrency()).toBe('')
    localStorage.setItem('stocky.lastCurrency', 'GBP')
    expect(getLastCurrency()).toBe('')
  })

  it('works when storage throws (private mode, blocked site data)', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    })
    expect(() => setLastCurrency('EUR')).not.toThrow()
    expect(getLastCurrency()).toBe('')
  })

  it('round-trips theme, fleetName, and staleHours preferences', () => {
    expect(getTheme()).toBe('system')
    setTheme('light')
    expect(getTheme()).toBe('light')
    setTheme('dark')
    expect(getTheme()).toBe('dark')
    setTheme('bogus')
    expect(getTheme()).toBe('dark')

    expect(getFleetName()).toBe('My Homelab Fleet')
    setFleetName('HexaWulf Fleet')
    expect(getFleetName()).toBe('HexaWulf Fleet')

    expect(getStaleHours()).toBe(48)
    setStaleHours(72)
    expect(getStaleHours()).toBe(72)
  })
})
