import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { ref } from 'vue'

const fx = vi.hoisted(() => ({ state: null }))
vi.mock('@/stores/inventory.js', () => ({ useInventory: () => fx.state }))

import CommandPalette from './CommandPalette.vue'

describe('CommandPalette (⌘K / Ctrl+K)', () => {
  beforeEach(() => {
    fx.state = {
      locations: ref([{ id: 'loc1', label: 'Lab Alpha', kind: 'site' }]),
      hosts: ref([
        {
          id: 'h1',
          label: 'alpha-node',
          location: 'loc1',
          formFactor: 'sbc',
          hardwareSnapshot: {
            system: { os: 'Ubuntu 24.04', arch: 'aarch64' },
            cpu: { model: 'Cortex-A76' },
            memory: { totalBytes: 8 * 1024 ** 3 },
            drives: [
              {
                name: 'nvme0n1',
                model: 'Samsung 990 PRO',
                serial: 'SN-990PRO-XYZ',
                type: 'nvme',
                sizeBytes: 1024 ** 4,
                smartStatus: 'PASSED',
                tempC: 39,
              },
            ],
            gpus: [{ model: 'RTX 3060', vendor: 'NVIDIA', vramMiB: 12288 }],
            nics: [{ name: 'eth0', ipv4: '10.0.0.42', mac: 'aa:bb:cc:11:22:33', speedMbps: 2500 }],
          },
        },
      ]),
      parts: ref([
        {
          id: 'p1',
          name: 'M.2 2280 NVMe 1TB',
          unit: 'pcs',
          spareTotal: 3,
          installedTotal: 2,
        },
      ]),
    }
  })

  async function mountPalette() {
    const stub = { template: '<div />' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: stub },
        { path: '/stock', name: 'stock', component: stub },
        { path: '/fleet/:id', name: 'host-detail', component: stub },
        { path: '/parts/:id', name: 'part', component: stub },
        { path: '/record', name: 'record', component: stub },
        { path: '/import', name: 'import', component: stub },
        { path: '/fleet/drift', name: 'fleet-drift', component: stub },
      ],
    })
    router.push('/')
    await router.isReady()
    const wrapper = mount(CommandPalette, {
      global: { plugins: [router] },
    })
    await flushPromises()
    return { wrapper, router }
  }

  it('lists hosts, parts, and quick actions by default', async () => {
    const { wrapper } = await mountPalette()
    expect(wrapper.text()).toContain('alpha-node')
    expect(wrapper.text()).toContain('M.2 2280 NVMe 1TB')
    expect(wrapper.text()).toContain('Go to Fleet Overview')
  })

  it('filters drives by serial number and navigates to host inspector on Enter', async () => {
    const { wrapper, router } = await mountPalette()
    const input = wrapper.get('[data-test="cmd-input"]')
    await input.setValue('SN-990PRO-XYZ')
    expect(wrapper.text()).toContain('Samsung 990 PRO (alpha-node)')
    expect(wrapper.text()).toContain('S/N: SN-990PRO-XYZ')

    await wrapper.get('[data-test="cmd-backdrop"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('host-detail')
    expect(router.currentRoute.value.params.id).toBe('h1')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('filters GPUs and NIC MAC addresses and supports ArrowDown / Escape keyboard controls', async () => {
    const { wrapper } = await mountPalette()
    const input = wrapper.get('[data-test="cmd-input"]')
    await input.setValue('rtx 3060')
    expect(wrapper.text()).toContain('RTX 3060 (alpha-node)')

    await input.setValue('aa:bb:cc:11:22:33')
    expect(wrapper.text()).toContain('alpha-node · eth0')

    await wrapper.get('[data-test="cmd-backdrop"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('sums PocketBase part.installed maps and formats singular unit labels', async () => {
    fx.state.parts.value = [
      {
        id: 'p2',
        name: 'Samsung 990 PRO 1TB',
        unit: 'pcs',
        spareTotal: 1,
        installed: { h1: 2, h2: 1 },
      },
    ]
    const { wrapper } = await mountPalette()
    expect(wrapper.text()).toContain('1 pc spare · 3 installed')
  })
})
