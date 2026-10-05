/// <reference path="../pb_data/types.d.ts" />

// parts: catalog + stored totals (spec §5.2, §6.6)
migrate(
  (app) => {
    const usersId = app.findCollectionByNameOrId('users').id
    const categoriesId = app.findCollectionByNameOrId('categories').id

    // spare, installed and spareTotal belong to the movement routes; nameKey to the parts hook
    const noServerFields =
      '@request.body.spare:isset = false && @request.body.installed:isset = false' +
      ' && @request.body.spareTotal:isset = false && @request.body.nameKey:isset = false'

    const parts = new Collection({
      type: 'base',
      name: 'parts',
      listRule: 'user = @request.auth.id',
      viewRule: 'user = @request.auth.id',
      createRule:
        '@request.auth.id != "" && @request.body.user = @request.auth.id' +
        ' && @request.body.category.user = @request.auth.id && ' +
        noServerFields,
      updateRule:
        '@request.auth.id != "" && user = @request.auth.id && @request.body.user:isset = false' +
        ' && (@request.body.category:isset = false || @request.body.category.user = @request.auth.id)' +
        ' && ' +
        noServerFields,
      deleteRule: null,
      fields: [
        {
          name: 'user',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: usersId,
          cascadeDelete: true,
        },
        { name: 'name', type: 'text', required: true, min: 2, max: 80 },
        { name: 'nameKey', type: 'text', required: true, max: 80 },
        {
          name: 'category',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: categoriesId,
          cascadeDelete: false,
        },
        {
          name: 'unit',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['pcs', 'sheets', 'm'],
        },
        { name: 'manufacturer', type: 'text', max: 60 },
        { name: 'model', type: 'text', max: 60 },
        { name: 'notes', type: 'text', max: 500 },
        // number fields can't be empty, so "no alert" is its own flag (spec §12 #18)
        { name: 'lowStockEnabled', type: 'bool' },
        { name: 'lowStockThreshold', type: 'number', onlyInt: true, min: 0, max: 9999 },
        { name: 'spare', type: 'json', maxSize: 20000 },
        { name: 'installed', type: 'json', maxSize: 20000 },
        { name: 'spareTotal', type: 'number', onlyInt: true, min: 0 },
        { name: 'archived', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_parts_user ON parts (user)',
        'CREATE UNIQUE INDEX idx_parts_user_nameKey ON parts (user, nameKey)',
      ],
    })
    app.save(parts)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('parts'))
  },
)
