# syntax=docker/dockerfile:1
# Stocky: one image in which PocketBase serves the API, the dashboard (/_/)
# and the built Vue app (docs/deploy.md). Multi-arch via buildx: the web
# build runs natively on the build machine (dist/ is the same on every arch),
# and only the PocketBase binary is picked per TARGETARCH.
#
#   docker buildx build --platform linux/amd64,linux/arm64 -t 0xwulf/stocky .
#   docker build -t stocky:dev .            # local, this machine's arch

ARG NODE_VERSION=24.21
ARG ALPINE_VERSION=3.24
# keep in step with spec §12 #19 and scripts/test-api.sh
ARG PB_VERSION=0.40.4

# --- web: build dist/ ----------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js jsconfig.json ./
COPY public ./public
COPY src ./src
RUN npm run build

# --- pocketbase: download and verify the release binary ---------------------------
FROM --platform=$BUILDPLATFORM alpine:${ALPINE_VERSION} AS pocketbase
ARG PB_VERSION
ARG TARGETARCH
WORKDIR /dl
RUN set -eu; \
    zip="pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip"; \
    base="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}"; \
    wget -q "$base/$zip" "$base/checksums.txt"; \
    grep " ${zip}\$" checksums.txt | sha256sum -c -; \
    unzip -q "$zip" pocketbase; \
    chmod 0755 pocketbase

# --- runtime --------------------------------------------------------------------------
FROM alpine:${ALPINE_VERSION} AS runtime
ARG PB_VERSION
ARG VERSION=dev
ARG REVISION=unknown

LABEL org.opencontainers.image.title="Stocky" \
      org.opencontainers.image.description="Hardware stock manager: track what's installed in your machines and what's in stock. PocketBase + Vue in one container" \
      org.opencontainers.image.source="https://github.com/hexawulf/stocky" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      io.pocketbase.version="${PB_VERSION}"

# the About dialog's diagnostics show it (pb_hooks/about.pb.js)
ENV STOCKY_PB_VERSION=${PB_VERSION}

# non-root, uid/gid 1000 to match the usual owner of the bind-mounted pb_data
RUN addgroup -S -g 1000 stocky \
 && adduser -S -D -H -u 1000 -G stocky stocky \
 && mkdir -p /pb/pb_data \
 && chown stocky:stocky /pb/pb_data

COPY --from=pocketbase /dl/pocketbase /pb/pocketbase
COPY --from=web /app/dist /pb/pb_public
COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks

WORKDIR /pb
USER stocky
EXPOSE 8080
VOLUME ["/pb/pb_data"]

# busybox wget is part of alpine; /api/health needs no auth
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1

# Migrations apply on start. The 0.40.4 defaults for these three flags are all
# true: automigrate would write migration files whenever a collection is edited
# in the dashboard, dev logs every SQL statement, hooksWatch restarts on file
# changes (spec §12 #19). --indexFallback (SPA deep links) already defaults to true.
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8080", \
     "--dir=/pb/pb_data", "--publicDir=/pb/pb_public", \
     "--migrationsDir=/pb/pb_migrations", "--hooksDir=/pb/pb_hooks", \
     "--automigrate=false", "--dev=false", "--hooksWatch=false"]
