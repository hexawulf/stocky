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
