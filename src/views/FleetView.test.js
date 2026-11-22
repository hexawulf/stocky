import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

const fx = vi.hoisted(() => ({ state: null }))
vi.mock('@/stores/inventory.js', () => ({ useInventory: () => fx.state }))
vi.mock('@/lib/api.js', () => ({
  loadDemoFleet: vi.fn(async () => ({ seeded: true, preset: 'demo_fleet' })),
  createIngestToken: vi.fn(async () => ({
    token: 'stky_testtoken1234567890abcdef',
    record: { id: 't1', label: 'Fleet Collector', tokenPrefix: 'stky_testtok', scope: 'fleet' },
  })),
  listIngestTokens: vi.fn(async () => []),
  revokeIngestToken: vi.fn(async () => ({})),
  listPendingSnapshots: vi.fn(async () => []),
  applyDriftSnapshot: vi.fn(async () => ({ movements: 1, status: 'applied' })),
  dismissDriftSnapshot: vi.fn(async () => ({ status: 'dismissed' })),
  listUnits: vi.fn(async () => []),
  listImports: vi.fn(async () => []),
  recordMovement: vi.fn(async () => ({})),
  updateEntry: vi.fn(async () => ({})),
}))

import { applyDriftSnapshot, createIngestToken, listPendingSnapshots } from '@/lib/api.js'
import FleetView from './FleetView.vue'
import HostDetailView from './HostDetailView.vue'
import DriftInboxView from './DriftInboxView.vue'
import { makeInventory, mountAt } from './testing.js'

beforeEach(() => {
  fx.state = makeInventory({
    hosts: {
      pib: {
        id: 'pib',
        key: 'pi_b',
        label: 'pi-b',
        type: 'Raspberry Pi 5 (8 GB)',
        role: 'Edge DNS',
        site: 'lab',
        formFactor: 'sbc',
        virtualType: 'bare-metal',
        sortOrder: 0,
        retired: false,
        referenced: true,
        driftCount: 1,
        lastSeenAt: new Date().toISOString(),
        smartSummary: { status: 'ok', maxTempC: 39, unhealthyDrives: [] },
        specs: {
          hostname: 'pi-b',
          platform: 'aarch64',
          model: 'Raspberry Pi 5',
          virtual: false,
          os: { name: 'Ubuntu', version: '26.04', kernel: '6.12.0-raspi' },
          cpu: { model: 'Cortex-A76', physicalCores: 4 },
          memory: { totalBytes: 8589934592, type: 'LPDDR4X' },
          storage: {
            totalBytes: 1000204886016,
            driveCount: 1,
            drives: [
              {
                vendor: 'Samsung',
                model: '980 PRO 1TB',
                serial: 'S5GX1122',
                sizeBytes: 1000204886016,
                interface: 'nvme',
                slot: 'nvme0',
                smartStatus: 'PASSED',
                tempC: 39,
              },
            ],
          },
          gpus: [],
          nics: [
            { vendor: 'Broadcom', model: 'macb', serial: '2c:cf:67:00:11:22', interface: 'eth0' },
          ],
          hats: [{ vendor: 'Pimoroni', model: 'NVMe Base', serial: 'uuid-1' }],
        },
      },
      nsb: {
        id: 'nsb',
        key: 'nas_b',
        label: 'nas-b',
        type: 'Synology DS923+',
        role: 'Storage NAS',
        site: 'ofc',
        formFactor: 'nas',
        virtualType: 'nas',
        sortOrder: 1,
        retired: false,
        referenced: false,
        driftCount: 0,
        lastSeenAt: new Date().toISOString(),
        smartSummary: { status: 'ok', maxTempC: 35, unhealthyDrives: [] },
        specs: {
          hostname: 'nas-b',
          platform: 'x86_64',
          model: 'Synology DS923+',
          virtual: false,
          os: { name: 'Synology DSM', version: '7.2.2', kernel: '4.4.302+' },
          cpu: { model: 'Ryzen R1600', physicalCores: 2 },
          memory: { totalBytes: 17179869184, type: 'DDR4' },
          storage: {
            totalBytes: 16003126444032,
            driveCount: 2,
            drives: [
              {
                vendor: 'Seagate',
                model: 'IronWolf 8TB',
                serial: 'WSD01',
                sizeBytes: 8001563222016,
                interface: 'sata',
                slot: 'ata1',
                smartStatus: 'PASSED',
                tempC: 35,
              },
              {
                vendor: 'Seagate',
                model: 'IronWolf 8TB',
                serial: 'WSD02',
                sizeBytes: 8001563222016,
                interface: 'sata',
                slot: 'ata2',
                smartStatus: 'PASSED',
                tempC: 36,
              },
            ],
          },
          gpus: [],
          nics: [],
          hats: [],
        },
      },
    },
  })
  fx.state.start = vi.fn(async () => {})
})
afterEach(() => (document.body.innerHTML = ''))

