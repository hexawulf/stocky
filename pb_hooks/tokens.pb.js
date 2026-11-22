/// <reference path="../pb_data/types.d.ts" />

// Scoped ingest tokens for automated fleet hardware discovery (Phase 2).
// - POST /api/stocky/tokens: creates `stky_<random>`, stores SHA-256 hash only,
//   and returns the plaintext token once.
// - POST /api/stocky/tokens/{id}/revoke: revokes a token immediately.

routerAdd(
  'POST',
  '/api/stocky/tokens',
  (e) => {
    const s = require(`${__hooks}/lib/stocky.js`)
    const body = e.requestInfo().body || {}
    return s.respond(e, () => {
      const uid = e.auth.id
      const label = String(body.label || '').trim()
      if (!label || label.length > 80) {
        s.fail('invalid_label', 'Token label must be 1–80 characters', { field: 'label' })
      }
      const scope = body.scope || 'fleet'
      if (['single_host', 'site', 'fleet'].indexOf(scope) < 0) {
        s.fail('invalid_scope', 'Scope must be single_host, site or fleet', { field: 'scope' })
      }
      let hostId = ''
      let siteId = ''
      if (body.host) {
        const h = s.findOwned(e.app, 'hosts', body.host, uid, 'Host')
        if (h.getBool('retired')) s.fail('retired', `${h.getString('label')} is retired`)
        hostId = h.id
        siteId = h.getString('site')
      }
      if (scope === 'single_host' && !hostId) {
        s.fail('invalid_host', 'Pick a host for a single-host token', { field: 'host' })
      }
      if (body.defaultSite) {
        const loc = s.findOwned(e.app, 'locations', body.defaultSite, uid, 'Site')
        if (loc.getString('kind') !== 'site') s.fail('invalid_site', 'Pick a site')
        if (loc.getBool('retired')) s.fail('retired', `${loc.getString('label')} is retired`)
        siteId = loc.id
      }
      if (!siteId) {
        const firstSite = e.app.findRecordsByFilter(
          'locations',
          "user = {:uid} && kind = 'site' && retired = false",
          'sortOrder',
          1,
          0,
          { uid: uid },
        )[0]
        if (firstSite) siteId = firstSite.id
      }

      const rawSecret = $security.randomString(42)
      const plaintext = `stky_${rawSecret}`
      const tokenPrefix = plaintext.slice(0, 12)
      const tokenHash = $security.sha256(plaintext)

      const record = new Record(e.app.findCollectionByNameOrId('ingest_tokens'))
      record.set('user', uid)
      record.set('label', label)
      record.set('tokenPrefix', tokenPrefix)
      record.set('tokenHash', tokenHash)
      record.set('scope', scope)
      record.set('host', hostId)
      record.set('defaultSite', siteId)
      record.set(
        'autoRegisterHosts',
        scope === 'single_host' ? false : body.autoRegisterHosts !== false,
      )
      record.set('revoked', false)
      e.app.save(record)

      return e.json(200, {
        token: plaintext,
        record: {
          id: record.id,
          label: record.getString('label'),
          tokenPrefix: record.getString('tokenPrefix'),
          scope: record.getString('scope'),
          host: record.getString('host'),
          defaultSite: record.getString('defaultSite'),
          autoRegisterHosts: record.getBool('autoRegisterHosts'),
          revoked: record.getBool('revoked'),
          created: record.getString('created'),
        },
      })
    })
  },
  $apis.requireAuth('users'),
)

routerAdd(
  'POST',
  '/api/stocky/tokens/{id}/revoke',
  (e) => {
    const s = require(`${__hooks}/lib/stocky.js`)
    const id = e.request.pathValue('id')
    return s.respond(e, () => {
      const record = s.findOwned(e.app, 'ingest_tokens', id, e.auth.id, 'Token')
      record.set('revoked', true)
      e.app.save(record)
      return e.json(200, { id: record.id, revoked: true })
    })
  },
  $apis.requireAuth('users'),
)
