# Changelog

All notable changes to Stocky. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Docker images are published as
`0xwulf/stocky:<version>`, `:<major>.<minor>` and `:latest`.

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

[0.1.1]: https://github.com/hexawulf/stocky/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/hexawulf/stocky/releases/tag/v0.1.0
