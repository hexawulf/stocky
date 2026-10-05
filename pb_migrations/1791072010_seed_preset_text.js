/// <reference path="../pb_data/types.d.ts" />

// users.seedPreset: select (standard | hexawulf) -> text, so presets can come
// from <pb_data>/stocky-presets.json without a migration (decision #27).
// Existing values are kept; pb_hooks/users_seed_preset.pb.js checks new ones
// against the presets that exist. Migration 1791072006 stays as it was.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')
    const values = {}
    for (const u of app.findAllRecords('users')) values[u.id] = u.getString('seedPreset')

    users.fields.removeByName('seedPreset')
    app.save(users)
    users.fields.add(
      new TextField({ name: 'seedPreset', max: 40, pattern: '^[a-z0-9_]*$', required: false }),
    )
    app.save(users)

    for (const u of app.findAllRecords('users')) {
      if (!values[u.id]) continue
      u.set('seedPreset', values[u.id])
      app.saveNoValidate(u)
    }
  },
  (app) => {
    // back to the select; a value it doesn't know becomes empty (standard)
    const users = app.findCollectionByNameOrId('users')
    const values = {}
    for (const u of app.findAllRecords('users')) values[u.id] = u.getString('seedPreset')

    users.fields.removeByName('seedPreset')
    app.save(users)
    users.fields.add(
      new SelectField({ name: 'seedPreset', maxSelect: 1, values: ['standard', 'hexawulf'] }),
    )
    app.save(users)

    for (const u of app.findAllRecords('users')) {
      const v = values[u.id]
      if (v !== 'standard' && v !== 'hexawulf') continue
      u.set('seedPreset', v)
      app.saveNoValidate(u)
    }
  },
)
