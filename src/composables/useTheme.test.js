import { describe, it, expect, beforeEach } from 'vitest'
import { useTheme, initTheme } from './useTheme.js'

describe('useTheme composable', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    initTheme()
  })

  it('defaults to system mode and removes data-theme attribute', () => {
    const { mode } = useTheme()
    expect(mode.value).toBe('system')
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })

  it('setThemeMode sets explicit light or dark mode and syncs DOM + localStorage', () => {
    const { mode, effectiveTheme, setThemeMode } = useTheme()
    setThemeMode('dark')
    expect(mode.value).toBe('dark')
    expect(effectiveTheme.value).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('stocky.theme')).toBe('dark')

    setThemeMode('light')
    expect(mode.value).toBe('light')
    expect(effectiveTheme.value).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem('stocky.theme')).toBe('light')

    setThemeMode('system')
    expect(mode.value).toBe('system')
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })

  it('toggleTheme flips between light and dark', () => {
    const { effectiveTheme, setThemeMode, toggleTheme } = useTheme()
    setThemeMode('light')
    expect(toggleTheme()).toBe('dark')
    expect(effectiveTheme.value).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    expect(toggleTheme()).toBe('light')
    expect(effectiveTheme.value).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('ignores invalid theme values', () => {
    const { mode, setThemeMode } = useTheme()
    setThemeMode('dark')
    setThemeMode('neon-purple')
    expect(mode.value).toBe('dark')
  })
})
