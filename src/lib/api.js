// Stocky's server routes (spec §7.7). Every quantity change goes through these;
// the records API can't write stock fields.
import { pb } from './pb.js'
import { todayLocal } from './dates.js'

function post(path, body = {}) {
  return pb.send(path, { method: 'POST', body })
}

// -> { movement, part }; input as in spec §7.7, date defaults to today on this device
export function recordMovement(input) {
  return post('/api/stocky/movements', { date: todayLocal(), ...input })
}

// -> { movement, part } for the reversal; the server can't know the phone's
// time zone, so today's date comes from here
export function undoMovement(id) {
  return post(`/api/stocky/movements/${encodeURIComponent(id)}/undo`, { date: todayLocal() })
}

// -> { seeded: boolean }; safe to call more than once
export function seedReferenceLists() {
  return post('/api/stocky/seed')
}

// -> { matches, fixed, stored, computed, dippedBelowZero, movements }
export function recalculatePart(id, fix = false) {
  return post(`/api/stocky/parts/${encodeURIComponent(id)}/recalculate`, { fix })
}

// --- records API (fields the rules allow; the hooks add nameKey, referenced, …) ---

function uid() {
  return pb.authStore.record?.id
}

// parts (spec §4.6): fields from partFieldsFromForm(); stock fields belong to the routes
export function createPart(fields) {
  return pb.collection('parts').create({ ...fields, user: uid() })
}

export function updatePart(id, fields) {
  return pb.collection('parts').update(id, fields)
}

// how many movements a part has (spec §4.6: warn before changing its unit)
export async function countPartMovements(partId) {
  const res = await pb.collection('movements').getList(1, 1, {
    filter: pb.filter('part = {:part}', { part: partId }),
    fields: 'id',
  })
  return res.totalItems
}

// sites, hosts, categories (spec §4.10)
export function createEntry(collection, fields) {
  return pb.collection(collection).create({ ...fields, user: uid() })
}

export function updateEntry(collection, id, fields) {
  return pb.collection(collection).update(id, fields)
}

export function deleteEntry(collection, id) {
  return pb.collection(collection).delete(id)
}

// --- hardware discovery (spec §13.3, §13.4.4) --------------------------------------------

// -> { rows, previewHash, warnings, skipped, ignored, snapshot, previous, host };
// the snapshot goes as the file's text, so the server is the one that parses it
export function previewDiscovery(hostId, snapshotText) {
  return post('/api/stocky/discovery/preview', { host: hostId, snapshot: snapshotText })
}

// -> { import, movements, summary }; decisions as decisionsPayload() makes them
export function applyDiscovery({ hostId, snapshotText, previewHash, decisions }) {
  return post('/api/stocky/discovery/apply', {
    host: hostId,
    snapshot: snapshotText,
    previewHash,
    decisions,
    date: todayLocal(),
  })
}

// -> { import, reversed }
export function undoImport(id) {
  return post(`/api/stocky/imports/${encodeURIComponent(id)}/undo`, { date: todayLocal() })
}

const IMPORT_FIELDS =
  'id,host,created,collector,collectedAt,hostname,machineIdHash,summary,undone,lastMovementAfter'

// imports without their snapshots, newest first (Hosts list: last import per host)
export function listImports() {
  return pb.collection('imports').getFullList({ sort: '-created', fields: IMPORT_FIELDS })
}

// imports that wrote no movement (History shows those that linked serials)
export function listQuietImports() {
  return pb.collection('imports').getFullList({
    filter: 'movements:length = 0',
    sort: '-created',
    fields: IMPORT_FIELDS,
  })
}

// -> { pocketbase, schema, migration } for the About dialog (signed in only)
export function getAbout() {
  return pb.send('/api/stocky/about', { method: 'GET' })
}
