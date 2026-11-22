/// <reference path="../pb_data/types.d.ts" />

// Stocky 1.0 Fleet Hardware Makeover (Phase 2):
// - Enrich `hosts` with formFactor, virtualType, role, provider, monthlyCost,
//   currency, tdpWatts, machineIdHash, lastSeenAt, lastCollector, specs,
//   smartSummary, and driftCount (server-managed telemetry fields protected
//   from direct client mutation).
// - Create `ingest_tokens` (SHA-256 hashed bearer tokens for automated push/pull).
// - Create `pending_snapshots` (Drift Inbox & automated snapshot history).
migrate(
  (app) => {
    const id = (name) => app.findCollectionByNameOrId(name).id
    const rel = (name, collection, opts) =>
      Object.assign(
        {
          name,
          type: 'relation',
          maxSelect: 1,
          collectionId: id(collection),
          cascadeDelete: false,
        },
        opts || {},
      )
    const own = 'user = @request.auth.id'

    // 1. Enrich hosts
    const hosts = app.findCollectionByNameOrId('hosts')
    hosts.fields.add(
      new SelectField({
        name: 'formFactor',
        maxSelect: 1,
        values: ['sbc', 'workstation', 'server', 'nas', 'vps', 'vm', 'laptop', 'network', 'other'],
      }),
    )
    hosts.fields.add(new TextField({ name: 'virtualType', max: 30 }))
    hosts.fields.add(new TextField({ name: 'role', max: 80 }))
    hosts.fields.add(new TextField({ name: 'provider', max: 60 }))
    hosts.fields.add(new NumberField({ name: 'monthlyCost', min: 0 }))
    hosts.fields.add(new SelectField({ name: 'currency', maxSelect: 1, values: ['USD', 'EUR', 'TWD'] }))
    hosts.fields.add(new NumberField({ name: 'tdpWatts', min: 0 }))
    hosts.fields.add(new TextField({ name: 'machineIdHash', max: 80 }))
    hosts.fields.add(new TextField({ name: 'lastSeenAt', max: 40 }))
    hosts.fields.add(new TextField({ name: 'lastCollector', max: 60 }))
    hosts.fields.add(new JSONField({ name: 'specs', maxSize: 200000 }))
    hosts.fields.add(new JSONField({ name: 'smartSummary', maxSize: 10000 }))
    hosts.fields.add(new NumberField({ name: 'driftCount', onlyInt: true, min: 0 }))
    hosts.addIndex('idx_hosts_user_machineIdHash', false, 'user, machineIdHash', '')
    app.save(hosts)

    // 2. Create ingest_tokens
    const ingestTokens = new Collection({
      type: 'base',
      name: 'ingest_tokens',
      listRule: own,
      viewRule: own,
      createRule: null,
      updateRule: null,
      deleteRule: own,
      fields: [
        rel('user', 'users', { required: true, cascadeDelete: true }),
        { name: 'label', type: 'text', required: true, min: 1, max: 80 },
        { name: 'tokenPrefix', type: 'text', required: true, max: 20 },
        { name: 'tokenHash', type: 'text', required: true, max: 80 },
        {
          name: 'scope',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['single_host', 'site', 'fleet'],
        },
        rel('host', 'hosts'),
        rel('defaultSite', 'locations'),
        { name: 'autoRegisterHosts', type: 'bool' },
        { name: 'lastUsedAt', type: 'text', max: 40 },
        { name: 'revoked', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_ingest_tokens_user ON ingest_tokens (user)',
        'CREATE UNIQUE INDEX idx_ingest_tokens_hash ON ingest_tokens (tokenHash)',
      ],
    })
    app.save(ingestTokens)

    // 3. Create pending_snapshots (Drift Inbox & snapshot timeline)
    const pendingSnapshots = new Collection({
      type: 'base',
      name: 'pending_snapshots',
      listRule: own,
      viewRule: own,
      createRule: null,
      updateRule: null,
      deleteRule: own,
      fields: [
        rel('user', 'users', { required: true, cascadeDelete: true }),
        rel('host', 'hosts', { required: true, cascadeDelete: true }),
        { name: 'collectedAt', type: 'text', max: 40 },
        { name: 'collector', type: 'text', max: 60 },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['clean', 'drift_pending', 'applied', 'dismissed'],
        },
        { name: 'snapshot', type: 'json', maxSize: 400000 },
        { name: 'diffSummary', type: 'json', maxSize: 20000 },
        { name: 'previewHash', type: 'text', max: 80 },
        rel('appliedImport', 'imports'),
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_pending_snapshots_user_host ON pending_snapshots (user, host, created)',
        'CREATE INDEX idx_pending_snapshots_user_status ON pending_snapshots (user, status)',
      ],
    })
    app.save(pendingSnapshots)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('pending_snapshots'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('ingest_tokens'))
    } catch (_) {}

    const hosts = app.findCollectionByNameOrId('hosts')
    hosts.removeIndex('idx_hosts_user_machineIdHash')
    for (const f of [
      'formFactor',
      'virtualType',
      'role',
      'provider',
      'monthlyCost',
      'currency',
      'tdpWatts',
      'machineIdHash',
      'lastSeenAt',
      'lastCollector',
      'specs',
      'smartSummary',
      'driftCount',
    ]) {
      hosts.fields.removeByName(f)
    }
    app.save(hosts)
  },
)
