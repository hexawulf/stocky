import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.STOCKY_E2E_PORT || 8097)
const BASE_URL = process.env.STOCKY_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI === undefined ? 'list' : [['github'], ['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
