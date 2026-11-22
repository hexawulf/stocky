// Light / Dark / System theme composable:
// Applies `data-theme="light" | "dark"` to document.documentElement, persists
// preference in localStorage ('stocky.theme'), and supports 1-click toggle in
// the top bar plus full System / Light / Dark selection in Settings.
import { computed, ref } from 'vue'
import { THEMES, getTheme, setTheme as saveTheme } from '@/lib/prefs.js'

const mode = ref(getTheme()) // 'system' | 'light' | 'dark'

function systemPrefersDark() {
  try {
    return !!globalThis.window?.matchMedia?.('(prefers-color-scheme: dark)')?.matches
  } catch {
    return false
  }
}

export const effectiveTheme = computed(() => {
  if (mode.value === 'light' || mode.value === 'dark') return mode.value
  return systemPrefersDark() ? 'dark' : 'light'
})

export function applyThemeDom(current = mode.value) {
  if (typeof document === 'undefined' || !document.documentElement) return
  if (current === 'light' || current === 'dark') {
    document.documentElement.setAttribute('data-theme', current)
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

export function setThemeMode(next) {
  if (!THEMES.includes(next)) return
  mode.value = next
  saveTheme(next)
  applyThemeDom(next)
}

export function toggleTheme() {
  const next = effectiveTheme.value === 'dark' ? 'light' : 'dark'
  setThemeMode(next)
  return next
}

export function initTheme() {
  mode.value = getTheme()
  applyThemeDom(mode.value)
}

export function useTheme() {
  return {
    mode,
    effectiveTheme,
    setThemeMode,
    toggleTheme,
    initTheme,
  }
}
