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

// load the Demo Fleet into an empty account so any Docker user can explore
// the visual Fleet Rack, Topology SVG, and Host Inspector in one click
routerAdd(
  'POST',
  '/api/stocky/demo-fleet',
  (e) => {
    const s = require(`${__hooks}/lib/stocky.js`)
    return s.respond(e, () => {
      const uid = e.auth.id
      let result = null
      e.app.runInTransaction((txApp) => {
        const existingHosts = txApp.findRecordsByFilter('hosts', 'user = {:uid}', '', 1, 0, {
          uid: uid,
        })
        const existingParts = txApp.findRecordsByFilter('parts', 'user = {:uid}', '', 1, 0, {
          uid: uid,
        })
        if (existingHosts.length > 0 || existingParts.length > 0) {
          s.fail(
            'not_empty',
            'Demo Fleet can only be loaded when your hosts and parts catalog are empty',
          )
        }
        // remove unreferenced default locations/categories so demo_fleet seeds cleanly
        for (const col of ['categories', 'locations']) {
          const recs = txApp.findRecordsByFilter(col, 'user = {:uid}', '', 0, 0, { uid: uid })
          for (const r of recs) txApp.delete(r)
        }
        const user = txApp.findRecordById('users', uid)
        user.set('seedPreset', 'demo_fleet')
        user.set('seedVersion', 0)
        txApp.saveNoValidate(user)
        result = s.seed(txApp, uid)
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
