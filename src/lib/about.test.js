import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_VERSION, LINKS, RELEASE_DATE, STACK, diagnosticsLine } from './about.js'

// Vitest runs from the project root (happy-dom's import.meta.url isn't a file URL)
const root = (f) => resolve(process.cwd(), f)
const pkg = JSON.parse(readFileSync(root('package.json'), 'utf8'))

describe('About facts (spec §4)', () => {
  it('the version comes from package.json at build time, never hard-coded', () => {
    expect(APP_VERSION).toBe(pkg.version)
    expect(RELEASE_DATE).toMatch(/^[A-Z][a-z]+ \d{4}$/)
  })

  it('the stack names the pinned PocketBase version used everywhere else', () => {
    const dockerfile = readFileSync(root('Dockerfile'), 'utf8')
    const pinned = dockerfile.match(/ARG PB_VERSION=([\d.]+)/)[1]
    expect(STACK.find(([k]) => k === 'Backend')[1]).toContain(`PocketBase ${pinned}`)
  })

  it('links are https and point at the public repo and image', () => {
    expect(LINKS.map((l) => l.href)).toEqual([
      'https://github.com/hexawulf/stocky',
      'https://hub.docker.com/r/0xwulf/stocky',
      'https://github.com/hexawulf/stocky/blob/main/spec.md',
      'https://github.com/hexawulf/stocky/blob/main/LICENSE',
    ])
  })

  it('one diagnostics line; unknown server facts say so', () => {
    expect(
      diagnosticsLine({
        version: '0.1.0',
        pocketbase: '0.40.4',
        schema: '1791072010',
        preset: 'example',
        realtime: true,
        online: true,
      }),
    ).toBe(
      'Stocky v0.1.0 · PocketBase 0.40.4 · schema 1791072010 · preset example · realtime connected · online',
    )
    expect(diagnosticsLine({ version: '0.1.0', realtime: false, online: false })).toBe(
      'Stocky v0.1.0 · PocketBase unknown · schema unknown · preset standard · realtime disconnected · offline',
    )
  })
})
