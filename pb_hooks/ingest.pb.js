/// <reference path="../pb_data/types.d.ts" />

// Automated Fleet Ingest & Drift Inbox routes (Phase 2):
// - POST /api/stocky/ingest (Bearer stky_<token>, rate-limited, body cap 512 KB)
// - POST /api/stocky/drift/{id}/apply (user auth, transactional apply into ledger)
// - POST /api/stocky/drift/{id}/dismiss (user auth, dismiss pending drift)

routerAdd('POST', '/api/stocky/ingest', (e) => {
  const s = require(`${__hooks}/lib/stocky.js`)
  const d = require(`${__hooks}/lib/discovery.js`)

  return s.respond(e, () => {
    const authHeader = String(e.request.header.get('Authorization') || '').trim()
    const match = authHeader.match(/^Bearer\s+(stky_[A-Za-z0-9_-]{16,120})$/)
    if (!match) {
      return e.json(401, {
        status: 401,
        message: 'Missing or invalid ingest bearer token',
        data: { code: 'invalid_token' },
      })
    }
    const rawToken = match[1]
    const tokenHash = $security.sha256(rawToken)
    const tokenRecords = e.app.findRecordsByFilter(
      'ingest_tokens',
      'tokenHash = {:hash}',
      '',
      1,
      0,
      { hash: tokenHash },
    )
    const tok = tokenRecords[0]
    if (!tok || tok.getBool('revoked') || !$security.equal(tok.getString('tokenHash'), tokenHash)) {
      return e.json(401, {
        status: 401,
        message: 'Ingest token is invalid or revoked',
        data: { code: 'invalid_token' },
      })
    }

    const uid = tok.getString('user')
    const info = e.requestInfo()
    let rawBody = ''
    if (info.body && typeof info.body.snapshot === 'string') {
      rawBody = info.body.snapshot
    } else if (info.body && typeof info.body === 'object' && info.body.schema) {
      rawBody = JSON.stringify(info.body)
    } else {
      try {
        rawBody = toString(e.request.body)
      } catch (_) {
        rawBody = ''
      }
    }
    if (rawBody.length > 512 * 1024) {
      s.fail('too_large', 'The snapshot is larger than 512 KB')
    }
    const snapshot = d.validateSnapshot(rawBody, { maxChars: 512 * 1024 })

    // Rate limit check: max 60 snapshots per hour for this user/host
    const oneHourAgo = new Date(Date.now() - 3600 * 1000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19)
    const recentSnaps = e.app.findRecordsByFilter(
      'pending_snapshots',
      'user = {:uid} && created >= {:since}',
      '',
      65,
      0,
      { uid: uid, since: oneHourAgo },
    )
    if (recentSnaps.length >= 60) {
      return e.json(429, {
        status: 429,
        message: 'Ingest rate limit exceeded (60 snapshots/hour)',
        data: { code: 'rate_limited' },
      })
    }

    let outcome = null
    e.app.runInTransaction((txApp) => {
      // 1. Resolve target host
      let hostRecord = null
      const pinnedHostId = tok.getString('host')
      if (pinnedHostId) {
        hostRecord = s.findOwned(txApp, 'hosts', pinnedHostId, uid, 'Host')
      } else {
        const allHosts = txApp.findRecordsByFilter(
          'hosts',
          'user = {:uid} && retired = false',
          'sortOrder',
          0,
          0,
          { uid: uid },
        )
        const mid = snapshot.host.machineIdHash
        if (mid) {
          hostRecord = allHosts.filter((h) => h.getString('machineIdHash') === mid)[0] || null
          if (!hostRecord) {
            const prevImp = txApp.findRecordsByFilter(
              'imports',
              'user = {:uid} && machineIdHash = {:mid} && undone = false',
              '-created',
              1,
              0,
              { uid: uid, mid: mid },
            )[0]
            if (prevImp) {
              hostRecord = allHosts.filter((h) => h.id === prevImp.getString('host'))[0] || null
            }
          }
        }
        if (!hostRecord && snapshot.host.hostname) {
          const norm = (v) =>
            String(v || '')
              .toLowerCase()
              .replace(/plus/g, '+')
              .replace(/-brix$/g, '')
              .replace(/[\s_.-]+/g, '')
          const want = norm(snapshot.host.hostname)
          if (want) {
            hostRecord =
              allHosts.filter(
                (h) => norm(h.getString('label')) === want || norm(h.getString('key')) === want,
              )[0] || null
          }
        }
        if (!hostRecord) {
          if (!tok.getBool('autoRegisterHosts')) {
            s.fail(
              'host_not_found',
              `No matching host found for "${snapshot.host.hostname || 'unnamed'}" and auto-registration is disabled`,
            )
          }
          let siteId = tok.getString('defaultSite')
          if (!siteId) {
            const firstSite = txApp.findRecordsByFilter(
              'locations',
              "user = {:uid} && kind = 'site' && retired = false",
              'sortOrder',
              1,
              0,
              { uid: uid },
            )[0]
            if (!firstSite) s.fail('no_site', 'Create at least one active site before ingesting')
            siteId = firstSite.id
          }
          const maxOrder = allHosts.reduce((m, x) => Math.max(m, x.getInt('sortOrder') || 0), -1)
          const rawLabel = (snapshot.host.hostname || snapshot.host.model || 'host').slice(0, 40)
          hostRecord = new Record(txApp.findCollectionByNameOrId('hosts'))
          hostRecord.set('user', uid)
          hostRecord.set('label', rawLabel)
          hostRecord.set('type', (snapshot.host.model || '').slice(0, 60))
          hostRecord.set('site', siteId)
          hostRecord.set('sortOrder', maxOrder + 1)
          hostRecord.set('formFactor', d.inferFormFactor(snapshot, ''))
          txApp.save(hostRecord)
          s.markReferenced(txApp, txApp.findRecordById('locations', siteId))
        }
      }

      if (hostRecord.getBool('retired')) {
        s.fail('retired', `${hostRecord.getString('label')} is retired`)
      }

      // 2. Run discovery diff preview against host's installed units
      const state = d.loadState(txApp, uid, hostRecord.id)
      const rows = d.compute(state, snapshot)
      const previewHash = d.hashOf(rows, state)

      const counts = {
        new: 0,
        missing: 0,
        replaced: 0,
        moved: 0,
        conflict: 0,
        adopt: 0,
        unchanged: 0,
      }
      let actionableDrift = 0
      for (const r of rows) {
        if (r.group === 'ignored' || r.declined) continue
        if (r.group === 'replaced' && r.role === 'in') continue // count replaced pair once
        counts[r.group] = (counts[r.group] || 0) + 1
        if (r.group !== 'unchanged' && r.checked) {
          actionableDrift++
        }
      }
      const smartWarnings =
        (snapshot.host.smartSummary && snapshot.host.smartSummary.unhealthyDrives) || []
      const diffSummary = {
        new: counts.new,
        missing: counts.missing,
        replaced: counts.replaced,
        moved: counts.moved,
        conflicts: counts.conflict,
        adopt: counts.adopt,
        unchanged: counts.unchanged,
        smartWarnings: smartWarnings,
      }

      const nowIso = new Date().toISOString()
      tok.set('lastUsedAt', nowIso)
      txApp.save(tok)

      // 3. Classify clean vs drift_pending
      const existingPending = txApp.findRecordsByFilter(
        'pending_snapshots',
        "user = {:uid} && host = {:host} && status = 'drift_pending'",
        '-created',
        0,
        0,
        { uid: uid, host: hostRecord.id },
      )

      let snapRecord = null
      let status = 'clean'
      if (actionableDrift > 0) {
        status = 'drift_pending'
        snapRecord =
          existingPending[0] || new Record(txApp.findCollectionByNameOrId('pending_snapshots'))
        // clean up any duplicate open drift records for the same host
        for (let i = 1; i < existingPending.length; i++) {
          txApp.delete(existingPending[i])
        }
      } else {
        status = 'clean'
        for (const old of existingPending) {
          txApp.delete(old)
        }
        snapRecord = new Record(txApp.findCollectionByNameOrId('pending_snapshots'))
      }

      snapRecord.set('user', uid)
      snapRecord.set('host', hostRecord.id)
      snapRecord.set('collectedAt', snapshot.collectedAt || nowIso)
      snapRecord.set('collector', snapshot.collector || '')
      snapRecord.set('status', status)
      snapRecord.set('snapshot', snapshot)
      snapRecord.set('diffSummary', diffSummary)
      snapRecord.set('previewHash', previewHash)
      txApp.save(snapRecord)

      // 4. Update host live telemetry & driftCount
      d.updateHostTelemetry(txApp, hostRecord, snapshot, { driftCount: actionableDrift })

      // 5. Retention: keep newest 10 clean snapshots per host
      const cleanSnaps = txApp.findRecordsByFilter(
        'pending_snapshots',
        "user = {:uid} && host = {:host} && status = 'clean'",
        '-created',
        100,
        0,
        { uid: uid, host: hostRecord.id },
      )
      for (let i = 10; i < cleanSnaps.length; i++) {
        txApp.delete(cleanSnaps[i])
      }

      outcome = {
        status: status,
        hostId: hostRecord.id,
        hostLabel: hostRecord.getString('label'),
        snapshotId: snapRecord.id,
        driftCount: actionableDrift,
        summary: diffSummary,
      }
    })

    return e.json(200, outcome)
  })
})

