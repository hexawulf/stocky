# Changelog

All notable changes to Stocky. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Docker images are published as
`0xwulf/stocky:<version>`, `:<major>.<minor>` and `:latest`.

## [1.2.0] - 2026-11-23

### Added

- **Public Landing Page (`LandingView.vue`, `/welcome`):**
  - Signed-out visitors to `/` now see a lazy-loaded, same-origin public landing page (hero with Sign in + GitHub links, feature cards, optimized WebP screenshots, Docker Compose / `docker run` quick-start snippet, and footer with live build version).
  - Signed-in users continue to land directly on Fleet (`/`), deep links preserve `/login?redirect=…`, and `index.html` includes same-origin Open Graph metadata (`og:title`, `og:description`, relative `og:image`).

### Fixed

- **Accessibility & Contrast:** Raised light-mode primary accent contrast from 3.65:1 to 4.98:1 (`hsl(160, 100%, 25%)`), fixed muted/warning/danger/badge text contrast in both themes, and respected explicit `data-theme` on `MovementIcon`.
- **UI & Mobile Layout:** Fixed scoped `.btn` overrides stripping borders from `.btn-secondary` buttons, replaced CJK fullwidth `＋` and `ⓘ` glyphs that rendered as missing-glyph boxes on minimal Linux font stacks, eliminated the Fleet KPI orphan row on desktop, added `scrollBehavior` top-reset on navigation, added an `<h1>` and non-wrapping quantity badges on Stock (`/stock`), and fixed 390 px horizontal overflow on Settings.
- **App Behaviour:** Fixed Command Palette (`⌘K`) part installed counts to sum PocketBase `part.installed` maps with singular/plural units, fixed `RecordView` `?host=` pre-selection for `install` links from Host Detail, kept the Parts nav tab active on `/parts/new` and `/parts/:id/edit`, and updated the Import placeholder to `stocky.discovery/2`.
- **Documentation & Cleanup:** Removed orphaned v0.1 screenshots and unused starter CSS, recaptured clean light-mode screenshots (2×2 grid in `README.md` and `docs/dockerhub.md`), updated `docs/deploy.md` to document blocking `/_/` and `/api/collections/_superusers/` with `403` on public reverse proxies and accurate Docker tags (`latest`, `X.Y.Z`, `X.Y`), updated `compose.yaml` tag comment, `SECURITY.md` supported versions (`1.x`), and `spec.md` status note.

### Known

- Trivy image scan: **0 fixable CRITICAL**, **1 report-only HIGH** inside the PocketBase 0.40.6 binary (`golang.org/x/net` v0.61.0, `CVE-2026-78661`, fixed in 0.62.0 — unchanged from v1.1.0).

## [1.1.0] - 2026-11-22

### Added

- **Global `⌘K` / `Ctrl+K` Command Palette (`CommandPalette.vue`):**
  - Instant fuzzy search from anywhere (`⌘K`, `Ctrl+K`, or top-bar `⌕` icon) across every **Host** (site, OS, CPU, RAM, tags), physical **Drive** (model, slot/device, **serial number**, SMART status, temperature), **GPU** (model, vendor, VRAM), **NIC** (interface, MAC address, IPv4), **Part Type**, and **Quick Actions** (*Fleet*, *Stock*, *Record*, *Connect Host*, *Drift Inbox*, *Toggle Light/Dark Theme*).
- **Light / Dark / System Theme System (`useTheme.js`):**
  - Explicit `:root[data-theme="light"]` and `:root[data-theme="dark"]` design tokens with automatic `prefers-color-scheme` fallback.
  - 1-click top-bar theme toggle (`☀` / `☾`) plus a `System / Light / Dark` Appearance selector in Settings (`/settings`), persisted in `localStorage`.
- **Collector Hardening for Synology DSM & WSL2 (`tools/stocky-collect.sh`, `tools/stocky-fleet-pull.sh`):**
  - Prioritizes `/etc.defaults/synoinfo.conf` on Synology DSM so migrated arrays report actual hardware model, adds `/proc/cpuinfo` and `/sys/block` + `/volume1/@appstore/synocli-disk/sbin/smartctl` fallbacks when `lscpu`/`lsblk` are absent, and detects WSL2 NVIDIA GPUs via `/usr/lib/wsl/lib/nvidia-smi`.
  - Fixed `ssh` stdin redirection in `tools/stocky-fleet-pull.sh` and added hostname normalization (`plus` ↔ `+`, `-brix` suffix) in `pb_hooks/ingest.pb.js`.

