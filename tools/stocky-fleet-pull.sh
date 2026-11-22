#!/usr/bin/env bash
# Author:      0xWulf
# Description: stocky-fleet-pull — central read-only SSH collector for hosts
#              that cannot push directly to Stocky (e.g. Synology NASes,
#              isolated LAN or WireGuard tunnel nodes). Reads a hosts.conf
#              list, streams tools/stocky-collect.sh over SSH in read-only
#              mode, and pushes each snapshot to Stocky's /api/stocky/ingest.
# Usage:       stocky-fleet-pull.sh -c HOSTS_CONF --push URL --token-file FILE [--no-sudo] [--dry-run] [-h]
# Modified:    2026-11-22
set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
COLLECT="$ROOT/stocky-collect.sh"

conf=''
push_url=''
token_file=''
no_sudo=0
dry=0

usage() {
  sed -n 's/^# Usage: *//p' "$0"
  echo "  -c FILE           path to hosts.conf (one SSH target per line)"
  echo "  --push URL        Stocky base URL (e.g. https://stocky.example.com)"
  echo "  --token-file FILE path to ingest token file (or set STOCKY_TOKEN env)"
  echo "  --no-sudo         pass --no-sudo to remote collector"
  echo "  --dry-run         show targets that would be queried without connecting"
}

while [ $# -gt 0 ]; do
  case "$1" in
    -c) [ $# -ge 2 ] || { usage >&2; exit 2; }; conf=$2; shift ;;
    --push) [ $# -ge 2 ] || { usage >&2; exit 2; }; push_url=${2%/}; shift ;;
    --token-file) [ $# -ge 2 ] || { usage >&2; exit 2; }; token_file=$2; shift ;;
    --no-sudo) no_sudo=1 ;;
    --dry-run) dry=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[ -n "$conf" ] || { echo "error: -c HOSTS_CONF is required" >&2; usage >&2; exit 2; }
[ -r "$conf" ] || { echo "error: cannot read $conf" >&2; exit 1; }
[ -r "$COLLECT" ] || { echo "error: collector not found at $COLLECT" >&2; exit 1; }

LOG_DIR="${HOME:-/tmp}/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/stocky-fleet-pull_$(date +%Y%m%d_%H%M%S).log"
if [ -t 2 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != dumb ]; then
  c_info=$'\033[36m' c_warn=$'\033[33m' c_err=$'\033[31m' c_off=$'\033[0m'
else
  c_info='' c_warn='' c_err='' c_off=''
fi
log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >>"$LOG"; }
info() { printf '%s%s%s\n' "$c_info" "$*" "$c_off" >&2; log "INFO $*"; }
warn() { printf '%swarning: %s%s\n' "$c_warn" "$*" "$c_off" >&2; log "WARN $*"; }
die() { printf '%s%s%s\n' "$c_err" "$*" "$c_off" >&2; log "ERROR $*"; exit "${2:-1}"; }

tok="${STOCKY_TOKEN:-}"
if [ -n "$token_file" ]; then
  [ -r "$token_file" ] || die "cannot read token file: $token_file" 1
  tok=$(tr -d '\r\n[:space:]' <"$token_file")
fi
if [ $dry -eq 0 ]; then
  [ -n "$push_url" ] || die "--push URL is required" 2
  [ -n "$tok" ] || die "--token-file FILE or STOCKY_TOKEN env is required" 2
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

ok_count=0
fail_count=0
while IFS= read -r raw_line || [ -n "$raw_line" ]; do
  line=${raw_line%%#*}
  line=${line#"${line%%[![:space:]]*}"}
  line=${line%"${line##*[![:space:]]}"}
  [ -n "$line" ] || continue
  target=${line%%[[:space:]]*}
  extra_flags=${line#"$target"}
  extra_flags=${extra_flags#"${extra_flags%%[![:space:]]*}"}
  [ $no_sudo -eq 1 ] && extra_flags="$extra_flags --no-sudo"

  if [ $dry -eq 1 ]; then
    echo "would collect via SSH: $target ${extra_flags:+(flags: $extra_flags)} -> ${push_url:-stdout}"
    continue
  fi

  info "collecting from $target..."
  snap="$work/snap_${ok_count}.json"
  resp="$work/resp_${ok_count}.json"
  if ssh -o BatchMode=yes -o ConnectTimeout=10 "$target" "bash -s -- $extra_flags" <"$COLLECT" >"$snap" 2>>"$LOG"; then
    code=$(printf 'Authorization: Bearer %s\n' "$tok" | curl -sS -o "$resp" -w '%{http_code}' --connect-timeout 10 --max-time 30 -X POST "$push_url/api/stocky/ingest" -H 'Content-Type: application/json' -H @- --data-binary "@$snap" 2>>"$LOG" || echo 000)
    if [ "$code" = 200 ] || [ "$code" = 201 ]; then
      info "  $target -> pushed ok (HTTP $code)"
      ok_count=$((ok_count + 1))
    else
      warn "  $target -> ingest HTTP $code: $(head -c 200 "$resp")"
      fail_count=$((fail_count + 1))
    fi
  else
    warn "  $target -> SSH collection failed (see $LOG)"
    fail_count=$((fail_count + 1))
  fi
done <"$conf"

[ $dry -eq 1 ] && exit 0
info "fleet pull complete: $ok_count ok, $fail_count failed (log: $LOG)"
[ "$fail_count" -eq 0 ]
