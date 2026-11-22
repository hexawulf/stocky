import { describe, expect, it } from 'vitest'
import {
  computeFleetSummary,
  filterFleetHosts,
  generateFleetMarkdown,
  generateFleetSvg,
  hostFreshness,
  inferHostFormFactor,
  prepareExportData,
} from './fleet.js'

const NOW = Date.parse('2026-11-22T12:00:00Z')

const SAMPLE_HOSTS = [
  {
    id: 'h1',
    label: 'sbc-node-01',
    site: 'lab',
    formFactor: 'sbc',
    virtualType: 'bare-metal',
    role: 'Edge DNS',
    tdpWatts: 12,
    driftCount: 0,
    machineIdHash: 'sha256:' + '1'.repeat(64),
    lastSeenAt: '2026-11-22T10:00:00Z',
    smartSummary: { status: 'ok', maxTempC: 38, unhealthyDrives: [] },
    specs: {
      hostname: 'sbc-node-01',
      platform: 'aarch64',
      model: 'Raspberry Pi 5',
      virtual: false,
      os: { name: 'Ubuntu', version: '26.04', kernel: '6.12.0-raspi' },
      cpu: { model: 'Cortex-A76', physicalCores: 4 },
      memory: { totalBytes: 17179869184, type: 'LPDDR4X' },
      storage: {
        totalBytes: 1000204886016,
        driveCount: 1,
        drives: [
          {
            vendor: 'Samsung',
            model: '990 PRO 1TB',
            serial: 'SECRET_NVME_SERIAL_01',
            sizeBytes: 1000204886016,
            interface: 'nvme',
            smartStatus: 'PASSED',
            tempC: 38,
          },
        ],
      },
      nics: [{ vendor: 'Broadcom', model: 'macb', serial: '2c:cf:67:aa:bb:cc', interface: 'eth0' }],
      gpus: [],
    },
  },
  {
    id: 'h2',
    label: 'vps-edge-01',
    site: 'cloud',
    formFactor: 'vps',
    virtualType: 'kvm',
    provider: 'CloudProvider',
    monthlyCost: 14,
    currency: 'USD',
    driftCount: 2,
    machineIdHash: 'sha256:' + '2'.repeat(64),
    lastSeenAt: '2026-11-18T10:00:00Z', // 4 days ago -> stale
    smartSummary: { status: 'warn', maxTempC: 68, unhealthyDrives: ['vda: high temp 68C'] },
    specs: {
      hostname: 'vps-edge-01',
      platform: 'x86_64',
      model: 'QEMU KVM',
      virtual: true,
      os: { name: 'Ubuntu', version: '26.04', kernel: '6.12.0' },
      cpu: { model: 'AMD EPYC', physicalCores: 4 },
      memory: { totalBytes: 8589934592 },
      storage: {
        totalBytes: 171798691840,
        driveCount: 1,
        drives: [
          {
            vendor: 'QEMU',
            model: 'VirtIO 160G',
            serial: 'SECRET_VPS_SERIAL_02',
            sizeBytes: 171798691840,
            interface: 'virtio',
          },
        ],
      },
      gpus: [
        { vendor: 'NVIDIA', model: 'RTX 4070', serial: 'SECRET_GPU_UUID', vramBytes: 12884901888 },
      ],
      nics: [{ vendor: 'VirtIO', model: 'virtio_net', serial: '52:54:00:99:88:77' }],
    },
  },
]

const LOCATIONS = {
  lab: { id: 'lab', label: 'Lab Rack', sortOrder: 0 },
  cloud: { id: 'cloud', label: 'Cloud Region', sortOrder: 1 },
}