routerAdd(
  'POST',
  '/api/stocky/drift/{id}/apply',
  (e) => {
    const s = require(`${__hooks}/lib/stocky.js`)
    const d = require(`${__hooks}/lib/discovery.js`)
    const id = e.request.pathValue('id')
    const body = e.requestInfo().body || {}

    return s.respond(e, () => {
      const uid = e.auth.id
      let result = null
      e.app.runInTransaction((txApp) => {
        const pending = s.findOwned(txApp, 'pending_snapshots', id, uid, 'Pending snapshot')
        if (pending.getString('status') !== 'drift_pending') {
          s.fail('not_pending', 'This snapshot has already been processed')
        }
        const hostId = pending.getString('host')
        const snapshotText = pending.getString('snapshot')
        const freshPreview = d.preview(txApp, uid, { host: hostId, snapshot: snapshotText })
        const previewHash = body.previewHash || freshPreview.previewHash

        let decisions = body.decisions
        if (!decisions || typeof decisions !== 'object') {
          decisions = {}
          for (const r of freshPreview.rows) {
            if (r.group === 'ignored') continue
            decisions[r.id] = {
              apply: !!r.checked,
              action: r.action,
              location: r.location || '',
              reason: r.reason || '',
              newPart: r.newPart || undefined,
            }
          }
        }

        const applied = d.apply(txApp, uid, {
          host: hostId,
          snapshot: snapshotText,
          previewHash: previewHash,
          decisions: decisions,
          date: body.date,
        })

        pending.set('status', 'applied')
        pending.set('appliedImport', applied.import.id)
        txApp.save(pending)

        const hostRecord = txApp.findRecordById('hosts', hostId)
        hostRecord.set('driftCount', 0)
        txApp.save(hostRecord)

        result = {
          id: pending.id,
          status: 'applied',
          import: applied.import,
          movements: applied.movements,
          summary: applied.summary,
        }
      })
      return e.json(200, result)
    })
  },
  $apis.requireAuth('users'),
)

routerAdd(
  'POST',
  '/api/stocky/drift/{id}/dismiss',
  (e) => {
    const s = require(`${__hooks}/lib/stocky.js`)
    const id = e.request.pathValue('id')

    return s.respond(e, () => {
      const uid = e.auth.id
      let result = null
      e.app.runInTransaction((txApp) => {
        const pending = s.findOwned(txApp, 'pending_snapshots', id, uid, 'Pending snapshot')
        pending.set('status', 'dismissed')
        txApp.save(pending)

        const hostId = pending.getString('host')
        try {
          const hostRecord = txApp.findRecordById('hosts', hostId)
          hostRecord.set('driftCount', 0)
          txApp.save(hostRecord)
        } catch (_) {}

        result = { id: pending.id, status: 'dismissed', hostId: hostId }
      })
      return e.json(200, result)
    })
  },
  $apis.requireAuth('users'),
)
