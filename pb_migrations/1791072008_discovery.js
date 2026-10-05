/// <reference path="../pb_data/types.d.ts" />

// Hardware discovery, phase D1 (spec §13.4, decision #23):
// - movements.type gains found_installed; stock_out may come from a host
//   (a route rule, no schema change)
// - imports: one per applied snapshot, written only by the discovery routes
// - units: individual serialised items, written only by the routes
// - movements.units (which units a movement concerned) and movements.import
// - parts.matchKeys: learned collector model strings, server-only like the
//   stock fields
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
    const day = { type: 'text', pattern: '^(\\d{4}-\\d{2}-\\d{2})?$' }

    const movements = app.findCollectionByNameOrId('movements')
    movements.fields.getByName('type').values = [
      'stock_in',
      'stock_out',
      'move',
      'install',
      'uninstall',
      'found_installed',
    ]
    app.save(movements)

    const imports = new Collection({
      type: 'base',
      name: 'imports',
      listRule: own,
      viewRule: own,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        rel('user', 'users', { required: true, cascadeDelete: true }),
        rel('host', 'hosts', { required: true }),
        { name: 'collectedAt', type: 'text', max: 40 },
        { name: 'collector', type: 'text', max: 60 },
        { name: 'hostname', type: 'text', max: 80 },
        { name: 'machineIdHash', type: 'text', max: 80 },
        // the validated snapshot (spec §13.3.2), capped
        { name: 'snapshot', type: 'json', maxSize: 400000 },
        // applied rows per group, e.g. { "new": 3, "unchanged": 5 }
        { name: 'summary', type: 'json', maxSize: 2000 },
        // the prior state of every unit this import changed (null = created by it)
        { name: 'unitsBefore', type: 'json', maxSize: 200000 },
        // [{ part, key }] learned name mappings this import added
        { name: 'mappingsAdded', type: 'json', maxSize: 50000 },
        // users.lastMovementId right after the apply: undo-import needs it unchanged
        { name: 'lastMovementAfter', type: 'text', max: 15 },
        { name: 'undone', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_imports_user_host ON imports (user, host, created)'],
    })
    app.save(imports)

    // the movements an import wrote, in order (reversed in the opposite order)
    imports.fields.add(
      new RelationField({
        name: 'movements',
        maxSelect: 999,
        collectionId: movements.id,
        cascadeDelete: false,
      }),
    )
    app.save(imports)

    const units = new Collection({
      type: 'base',
      name: 'units',
      listRule: own,
      viewRule: own,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        rel('user', 'users', { required: true, cascadeDelete: true }),
        rel('part', 'parts', { required: true }),
        { name: 'serial', type: 'text', required: true, max: 80 },
        { name: 'serialKey', type: 'text', required: true, max: 80 },
        // what the collector called it, for Replaced (same kind, same slot)
        { name: 'kind', type: 'text', max: 20 },
        { name: 'slot', type: 'text', max: 120 },
        rel('host', 'hosts'),
        rel('location', 'locations'),
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['installed', 'spare', 'gone'],
        },
        Object.assign({ name: 'firstSeen' }, day),
        Object.assign({ name: 'lastSeen' }, day),
        rel('lastImport', 'imports'),
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_units_user_part ON units (user, part)',
        'CREATE INDEX idx_units_user_serialKey ON units (user, serialKey)',
        'CREATE UNIQUE INDEX idx_units_user_part_serialKey ON units (user, part, serialKey)',
      ],
    })
    app.save(units)

    movements.fields.add(
      new RelationField({ name: 'units', maxSelect: 9999, collectionId: units.id }),
    )
    movements.fields.add(
      new RelationField({ name: 'import', maxSelect: 1, collectionId: imports.id }),
    )
    movements.addIndex('idx_movements_import', false, '`import`', '')
    app.save(movements)

    const parts = app.findCollectionByNameOrId('parts')
    parts.fields.add(new JSONField({ name: 'matchKeys', maxSize: 20000 }))
    const noMatchKeys = ' && @request.body.matchKeys:isset = false'
    parts.createRule += noMatchKeys
    parts.updateRule += noMatchKeys
    app.save(parts)
  },
  (app) => {
    const parts = app.findCollectionByNameOrId('parts')
    parts.fields.removeByName('matchKeys')
    parts.createRule = parts.createRule.replace(' && @request.body.matchKeys:isset = false', '')
    parts.updateRule = parts.updateRule.replace(' && @request.body.matchKeys:isset = false', '')
    app.save(parts)

    const movements = app.findCollectionByNameOrId('movements')
    movements.fields.removeByName('units')
    movements.fields.removeByName('import')
    movements.removeIndex('idx_movements_import')
    app.save(movements)

    app.delete(app.findCollectionByNameOrId('units'))
    app.delete(app.findCollectionByNameOrId('imports'))

    movements.fields.getByName('type').values = [
      'stock_in',
      'stock_out',
      'move',
      'install',
      'uninstall',
    ]
    app.save(movements)
  },
)
