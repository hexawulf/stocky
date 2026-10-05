/// <reference path="../pb_data/types.d.ts" />

// users.seedPreset: which preset the first login seeds (spec §5.4, decision #20).
// Empty = standard. Set by the superuser before the account's first login.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')
    users.fields.add(
      new SelectField({ name: 'seedPreset', maxSelect: 1, values: ['standard', 'hexawulf'] }),
    )
    app.save(users)
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users')
    users.fields.removeByName('seedPreset')
    app.save(users)
  },
)
