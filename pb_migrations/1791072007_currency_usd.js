/// <reference path="../pb_data/types.d.ts" />

// Add USD next to TWD and EUR (spec §5.2, §8, decision #21): a site's default
// currency and a stock in's price currency.
migrate(
  (app) => {
    for (const [collection, field] of [
      ['locations', 'defaultCurrency'],
      ['movements', 'priceCurrency'],
    ]) {
      const c = app.findCollectionByNameOrId(collection)
      c.fields.getByName(field).values = ['TWD', 'EUR', 'USD']
      app.save(c)
    }
  },
  (app) => {
    for (const [collection, field] of [
      ['locations', 'defaultCurrency'],
      ['movements', 'priceCurrency'],
    ]) {
      const c = app.findCollectionByNameOrId(collection)
      c.fields.getByName(field).values = ['TWD', 'EUR']
      app.save(c)
    }
  },
)
