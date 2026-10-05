import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

const fx = vi.hoisted(() => ({ online: null, user: null }))
vi.mock('@/stores/inventory.js', () => ({ useInventory: () => ({ online: fx.online }) }))
vi.mock('@/stores/auth.js', () => ({ useAuth: () => ({ user: fx.user }) }))
vi.mock('@/lib/api.js', () => ({ getAbout: vi.fn() }))
vi.mock('@/lib/pb.js', () => ({ pb: { realtime: { isConnected: true } } }))

import { getAbout } from '@/lib/api.js'
import { APP_VERSION } from '@/lib/about.js'
import { useAbout } from '@/composables/useAbout.js'
import AppShell from '@/layouts/AppShell.vue'

const stub = { template: '<div />' }
async function mountShell() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: AppShell,
        children: [{ path: '', name: 'home', component: stub }],
      },
      { path: '/parts', name: 'parts', component: stub },
      { path: '/record', name: 'record', component: stub },
      { path: '/history', name: 'history', component: stub },
      { path: '/settings', name: 'settings', component: stub },
      { path: '/import', name: 'import', component: stub },
    ],
  })
  router.push('/')
  await router.isReady()
  const w = mount(
    { template: '<RouterView />' },
    { global: { plugins: [router] }, attachTo: document.body },
  )
  await flushPromises()
  return w
}
const dialog = () => document.querySelector('[role="dialog"]')
async function openAbout(w) {
  const btn = w.get('[data-test="top-about"]')
  btn.element.focus()
  await btn.trigger('click')
  await flushPromises()
  return btn
}
const key = async (k, opts = {}) => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }))
  await flushPromises()
}

beforeEach(() => {
  fx.online = ref(true)
  fx.user = ref({ id: 'u1', email: 'a@test.local', seedPreset: 'example' })
  getAbout.mockReset().mockResolvedValue({ pocketbase: '0.40.4', schema: '1791072010' })
})
afterEach(() => {
  if (useAbout().isOpen.value) useAbout().close()
  document.body.innerHTML = ''
})

describe('About dialog (spec §4)', () => {
  it('top bar: Import is the only labelled control; About and Settings are matching icons', async () => {
    const w = await mountShell()
    const about = w.get('[data-test="top-about"]')
    const settings = w.get('[data-test="top-settings"]')
    for (const [el, name] of [
      [about, 'About Stocky'],
      [settings, 'Settings'],
    ]) {
      expect(el.attributes('aria-label')).toBe(name)
      expect(el.attributes('title')).toBe(name)
      expect(el.classes()).toContain('icon-btn')
      // no visible words, only the icon
      expect(el.findAll('span:not([aria-hidden="true"])')).toHaveLength(0)
    }
    expect(about.text()).toBe('ⓘ')
    expect(settings.text()).toBe('⚙')
    expect(w.get('[data-test="top-import"]').text()).toBe('Import')
    w.unmount()
  })

  it('the top bar has an About button; the dialog opens as a modal with focus inside', async () => {
    const w = await mountShell()
    const btn = w.get('[data-test="top-about"]')
    expect(btn.attributes('aria-label')).toBe('About Stocky')
    expect(dialog()).toBeNull()
    await openAbout(w)
    const d = dialog()
    expect(d.getAttribute('aria-modal')).toBe('true')
    expect(d.querySelector('#about-title').textContent).toBe('About Stocky')
    expect(d.textContent).toContain("Know what's in your machines, and what's in stock.")
    expect(document.activeElement).toBe(d.querySelector('[data-test="about-close"]'))
    w.unmount()
  })

  it('shows the build version, release date, stack and contact', async () => {
    const w = await mountShell()
    await openAbout(w)
    const d = dialog()
    expect(d.querySelector('[data-test="about-version"]').textContent.trim()).toBe(
      `Version ${APP_VERSION} · October 2026`,
    )
    expect(d.textContent).toContain('PocketBase 0.40.4 (Go, SQLite)')
    expect(d.textContent).toContain('plain composables (no Pinia)')
    const mail = d.querySelector('[data-test="about-mail"]')
    expect(mail.getAttribute('href')).toBe('mailto:dev@0xwulf.dev')
    w.unmount()
  })

  it('links open in a new tab, without opener or referrer', async () => {
    const w = await mountShell()
    await openAbout(w)
    const links = [...dialog().querySelectorAll('.links a')]
    expect(links.map((a) => a.textContent.trim())).toEqual([
      'GitHub repository',
      'Docker Hub',
      'Technical spec',
      'Licence: MIT',
    ])
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    }
    w.unmount()
  })

  it('diagnostics: server facts from /api/stocky/about, realtime and online from the app; Copy', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const w = await mountShell()
    await openAbout(w)
    const line = dialog().querySelector('[data-test="about-diagnostics"]').textContent
    expect(line).toBe(
      `Stocky v${APP_VERSION} · PocketBase 0.40.4 · schema 1791072010 · preset example · realtime connected · online`,
    )
    dialog().querySelector('[data-test="about-copy"]').click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(line)
    expect(dialog().querySelector('.copied').textContent).toBe('Copied')
    w.unmount()
  })

  it('without the server facts (offline), the dialog still opens and says unknown', async () => {
    getAbout.mockRejectedValue({ status: 0 })
    fx.online.value = false
    const w = await mountShell()
    await openAbout(w)
    expect(dialog().querySelector('[data-test="about-diagnostics"]').textContent).toContain(
      'PocketBase unknown · schema unknown · preset example · realtime connected · offline',
    )
    w.unmount()
  })

  it('Esc closes it and focus returns to the About button', async () => {
    const w = await mountShell()
    const btn = await openAbout(w)
    await key('Escape')
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(btn.element)
    w.unmount()
  })

  it('the close button and the backdrop close it', async () => {
    const w = await mountShell()
    const btn = await openAbout(w)
    dialog().querySelector('[data-test="about-close"]').click()
    await flushPromises()
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(btn.element)
    await openAbout(w)
    document.querySelector('.backdrop').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(dialog()).toBeNull()
    w.unmount()
  })

  it('Tab stays inside: from the last control back to the first, and Shift+Tab the other way', async () => {
    const w = await mountShell()
    await openAbout(w)
    const close = dialog().querySelector('[data-test="about-close"]')
    const copy = dialog().querySelector('[data-test="about-copy"]')
    copy.focus()
    await key('Tab')
    expect(document.activeElement).toBe(close)
    await key('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(copy)
    w.unmount()
  })
})
