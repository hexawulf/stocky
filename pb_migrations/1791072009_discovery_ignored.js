/// <reference path="../pb_data/types.d.ts" />

// Discovery: remember what the user declined, per host (spec §13.6, §13.11.9)
// - hosts.discoveryIgnored: keys of detected items left unchecked or kept
//   out ("S:<serialKey>" or "M:<kind>|<model key>"); written only by the
//   discovery routes, so the records API can't set it
// - imports.ignoredBefore: the host's list before the import changed it
//   (null when it didn't), restored by undo-import
migrate(
  (app) => {
    const guard = ' && @request.body.discoveryIgnored:isset = false'
    const hosts = app.findCollectionByNameOrId('hosts')
    hosts.fields.add(new JSONField({ name: 'discoveryIgnored', maxSize: 50000 }))
    hosts.createRule += guard
    hosts.updateRule += guard
    app.save(hosts)

    const imports = app.findCollectionByNameOrId('imports')
    imports.fields.add(new JSONField({ name: 'ignoredBefore', maxSize: 50000 }))
    app.save(imports)
  },
  (app) => {
    const guard = ' && @request.body.discoveryIgnored:isset = false'
    const hosts = app.findCollectionByNameOrId('hosts')
    hosts.fields.removeByName('discoveryIgnored')
    hosts.createRule = hosts.createRule.replace(guard, '')
    hosts.updateRule = hosts.updateRule.replace(guard, '')
    app.save(hosts)

    const imports = app.findCollectionByNameOrId('imports')
    imports.fields.removeByName('ignoredBefore')
    app.save(imports)
  },
)
