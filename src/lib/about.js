// What the About dialog shows (spec §4). The version comes from package.json
// at build time (vite.config.js `define`); the release date sits next to it.
/* global __APP_VERSION__ */

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
export const RELEASE_DATE = 'October 2026'

export const TAGLINE = "Know what's in your machines, and what's in stock."

// [label, value]: keep in step with package.json and the Dockerfile
export const STACK = [
  ['Backend', 'PocketBase 0.40.4 (Go, SQLite), JS hooks and server routes'],
  ['Realtime', 'PocketBase SSE subscriptions'],
  ['Frontend', 'Vue 3, Vite, vue-router'],
  ['State', 'plain composables (no Pinia)'],
  ['Styling', 'hand-written CSS with theme tokens (light/dark)'],
  ['Testing', 'Vitest, @vue/test-utils, happy-dom, API suites'],
  ['Discovery', 'stocky-collect.sh (Bash, read-only)'],
  ['Packaging', 'multi-arch Docker image (amd64/arm64), Alpine, non-root'],
]

export const CONTACT = { author: '0xWulf', email: 'dev@0xwulf.dev' }

const REPO = 'https://github.com/hexawulf/stocky'
export const LINKS = [
  { label: 'GitHub repository', href: REPO },
  { label: 'Docker Hub', href: 'https://hub.docker.com/r/0xwulf/stocky' },
  { label: 'Technical spec', href: `${REPO}/blob/main/spec.md` },
  { label: 'Licence: MIT', href: `${REPO}/blob/main/LICENSE` },
]

// "Stocky v0.1.0 · PocketBase 0.40.4 · schema 1791072010 · preset example ·
// realtime connected · online"; unknown server facts read "unknown"
export function diagnosticsLine({ version, pocketbase, schema, preset, realtime, online }) {
  return [
    `Stocky v${version}`,
    `PocketBase ${pocketbase || 'unknown'}`,
    `schema ${schema || 'unknown'}`,
    `preset ${preset || 'standard'}`,
    `realtime ${realtime ? 'connected' : 'disconnected'}`,
    online ? 'online' : 'offline',
  ].join(' · ')
}
