// Home (spec §4.3): spares per location grouped by category, and what's
// installed in each host grouped by site.

const byLabel = (a, b) => a.label.localeCompare(b.label)
const bySort = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || byLabel(a, b)

// [{ location, total, groups: [{ category, items: [{ part, qty }] }] }]
// locations: already in display order (active sites, then In transit)
export function locationSections(parts, locations, categories) {
  return locations.map((location) => {
    const byCategory = new Map()
    let total = 0
    for (const p of parts) {
      const qty = p.spare?.[location.id] ?? 0
      if (qty <= 0) continue
      total += qty
      const key = p.category || ''
      if (!byCategory.has(key)) byCategory.set(key, [])
      byCategory.get(key).push({ part: p, qty })
    }
    const groups = [...byCategory.entries()]
      .map(([id, items]) => ({
        category: categories[id] ?? { id, label: 'No category', sortOrder: Infinity },
        items: items.sort((a, b) => a.part.name.localeCompare(b.part.name)),
      }))
      .sort((a, b) => bySort(a.category, b.category))
    return { location, total, groups }
  })
}

// [{ site, hosts: [{ host, items: [{ part, qty }] }] }] for active hosts,
// sites in their order (spec §4.3 "Installed" section)
export function installedSections(parts, hosts, locations) {
  const sites = new Map()
  for (const host of [...hosts].sort(bySort)) {
    const items = parts
      .map((p) => ({ part: p, qty: p.installed?.[host.id] ?? 0 }))
      .filter((r) => r.qty > 0)
      .sort((a, b) => a.part.name.localeCompare(b.part.name))
    const site = locations[host.site] ?? {
      id: host.site,
      label: 'Unknown site',
      sortOrder: Infinity,
    }
    if (!sites.has(site.id)) sites.set(site.id, { site, hosts: [] })
    sites.get(site.id).hosts.push({ host, items })
  }
  return [...sites.values()].sort((a, b) => bySort(a.site, b.site))
}
