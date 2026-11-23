import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createMemoryHistory } from 'vue-router'

const authState = vi.hoisted(() => ({
  isSignedIn: null,
  restore: vi.fn(async () => false),
  ensureSeeded: vi.fn(async () => {}),
}))

vi.mock('@/stores/auth.js', () => ({
  useAuth: () => authState,
}))

import { createStockyRouter } from './index.js'

describe('Stocky router auth & landing guards', () => {
  beforeEach(() => {
    authState.isSignedIn = ref(false)
    authState.restore.mockReset().mockResolvedValue(false)
    authState.ensureSeeded.mockReset().mockResolvedValue()
  })

  it('routes signed-out visitors on / to the public landing page (/welcome)', async () => {
    const router = createStockyRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('welcome')
    expect(router.currentRoute.value.path).toBe('/welcome')
    expect(authState.ensureSeeded).not.toHaveBeenCalled()
  })

  it('keeps /login directly accessible when signed out', async () => {
    const router = createStockyRouter(createMemoryHistory())
    await router.push('/login')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('redirects signed-out deep links to /login with redirect query', async () => {
    const router = createStockyRouter(createMemoryHistory())
    await router.push('/parts/12')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/parts/12' })
  })

  it('routes signed-out unknown paths via catch-all to the landing page', async () => {
    const router = createStockyRouter(createMemoryHistory())
    await router.push('/does-not-exist')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('welcome')
  })

  it('routes signed-in users on / to the app (home) and never shows landing', async () => {
    authState.isSignedIn.value = true
    authState.restore.mockResolvedValue(true)
    const router = createStockyRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('home')
    expect(authState.ensureSeeded).toHaveBeenCalledTimes(1)
  })

  it('redirects signed-in users visiting /welcome or /login straight to home', async () => {
    authState.isSignedIn.value = true
    authState.restore.mockResolvedValue(true)
    const router = createStockyRouter(createMemoryHistory())
    await router.push('/welcome')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('home')

    await router.push('/login')
    expect(router.currentRoute.value.name).toBe('home')
  })
})
