// Author:      0xWulf
// Description: Validate JSON files against docs/discovery-schema.json without
//              a dependency: implements the JSON Schema keywords that schema
//              uses (type, const, enum, required, properties,
//              additionalProperties, maxProperties, items, maxItems,
//              minimum, maxLength, pattern, $ref to #/$defs). Exit 1 on the
//              first invalid file, listing its errors.
// Usage:       node scripts/validate-schema.mjs FILE...
// Modified:    2026-10-05
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const schema = JSON.parse(readFileSync(`${ROOT}docs/discovery-schema.json`, 'utf8'))

const typeOf = (v) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v

function validate(v, s, path, errors) {
  if (s.$ref)
    s = s.$ref
      .split('/')
      .slice(1)
      .reduce((o, k) => o[k], schema)
  const fail = (msg) => errors.push(`${path || '/'}: ${msg}`)
  if ('const' in s && v !== s.const) return fail(`must be ${JSON.stringify(s.const)}`)
  if (s.enum && !s.enum.includes(v)) return fail(`must be one of ${s.enum.join(', ')}`)
  if (s.type) {
    const types = [].concat(s.type)
    const t = typeOf(v)
    if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) {
      return fail(`must be ${types.join(' or ')}, is ${t}`)
    }
  }
  if (typeof v === 'string') {
    if (s.maxLength !== undefined && [...v].length > s.maxLength) fail(`longer than ${s.maxLength}`)
    if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) fail(`doesn't match ${s.pattern}`)
  }
  if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) fail(`below ${s.minimum}`)
  if (Array.isArray(v)) {
    if (s.maxItems !== undefined && v.length > s.maxItems) fail(`more than ${s.maxItems} items`)
    if (s.items) v.forEach((x, i) => validate(x, s.items, `${path}/${i}`, errors))
  }
  if (typeOf(v) === 'object') {
    for (const k of s.required ?? []) if (!(k in v)) fail(`missing ${k}`)
    const keys = Object.keys(v)
    if (s.maxProperties !== undefined && keys.length > s.maxProperties)
      fail(`more than ${s.maxProperties} properties`)
    for (const k of keys) {
      if (s.properties?.[k]) validate(v[k], s.properties[k], `${path}/${k}`, errors)
      else if (s.additionalProperties === false) fail(`unknown property ${k}`)
      else if (typeof s.additionalProperties === 'object')
        validate(v[k], s.additionalProperties, `${path}/${k}`, errors)
    }
  }
}

let bad = 0
for (const file of process.argv.slice(2)) {
  let doc
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    console.log(`INVALID ${file}: not JSON (${err.message})`)
    bad++
    continue
  }
  const errors = []
  validate(doc, schema, '', errors)
  if (errors.length) {
    bad++
    console.log(`INVALID ${file}\n  ${errors.slice(0, 20).join('\n  ')}`)
  } else console.log(`valid   ${file}`)
}
process.exit(bad ? 1 : 0)
