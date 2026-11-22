/// <reference path="../../pb_data/types.d.ts" />

// Seed presets (spec §5.4, decision #20): the lists a new account starts
// with, picked by users.seedPreset (empty = standard). Two are built in;
// more can be added without rebuilding the image, in
// <pb_data>/stocky-presets.json (docs/presets.md), which is read every time
// it's needed, validated, and ignored with a logged error if it's invalid.
// seed() in stocky.js writes the chosen preset once.
//
// A host's `site` is the key of a site in the same preset. A site starts
// referenced exactly when the preset gives it hosts.

const BUILT_IN = {
  // the default for every account
  standard: {
    label: 'Standard',
    locations: [
      { key: 'home', label: 'Home', kind: 'site', defaultCurrency: '' },
      { key: 'in_transit', label: 'In transit', kind: 'transit', defaultCurrency: '' },
    ],
    hosts: [],
    categories: [
      { key: 'computers', label: 'Computers & boards', description: 'SBCs, mini PCs, laptops' },
      { key: 'components', label: 'Components', description: 'CPUs, RAM, expansion cards' },
      { key: 'storage', label: 'Storage', description: 'SSDs, HDDs, memory cards' },
      { key: 'networking', label: 'Networking', description: 'switches, routers, access points' },
      { key: 'power', label: 'Power', description: 'PSUs, chargers, power cables' },
      { key: 'cables', label: 'Cables & adapters', description: '' },
      { key: 'peripherals', label: 'Peripherals', description: 'displays, keyboards, cameras' },
      {
        key: 'consumables',
        label: 'Consumables',
        description: 'thermal paste, batteries, cable ties',
      },
      { key: 'other', label: 'Other', description: '' },
    ],
  },

  // an example homelab with two sites and a few hosts, to try Stocky with
  example: {
    label: 'Example homelab',
    locations: [
      { key: 'lab', label: 'Lab', kind: 'site', defaultCurrency: 'USD' },
      { key: 'office', label: 'Office', kind: 'site', defaultCurrency: 'EUR' },
      { key: 'in_transit', label: 'In transit', kind: 'transit', defaultCurrency: '' },
    ],
    hosts: [
      { key: 'pi_a', label: 'pi-a', type: 'Raspberry Pi 5 (16 GB)', site: 'lab' },
      { key: 'pi_b', label: 'pi-b', type: 'Raspberry Pi 5 (8 GB)', site: 'lab' },
      { key: 'workstation', label: 'workstation', type: 'Desktop PC', site: 'lab' },
      { key: 'nas_a', label: 'nas-a', type: 'NAS', site: 'lab' },
      { key: 'router_a', label: 'router-a', type: 'Router', site: 'lab' },
      { key: 'nas_b', label: 'nas-b', type: 'NAS', site: 'office' },
      { key: 'minipc', label: 'minipc', type: 'Mini PC', site: 'office' },
      { key: 'router_b', label: 'router-b', type: 'Router', site: 'office' },
    ],
    categories: [
      { key: 'sbc', label: 'SBCs', description: '' },
      { key: 'storage', label: 'Storage', description: 'NVMe, microSD, HDD' },
      { key: 'power', label: 'Power', description: 'PSUs, cables' },
      { key: 'networking', label: 'Networking', description: 'Ethernet cables, switches' },
      { key: 'cameras', label: 'Cameras', description: '' },
      { key: 'sensors', label: 'Sensors', description: 'Zigbee' },
      { key: 'consumables', label: 'Consumables', description: 'thermal pads, batteries' },
      { key: 'other', label: 'Other', description: '' },
    ],
  },

  // a populated 4-node visual demo fleet (ARM64 SBC, x86 GPU Workstation,
  // 4-bay NAS, Cloud KVM VPS) with realistic specs, units, spares and movements
  demo_fleet: {
    label: 'Demo Fleet (Visual Showcase)',
    locations: [
      { key: 'lab_rack', label: 'Lab Rack', kind: 'site', defaultCurrency: 'USD' },
      { key: 'office_desk', label: 'Office Desk', kind: 'site', defaultCurrency: 'USD' },
      { key: 'cloud_region', label: 'Cloud Region', kind: 'site', defaultCurrency: 'USD' },
      { key: 'in_transit', label: 'In transit', kind: 'transit', defaultCurrency: '' },
    ],
    hosts: [
      {
        key: 'sbc_node_01',
        label: 'sbc-node-01',
        type: 'Raspberry Pi 5 Model B Rev 1.0',
        site: 'lab_rack',
        formFactor: 'sbc',
        virtualType: 'bare-metal',
        role: 'Edge Ingress & DNS',
        provider: 'Bare Metal',
        tdpWatts: 12,
        machineIdHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        lastCollector: 'stocky-collect 2.0.0',
        smartSummary: { status: 'ok', maxTempC: 39, unhealthyDrives: [] },
        specs: {
          hostname: 'sbc-node-01',
          platform: 'aarch64',
          model: 'Raspberry Pi 5 Model B Rev 1.0',
          virtual: false,
          virtualType: 'bare-metal',
          os: { name: 'Ubuntu', version: '26.04', kernel: '6.12.0-raspi' },
          uptimeSeconds: 1245600,
          cpu: { model: 'ARM Cortex-A76', vendor: 'ARM', physicalCores: 4, logicalCores: 4, maxMhz: 2400 },
          memory: { totalBytes: 17179869184, swapBytes: 0, zramBytes: 2147483648, type: 'LPDDR4X', modules: [] },
          storage: {
            totalBytes: 1128070340608,
            driveCount: 2,
            drives: [
              {
                vendor: 'Samsung',
                model: 'Samsung SSD 990 PRO 1TB',
                serial: 'S6Z1NJ0X00101',
                sizeBytes: 1000204886016,
                interface: 'nvme',
                slot: 'nvme0',
                smartStatus: 'PASSED',
                tempC: 39,
                wearPercent: 2,
              },
              {
                vendor: 'SanDisk',
                model: 'Extreme microSD 128GB',
                serial: '0x9988aabb',
                sizeBytes: 127865454592,
                interface: 'sd',
                slot: 'mmc0',
                smartStatus: 'UNKNOWN',
                tempC: null,
                wearPercent: null,
              },
            ],
          },
          gpus: [],
          nics: [
            { vendor: 'Broadcom', model: 'Onboard Ethernet (macb)', serial: '2c:cf:67:10:01:01', bus: 'platform', onboard: true, interface: 'eth0' },
            { vendor: 'Broadcom', model: 'Onboard Wi-Fi (brcmfmac)', serial: '2c:cf:67:10:01:02', bus: 'sdio', onboard: true, interface: 'wlan0' },
          ],
          hats: [{ vendor: 'Pineboards', model: 'HatDrive! Top NVMe', serial: '7a2504e0-4f89-11d3-9a0c-0305e82c0001' }],
          usb: [],
        },
      },
      {
        key: 'ws_compute_01',
        label: 'ws-compute-01',
        type: 'Custom AM5 Workstation',
        site: 'office_desk',
        formFactor: 'workstation',
        virtualType: 'bare-metal',
        role: 'AI / Build Workstation',
        provider: 'Bare Metal',
        tdpWatts: 185,
        machineIdHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        lastCollector: 'stocky-collect 2.0.0',
        smartSummary: { status: 'ok', maxTempC: 42, unhealthyDrives: [] },
        specs: {
          hostname: 'ws-compute-01',
          platform: 'x86_64',
          model: 'ASUS ProArt B650-CREATOR',
          virtual: false,
          virtualType: 'bare-metal',
          os: { name: 'Ubuntu', version: '26.04', kernel: '6.12.0-45-generic' },
          uptimeSeconds: 612000,
          cpu: { model: 'AMD Ryzen 9 7950X', vendor: 'AMD', physicalCores: 16, logicalCores: 32, maxMhz: 5700 },
          memory: {
            totalBytes: 68719476736,
            swapBytes: 8589934592,
            zramBytes: 0,
            type: 'DDR5',
            modules: [
              { vendor: 'Kingston', model: 'KF556C40-32', serial: 'K5320001', sizeBytes: 34359738368, memoryType: 'DDR5', speedMTs: 5600, slot: 'DIMM_A2' },
              { vendor: 'Kingston', model: 'KF556C40-32', serial: 'K5320002', sizeBytes: 34359738368, memoryType: 'DDR5', speedMTs: 5600, slot: 'DIMM_B2' },
            ],
          },
          storage: {
            totalBytes: 4000787030016,
            driveCount: 2,
            drives: [
              {
                vendor: 'WD',
                model: 'WD Black SN850X 2TB',
                serial: 'WDBLK2001',
                sizeBytes: 2000393515008,
                interface: 'nvme',
                slot: 'nvme0',
                smartStatus: 'PASSED',
                tempC: 42,
                wearPercent: 4,
              },
              {
                vendor: 'WD',
                model: 'WD Black SN850X 2TB',
                serial: 'WDBLK2002',
                sizeBytes: 2000393515008,
                interface: 'nvme',
                slot: 'nvme1',
                smartStatus: 'PASSED',
                tempC: 40,
                wearPercent: 1,
              },
            ],
          },
          gpus: [
            {
              vendor: 'NVIDIA',
              model: 'NVIDIA GeForce RTX 4070 Ti SUPER',
              serial: 'GPU-9a8b7c6d-1122-3344-5566-778899aabbcc',
              vramBytes: 17179869184,
              bus: 'pci',
              slot: '0000:01:00.0',
            },
          ],
          nics: [
            { vendor: 'Intel', model: 'Intel I226-V 2.5GbE', serial: 'a4:bb:6d:20:01:01', bus: 'pci', onboard: true, interface: 'eno1' },
          ],
          hats: [],
          usb: [],
        },
      },
      {
        key: 'nas_vault_01',
        label: 'nas-vault-01',
        type: 'Synology DS923+',
        site: 'lab_rack',
        formFactor: 'nas',
        virtualType: 'nas',
        role: 'Primary Storage & Media NAS',
        provider: 'Bare Metal',
        tdpWatts: 45,
        machineIdHash: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
        lastCollector: 'stocky-collect 2.0.0',
        smartSummary: { status: 'ok', maxTempC: 36, unhealthyDrives: [] },
        specs: {
          hostname: 'nas-vault-01',
          platform: 'x86_64',
          model: 'Synology DS923+',
          virtual: false,
          virtualType: 'nas',
          os: { name: 'Synology DSM', version: '7.2.2-72806', kernel: '4.4.302+' },
          uptimeSeconds: 3890000,
          cpu: { model: 'AMD Ryzen Embedded R1600', vendor: 'AMD', physicalCores: 2, logicalCores: 4, maxMhz: 2600 },
          memory: { totalBytes: 34359738368, swapBytes: 4294967296, zramBytes: 0, type: 'DDR4 ECC', modules: [] },
          storage: {
            totalBytes: 32006252888064,
            driveCount: 4,
            drives: [
              { vendor: 'Seagate', model: 'IronWolf 8TB ST8000VN004', serial: 'WSD90011', sizeBytes: 8001563222016, interface: 'sata', slot: 'ata1', smartStatus: 'PASSED', tempC: 35, wearPercent: null },
              { vendor: 'Seagate', model: 'IronWolf 8TB ST8000VN004', serial: 'WSD90012', sizeBytes: 8001563222016, interface: 'sata', slot: 'ata2', smartStatus: 'PASSED', tempC: 36, wearPercent: null },
              { vendor: 'Seagate', model: 'IronWolf 8TB ST8000VN004', serial: 'WSD90013', sizeBytes: 8001563222016, interface: 'sata', slot: 'ata3', smartStatus: 'PASSED', tempC: 35, wearPercent: null },
              { vendor: 'Seagate', model: 'IronWolf 8TB ST8000VN004', serial: 'WSD90014', sizeBytes: 8001563222016, interface: 'sata', slot: 'ata4', smartStatus: 'PASSED', tempC: 34, wearPercent: null },
            ],
          },
          gpus: [],
          nics: [
            { vendor: 'Realtek', model: '1GbE LAN 1', serial: '90:09:d0:11:22:01', bus: 'pci', onboard: true, interface: 'eth0' },
            { vendor: 'Aquatia', model: 'E10G22-T1-Mini 10GbE', serial: '90:09:d0:11:22:02', bus: 'pci', onboard: false, interface: 'eth1' },
          ],
          hats: [],
          usb: [],
        },
      },
      {
        key: 'vps_edge_01',
        label: 'vps-edge-01',
        type: 'Cloud KVM VPS',
        site: 'cloud_region',
        formFactor: 'vps',
        virtualType: 'kvm',
        role: 'WireGuard Hub & Monitoring',
        provider: 'Cloud KVM',
        monthlyCost: 14,
        currency: 'USD',
        machineIdHash: 'sha256:4444444444444444444444444444444444444444444444444444444444444444',
        lastCollector: 'stocky-collect 2.0.0',
        smartSummary: { status: 'unknown', unhealthyDrives: [] },
        specs: {
          hostname: 'vps-edge-01',
          platform: 'x86_64',
          model: 'QEMU Standard PC (Q35 + ICH9)',
          virtual: true,
          virtualType: 'kvm',
          os: { name: 'Ubuntu', version: '26.04', kernel: '6.12.0-generic' },
          uptimeSeconds: 2150000,
          cpu: { model: 'AMD EPYC-Genoa Processor', vendor: 'AMD', physicalCores: 4, logicalCores: 4, maxMhz: 2800 },
          memory: { totalBytes: 8589934592, swapBytes: 2147483648, zramBytes: 0, type: 'vRAM', modules: [] },
          storage: {
            totalBytes: 171798691840,
            driveCount: 1,
            drives: [
              { vendor: 'QEMU', model: 'VirtIO NVMe Volume 160GB', serial: 'vol-cloud-001', sizeBytes: 171798691840, interface: 'virtio', slot: 'virtio0', smartStatus: 'UNKNOWN', tempC: null, wearPercent: null },
            ],
          },
          gpus: [],
          nics: [{ vendor: 'Red Hat', model: 'VirtIO Ethernet (virtio_net)', serial: '52:54:00:aa:bb:01', bus: 'pci', onboard: true, interface: 'eth0' }],
          hats: [],
          usb: [],
        },
      },
    ],
    categories: [
      { key: 'computers', label: 'Computers & boards', description: 'SBCs, mini PCs, workstations' },
      { key: 'components', label: 'Components', description: 'CPUs, RAM, GPUs, expansion cards' },
      { key: 'storage', label: 'Storage', description: 'NVMe SSDs, SATA HDDs, microSD' },
      { key: 'networking', label: 'Networking', description: 'NICs, switches, routers' },
      { key: 'power', label: 'Power', description: 'PSUs, UPS, PD chargers' },
      { key: 'cables', label: 'Cables & adapters', description: 'DAC, Cat6A, PCIe risers' },
      { key: 'peripherals', label: 'Peripherals', description: 'KVMs, Zigbee coordinators' },
      { key: 'consumables', label: 'Consumables', description: 'Thermal pads, fans' },
      { key: 'other', label: 'Other', description: '' },
    ],
  },
}

