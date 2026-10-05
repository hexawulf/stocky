# Stocky

**Know what's in your machines, and what's in stock.**

Stocky is a small, mobile-first, self-hosted inventory for homelab hardware:
spare parts at one or more sites, what's on its way between them (In transit),
and what's installed in which machine. Every change is a dated movement,
validated on the server, so quantities never go negative and the numbers can
always be explained. You can undo the newest movement within 24 hours. One
container: [PocketBase](https://pocketbase.io) (auth, SQLite, API rules,
realtime) serving a Vue 3 app. No cloud services, no telemetry.

Source, issues and docs: **[github.com/hexawulf/stocky](https://github.com/hexawulf/stocky)**

## Quick start

```sh
mkdir -p pb_data
sudo chown 1000:1000 pb_data          # the container runs as uid/gid 1000
docker run -d --name stocky --restart unless-stopped \
  -p 8080:8080 -v "$PWD/pb_data:/pb/pb_data" 0xwulf/stocky:latest

# first superuser (PocketBase dashboard admin)
docker exec -it stocky /pb/pocketbase superuser upsert you@example.com 'a-long-password'
```

The data directory must exist before the first start and be writable by uid
1000, or PocketBase can't create its database.

Until a superuser exists, PocketBase prints a one-time install link with a
token in the container log (`docker logs stocky`). **Treat that link as a
secret.** Anyone who opens it can create the admin account. Create the
superuser right after the first start, as shown above.

Then open `http://<host>:8080/_/` (the dashboard), create your user account
(there is no public sign-up), and sign in at `http://<host>:8080/`.

## Docker Compose

```yaml
services:
  stocky:
    image: 0xwulf/stocky:latest # or pin X.Y.Z to update deliberately
    container_name: stocky
    restart: unless-stopped
    ports:
      - '127.0.0.1:5030:8080' # put a TLS reverse proxy in front
    volumes:
      - ./pb_data:/pb/pb_data
    mem_limit: 128m
```

```sh
mkdir -p pb_data && sudo chown 1000:1000 pb_data
docker compose up -d
docker exec -it stocky /pb/pocketbase superuser upsert you@example.com 'a-long-password'
```

## Tags and platforms

| Tag      | Meaning                                         |
| -------- | ----------------------------------------------- |
| `X.Y.Z`  | one exact release, e.g. `0.1.1`                 |
| `X.Y`    | the newest patch release of that minor line     |
| `latest` | the newest release (pre-releases never move it) |

- Platforms: `linux/amd64` and `linux/arm64` (Raspberry Pi 4/5) in one
  multi-arch manifest.
- Images are built and pushed by
  [GitHub Actions](https://github.com/hexawulf/stocky/actions/workflows/release.yml)
  from GPG-signed git tags, only after the full test suite passes on that tag.
- Each image carries **SBOM** and **SLSA provenance** attestations:
  `docker buildx imagetools inspect 0xwulf/stocky:latest --format '{{ json .Provenance }}'`
  (or `.SBOM`).
- OCI labels give the version, the source commit (`org.opencontainers.image.revision`)
  and the bundled PocketBase version (`io.pocketbase.version`).

## Container details

| Item        | Value                                                                  |
| ----------- | ---------------------------------------------------------------------- |
| Port        | `8080` (app, API `/api/`, dashboard `/_/`)                             |
| Volume      | `/pb/pb_data`: SQLite database and settings. All state lives here.     |
| User        | non-root `stocky`, uid/gid `1000`                                      |
| Healthcheck | `GET /api/health` every 30 s                                           |
| Base        | Alpine; PocketBase release binary verified against its `checksums.txt` |
| Size        | about 17 MB compressed, 20–40 MiB RAM idle                             |

Migrations apply on start, so **back up `pb_data` before upgrading** to a
release that changes the schema (see the
[changelog](https://github.com/hexawulf/stocky/blob/main/CHANGELOG.md)).

**Reverse proxy:** serve Stocky over HTTPS on its own hostname. Realtime updates
use **server-sent events (SSE)**: turn off response buffering for the proxied
location (nginx: `proxy_buffering off;`, `proxy_http_version 1.1;`,
`proxy_set_header Connection '';`, a long `proxy_read_timeout`), or changes
appear only after a reload. A full nginx example, trusting `X-Forwarded-For`,
mail (SMTP for password reset) and backups are in
[docs/deploy.md](https://github.com/hexawulf/stocky/blob/main/docs/deploy.md#behind-a-reverse-proxy).

## Hardware discovery

[`tools/stocky-collect.sh`](https://github.com/hexawulf/stocky/blob/main/tools/README.md)
reads a physical Linux machine (drives, memory, CPU, NICs, USB devices, Pi
HATs, serial numbers) into a JSON snapshot. It's read-only, plain Bash and
needs no extra packages. Upload the snapshot in Stocky (Import), review the
preview (new, missing, replaced, moved, conflicting) and apply only what you
confirm. Re-runs never double count; an import can be undone as a whole.
Format: [docs/discovery-schema.json](https://github.com/hexawulf/stocky/blob/main/docs/discovery-schema.json).

## Links

- GitHub: https://github.com/hexawulf/stocky
- Specification: https://github.com/hexawulf/stocky/blob/main/spec.md
- Deployment guide: https://github.com/hexawulf/stocky/blob/main/docs/deploy.md
- Seed presets: https://github.com/hexawulf/stocky/blob/main/docs/presets.md
- Changelog: https://github.com/hexawulf/stocky/blob/main/CHANGELOG.md
- Issues: https://github.com/hexawulf/stocky/issues
- Licence: [MIT](https://github.com/hexawulf/stocky/blob/main/LICENSE)
