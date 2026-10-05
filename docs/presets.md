# Seed presets

A new account starts with the lists of one **preset**: its sites, an In
transit location, hosts and categories. The superuser picks it in the
PocketBase dashboard (`/_/` → users → the account → `seedPreset`) **before
the account's first login**; Stocky seeds it on that login and never again,
so changing `seedPreset` later has no effect. Empty means `standard`.

## Built in

| Name | What you get |
| --- | --- |
| `standard` | One site (Home), In transit, nine generic categories, no hosts |
| `example` | An example homelab: sites Lab (USD) and Office (EUR), In transit, eight hosts (`pi-a`, `pi-b`, `workstation`, `nas-a`, `router-a` at Lab; `nas-b`, `minipc`, `router-b` at Office), eight categories |

## Your own: `stocky-presets.json`

Put a file named `stocky-presets.json` in the PocketBase data directory (the
`pb_data` volume, next to `data.db`). It's read whenever a preset is needed,
so no restart or rebuild is required. It's one JSON object; each key is a
preset name (`a–z`, `0–9`, `_`, up to 40 characters; `standard` and `example`
can't be replaced):

```json
{
  "my_lab": {
    "label": "My lab",
    "locations": [
      { "key": "home", "label": "Home", "kind": "site", "defaultCurrency": "EUR" },
      { "key": "cabin", "label": "Cabin", "kind": "site", "defaultCurrency": "" },
      { "key": "in_transit", "label": "In transit", "kind": "transit" }
    ],
    "hosts": [
      { "key": "nas", "label": "NAS", "type": "Synology DS224+", "site": "home" },
      { "key": "pi", "label": "pi", "type": "Raspberry Pi 5 (8 GB)", "site": "cabin" }
    ],
    "categories": [
      { "key": "storage", "label": "Storage", "description": "SSDs, HDDs, memory cards" },
      { "key": "other", "label": "Other" }
    ]
  }
}
```

Rules (checked every time the file is read):

- `locations`: at least one `site`, exactly one `transit`; `defaultCurrency`
  is `TWD`, `EUR`, `USD` or empty.
- `hosts[].site` is the `key` of a site in the same preset.
- At least one category. Hardware discovery suggests categories by key
  (`storage`, `components`, `networking`, `peripherals`, `computers`, `sbc`,
  `other`; spec §13.5), so reusing those keys helps.
- Keys use `a–z`, `0–9` and `_` and are unique within their list; labels are
  1–40 characters and unique within their list (ignoring case).
- At most 50 presets and 200 entries per list.

If the file can't be read, isn't JSON or breaks a rule, Stocky ignores the
whole file and logs why; the built-in presets keep working. Choosing a
preset from a broken file is refused with the reason ("Unknown seed preset
… (stocky-presets.json is invalid: …)").