describe('Fleet KPI summary, freshness and filtering (Phase 3)', () => {
  it('classifies host freshness accurately', () => {
    expect(hostFreshness(SAMPLE_HOSTS[0], { now: NOW })).toMatchObject({
      state: 'online',
      dot: 'green',
    })
    expect(hostFreshness(SAMPLE_HOSTS[1], { now: NOW })).toMatchObject({
      state: 'stale',
      dot: 'gray',
    })
    expect(hostFreshness({ label: 'manual-box' }, { now: NOW })).toMatchObject({
      state: 'manual',
      dot: 'blue',
    })
  })

  it('aggregates fleet cores, RAM, storage, SMART alerts, drift, and economics', () => {
    const sum = computeFleetSummary(SAMPLE_HOSTS, { now: NOW })
    expect(sum).toMatchObject({
      totalHosts: 2,
      online: 1,
      stale: 1,
      driftHosts: 1,
      totalDriftItems: 2,
      physicalCores: 4,
      cloudVcpus: 4,
      totalCores: 8,
      arm64Count: 1,
      x86Count: 1,
      totalRamLabel: '24 GB',
      totalDrives: 2,
      smartWarnings: 1,
      smartHealthy: false,
      monthlyCostByCurrency: { USD: 14 },
      totalTdpWatts: 12,
    })
  })

  it('filters hosts by site, formFactor, architecture, status, and text search', () => {
    expect(filterFleetHosts(SAMPLE_HOSTS, { site: 'lab' }, { now: NOW })).toHaveLength(1)
    expect(filterFleetHosts(SAMPLE_HOSTS, { formFactor: 'vps' }, { now: NOW })).toHaveLength(1)
    expect(filterFleetHosts(SAMPLE_HOSTS, { arch: 'arm64' }, { now: NOW })).toHaveLength(1)
    expect(filterFleetHosts(SAMPLE_HOSTS, { status: 'drift' }, { now: NOW })[0].id).toBe('h2')
    expect(filterFleetHosts(SAMPLE_HOSTS, { status: 'smart_warn' }, { now: NOW })[0].id).toBe('h2')
    expect(filterFleetHosts(SAMPLE_HOSTS, { q: 'rtx 4070' }, { now: NOW })[0].id).toBe('h2')
    expect(filterFleetHosts(SAMPLE_HOSTS, { q: '990 pro' }, { now: NOW })[0].id).toBe('h1')
  })

  it('infers form factor from virtualType or model keywords when unset', () => {
    expect(inferHostFormFactor({ type: 'Synology DS423+' })).toBe('nas')
    expect(inferHostFormFactor({ type: 'Raspberry Pi 5' })).toBe('sbc')
    expect(inferHostFormFactor({ virtualType: 'kvm' })).toBe('vps')
  })
})

describe('Privacy-safe visual & spec exports (Phase 4)', () => {
  it('redacts serials, MACs, machineIdHash, and costs by default', () => {
    const data = prepareExportData(SAMPLE_HOSTS, LOCATIONS)
    const rawJson = JSON.stringify(data)
    expect(rawJson).not.toContain('SECRET_NVME_SERIAL_01')
    expect(rawJson).not.toContain('SECRET_VPS_SERIAL_02')
    expect(rawJson).not.toContain('SECRET_GPU_UUID')
    expect(rawJson).not.toContain('2c:cf:67:aa:bb:cc')
    expect(rawJson).not.toContain('52:54:00:99:88:77')
    expect(rawJson).not.toContain('sha256:')
    expect(rawJson).not.toContain('CloudProvider')

    const md = generateFleetMarkdown(SAMPLE_HOSTS, LOCATIONS)
    expect(md).toContain('sbc-node-01')
    expect(md).toContain('NVME 1T')
    expect(md).not.toContain('SECRET_NVME_SERIAL_01')
    expect(md).not.toContain('2c:cf:67:aa:bb:cc')

    const svg = generateFleetSvg(SAMPLE_HOSTS, LOCATIONS, {}, { fleetName: 'Test Fleet' })
    expect(svg).toContain('<svg')
    expect(svg).toContain('Test Fleet')
    expect(svg).toContain('sbc-node-01')
    expect(svg).not.toContain('SECRET_NVME_SERIAL_01')
    expect(svg).not.toContain('2c:cf:67:aa:bb:cc')
  })

  it('supports optional host anonymization', () => {
    const md = generateFleetMarkdown(SAMPLE_HOSTS, LOCATIONS, { anonymizeHosts: true })
    expect(md).toContain('sbc-01')
    expect(md).toContain('vps-01')
    expect(md).not.toContain('sbc-node-01')
    expect(md).not.toContain('vps-edge-01')
  })
})
