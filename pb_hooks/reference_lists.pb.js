/// <reference path="../pb_data/types.d.ts" />

// Checks the API rules can't express (spec §6.5–§6.6). These are request
// hooks, so they guard the records API and the dashboard; the movement and
// seed routes do their own checks. Superusers skip the guards on purpose.
// Each hook runs its checks and the save in one transaction (s.inTransaction)
// and answers a failed check as 400 { message, data: { code, ... } } (s.respond).

// --- parts: nameKey, duplicate name, active category, referenced ---------------

onRecordCreateRequest((e) => {
  const s = require(`${__hooks}/lib/stocky.js`)
  s.respond(e, () =>
    s.inTransaction(e, (txApp) => {
      if (!e.hasSuperuserAuth()) s.writeStock(e.record, {}, {}) // stock starts empty
      const category = s.preparePart(txApp, e.record.getString('user'), e.record, true)
      e.next()
      s.markReferenced(txApp, category)
    }),
  )
}, 'parts')

onRecordUpdateRequest((e) => {
  const s = require(`${__hooks}/lib/stocky.js`)
  s.respond(e, () =>
    s.inTransaction(e, (txApp) => {
      const category = s.preparePart(txApp, e.record.getString('user'), e.record, false)
      e.next()
      s.markReferenced(txApp, category)
    }),
  )
}, 'parts')

// --- hosts: active site, referenced site, retire guard, delete scan ------------

onRecordCreateRequest((e) => {
  const s = require(`${__hooks}/lib/stocky.js`)
  s.respond(e, () =>
    s.inTransaction(e, (txApp) => {
      const site = e.hasSuperuserAuth() ? null : s.activeSite(txApp, e.record)
      e.next()
      s.markReferenced(txApp, site || txApp.findRecordById('locations', e.record.getString('site')))
    }),
  )
}, 'hosts')

onRecordUpdateRequest((e) => {
  const s = require(`${__hooks}/lib/stocky.js`)
  s.respond(e, () =>
    s.inTransaction(e, (txApp) => {
      let site = null
      if (!e.hasSuperuserAuth()) {
        if (e.record.getString('site') !== e.record.original().getString('site')) {
          site = s.activeSite(txApp, e.record)
        }
        if (s.becameRetired(e.record)) s.guardHostRetire(txApp, e.record)
      }
      e.next()
      s.markReferenced(txApp, site)
    }),
  )
}, 'hosts')

onRecordDeleteRequest((e) => {
  const s = require(`${__hooks}/lib/stocky.js`)
  s.respond(e, () => {
    if (!e.hasSuperuserAuth()) s.guardDelete(e.app, e.record, 'installed')
    e.next()
  })
}, 'hosts')

// --- locations: retire guard, delete scan --------------------------------------

onRecordUpdateRequest((e) => {
  const s = require(`${__hooks}/lib/stocky.js`)
  s.respond(e, () =>
    s.inTransaction(e, (txApp) => {
      if (!e.hasSuperuserAuth() && s.becameRetired(e.record)) s.guardLocationRetire(txApp, e.record)
      e.next()
    }),
  )
}, 'locations')

onRecordDeleteRequest((e) => {
  const s = require(`${__hooks}/lib/stocky.js`)
  s.respond(e, () => {
    if (!e.hasSuperuserAuth()) s.guardDelete(e.app, e.record, 'spare')
    e.next()
  })
}, 'locations')

// categories need no hook: retiring is always allowed (spec §4.10), and
// delete is guarded by referenced = false in the rule.
