#!/usr/bin/env bash
# Author:      0xWulf
# Description: Run Stocky's tests: npm test (Vitest), tools/test-collect.sh, then test-rules.sh, test-routes.sh,
#              test-stores.mjs, test-discovery.mjs,
#              each against its own throwaway PocketBase started from this
#              repo's pb_migrations/ and pb_hooks/ in a temp directory.
#              Nothing outside the temp directories is touched.
# Usage:       scripts/test-api.sh [--download] [--dry-run] [--only SUITE]
#                --download  fetch the pinned PocketBase into ~/.cache/stocky
#                            (checked against the release checksums.txt)
#                --dry-run   print what would run, start nothing
#                --only S    run just that server suite (e.g. test-discovery.mjs), no Vitest
#              PB_BIN=/path/to/pocketbase overrides the binary; PORT (default
#              8091) is the loopback port used for the test servers.
# Modified:    2026-10-05
set -euo pipefail

PB_VERSION=0.40.4 # keep in step with spec §12 #19 and the Dockerfile
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8091}
CACHE="$HOME/.cache/stocky"
LOG_DIR="$HOME/logs"
LOG="$LOG_DIR/stocky-test-api_$(date +%Y%m%d_%H%M%S).log"

SUITES="test-rules.sh test-routes.sh test-stores.mjs test-discovery.mjs"
download=0
dry=0
only=''
while [ $# -gt 0 ]; do
  case "$1" in
    --download) download=1 ;;
    --dry-run) dry=1 ;;
    --only)
      only=${2:-}
      case " $SUITES " in *" $only "*) ;; *) echo "--only needs one of: $SUITES" >&2; exit 2 ;; esac
      shift
      ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -t 1 ]; then
  green=$(printf '\033[32m'); red=$(printf '\033[31m'); off=$(printf '\033[0m')
else
  green=''; red=''; off=''
fi

arch() {
  case "$(uname -m)" in
    x86_64) echo amd64 ;;
    aarch64 | arm64) echo arm64 ;;
    *) echo "unsupported arch $(uname -m)" >&2; exit 2 ;;
  esac
}

fetch_pocketbase() {
  local a zip dir
  a=$(arch)
  zip="pocketbase_${PB_VERSION}_linux_${a}.zip"
  dir="$CACHE/$PB_VERSION"
  mkdir -p "$dir"
  curl -fsSL -o "$dir/$zip" "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/$zip"
  curl -fsSL -o "$dir/checksums.txt" "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/checksums.txt"
  # stdout is the function's result (the binary path), so the check reports on stderr
  (cd "$dir" && grep " $zip\$" checksums.txt | sha256sum -c - >&2)
  unzip -oq "$dir/$zip" pocketbase -d "$dir"
  echo "$dir/pocketbase"
}

# pick the binary: PB_BIN, the cache, PATH, or --download
if [ -n "${PB_BIN:-}" ]; then
  bin=$PB_BIN
elif [ -x "$CACHE/$PB_VERSION/pocketbase" ]; then
  bin="$CACHE/$PB_VERSION/pocketbase"
elif command -v pocketbase >/dev/null 2>&1; then
  bin=$(command -v pocketbase)
elif [ "$download" -eq 1 ]; then
  [ "$dry" -eq 1 ] && { echo "would download PocketBase $PB_VERSION to $CACHE"; bin="$CACHE/$PB_VERSION/pocketbase"; } || bin=$(fetch_pocketbase)
elif [ "$dry" -eq 1 ]; then
  bin='(none found: set PB_BIN, put it on PATH, or pass --download)'
else
  echo "no pocketbase binary: set PB_BIN, put it on PATH, or pass --download" >&2
  exit 2
fi

if [ "$dry" -eq 0 ]; then
  have=$("$bin" --version | awk '{print $3}')
  [ "$have" = "$PB_VERSION" ] || echo "warning: $bin is $have, pinned is $PB_VERSION" >&2
fi

if [ "$dry" -eq 1 ]; then
  echo "binary:  $bin"
  echo "suites:  ${only:-npm test, $SUITES} (one fresh instance each, 127.0.0.1:$PORT)"
  echo "log:     $LOG"
  exit 0
fi