### Changed

- **Navigation & Default Home View:** Promoted **Fleet** (`/` and `/fleet`) to the primary home screen and placed **Stock** (`/stock`, spare stock by site, low-stock alerts, and installed units) second in the navigation bar.

## [1.0.0] - 2026-11-22

### Added

- **Visual Fleet Hardware Experience (`/fleet`):**
  - **KPI Summary Strip:** Live host freshness (`online`, `stale`, `drift`), aggregate compute cores (`ARM64` vs `x86_64`, physical vs cloud vCPUs), total fleet RAM, total storage capacity with SMART health warnings, and optional monthly cloud spend + physical TDP power totals.
  - **Rack & Chassis View:** Hardware chassis cards grouped by Site with form-factor badges (`SBC`, `Workstation`, `Server`, `NAS`, `Cloud VPS`, `VM`), CPU/RAM/OS spec chips, visual drive-bay slots (`NVMe`, `SATA`, `VirtIO`, `SD`, `USB`) with SMART status LEDs and temperatures, and GPU/HAT/NIC chips.
  - **Interactive Fleet Topology SVG (`FleetTopologyMap.vue`):** Pure Vue-rendered hierarchical SVG topology map (Fleet Root → Site Containers → Host Nodes → expandable Tier-3 Hardware Anatomy sub-nodes) with zoom, fit, and detailed/compact modes.
  - **Comparison Matrix (`FleetMatrixView.vue`):** Sortable fleet spec matrix across Site, Form Factor, Arch/OS, CPU/Cores, RAM, Storage, GPUs, NICs, SMART, Cost, and Last Seen.
- **Host Detail Inspector (`/fleet/:id`):**
  - Visual Hardware Anatomy SVG block diagram (System Board/SoC, Compute, Memory Subsystem, PCIe/GPU/NICs, Storage Bays).
  - Installed Stocky parts & serialized `units` with 1-click **Swap with spare** and **Uninstall to spare** actions, Hardware Timeline, and Quick Metadata Editor.
- **Universal Discovery Schema v2 & Collector (`tools/stocky-collect.sh` v2.0.0):**
  - Extended `docs/discovery-schema.json` to `stocky.discovery/2` (full backward compatibility with `stocky.discovery/1`).
  - Collects bare-metal Linux, Raspberry Pi / ARM64 SBCs, Cloud KVM VPSes, Synology DSM NASes, and WSL2 hosts (`--physical-only` restores v1 VM refusal).
  - Added GPU detection (`nvidia-smi` and `lspci`), OS/kernel/uptime telemetry, CPU/memory/storage summaries, and non-destructive `smartctl` health, temperature, and wear summaries.
  - Added `--push <URL>` with `--token-file <PATH>` (or `STOCKY_TOKEN` env var; raw CLI tokens refused so `ps` never leaks secrets), plus `--print-systemd` and `--print-cron` snippet generators.
  - Added `tools/stocky-fleet-pull.sh` + `tools/hosts.conf.example` for central read-only SSH collection of NASes and isolated nodes.
  - Baked `/tools/stocky-collect.sh` and `/tools/stocky-collect.sh.sha256` directly into the container's static file server.
- **Scoped Ingest Tokens & Zero-Noise Drift Inbox (`/fleet/drift`):**
  - Migration `1791072011_fleet_hardware.js`: enriched `hosts` collection and created `ingest_tokens` (SHA-256 hashed, constant-time verified, scoped to host/site/fleet, revocable) and `pending_snapshots` (with automatic 10-snapshot clean retention per host).
  - `POST /api/stocky/ingest` updates live host telemetry (`specs`, `smartSummary`, `lastSeenAt`, `formFactor`) automatically and queues physical hardware drift in `pending_snapshots` (`status = "drift_pending"`).
  - `POST /api/stocky/drift/{id}/apply` and `/dismiss` let operators confirm or dismiss hardware drift in one click with full 24-hour undo support.
