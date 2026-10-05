/// <reference path="../pb_data/types.d.ts" />

// movements: append-only history, written only by the server routes (spec §5.2, §6.7, §12 #17)
migrate(
  (app) => {
    const id = (name) => app.findCollectionByNameOrId(name).id
    const rel = (name, collection, required = false, cascadeDelete = false) => ({
      name,
      type: 'relation',
      required,
      maxSelect: 1,
      collectionId: id(collection),
      cascadeDelete,
    })

    const movements = new Collection({
      type: 'base',
      name: 'movements',
      listRule: 'user = @request.auth.id',
      viewRule: 'user = @request.auth.id',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        rel('user', 'users', true, true),
        rel('part', 'parts', true),
        {
          name: 'type',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['stock_in', 'stock_out', 'move', 'install', 'uninstall'],
        },
        { name: 'quantity', type: 'number', required: true, onlyInt: true, min: 1, max: 9999 },
        rel('fromLocation', 'locations'),
        rel('fromHost', 'hosts'),
        rel('toLocation', 'locations'),
        rel('toHost', 'hosts'),
        { name: 'reason', type: 'select', maxSelect: 1, values: ['used', 'retired', 'discarded'] },
        // no price when priceCurrency is empty (spec §12 #18)
        { name: 'priceMinor', type: 'number', onlyInt: true, min: 0, max: 99999999 },
        { name: 'priceCurrency', type: 'select', maxSelect: 1, values: ['TWD', 'EUR'] },
        { name: 'date', type: 'text', required: true, pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        { name: 'note', type: 'text', max: 500 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: [
        'CREATE INDEX idx_movements_user_part ON movements (user, part, date, created)',
        'CREATE INDEX idx_movements_user_date ON movements (user, date, created)',
      ],
    })
    app.save(movements)

    // self-relation: the collection has to exist before a field can point at it
    movements.fields.add(
      new RelationField({
        name: 'reverses',
        maxSelect: 1,
        collectionId: movements.id,
        cascadeDelete: false,
      }),
    )
    app.save(movements)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('movements'))
  },
)
