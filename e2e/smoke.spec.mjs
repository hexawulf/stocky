// Author:      0xWulf
// Description: Playwright Chromium E2E Smoke Suite for Stocky 1.0 (Phase 6.3):
//              - /api/health = 200, protected routes fail closed (401)
//              - Login & create ingest token -> POST /api/stocky/ingest with
//                pi5-nvme and kvm-vps v2 snapshots -> verify /fleet renders
//                Chassis Cards, Topology SVG, and Comparison Matrix
//              - Submit a drifted snapshot (swapped NVMe) -> verify Drift Inbox
//                badge appears -> apply drift -> verify movement & Host Anatomy Inspector
//              - Export redacted SVG & Markdown -> assert zero serials/MACs leak
//              - About modal attribution + Escape close + mobile 390x844 zero horizontal overflow
//              - Zero pageerror and zero >=500 responses.
//              Also captures fresh light/dark demo-fleet screenshots when
//              STOCKY_CAPTURE_SCREENSHOTS=1.
// Modified:    2026-11-22
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import PocketBase from 'pocketbase'

const ROOT = process.cwd()
const BASE_URL = process.env.STOCKY_BASE_URL || 'http://127.0.0.1:8097'
const CAPTURE_SCREENSHOTS = process.env.STOCKY_CAPTURE_SCREENSHOTS === '1'

