// Movement logic shared by Record, Part detail and History. It mirrors the
// server's rules (pb_hooks/lib/stocky.js, spec §7–§8) so forms can explain a
// problem before sending; the server still decides.
import { CURRENCIES, formatQty, parseMoney, placeLabel } from './format.js'

export const MAX_QTY = 9999
export const MAX_NOTE = 500
export const MAX_PRICE_MINOR = 99999999

export const MOVEMENT_TYPES = [
  { value: 'stock_in', label: 'Stock in' },
  { value: 'stock_out', label: 'Stock out' },
  { value: 'move', label: 'Move' },
  { value: 'install', label: 'Install' },
  { value: 'uninstall', label: 'Uninstall' },
  { value: 'found_installed', label: 'Found installed' },
]
export const TYPE_LABEL = Object.fromEntries(MOVEMENT_TYPES.map((t) => [t.value, t.label]))

export const REASONS = [
  { value: 'used', label: 'Used' },
  { value: 'retired', label: 'Retired' },
  { value: 'discarded', label: 'Discarded' },
]

// which relation each side uses (spec §4.7 table). Stock out comes from a
// location or, for things installed, a host (§13.4.2); found_installed has
// no source (§13.4.1).
export const SHAPES = {
  stock_in: { from: null, to: 'location' },
  stock_out: { from: 'location', to: null, fromHost: true },
  move: { from: 'location', to: 'location' },
  install: { from: 'location', to: 'host' },
  uninstall: { from: 'host', to: 'location' },
  found_installed: { from: null, to: 'host' },
}

// types that may create their part on the way (spec §4.6, §13.4.1)
export const NEW_PART_TYPES = ['stock_in', 'found_installed']

// spec §7.4, §13.4.2: stock out from a host reverses to found_installed
function reversalType(m) {
  if (m.type === 'stock_out') return m.fromHost ? 'found_installed' : 'stock_in'
  return {
    stock_in: 'stock_out',
    move: 'move',
    install: 'uninstall',
    uninstall: 'install',
    found_installed: 'stock_out',
  }[m.type]
}

