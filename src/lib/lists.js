// Sites, hosts and categories screens (spec §4.10): per-list settings,
// entry validation and reordering.

export const LIST_KINDS = {
  sites: {
    collection: 'locations',
    title: 'Sites',
    noun: 'site',
    empty: 'No sites yet',
    add: '＋ Add site',
  },
  hosts: {
    collection: 'hosts',
    title: 'Hosts',
    noun: 'host',
    empty: 'No hosts yet',
    add: '＋ Add host',
  },
  categories: {
    collection: 'categories',
    title: 'Categories',
    noun: 'category',
    empty: 'No categories yet',
    add: '＋ Add category',
  },
}

export const MAX_LABEL = 40
export const MAX_HOST_TYPE = 60
export const MAX_DESCRIPTION = 120

const labelKey = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()

// field -> message. form: { label, type?, site?, description?, defaultCurrency? }
// ctx: { entries (same list, all), exceptId, sites (active sites, for hosts) }
export function validateEntry(kind, form, ctx = {}) {
  const e = {}
  const label = String(form.label ?? '').trim()
  const noun = LIST_KINDS[kind].noun
  if (label.length < 1 || label.length > MAX_LABEL) e.label = `Name: 1–${MAX_LABEL} characters`
  else if (
    (ctx.entries ?? []).some(
      (x) => !x.retired && x.id !== ctx.exceptId && labelKey(x.label) === labelKey(label),
    )
  ) {
    e.label = `A ${noun} named ${label} already exists`
  }
  if (kind === 'hosts') {
    if (!form.site || !(ctx.sites ?? []).some((s) => s.id === form.site)) e.site = 'Pick a site'
    if (String(form.type ?? '').trim().length > MAX_HOST_TYPE)
      e.type = `Up to ${MAX_HOST_TYPE} characters`
  }
  if (kind === 'categories' && String(form.description ?? '').trim().length > MAX_DESCRIPTION) {
    e.description = `Up to ${MAX_DESCRIPTION} characters`
  }
  return e
}

// form -> fields to save for this list
export function entryFields(kind, form) {
  const f = { label: String(form.label ?? '').trim() }
  if (kind === 'sites' && form.kind !== 'transit') f.defaultCurrency = form.defaultCurrency || ''
  if (kind === 'hosts') {
    f.type = String(form.type ?? '').trim()
    f.site = form.site
  }
  if (kind === 'categories') f.description = String(form.description ?? '').trim()
  return f
}

// Move entry `index` up (-1) or down (+1) in `list` (already in display order).
// Entries added later all have sortOrder 0, so swapping two values isn't enough:
// renumber the list 0..n-1 in the new order and return only the changed rows.
export function reorder(list, index, dir) {
  const target = index + dir
  if (target < 0 || target >= list.length) return []
  const order = [...list]
  ;[order[index], order[target]] = [order[target], order[index]]
  return order
    .map((x, i) => ({ id: x.id, sortOrder: i, changed: x.sortOrder !== i }))
    .filter((x) => x.changed)
    .map(({ id, sortOrder }) => ({ id, sortOrder }))
}

export function nextSortOrder(list) {
  return list.reduce((max, x) => Math.max(max, x.sortOrder ?? 0), -1) + 1
}