mkdir -p "$LOG_DIR"
work=$(mktemp -d)
# the server's pid lives in a file: test-stores.mjs restarts the server and
# writes the new pid back, so cleanup always stops the right process
pidfile="$work/server.pid"
stop_server() {
  if [ -s "$pidfile" ]; then
    kill "$(cat "$pidfile")" 2>/dev/null || true
    sleep 0.5
    : >"$pidfile"
  fi
}
cleanup() {
  stop_server
  rm -rf "$work"
}
trap cleanup EXIT

# a tiny built app for the static-caching checks (pb_hooks/static_cache.pb.js)
public="$work/public"
mkdir -p "$public/assets"
cat >"$public/index.html" <<'HTML'
<!doctype html><html><head><title>Stocky</title>
<script type="module" src="/assets/index-test1234.js"></script></head>
<body><div id="app"></div></body></html>
HTML
echo 'console.log("stocky test asset")' >"$public/assets/index-test1234.js"
export STOCKY_PUBLIC_DIR="$public"

run_suite() {
  local suite=$1 data="$work/$1"
  mkdir -p "$data"
  echo "== $suite ==" >>"$LOG"
  "$bin" migrate up --dir="$data" --migrationsDir="$ROOT/pb_migrations" --automigrate=false --dev=false >>"$LOG" 2>&1
  "$bin" superuser upsert su@test.local SuperPass123 --dir="$data" >>"$LOG" 2>&1
  STOCKY_PB_VERSION="$PB_VERSION" "$bin" serve --http="127.0.0.1:$PORT" --dir="$data" --migrationsDir="$ROOT/pb_migrations" \
    --hooksDir="$ROOT/pb_hooks" --publicDir="$public" \
    --hooksWatch=false --automigrate=false --dev=false >>"$LOG" 2>&1 &
  echo $! >"$pidfile"
  for _ in $(seq 1 50); do
    curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break
    sleep 0.2
  done
  local status=0
  export PB_URL="http://127.0.0.1:$PORT" PB_DB="$data/data.db" PB_BIN="$bin" PB_DATA="$data" PB_PIDFILE="$pidfile"
  case "$suite" in
    *.mjs) node --experimental-eventsource --no-warnings "$ROOT/scripts/$suite" >"$work/$suite.out" 2>&1 || status=$? ;;
    *) bash "$ROOT/scripts/$suite" >"$work/$suite.out" 2>&1 || status=$? ;;
  esac
  cat "$work/$suite.out" >>"$LOG"
  stop_server
  grep '^FAIL' "$work/$suite.out" || true
  local summary
  summary=$(tail -1 "$work/$suite.out")
  if [ "$status" -eq 0 ]; then
    echo "${green}ok${off}    $suite  $summary"
  else
    echo "${red}FAIL${off}  $suite  $summary"
  fi
  return "$status"
}

overall=0
if [ -n "$only" ]; then
  run_suite "$only" || overall=1
  echo "log: $LOG"
  exit "$overall"
fi
# unit and component tests (Vitest, no server needed)
echo "== npm test ==" >>"$LOG"
if (cd "$ROOT" && npx vitest run --reporter=dot) >"$work/vitest.out" 2>&1; then
  echo "${green}ok${off}    npm test  $(grep -E '^ +Tests' "$work/vitest.out" | sed 's/^ *//')"
else
  overall=1
  grep -E 'FAIL|✗|×' "$work/vitest.out" | head -20 || true
  echo "${red}FAIL${off}  npm test  $(grep -E '^ +Tests' "$work/vitest.out" | sed 's/^ *//')"
fi
cat "$work/vitest.out" >>"$LOG"
# the discovery collector against fake machines (no server needed)
echo "== tools/test-collect.sh ==" >>"$LOG"
if "$ROOT/tools/test-collect.sh" >"$work/collect.out" 2>&1; then
  echo "${green}ok${off}    test-collect.sh  $(tail -1 "$work/collect.out")"
else
  overall=1
  grep '^FAIL' "$work/collect.out" || true
  echo "${red}FAIL${off}  test-collect.sh  $(tail -1 "$work/collect.out")"
fi
cat "$work/collect.out" >>"$LOG"
for suite in $SUITES; do
  run_suite "$suite" || overall=1
done
echo "log: $LOG"
exit "$overall"
