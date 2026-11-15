# Changelog

All notable changes to Stocky. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Docker images are published as
`0xwulf/stocky:<version>`, `:<major>.<minor>` and `:latest`.

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

[0.1.3]: https://github.com/hexawulf/stocky/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/hexawulf/stocky/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/hexawulf/stocky/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/hexawulf/stocky/releases/tag/v0.1.0
