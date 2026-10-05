# Deploying Stocky

Stocky is one container: **PocketBase** (auth, SQLite, API rules, realtime)
serving the built Vue app, the API (`/api/*`) and the admin dashboard
(`/_/`) on one origin. The image holds no data, settings or credentials;
everything lives in the `pb_data` volume.

## Run it

```sh
mkdir -p pb_data            # must be writable by uid/gid 1000 (the container user)
docker compose up -d        # compose.yaml in this repo
docker exec -it stocky /pb/pocketbase superuser upsert <email> <password>
```

Or without compose:

```sh
docker run -d --name stocky --restart unless-stopped \
  -p 127.0.0.1:5030:8080 -v "$PWD/pb_data:/pb/pb_data" 0xwulf/stocky:latest
```

- Create the first superuser **right away**. Until one exists, the container
  log prints a one-time install link with a token that can create one: treat
  that log line as a secret.
- In the dashboard (`/_/`): create user accounts (there is no public
  sign-up), and set each account's `seedPreset` **before its first login**
  if it shouldn't get the `standard` lists (see [presets.md](presets.md)).
- Health check: `GET /api/health`. The image has a `HEALTHCHECK`.
- Images: `linux/amd64` and `linux/arm64`. Tags: `latest`, `vX.Y.Z`,
  `sha-<short>`.

## Behind a reverse proxy

Serve it over HTTPS on its own hostname and pass realtime through:
PocketBase pushes changes with **server-sent events**, which a buffering
proxy delays until the connection closes. Example for nginx:

```nginx
server {
    listen 443 ssl;
    server_name stocky.example.com;
    # ssl_certificate …; ssl_certificate_key …;

    client_max_body_size 1m;

    location / {
        proxy_pass http://<host-ip>:5030;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;          # realtime (SSE)
        proxy_read_timeout 1h;
    }
}
```

Consider keeping `/_/` (the dashboard) reachable only from your LAN or VPN.
If the proxy sets `X-Forwarded-For`, tell PocketBase to trust it (dashboard →
Settings → Application → "User IP proxy headers") so rate limits see real
client addresses.

## Mail (password reset)

Password-reset mail needs SMTP, set in the dashboard (Settings → Mail
settings). Without it PocketBase falls back to `sendmail`, which the image
doesn't include: no mail is sent, the request still answers with success,
and the failure shows only in the log. Until SMTP works, reset passwords in
the dashboard. Never put SMTP credentials in a file in this repo.

## Data, backups and updates

- `pb_data` holds the SQLite database and all settings. Back it up (or use
  PocketBase's scheduled backups into a directory your backup job copies).
- A new image applies its **migrations on start**. Take a backup before a
  release that changes the schema, or pin a version tag and update
  deliberately. Watchtower and similar updaters work, with that caveat.
- Your own seed presets go in `pb_data/stocky-presets.json`
  ([presets.md](presets.md)).

## Hardware discovery collector

`tools/stocky-collect.sh` reads one physical Linux machine and writes a JSON
snapshot to import in Stocky (top bar → Import). Copy it to the machine and
run it there; see [tools/README.md](../tools/README.md).

## Build it yourself

```sh
docker build -t stocky:dev .                                   # this machine's arch
docker buildx build --platform linux/amd64,linux/arm64 -t stocky:multi .
```

The Dockerfile builds the app in `node:24-alpine`, downloads the pinned
PocketBase release (checked against its `checksums.txt`), and runs it on
`alpine` as uid/gid 1000. Measured: about 40 MB unpacked, 16.5 MB
compressed, 20–40 MiB RAM.

## Development

```sh
npm install
npm run dev        # Vite with HMR; /api and /_ proxy to 127.0.0.1:8090
npm test           # Vitest
npm run test:api   # everything, against throwaway PocketBase instances
                   # (add -- --download the first time)
```

Run PocketBase for dev at `127.0.0.1:8090` with this repo's
`pb_migrations/` and `pb_hooks/` (the release binary, or the image with a
local `pb_data`).
