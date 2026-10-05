// The part form (spec §4.6, §8): form state <-> record fields, and validation.
import { UNITS } from './format.js'
import { findDuplicate } from './movements.js'

export const MAX_NAME = 80
export const MAX_MAKER = 60
export const MAX_NOTES = 500
export const MAX_THRESHOLD = 9999

export function emptyPartForm(name = '') {
  return {
    name,
    category: '',
    unit: 'pcs',
    manufacturer: '',
    model: '',
    notes: '',
    threshold: '', // blank = no low-stock alert (decision #18)
  }
}

export function partFormFromRecord(p) {
  return {
    name: p.name ?? '',
    category: p.category ?? '',
    unit: p.unit ?? 'pcs',
    manufacturer: p.manufacturer ?? '',
    model: p.model ?? '',
    notes: p.notes ?? '',
    threshold: p.lowStockEnabled ? String(p.lowStockThreshold ?? 0) : '',
  }
}

// form -> the fields the server stores (number fields can't be empty, so a
// blank threshold is lowStockEnabled: false; decision #18)
export function partFieldsFromForm(form) {
  const t = String(form.threshold ?? '').trim()
  return {
    name: form.name.trim(),
    category: form.category,
    unit: form.unit,
    manufacturer: form.manufacturer.trim(),
    model: form.model.trim(),
    notes: form.notes.trim(),
    lowStockEnabled: t !== '',
    lowStockThreshold: t === '' ? 0 : Number(t),
  }
}

// field -> message; ctx: { parts, categories (all, incl. retired), exceptId, originalCategory }
export function validatePart(form, ctx = {}) {
  const e = {}
  const name = form.name.trim()
  if (name.length < 2 || name.length > MAX_NAME) e.name = `Name: 2–${MAX_NAME} characters`
  else if (findDuplicate(ctx.parts ?? [], name, ctx.exceptId)) e.name = 'duplicate'

  const cat = (ctx.categories ?? []).find((c) => c.id === form.category)
  if (!form.category || !cat) e.category = 'Pick a category'
  // an existing part may keep a retired category; a new or changed one must be active (§8)
  else if (cat.retired && form.category !== ctx.originalCategory)
    e.category = `${cat.label} is retired`

  if (!UNITS.includes(form.unit)) e.unit = 'Pick a unit'
  if (form.manufacturer.trim().length > MAX_MAKER) e.manufacturer = `Up to ${MAX_MAKER} characters`
  if (form.model.trim().length > MAX_MAKER) e.model = `Up to ${MAX_MAKER} characters`
  if (form.notes.trim().length > MAX_NOTES) e.notes = `Up to ${MAX_NOTES} characters`

  const t = String(form.threshold ?? '').trim()
  if (t !== '' && !(/^\d+$/.test(t) && Number(t) <= MAX_THRESHOLD)) {
    e.threshold = `A whole number from 0 to ${MAX_THRESHOLD}, or blank for no alert`
  }
  return e
}

// search on name, manufacturer and model, case-insensitive substring (spec §4.4)
export function searchParts(parts, query) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase()
  if (!q) return parts
  return parts.filter((p) =>
    [p.name, p.manufacturer, p.model].some((v) => v && v.toLowerCase().includes(q)),
  )
}

export function isLowStock(p) {
  return !!p.lowStockEnabled && p.spareTotal <= p.lowStockThreshold
}