- **Privacy-Safe Visual & Spec Exports (`FleetExportDialog.vue`):**
  - Export fleet topology and specs as standalone **SVG**, **2× High-DPI PNG** (client-side Canvas), **Markdown Spec Matrix**, or **JSON Inventory**.
  - Privacy redaction toggles ON by default (strips serial numbers, MAC addresses, `machineIdHash`, costs, plus optional host anonymization).
- **Onboarding & Tier-S Engineering:**
  - Added `demo_fleet` preset and 1-click **Load Demo Fleet** action (`POST /api/stocky/demo-fleet`), plus the **Connect a Host** wizard (`ConnectHostDialog.vue`).
  - Added Playwright Chromium E2E smoke suite (`e2e/smoke.spec.mjs`, `scripts/test-e2e.sh`), `.github/dependabot.yml`, and `SECURITY.md`.
  - Standardized About dialog Developer attribution (`Erling Wulf Weinreich (0xWulf) · dev@0xwulf.dev`) and `What's new in 1.0.0` summary.

### Security

- Upgraded dev dependencies (`vite` 8.3.8, `vitest` 5.1.1, `happy-dom` 21.0.4) and overrides (`glob` 14.0.6, `minimatch` 11.0.9, `source-map-js` 1.2.4) so `npm audit` and `npm audit --omit=dev` report 0 vulnerabilities.

## [0.1.3] - 2026-11-16

### Security

- PocketBase 0.40.4 → 0.40.6: built with Go 1.27.3 (`net/http` and CA-bundle
  fixes) and newer `golang.org/x/net`. This clears 7 HIGH CVEs in the binary.
- The runtime stage now runs `apk upgrade`, which clears the Alpine musl and
  zlib HIGH CVEs.
- Releases are scanned with Trivy and blocked on any fixable CRITICAL.

### Known

- One HIGH remains inside the PocketBase binary: `golang.org/x/net` 0.61.0,
  CVE-2026-78661 (`x/net/html` DoS), fixed in 0.62.0. It needs a PocketBase
  release built with it; 0.40.6 is the newest.

## [0.1.2] - 2026-10-06

### Fixed

- Import screen: no more large circle around the page. The top bar's Import
  button and the import screen shared the class `import`, and a view's root
  element inherits the layout's scoped styles, so the button's pill border
  drew around the whole screen. The button's class is now `import-btn`.

### Added

- SVG favicon (crates on a shelf) in the accent colour, lighter on dark
  browser tabs; `favicon.ico` (16, 32, 48 px) and a 180 px
  `apple-touch-icon.png` from the same design.

## [0.1.1] - 2026-10-05

### Changed

- Top bar: About (ⓘ) is now an icon button matching Settings (⚙), with
  "About Stocky" as its accessible name and tooltip. Import is the only
  labelled control.

### Added

- GitHub Actions CI on pull requests and `main`: unit and component tests, the
  production build, and the server suites against a checksum-verified
  PocketBase.
- Release workflow: version tags build `linux/amd64` and `linux/arm64` images
  with SBOM and provenance attestations and push them to Docker Hub
  (`0xwulf/stocky`).
- The image carries an `org.opencontainers.image.licenses` label.

## [0.1.0] - 2026-10-05

Initial public release.

- Parts, sites, In transit and hosts; movements validated on the server in one
  transaction, append-only, with undo of the newest within 24 hours.
- History with filters, live across devices.
- Hardware discovery: `tools/stocky-collect.sh` snapshots a physical Linux
  machine; preview, conflicts and apply in the app; undo per import.
- Seed presets: `standard`, `example`, or your own in
  `pb_data/stocky-presets.json`.
- One multi-arch Docker image (amd64/arm64): PocketBase serving the Vue app,
  Alpine, non-root.

[1.2.0]: https://github.com/hexawulf/stocky/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/hexawulf/stocky/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/hexawulf/stocky/compare/v0.1.3...v1.0.0
[0.1.3]: https://github.com/hexawulf/stocky/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/hexawulf/stocky/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/hexawulf/stocky/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/hexawulf/stocky/releases/tag/v0.1.0
