/// <reference path="../pb_data/types.d.ts" />

// Lock down the built-in users collection: no sign-up, no self-editing (spec §6.4).
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')

    users.listRule = 'id = @request.auth.id'
    users.viewRule = 'id = @request.auth.id'
    users.createRule = null
    users.updateRule = null
    users.deleteRule = null
    users.manageRule = null

    // written only by the seed route (spec §5.4)
    users.fields.add(new NumberField({ name: 'seedVersion', onlyInt: true, min: 0 }))

    app.save(users)
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users')

    // PocketBase defaults for the users collection
    users.listRule = 'id = @request.auth.id'
    users.viewRule = 'id = @request.auth.id'
    users.createRule = ''
    users.updateRule = 'id = @request.auth.id'
    users.deleteRule = 'id = @request.auth.id'
    users.manageRule = null
    users.fields.removeByName('seedVersion')

    app.save(users)
  },
)
