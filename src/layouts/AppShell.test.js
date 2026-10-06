import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

const fx = vi.hoisted(() => ({ state: null }))
vi.mock('@/stores/inventory.js', () => ({ useInventory: () => fx.state }))
vi.mock('@/lib/api.js', () => ({
  previewDiscovery: vi.fn(),
  applyDiscovery: vi.fn(),
  listImports: vi.fn(async () => []),
  createEntry: vi.fn(),
}))

import AppShell from './AppShell.vue'
import shellSource from './AppShell.vue?raw'
import HostImportView from '@/views/HostImportView.vue'
import { makeInventory } from '@/views/testing.js'

// every class AppShell's scoped styles name (router-link-* are vue-router's)
const shellClasses = new Set(
  [...shellSource.split('<style scoped>')[1].matchAll(/\.([a-zA-Z][\w-]*)/g)]
    .map((m) => m[1])
    .filter((c) => !c.startsWith('router-link')),
)

async function mountShellAt(path) {
  fx.state = makeInventory()
  const stub = { template: '<div />' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: AppShell,
        children: [
          { path: '', name: 'home', component: stub },
          { path: 'parts', name: 'parts', component: stub },
          { path: 'record', name: 'record', component: stub },
          { path: 'history', name: 'history', component: stub },
          { path: 'settings', name: 'settings', component: stub },
          { path: 'import', name: 'import', component: HostImportView },
        ],
      },
    ],
  })
  router.push(path)
  await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('AppShell around the import screen', () => {
  // A child view's root element inherits AppShell's scope attribute, so any
  // AppShell rule whose class the root shares styles the whole screen too
  // (0.1.1: the top-bar Import pill drew a circle around the import section).
  it("gives the view's root AppShell's scope, so their class names must differ", async () => {
    const wrapper = await mountShellAt('/import')
    const section = wrapper.get('section')
    expect(section.element.hasAttribute(AppShell.__scopeId)).toBe(true)
    expect(section.classes().filter((c) => shellClasses.has(c))).toEqual([])
  })

  it('styles the top-bar Import link with its own class', async () => {
    const wrapper = await mountShellAt('/import')
    const link = wrapper.get('[data-test="top-import"]')
    expect(link.classes()).toContain('import-btn')
    expect(wrapper.get('section').classes()).not.toContain('import-btn')
  })
})
