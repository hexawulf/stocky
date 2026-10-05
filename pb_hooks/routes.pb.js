/// <reference path="../pb_data/types.d.ts" />

// Stocky's server routes (spec §5.4, §7.3, §7.4, §7.6). Each runs in one
// transaction; only signed-in users of the `users` collection may call them.
// A validation failure answers 400 { message, data: { code, ... } } (lib/stocky.js).

// record a movement, optionally creating its part (newPart, stock_in only)
routerAdd(
  'POST',
  '/api/stocky/movements',
  (e) => {
    const s = require(`${__hooks}/lib/stocky.js`)
    const input = e.requestInfo().body || {}
    return s.respond(e, () => {
      let result
      e.app.runInTransaction((txApp) => {
        result = s.recordMovement(txApp, e.auth.id, input, {})
      })
      return e.json(200, result)
    })
  },
  $apis.requireAuth('users'),
)

// undo the account's newest movement within 24 h; body.date = today on the phone
routerAdd(
  'POST',
  '/api/stocky/movements/{id}/undo',
  (e) => {
    const s = require(`${__hooks}/lib/stocky.js`)
    const id = e.request.pathValue('id')
    const body = e.requestInfo().body || {}
    return s.respond(e, () => {
      let result
      e.app.runInTransaction((txApp) => {
        result = s.undoMovement(txApp, e.auth.id, id, body.date)
      })
      return e.json(200, result)
    })
  },
  $apis.requireAuth('users'),
)

// seed the reference lists once (spec §5.4); safe to call again
routerAdd(
  'POST',
  '/api/stocky/seed',
  (e) => {
    const s = require(`${__hooks}/lib/stocky.js`)
    return s.respond(e, () => {
      let result
      e.app.runInTransaction((txApp) => {
        result = s.seed(txApp, e.auth.id)
      })
      return e.json(200, result)
    })
  },
  $apis.requireAuth('users'),
)

// compare a part's stored totals with a replay of its history; body.fix = true writes the replay
routerAdd(
  'POST',
  '/api/stocky/parts/{id}/recalculate',
  (e) => {
    const s = require(`${__hooks}/lib/stocky.js`)
    const id = e.request.pathValue('id')
    const body = e.requestInfo().body || {}
    return s.respond(e, () => {
      let result
      e.app.runInTransaction((txApp) => {
        result = s.recalculate(txApp, e.auth.id, id, body.fix === true)
      })
      return e.json(200, result)
    })
  },
  $apis.requireAuth('users'),
)
