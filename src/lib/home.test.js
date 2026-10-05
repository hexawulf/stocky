import { describe, expect, it } from 'vitest'
import { installedSections, locationSections } from './home.js'

const categories = {
  st: { id: 'st', label: 'Storage', sortOrder: 0 },
  pw: { id: 'pw', label: 'Power', sortOrder: 1 },
}
const locations = {
  lab: { id: 'lab', label: 'Lab', sortOrder: 0 },
  ofc: { id: 'ofc', label: 'Office', sortOrder: 1 },
}
const parts = [
  { id: 'a', name: 'microSD', category: 'st', spare: { lab: 3, trn: 1 }, installed: { pib: 1 } },
  { id: 'b', name: 'PSU 27W', category: 'pw', spare: { lab: 2 }, installed: {} },
  { id: 'c', name: 'NVMe', category: 'st', spare: { lab: 1 }, installed: { pib: 2, nsb: 1 } },
]

describe('locationSections (spec §4.3)', () => {
  it('per location: total and parts with stock, grouped by category in order', () => {
    const [lab, ofc, trn] = locationSections(
      parts,
      [locations.lab, locations.ofc, { id: 'trn', label: 'In transit' }],
      categories,
    )
    expect(lab.total).toBe(6)
    expect(
      lab.groups.map((g) => [g.category.label, g.items.map((i) => `${i.part.name}:${i.qty}`)]),
    ).toEqual([
      ['Storage', ['microSD:3', 'NVMe:1']],
      ['Power', ['PSU 27W:2']],
    ])
    expect(ofc).toMatchObject({ total: 0, groups: [] })
    expect(trn.total).toBe(1)
  })
})

describe('installedSections (spec §4.3)', () => {
  it('active hosts grouped by site, each with its installed parts', () => {
    const hosts = [
      { id: 'nsb', label: 'nas-b', site: 'ofc', sortOrder: 0 },
      { id: 'pib', label: 'pi-b', site: 'lab', sortOrder: 1 },
      { id: 'pia', label: 'pi-a', site: 'lab', sortOrder: 0 },
    ]
    const out = installedSections(parts, hosts, locations)
    expect(out.map((s) => s.site.label)).toEqual(['Lab', 'Office'])
    expect(
      out[0].hosts.map((h) => [h.host.label, h.items.map((i) => `${i.part.name}:${i.qty}`)]),
    ).toEqual([
      ['pi-a', []],
      ['pi-b', ['microSD:1', 'NVMe:2']], // by name, case-insensitive
    ])
  })
})
