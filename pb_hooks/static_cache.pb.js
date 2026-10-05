/// <reference path="../pb_data/types.d.ts" />

// Caching for the built app served from pb_public (docs/deploy.md).
// Without it, PocketBase sends no Cache-Control, browsers reuse a stale
// index.html after a deploy, and a missing old /assets/ file gets the SPA
// fallback (index.html with 200), so a stale page keeps running unnoticed.
//
// - index.html and the SPA fallback (any other app path): no-cache, so the
//   browser revalidates and picks up a new deploy at once
// - /assets/* (Vite file names carry a content hash): cached for a year
// - a missing /assets/* file: 404 instead of index.html
// /api/ and the dashboard (/_/) are left alone.
routerUse((e) => {
  const method = e.request.method
  const path = e.request.url.path
  if (method !== 'GET' && method !== 'HEAD') return e.next()
  if (path === '/api' || path.startsWith('/api/') || path === '/_' || path.startsWith('/_/')) {
    return e.next()
  }

  if (path.startsWith('/assets/')) {
    // pb_public sits next to pb_hooks in the image; tests point elsewhere
    const dir = $os.getenv('STOCKY_PUBLIC_DIR') || `${__hooks}/../pb_public`
    let found = false
    if (!path.includes('..')) {
      try {
        found = !$os.stat(dir + path).isDir()
      } catch (_) {
        found = false
      }
    }
    if (!found) return e.string(404, 'Not found')
    e.response.header().set('Cache-Control', 'public, max-age=31536000, immutable')
    return e.next()
  }

  e.response.header().set('Cache-Control', 'no-cache')
  return e.next()
})