// same normalisation as the server's nameKey (spec §5.2)
export function nameKey(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

// spec §4.6: "You already have '…' — open it?"
export function findDuplicate(parts, name, exceptId = '') {
  const key = nameKey(name)
  if (key.length < 2) return null
  return parts.find((p) => p.id !== exceptId && (p.nameKey || nameKey(p.name)) === key) ?? null
}

// spare at a location, or installed in a host
export function available(part, placeId, kind = 'location') {
  if (!part || !placeId) return 0
  const map = kind === 'host' ? part.installed : part.spare
  return map?.[placeId] ?? 0
}

// "From" choices with what's available (spec §4.7). For install, pass toHost:
// only that host's site and In transit qualify. Zero-stock rows stay listed
// (disabled in the picker) so the user sees where nothing is.
export function sourcesFor(type, { part, locations = [], hosts = [], toHost = null }) {
  const shape = SHAPES[type]
  if (!shape?.from) return []
  const fromHosts = () =>
    hosts
      .filter((h) => !h.retired && available(part, h.id, 'host') > 0)
      .map((h) => ({ id: h.id, place: h, kind: 'host', available: available(part, h.id, 'host') }))
  if (shape.from === 'host') return fromHosts()
  let list = locations.filter((l) => !l.retired)
  if (type === 'install') {
    if (!toHost) return []
    list = list.filter((l) => l.id === toHost.site || l.kind === 'transit')
  }
  const out = list.map((l) => ({
    id: l.id,
    place: l,
    kind: 'location',
    available: available(part, l.id),
  }))
  // stock out: hosts with the part installed come after the locations
  return shape.fromHost ? out.concat(fromHosts()) : out
}

// "To" choices (spec §4.7): active locations, or active hosts for install;
// a move can't go back to its source
export function destinationsFor(type, { locations = [], hosts = [], fromId = '' }) {
  const shape = SHAPES[type]
  if (!shape?.to) return []
  if (shape.to === 'host') return hosts.filter((h) => !h.retired)
  return locations.filter((l) => !l.retired && !(type === 'move' && l.id === fromId))
}

// field -> message for a Record form draft (spec §8); empty object = valid.
// draft: { type, partId | newPart, quantity, fromId, toId, reason, priceText,
//          currency, date, note }; ctx: { part, available, today, toHost, fromPlace }
export function validateMovement(draft, ctx = {}) {
  const errors = {}
  const shape = SHAPES[draft.type]
  if (!shape) errors.type = 'Pick a movement type'
  if (!draft.partId && !draft.newPart) errors.part = 'Pick a part'
  if (draft.newPart && !NEW_PART_TYPES.includes(draft.type)) {
    errors.part = 'A new part starts with a stock in or found installed'
  }

  const q = draft.quantity
  if (!Number.isInteger(q) || q < 1 || q > MAX_QTY) {
    errors.quantity = `Enter a whole number from 1 to ${MAX_QTY}`
  } else if (shape?.from && ctx.available !== undefined && q > ctx.available) {
    const where = ctx.fromPlace ? ` at ${ctx.fromPlace.label}` : ''
    errors.quantity = `Only ${formatQty(ctx.available, ctx.part?.unit ?? 'pcs')} available${where}`
  }

  if (!draft.date || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors.date = 'Pick a date'
  else if (ctx.today && draft.date > ctx.today) errors.date = "The date can't be in the future"

  if (shape?.from && !draft.fromId) errors.from = 'Pick where it comes from'
  if (shape?.to && !draft.toId)
    errors.to = shape.to === 'host' ? 'Pick a host' : 'Pick where it goes'
  if (draft.type === 'move' && draft.fromId && draft.fromId === draft.toId) {
    errors.to = 'Pick a different location'
  }
  if (draft.type === 'install' && ctx.toHost && ctx.fromPlace) {
    const ok = ctx.fromPlace.id === ctx.toHost.site || ctx.fromPlace.kind === 'transit'
    if (!ok) errors.from = `Install into ${ctx.toHost.label} only from its own site or In transit`
  }

  if (draft.type === 'stock_out' && !REASONS.some((r) => r.value === draft.reason)) {
    errors.reason = 'Pick a reason'
  }

  if (draft.type === 'stock_in' && String(draft.priceText ?? '').trim() !== '') {
    if (!CURRENCIES.includes(draft.currency)) errors.currency = 'Pick a currency'
    else {
      const minor = parseMoney(draft.priceText, draft.currency)
      if (Number.isNaN(minor) || minor > MAX_PRICE_MINOR) {
        errors.price =
          draft.currency === 'TWD' ? 'Enter whole dollars' : 'Enter an amount like 12.99'
      }
    }
  }

  if (String(draft.note ?? '').length > MAX_NOTE) errors.note = `Up to ${MAX_NOTE} characters`
  return errors
}

// "Move 2 × microSD from Lab → In transit on 2026-10-04" (spec §4.7)
export function summary({ type, quantity, partName, from, to, reason, date }) {
  const what = `${quantity} × ${partName}`
  const on = date ? ` on ${date}` : ''
  switch (type) {
    case 'stock_in':
      return `Stock in ${what} → ${placeLabel(to)}${on}`
    case 'stock_out':
      return `Stock out ${what} from ${placeLabel(from)}${reason ? ` (${reason})` : ''}${on}`
    case 'move':
      return `Move ${what} from ${placeLabel(from)} → ${placeLabel(to)}${on}`
    case 'install':
      return `Install ${what} from ${placeLabel(from)} → ${placeLabel(to)}${on}`
    case 'uninstall':
      return `Uninstall ${what} from ${placeLabel(from)} → ${placeLabel(to)}${on}`
    case 'found_installed':
      return `Found installed ${what} in ${placeLabel(to)}${on}`
    default:
      return ''
  }
}

// the movement an undo would write (mirrors spec §7.4's table)
export function reversalOf(m) {
  return {
    type: reversalType(m),
    part: m.part,
    quantity: m.quantity,
    fromLocation: m.toLocation || '',
    fromHost: m.toHost || '',
    toLocation: m.fromLocation || '',
    toHost: m.fromHost || '',
  }
}

// resolve a movement's places from id -> record maps
export function placesOf(m, { locations = {}, hosts = {} }) {
  return {
    from: m.fromLocation ? locations[m.fromLocation] : m.fromHost ? hosts[m.fromHost] : null,
    to: m.toLocation ? locations[m.toLocation] : m.toHost ? hosts[m.toHost] : null,
  }
}

// text for the undo confirm sheet (spec §4.8)
export function reversalSummary(m, lookups, partName, today) {
  const r = reversalOf(m)
  return summary({ ...r, partName, ...placesOf(r, lookups), date: today })
}

// would movement m show up under these History filters? (spec §4.8; the same
// conditions as the server filter, for realtime inserts)
export function matchesFilters(m, f = {}) {
  if (f.type && m.type !== f.type) return false
  if (f.part && m.part !== f.part) return false
  if (f.place && ![m.fromLocation, m.fromHost, m.toLocation, m.toHost].includes(f.place)) {
    return false
  }
  if (f.from && m.date < f.from) return false
  if (f.to && m.date > f.to) return false
  return true
}

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000

// PocketBase dates look like "2026-10-04 06:20:53.357Z"
export function parsePbDate(s) {
  return Date.parse(String(s ?? '').replace(' ', 'T'))
}

// Undo is offered on the account's newest movement while it's eligible
// (spec §7.4): not a reversal, not undone yet, recorded under 24 h ago, and
// not part of an import (that has its own Undo import, §13.4.4).
// The server checks again; this only decides whether to show the button.
export function canUndo(m, { lastMovementId, undone, now = Date.now() } = {}) {
  if (!m || m.id !== lastMovementId || m.reverses || m.import) return false
  if (undone?.has?.(m.id)) return false
  const created = parsePbDate(m.created)
  return Number.isFinite(created) && now - created < UNDO_WINDOW_MS
}

// [{ date, items }] in the list's order (newest day first), for History (spec §4.8)
export function groupByDay(list) {
  const groups = []
  for (const m of list) {
    const last = groups.at(-1)
    if (last && last.date === m.date) last.items.push(m)
    else groups.push({ date: m.date, items: [m] })
  }
  return groups
}

// "Sat, 4 Oct 2026" for a YYYY-MM-DD day, without shifting it through a time zone
export function formatDay(date, locale) {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}
