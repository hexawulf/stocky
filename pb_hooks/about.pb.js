/// <reference path="../pb_data/types.d.ts" />

// GET /api/stocky/about: what the About dialog's diagnostics line needs from
// the server (signed-in users only; guests learn no versions).
// -> { pocketbase, schema, migration }
//    pocketbase: STOCKY_PB_VERSION, set by the Dockerfile from its pinned
//                PB_VERSION (the JS hooks can't ask the binary), '' if unset
//    migration:  the newest applied Stocky migration file; schema: its number
routerAdd(
  'GET',
  '/api/stocky/about',
  (e) => {
    const row = new DynamicModel({ file: '' })
    try {
      e.app
        .db()
        .newQuery("SELECT file FROM _migrations WHERE file LIKE '%.js' ORDER BY file DESC LIMIT 1")
        .one(row)
    } catch (_) {
      row.file = ''
    }
    const file = String(row.file || '')
    return e.json(200, {
      pocketbase: $os.getenv('STOCKY_PB_VERSION') || '',
      schema: (file.match(/^(\d+)_/) || [])[1] || '',
      migration: file,
    })
  },
  $apis.requireAuth('users'),
)
