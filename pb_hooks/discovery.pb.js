/// <reference path="../pb_data/types.d.ts" />

// Hardware discovery routes (spec §13.3, §13.4.4). The snapshot is sent as the
// file's text (body.snapshot), so the server is the one that parses it.
// preview writes nothing; apply and undo run in one transaction.

// -> { rows, previewHash, warnings, skipped, ignored, snapshot, previous }
routerAdd(
  'POST',
  '/api/stocky/discovery/preview',
  (e) => {
    const s = require(`${__hooks}/lib/stocky.js`)
    const d = require(`${__hooks}/lib/discovery.js`)
    const body = e.requestInfo().body || {}
    return s.respond(e, () => e.json(200, d.preview(e.app, e.auth.id, body)))
  },
  $apis.requireAuth('users'),
)

// body: { host, snapshot, previewHash, decisions: { rowId: { apply, action, ... } }, date }
routerAdd(
  'POST',
  '/api/stocky/discovery/apply',
  (e) => {
    const s = require(`${__hooks}/lib/stocky.js`)
    const d = require(`${__hooks}/lib/discovery.js`)
    const body = e.requestInfo().body || {}
    return s.respond(e, () => {
      let result
      e.app.runInTransaction((txApp) => {
        result = d.apply(txApp, e.auth.id, body)
      })
      return e.json(200, result)
    })
  },
  $apis.requireAuth('users'),
)

// reverse every movement of the account's newest import within 24 h; body.date = today on the phone
routerAdd(
  'POST',
  '/api/stocky/imports/{id}/undo',
  (e) => {
    const s = require(`${__hooks}/lib/stocky.js`)
    const d = require(`${__hooks}/lib/discovery.js`)
    const id = e.request.pathValue('id')
    const body = e.requestInfo().body || {}
    return s.respond(e, () => {
      let result
      e.app.runInTransaction((txApp) => {
        result = d.undoImport(txApp, e.auth.id, id, body.date)
      })
      return e.json(200, result)
    })
  },
  $apis.requireAuth('users'),
)
