#!/usr/bin/env bash
# Author:      0xWulf
# Description: Build Stocky (npm run build), start a throwaway PocketBase instance
#              serving dist/ + pb_migrations/ + pb_hooks/, seed a test account,
#              and run Playwright E2E smoke tests (e2e/smoke.spec.mjs).
#              If STOCKY_BASE_URL is already set, runs Playwright directly against it.
# Usage:       scripts/test-e2e.sh [--screenshots]
# Modified:    2026-11-22
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${STOCKY_E2E_PORT:-8097}
PB_VERSION=0.40.6
CACHE="$HOME/.cache/stocky"
LOG_DIR="$HOME/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/stocky-test-e2e_$(date +%Y%m%d_%H%M%S).log"

if [ -n "${STOCKY_BASE_URL:-}" ]; then
  cd "$ROOT"
  exec npx playwright test "$@"
fi

if [ -n "${PB_BIN:-}" ]; then
  bin=$PB_BIN
elif [ -x "$CACHE/$PB_VERSION/pocketbase" ]; then
  bin="$CACHE/$PB_VERSION/pocketbase"
elif command -v pocketbase >/dev/null 2>&1; then
  bin=$(command -v pocketbase)
else
  "$ROOT/scripts/test-api.sh" --download --dry-run >/dev/null
  bin="$CACHE/$PB_VERSION/pocketbase"
fi

echo "== building frontend dist/ ==" >>"$LOG"
(cd "$ROOT" && npm run build) >>"$LOG" 2>&1

work=$(mktemp -d)
pid=''
cleanup() {
  [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

data="$work/pb_data"
public="$work/pb_public"
mkdir -p "$data" "$public/tools"
cp -a "$ROOT/dist/." "$public/"
cp "$ROOT/tools/stocky-collect.sh" "$public/tools/stocky-collect.sh"
(cd "$public/tools" && sha256sum stocky-collect.sh >stocky-collect.sh.sha256)

export STOCKY_PUBLIC_DIR="$public"
"$bin" migrate up --dir="$data" --migrationsDir="$ROOT/pb_migrations" --automigrate=false --dev=false >>"$LOG" 2>&1
"$bin" superuser upsert su@test.local SuperPass123 --dir="$data" >>"$LOG" 2>&1
STOCKY_PB_VERSION="$PB_VERSION" "$bin" serve --http="127.0.0.1:$PORT" --dir="$data" \
  --migrationsDir="$ROOT/pb_migrations" --hooksDir="$ROOT/pb_hooks" --publicDir="$public" \
  --hooksWatch=false --automigrate=false --dev=false >>"$LOG" 2>&1 &
pid=$!

for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break
  sleep 0.2
done

export STOCKY_BASE_URL="http://127.0.0.1:$PORT"
cd "$ROOT"
npx playwright test "$@"
