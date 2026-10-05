# Stocky

**Know what's in your machines, and what's in stock.**

Stocky is a small, mobile-first, self-hosted inventory for homelab hardware:
spare parts at one or more sites, what's on its way between them (In transit),
and what's installed in which machine. Every change is a dated movement, so
the numbers can always be explained, and the most recent one can be undone.

It runs as **one Docker container**: [PocketBase](https://pocketbase.io)
(auth, SQLite, API rules, realtime) serving a Vue 3 app. No cloud services.

## What it does

- **Parts and stock:** a catalog of part types with a unit (pcs, sheets, m),
  spare quantities per site and In transit, low-stock alerts, optional unit
  prices (TWD, EUR, USD).
- **Movements:** stock in, stock out, move, install, uninstall, found
  installed. Validated on the server in one transaction; quantities never go
  negative; Undo for the newest movement within 24 hours.
- **History:** filterable by type, part, place and date, live across devices.
- **Hardware discovery:** `tools/stocky-collect.sh` reads a physical Linux
  machine (drives, memory, CPU, NICs, USB devices, Pi HATs, serial numbers)
  into a JSON snapshot. Upload it in Stocky, review a preview (new, missing,
  replaced, moved, conflicting items), and apply only what you confirm. Re-runs
  never double count; an import can be undone as a whole.
- **Your lists:** sites, hosts and categories are editable; new accounts start
  from a preset (`standard`, `example`, or your own in a JSON file).
- Phone first (bottom navigation), sidebar on wider screens, light and dark.
- **About** (ⓘ in the top bar, or Settings → About Stocky): version, tech
  stack, links, and a one-line diagnostics summary to paste into a bug report.

## Run it

```sh
mkdir -p pb_data                      # writable by uid/gid 1000
docker run -d --name stocky --restart unless-stopped \
  -p 127.0.0.1:5030:8080 -v "$PWD/pb_data:/pb/pb_data" 0xwulf/stocky:latest
docker exec -it stocky /pb/pocketbase superuser upsert you@example.com 'a-long-password'
```

Then open `http://127.0.0.1:5030/_/` (the PocketBase dashboard), create your
user account (there's no public sign-up), and sign in at
`http://127.0.0.1:5030/`. For HTTPS, a reverse proxy, mail and backups see
[docs/deploy.md](docs/deploy.md); for seed presets,
[docs/presets.md](docs/presets.md).

Images are built for `linux/amd64` and `linux/arm64` (Raspberry Pi 4/5).

## Discovery collector

```sh
tools/stocky-collect.sh --dry-run               # what it would read and run
tools/stocky-collect.sh -o "$(hostname).json"   # then: Stocky → Import
```

Read-only, plain Bash, no extra packages; refuses VMs and containers. See
[tools/README.md](tools/README.md) and the format in
[docs/discovery-schema.json](docs/discovery-schema.json).

## Develop

Node `^22.18` or `>=24.12`, and the PocketBase binary (pinned version in the
Dockerfile) for the server tests.

```sh
npm install
npm run dev                      # Vite; /api and /_ proxy to PocketBase on 127.0.0.1:8090
npm test                         # unit and component tests (Vitest)
npm run test:api -- --download   # all suites against throwaway PocketBase instances
docker build -t stocky:dev .
```

- `src/`: the Vue app (plain composables for state, vue-router).
- `pb_migrations/`, `pb_hooks/`: collections, API rules and the server routes.
- `spec.md`: the full specification and its decision log.

## License

[MIT](LICENSE)
