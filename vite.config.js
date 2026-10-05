import { fileURLToPath, URL } from 'node:url'

import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// the app's version, from package.json at build time (About dialog)
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  // devtools only in the dev server, not in Vitest runs
  plugins: [vue(), ...(process.env.VITEST ? [] : [vueDevTools()])],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Same origin in dev as in production (docs/deploy.md): the API and the
  // dashboard go to a local PocketBase. '/_/' keeps its trailing slash so it
  // doesn't swallow Vite's own '/__…' paths (devtools).
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8090',
      '/_/': 'http://127.0.0.1:8090',
    },
  },
  // npm test: unit and component tests next to the code (src/**/*.test.js)
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.js'],
  },
})