test.describe('Stocky 1.0 E2E Smoke Suite', () => {
  test('full fleet discovery, visual topology, drift apply, redacted export, about modal & mobile viewport', async ({
    page,
    request,
  }) => {
    const pageErrors = []
    const server500s = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))
    page.on('response', (resp) => {
      if (resp.status() >= 500) server500s.push(`${resp.status()} ${resp.url()}`)
    })

    // 1. Health check = 200 & protected route fails closed (401)
    const health = await request.get(`${BASE_URL}/api/health`)
    expect(health.status()).toBe(200)

    const unauthAbout = await request.get(`${BASE_URL}/api/stocky/about`)
    expect(unauthAbout.status()).toBe(401)

    const unauthIngest = await request.post(`${BASE_URL}/api/stocky/ingest`, { data: {} })
    expect(unauthIngest.status()).toBe(401)

    // Seed an isolated test user via superuser
    const admin = new PocketBase(BASE_URL)
    await admin.collection('_superusers').authWithPassword('su@test.local', 'SuperPass123')
    const email = `e2e_${Date.now()}@test.local`
    await admin.collection('users').create({
      email,
      password: 'UserPass123',
      passwordConfirm: 'UserPass123',
      seedPreset: 'standard',
    })

    // 2. Log in through the real Vue UI
    await page.goto('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('UserPass123')
    await page.getByRole('button', { name: /log in|sign in/i }).click()
    await expect(page.locator('.brand')).toHaveText('Stocky')

    // 3. Navigate to /fleet, open Connect Host wizard, generate a fleet ingest token
    await page.goto('/fleet')
    await expect(page.locator('[data-test="empty-fleet"]')).toBeVisible()
    await page.locator('[data-test="open-connect"]').click()
    await expect(page.locator('[data-test="connect-host-dialog"]')).toBeVisible()
    await page.locator('[data-test="generate-token"]').click()
    const rawToken = (
      await page.locator('[data-test="generated-token"] code').textContent()
    )?.trim()
    expect(rawToken).toMatch(/^stky_/)
    await page.locator('[data-test="connect-close"]').click()

    // 4. POST /api/stocky/ingest with pi5-nvme and kvm-vps v2 fixtures
    const pi5Fixture = JSON.parse(readFileSync(resolve(ROOT, 'tools/fixtures/pi5-nvme.json'), 'utf8'))
    const kvmFixture = JSON.parse(readFileSync(resolve(ROOT, 'tools/fixtures/kvm-vps.json'), 'utf8'))

    const ing1 = await request.post(`${BASE_URL}/api/stocky/ingest`, {
      headers: { Authorization: `Bearer ${rawToken}` },
      data: pi5Fixture,
    })
    expect(ing1.status()).toBe(200)
    const ing1Body = await ing1.json()
    expect(ing1Body.status).toBe('drift_pending')

    const ing2 = await request.post(`${BASE_URL}/api/stocky/ingest`, {
      headers: { Authorization: `Bearer ${rawToken}` },
      data: kvmFixture,
    })
    expect(ing2.status()).toBe(200)

    // 5. Verify /fleet renders Chassis Cards, Interactive Topology SVG, and Comparison Matrix
    await page.goto('/fleet')
    await expect(page.locator('[data-host-card="pi-test"]')).toBeVisible()
    await expect(page.locator('[data-host-card="vps-node-01"]')).toBeVisible()
    await expect(page.locator('[data-test="fleet-kpis"]')).toContainText('8 cores')

    await page.locator('[data-test="mode-topology"]').click()
    await expect(page.locator('[data-test="fleet-topology"]')).toBeVisible()
    await expect(page.locator('[data-host-node="pi-test"]')).toBeVisible()

    await page.locator('[data-test="mode-matrix"]').click()
    await expect(page.locator('[data-test="fleet-matrix"]')).toBeVisible()
    await expect(page.locator('[data-matrix-host="vps-node-01"]')).toContainText('AMD EPYC')

    // 6. Verify Drift Inbox badge appears -> apply initial drift -> then submit swapped NVMe drift
    await expect(page.locator('[data-test="nav-drift-badge"]')).toBeVisible()
    await page.goto('/fleet/drift')
    await expect(page.locator('[data-drift-host="pi-test"]')).toBeVisible()
    await page
      .locator('[data-drift-host="pi-test"] [data-test="drift-apply"]')
      .click()
    await expect(page.locator('[data-drift-host="pi-test"]')).toHaveCount(0)

    // Now submit a drifted snapshot (swapped NVMe in slot nvme0 on pi-test)
    const driftedPi5 = structuredClone(pi5Fixture)
    const nvmeItem = driftedPi5.items.find((i) => i.interface === 'nvme')
    nvmeItem.model = 'WD Black SN850X 2TB'
    nvmeItem.serial = 'WDSWAP999999'
    nvmeItem.sizeBytes = 2000398934016

    const ingDrift = await request.post(`${BASE_URL}/api/stocky/ingest`, {
      headers: { Authorization: `Bearer ${rawToken}` },
      data: driftedPi5,
    })
    expect(ingDrift.status()).toBe(200)
    expect((await ingDrift.json()).status).toBe('drift_pending')

    await page.goto('/fleet/drift')
    await expect(page.locator('[data-drift-host="pi-test"]')).toContainText('1 replaced')
    await page
      .locator('[data-drift-host="pi-test"] [data-test="drift-apply"]')
      .click()
    await expect(page.locator('[data-drift-host="pi-test"]')).toHaveCount(0)

    // Verify Host Detail Inspector (/fleet/:id)
    await page.goto(`/fleet/${ing1Body.hostId}`)
    await expect(page.locator('[data-test="host-anatomy-svg"]')).toBeVisible()
    await expect(page.locator('[data-test="host-installed-units"]')).toContainText(
      'WD Black SN850X 2TB',
    )

    // 7. Export redacted SVG & Markdown -> assert zero serials/MACs leak
    await page.goto('/fleet')
    await page.locator('[data-test="open-export"]').click()
    await expect(page.locator('[data-test="fleet-export-dialog"]')).toBeVisible()
    const svgPreviewHtml = await page.locator('[data-test="export-preview"]').innerHTML()
    expect(svgPreviewHtml).toContain('<svg')
    expect(svgPreviewHtml).not.toContain('WDSWAP999999')
    expect(svgPreviewHtml).not.toContain('2c:cf:67:00:00:01')

    await page.locator('[data-test="export-format-markdown"]').click()
    const mdPreviewText = await page.locator('[data-test="export-preview"]').textContent()
    expect(mdPreviewText).toContain('pi-test')
    expect(mdPreviewText).not.toContain('WDSWAP999999')
    expect(mdPreviewText).not.toContain('2c:cf:67:00:00:01')
    await page.locator('[data-test="export-close"]').click()

    // 8. About modal attribution + Escape close + Theme toggle (light/dark)
    const themeToggle = page.locator('[data-test="top-theme"]')
    await expect(themeToggle).toBeVisible()
    await themeToggle.click()
    const themeAttr1 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    expect(['light', 'dark']).toContain(themeAttr1)
    await themeToggle.click()
    const themeAttr2 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    expect(themeAttr2).not.toBe(themeAttr1)

    await page.locator('[data-test="top-about"]').click()
    const aboutDialog = page.getByRole('dialog')
    await expect(aboutDialog).toBeVisible()
    await expect(aboutDialog.locator('[data-test="about-developer"]')).toContainText(
      'Erling Wulf Weinreich (0xWulf)',
    )
    await expect(aboutDialog.locator('[data-test="about-mail"]')).toHaveText('dev@0xwulf.dev')
    await page.keyboard.press('Escape')
    await expect(aboutDialog).toHaveCount(0)

    // Verify root '/' is Fleet view and '/stock' is the second tab (Stock view)
    await page.goto('/')
    await expect(page.locator('[data-test="fleet-view"]')).toBeVisible()
    await page.goto('/stock')
    await expect(page.locator('[data-test="installed"]')).toBeVisible()

    // Verify ⌘K / top-cmd Command Palette searches hosts & drive serials
    await page.locator('[data-test="top-cmd"]').click()
    await expect(page.locator('[data-test="cmd-dialog"]')).toBeVisible()
    await page.locator('[data-test="cmd-input"]').fill('WDSWAP999999')
    await expect(page.locator('[data-test="cmd-list"]')).toContainText('WD Black SN850X 2TB')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-test="cmd-dialog"]')).toHaveCount(0)

    // 9. Mobile 390x844 zero horizontal overflow
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/fleet')
    await expect(page.locator('[data-host-card="pi-test"]')).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflow).toBe(false)

    expect(pageErrors).toEqual([])
    expect(server500s).toEqual([])
  })

  test('demo_fleet preset renders visual showcase and captures clean docs screenshots', async ({
    page,
  }) => {
    const admin = new PocketBase(BASE_URL)
    await admin.collection('_superusers').authWithPassword('su@test.local', 'SuperPass123')
    const email = `demo_${Date.now()}@test.local`
    await admin.collection('users').create({
      email,
      password: 'UserPass123',
      passwordConfirm: 'UserPass123',
      seedPreset: 'demo_fleet',
    })

    await page.setViewportSize({ width: 1280, height: 860 })
    await page.goto('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('UserPass123')
    await page.getByRole('button', { name: /log in|sign in/i }).click()
    await expect(page.locator('.brand')).toHaveText('Stocky')

    await page.goto('/fleet')
    await expect(page.locator('[data-host-card="sbc-node-01"]')).toBeVisible()
    await expect(page.locator('[data-host-card="ws-compute-01"]')).toBeVisible()
    await expect(page.locator('[data-host-card="nas-vault-01"]')).toBeVisible()
    await expect(page.locator('[data-host-card="vps-edge-01"]')).toBeVisible()

    if (CAPTURE_SCREENSHOTS) {
      // Capture all 4 showcase screenshots in crisp Light Mode for the 2x2 README grid
      await page.emulateMedia({ colorScheme: 'light' })
      await page.evaluate(() => {
        localStorage.setItem('stocky.theme', 'light')
        document.documentElement.setAttribute('data-theme', 'light')
      })

      // 1. Fleet Rack & Chassis View (Light Mode)
      await page.screenshot({ path: resolve(ROOT, 'docs/screenshots/fleet-rack.png') })

      // 2. Interactive Fleet Topology SVG (Light Mode)
      await page.locator('[data-test="mode-topology"]').click()
      await expect(page.locator('[data-test="fleet-topology"]')).toBeVisible()
      await page.screenshot({ path: resolve(ROOT, 'docs/screenshots/fleet-topology.png') })

      // 3. Global ⌘K Command Palette & Drive Serial Search (Light Mode)
      await page.locator('[data-test="mode-rack"]').click()
      await page.locator('[data-test="top-cmd"]').click()
      await expect(page.locator('[data-test="cmd-dialog"]')).toBeVisible()
      await page.locator('[data-test="cmd-input"]').fill('NVMe')
      await page.screenshot({ path: resolve(ROOT, 'docs/screenshots/command-palette.png') })
      await page.keyboard.press('Escape')

      // 4. Host Hardware Anatomy Inspector (Light Mode)
      await page.locator('[data-host-card="ws-compute-01"] a.host-link').click()
      await expect(page.locator('[data-test="host-anatomy-svg"]')).toBeVisible()
      await page.screenshot({ path: resolve(ROOT, 'docs/screenshots/host-inspector.png') })
    }
  })
})
