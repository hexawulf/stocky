// Shared fixtures for view tests: an inventory shaped like useInventory()
// (example-like lists plus a Home site), and a router with the app's routes
// stubbed. Not a test file itself.
import { computed, reactive, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

export function makeInventory(overrides = {}) {
  const records = reactive({
    locations: {
      lab: {
        id: 'lab',
        key: 'lab',
        label: 'Lab',
        kind: 'site',
        sortOrder: 0,
        retired: false,
        referenced: true,
        defaultCurrency: 'TWD',
      },
      ofc: {
        id: 'ofc',
        key: 'office',
        label: 'Office',
        kind: 'site',
        sortOrder: 1,
        retired: false,
        referenced: true,
        defaultCurrency: 'EUR',
      },
      home: {
        id: 'home',
        key: '',
        label: 'Home',
        kind: 'site',
        sortOrder: 2,
        retired: false,
        referenced: false,
        defaultCurrency: '',
      },
      trn: {
        id: 'trn',
        key: 'in_transit',
        label: 'In transit',
        kind: 'transit',
        sortOrder: 3,
        retired: false,
        referenced: true,
        defaultCurrency: '',
      },
      ...overrides.locations,
    },
    hosts: {
      pib: {
        id: 'pib',
        key: 'pi_b',
        label: 'pi-b',
        type: 'Raspberry Pi 5 (8 GB)',
        site: 'lab',
        sortOrder: 0,
        retired: false,
        referenced: true,
      },
      nsb: {
        id: 'nsb',
        key: 'nas_b',
        label: 'nas-b',
        type: 'Synology NAS',
        site: 'ofc',
        sortOrder: 1,
        retired: false,
        referenced: false,
      },
      ...overrides.hosts,
    },
    parts: {
      p1: {
        id: 'p1',
        name: 'microSD 128 GB',
        nameKey: 'microsd 128 gb',
        category: 'st',
        unit: 'pcs',
        manufacturer: 'SanDisk',
        model: 'High Endurance',
        notes: '',
        spare: { lab: 3, trn: 1 },
        installed: { pib: 1 },
        spareTotal: 4,
        lowStockEnabled: true,
        lowStockThreshold: 4,
        archived: false,
        updated: '2026-10-04 10:00:00.000Z',
      },
      ...overrides.parts,
    },
    categories: {
      st: {
        id: 'st',
        key: 'storage',
        label: 'Storage',
        description: 'NVMe, microSD',
        sortOrder: 0,
        retired: false,
        referenced: true,
      },
      pw: {
        id: 'pw',
        key: 'power',
        label: 'Power',
        description: '',
        sortOrder: 1,
        retired: false,
        referenced: false,
      },
      old: {
        id: 'old',
        key: '',
        label: 'Old stuff',
        description: '',
        sortOrder: 2,
        retired: true,
        referenced: true,
      },
      ...overrides.categories,
    },
  })
  const online = ref(true)
  const status = ref(overrides.status ?? 'ready')
  const bySort = (a, b) => a.sortOrder - b.sortOrder
  const active = (o) =>
    Object.values(o)
      .filter((r) => !r.retired)
      .sort(bySort)
  return {
    records,
    online,
    status,
    error: ref(null),
    retry: () => {},
    canWrite: computed(() => online.value && status.value === 'ready'),
    parts: computed(() =>
      Object.values(records.parts)
        .filter((p) => !p.archived)
        .sort((a, b) => a.name.localeCompare(b.name)),
    ),
    locations: computed(() => {
      const all = active(records.locations)
      return [...all.filter((l) => l.kind === 'site'), ...all.filter((l) => l.kind === 'transit')]
    }),
    transit: computed(() => Object.values(records.locations).find((l) => l.kind === 'transit')),
    hosts: computed(() => active(records.hosts)),
    categories: computed(() => active(records.categories)),
    lowStock: computed(() =>
      Object.values(records.parts).filter(
        (p) => !p.archived && p.lowStockEnabled && p.spareTotal <= p.lowStockThreshold,
      ),
    ),
  }
}

const stub = { template: '<div />' }

// mount a view at a path, with all app routes present (stubs except the view)
export async function mountAt(component, path, { routeName } = {}) {
  const names = {
    home: '/',
    parts: '/parts',
    'part-new': '/parts/new',
    'part-edit': '/parts/:id/edit',
    part: '/parts/:id',
    record: '/record',
    history: '/history',
    settings: '/settings',
    'settings-list': '/settings/:kind',
    'host-import': '/settings/hosts/:id/import',
    import: '/import',
  }
  const routes = Object.entries(names).map(([name, p]) => ({
    name,
    path: p,
    component: name === routeName ? component : stub,
  }))
  const router = createRouter({ history: createMemoryHistory(), routes })
  router.push(path)
  await router.isReady()
  const wrapper = mount(component, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}
