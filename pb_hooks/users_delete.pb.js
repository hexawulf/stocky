/// <reference path="../pb_data/types.d.ts" />

// Deleting a user: remove their records children-first, so no required
// relation (movement → part/location/host/units/import, unit → part/import,
// import → host, host → site, part → category) blocks the delete. Everything, including the user delete itself, runs in
// one transaction: e.app is swapped for txApp so e.next() joins it.
// The records API replaces any delete error with a generic message, so each
// step is logged to make a failure traceable.
onRecordDelete((e) => {
  e.app.runInTransaction((txApp) => {
    const originalApp = e.app
    e.app = txApp
    try {
      const uid = e.record.id
      for (const name of [
        'movements',
        'units',
        'imports',
        'parts',
        'hosts',
        'categories',
        'locations',
      ]) {
        const records = txApp.findRecordsByFilter(name, 'user = {:uid}', '', 0, 0, { uid })
        for (const r of records) {
          txApp.delete(r)
        }
        console.log(`users_delete hook: deleted ${records.length} ${name} of ${uid}`)
      }
      e.next()
    } finally {
      e.app = originalApp
    }
  })
}, 'users')
