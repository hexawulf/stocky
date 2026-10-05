/// <reference path="../pb_data/types.d.ts" />

// users.seedPreset must name an existing preset (built in, or from
// <pb_data>/stocky-presets.json); it's a plain text field since migration
// 1791072010, so this hook does what the old select values did.
onRecordCreateRequest((e) => {
  const s = require(`${__hooks}/lib/stocky.js`)
  return s.respond(e, () => {
    s.checkSeedPreset(e.app, e.record)
    return e.next()
  })
}, 'users')

onRecordUpdateRequest((e) => {
  const s = require(`${__hooks}/lib/stocky.js`)
  return s.respond(e, () => {
    s.checkSeedPreset(e.app, e.record)
    return e.next()
  })
}, 'users')