describe('FleetView (/fleet — Phase 3 & 4 & 5)', () => {
  it('renders KPI summary strip, Rack Chassis Cards, Drive Bays, and switches to Topology SVG & Matrix', async () => {
    const { wrapper: w } = await mountAt(FleetView, '/fleet', { routeName: 'fleet' })
    expect(w.get('[data-test="fleet-kpis"]').text()).toContain('6 cores')
    expect(w.get('[data-test="fleet-kpis"]').text()).toContain('24 GB')
    expect(w.get('[data-host-card="pi-b"]').text()).toContain('NVME 1T')
    expect(w.get('[data-host-card="pi-b"]').text()).toContain('HAT: NVMe Base')
    expect(w.get('[data-host-card="nas-b"]').text()).toContain('SATA 8T')

    // Switch to Interactive Topology SVG
    await w.get('[data-test="mode-topology"]').trigger('click')
    expect(w.find('[data-test="fleet-topology"]').exists()).toBe(true)
    expect(w.get('[data-test="fleet-topology"]').text()).toContain('pi-b')

    // Switch to Spec Matrix
    await w.get('[data-test="mode-matrix"]').trigger('click')
    expect(w.find('[data-test="fleet-matrix"]').exists()).toBe(true)
    expect(w.get('[data-matrix-host="nas-b"]').text()).toContain('Synology DSM')
    w.unmount()
  })

  it('opens Export Modal with redaction ON by default and zero serial leakage', async () => {
    const { wrapper: w } = await mountAt(FleetView, '/fleet', { routeName: 'fleet' })
    await w.get('[data-test="open-export"]').trigger('click')
    const modal = w.get('[data-test="fleet-export-dialog"]')
    expect(modal.get('[data-test="redact-serials"]').element.checked).toBe(true)
    expect(modal.get('[data-test="redact-macs"]').element.checked).toBe(true)

    await modal.get('[data-test="export-format-markdown"]').trigger('click')
    const preview = modal.get('[data-test="export-preview"]').text()
    expect(preview).toContain('pi-b')
    expect(preview).not.toContain('S5GX1122')
    expect(preview).not.toContain('2c:cf:67:00:11:22')
    w.unmount()
  })

  it('opens Connect Host Wizard and generates a scoped ingest token', async () => {
    const { wrapper: w } = await mountAt(FleetView, '/fleet', { routeName: 'fleet' })
    await w.get('[data-test="open-connect"]').trigger('click')
    const modal = w.get('[data-test="connect-host-dialog"]')
    await modal.get('[data-test="generate-token"]').trigger('click')
    await flushPromises()
    expect(createIngestToken).toHaveBeenCalled()
    expect(modal.get('[data-test="generated-token"]').text()).toContain(
      'stky_testtoken1234567890abcdef',
    )
    expect(modal.get('[data-test="connect-snippet"]').text()).toContain('--token-file')
    w.unmount()
  })
})

describe('HostDetailView (/fleet/:id — Phase 3.3)', () => {
  it('renders Visual Hardware Anatomy SVG and installed parts', async () => {
    const { wrapper: w } = await mountAt(HostDetailView, '/fleet/pib', { routeName: 'host-detail' })
    expect(w.get('h1').text()).toBe('pi-b')
    expect(w.get('[data-test="host-anatomy-svg"]').text()).toContain('Cortex-A76')
    expect(w.get('[data-test="host-anatomy-svg"]').text()).toContain('NVME 1T')
    expect(w.get('[data-test="host-installed-units"]').text()).toContain('microSD 128 GB')
    w.unmount()
  })
})

describe('DriftInboxView (/fleet/drift — Phase 3.4)', () => {
  it('lists pending hardware drift and applies it to the ledger in one click', async () => {
    listPendingSnapshots.mockResolvedValueOnce([
      {
        id: 'ps1',
        host: 'pib',
        collectedAt: '2026-11-22T10:00:00+08:00',
        collector: 'stocky-collect 2.0.0',
        status: 'drift_pending',
        diffSummary: { new: 1, missing: 0, replaced: 0, moved: 0, conflicts: 0, smartWarnings: [] },
        snapshot: {
          host: { hostname: 'pi-b' },
          items: [{ kind: 'drive', vendor: 'Samsung', model: '990 PRO 2TB', serial: 'S777' }],
        },
      },
    ])
    const { wrapper: w } = await mountAt(DriftInboxView, '/fleet/drift', {
      routeName: 'fleet-drift',
    })
    await flushPromises()
    expect(w.get('[data-drift-host="pi-b"]').text()).toContain('1 new')
    expect(w.get('[data-drift-host="pi-b"]').text()).toContain('990 PRO 2TB')
    await w.get('[data-test="drift-apply"]').trigger('click')
    await flushPromises()
    expect(applyDriftSnapshot).toHaveBeenCalledWith('ps1')
    w.unmount()
  })
})
