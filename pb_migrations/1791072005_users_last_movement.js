/// <reference path="../pb_data/types.d.ts" />

// users.lastMovementId → movements (spec §7.4); added last because users and movements point at each other
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')
    const movementsId = app.findCollectionByNameOrId('movements').id

    users.fields.add(
      new RelationField({
        name: 'lastMovementId',
        maxSelect: 1,
        collectionId: movementsId,
        cascadeDelete: false,
      }),
    )
    app.save(users)
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users')
    users.fields.removeByName('lastMovementId')
    app.save(users)
  },
)
