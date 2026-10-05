/// <reference path="../pb_data/types.d.ts" />

// locations, hosts, categories (spec §5.2, §5.3, §6.5)
migrate(
  (app) => {
    const usersId = app.findCollectionByNameOrId('users').id

    const own = 'user = @request.auth.id'
    const createBase =
      '@request.auth.id != "" && @request.body.user = @request.auth.id' +
      ' && @request.body.key:isset = false && @request.body.referenced:isset = false'
    const updateBase =
      '@request.auth.id != "" && user = @request.auth.id' +
      ' && @request.body.user:isset = false && @request.body.key:isset = false' +
      ' && @request.body.referenced:isset = false'

    // fields every reference list shares
    const common = () => [
      {
        name: 'user',
        type: 'relation',
        required: true,
        maxSelect: 1,
        collectionId: usersId,
        cascadeDelete: true,
      },
      { name: 'key', type: 'text', max: 40, pattern: '^[a-z0-9_]*$' },
      { name: 'label', type: 'text', required: true, min: 1, max: 40 },
      { name: 'sortOrder', type: 'number', onlyInt: true },
      { name: 'retired', type: 'bool' },
      { name: 'referenced', type: 'bool' },
    ]
    const timestamps = () => [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ]
    const commonIndexes = (name) => [
      `CREATE INDEX idx_${name}_user ON ${name} (user)`,
      `CREATE UNIQUE INDEX idx_${name}_user_key ON ${name} (user, key) WHERE key != ''`,
      `CREATE UNIQUE INDEX idx_${name}_user_label ON ${name} (user, label COLLATE NOCASE) WHERE retired = FALSE`,
    ]

    const locations = new Collection({
      type: 'base',
      name: 'locations',
      listRule: own,
      viewRule: own,
      createRule: createBase + ' && @request.body.kind = "site"',
      updateRule:
        updateBase +
        ' && @request.body.kind:isset = false' +
        ' && (kind != "transit" || @request.body.retired:isset = false || @request.body.retired = false)',
      deleteRule: own + ' && referenced = false && kind != "transit"',
      fields: [
        ...common(),
        { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['site', 'transit'] },
        { name: 'defaultCurrency', type: 'select', maxSelect: 1, values: ['TWD', 'EUR'] },
        ...timestamps(),
      ],
      indexes: [
        ...commonIndexes('locations'),
        "CREATE UNIQUE INDEX idx_locations_user_transit ON locations (user) WHERE kind = 'transit'",
      ],
    })
    app.save(locations)

    // a host's site must be one of your own sites
    const siteOk = '@request.body.site.user = @request.auth.id && @request.body.site.kind = "site"'
    const hosts = new Collection({
      type: 'base',
      name: 'hosts',
      listRule: own,
      viewRule: own,
      createRule: createBase + ' && ' + siteOk,
      updateRule: updateBase + ` && (@request.body.site:isset = false || (${siteOk}))`,
      deleteRule: own + ' && referenced = false',
      fields: [
        ...common(),
        { name: 'type', type: 'text', max: 60 },
        {
          name: 'site',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: locations.id,
          cascadeDelete: false,
        },
        ...timestamps(),
      ],
      indexes: commonIndexes('hosts'),
    })
    app.save(hosts)

    const categories = new Collection({
      type: 'base',
      name: 'categories',
      listRule: own,
      viewRule: own,
      createRule: createBase,
      updateRule: updateBase,
      deleteRule: own + ' && referenced = false',
      fields: [...common(), { name: 'description', type: 'text', max: 120 }, ...timestamps()],
      indexes: commonIndexes('categories'),
    })
    app.save(categories)
  },
  (app) => {
    for (const name of ['categories', 'hosts', 'locations']) {
      app.delete(app.findCollectionByNameOrId(name))
    }
  },
)