const FILE_NAME = 'stocky-presets.json'
const KEY = /^[a-z0-9_]{1,40}$/
const CURRENCIES = ['', 'TWD', 'EUR', 'USD']

// -> a list of problems with a presets object (empty when it's fine)
function validate(presets) {
  const errors = []
  if (!presets || typeof presets !== 'object' || Array.isArray(presets)) {
    return ['the file must hold one JSON object: { "<preset name>": { … } }']
  }
  const names = Object.keys(presets)
  if (names.length > 50) errors.push('at most 50 presets')
  const text = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max
  for (const name of names) {
    const before = errors.length
    const at = (m) => errors.push(`${name}: ${m}`)
    if (!KEY.test(name)) at('preset names use a–z, 0–9 and _ (up to 40)')
    if (BUILT_IN[name]) at(`"${name}" is built in and can't be replaced`)
    const p = presets[name]
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      at('must be an object with locations, hosts and categories')
      continue
    }
    if (p.label !== undefined && !text(p.label, 1, 60)) at('label: 1–60 characters')
    for (const list of ['locations', 'hosts', 'categories']) {
      if (!Array.isArray(p[list])) at(`${list} must be a list`)
      else if (p[list].length > 200) at(`${list}: at most 200`)
    }
    if (errors.length > before) continue
    const keysOf = {}
    for (const list of ['locations', 'hosts', 'categories']) {
      const keys = {}
      const labels = {}
      p[list].forEach((x, i) => {
        const where = `${list}[${i}]`
        if (!x || typeof x !== 'object') return at(`${where} must be an object`)
        if (!KEY.test(x.key || '')) at(`${where}.key: a–z, 0–9 and _ (up to 40)`)
        else if (keys[x.key]) at(`${where}.key "${x.key}" is used twice`)
        keys[x.key] = x
        if (!text(x.label, 1, 40)) at(`${where}.label: 1–40 characters`)
        else {
          const l = x.label.trim().toLowerCase()
          if (labels[l]) at(`${where}.label "${x.label}" is used twice`)
          labels[l] = true
        }
        if (list === 'locations') {
          if (x.kind !== 'site' && x.kind !== 'transit') at(`${where}.kind: site or transit`)
          if (CURRENCIES.indexOf(x.defaultCurrency || '') < 0) {
            at(`${where}.defaultCurrency: TWD, EUR, USD or empty`)
          }
        }
        if (list === 'hosts' && x.type !== undefined && !text(x.type, 0, 60)) {
          at(`${where}.type: up to 60 characters`)
        }
        if (list === 'categories' && x.description !== undefined && !text(x.description, 0, 120)) {
          at(`${where}.description: up to 120 characters`)
        }
      })
      keysOf[list] = keys
    }
    const kinds = p.locations.map((l) => l && l.kind)
    if (kinds.filter((k) => k === 'transit').length !== 1) at('exactly one transit location')
    if (kinds.filter((k) => k === 'site').length < 1) at('at least one site')
    if (p.categories.length < 1) at('at least one category')
    p.hosts.forEach((h, i) => {
      const site = h && keysOf.locations[h.site]
      if (!site || site.kind !== 'site') at(`hosts[${i}].site: the key of a site in this preset`)
    })
  }
  return errors
}

// -> { presets, file: [names from the file], error } with the built-ins
// always present; error describes an unreadable or invalid file
function load(app) {
  const presets = Object.assign({}, BUILT_IN)
  const path = `${app.dataDir()}/${FILE_NAME}`
  let raw
  try {
    raw = toString($os.readFile(path))
  } catch (err) {
    const missing = /no such file|not exist|cannot find/i.test(String(err))
    return {
      presets: presets,
      file: [],
      error: missing ? '' : `${FILE_NAME} can't be read: ${err}`,
    }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { presets: presets, file: [], error: `${FILE_NAME} isn't valid JSON` }
  }
  const errors = validate(parsed)
  if (errors.length) {
    return {
      presets: presets,
      file: [],
      error: `${FILE_NAME} is invalid: ${errors.slice(0, 5).join('; ')}`,
    }
  }
  for (const name of Object.keys(parsed)) presets[name] = parsed[name]
  return { presets: presets, file: Object.keys(parsed), error: '' }
}

module.exports = { BUILT_IN, FILE_NAME, validate, load }
