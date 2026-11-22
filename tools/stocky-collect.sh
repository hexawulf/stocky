#!/usr/bin/env bash
# Author:      0xWulf
# Description: stocky-collect — a read-only hardware snapshot for Stocky's
#              discovery import and automated fleet ingest (spec §13.2).
#              Prints JSON (schema stocky.discovery/2, docs/discovery-schema.json)
#              to stdout, -o FILE, or pushes directly via --push BASE_URL.
#              Supports bare-metal Linux, SBCs (Raspberry Pi), KVM/cloud VPSes,
#              Synology DSM NASes, and WSL2 (--physical-only restores v1 VM refusal).
#              Writes nothing but the JSON and its log
#              (~/logs/stocky-collect_YYYYMMDD_HHMMSS.log). Needs no extra
#              packages; uses smartctl, lspci, lsusb and nvidia-smi only if present.
#              sudo is used for two read-only commands only, never with a
#              prompt (sudo -n): dmidecode (memory modules, board and system
#              serials on x86) and smartctl (drive serials and SMART health).
#              --no-sudo skips them.
# Source:      https://github.com/hexawulf/stocky tools/stocky-collect.sh
# Usage:       stocky-collect.sh [-o FILE] [--push URL] [--token-file FILE] [--no-sudo] [--physical-only] [--print-systemd] [--print-cron] [--dry-run] [-h] [--version]
# Exit codes:  0 ok, 1 error, 2 usage, 3 virtual machine or container (with --physical-only)
# Modified:    2026-11-22
set -euo pipefail

VERSION=2.0.0
SCHEMA=stocky.discovery/2
MAX_ITEMS=200

# For tests only: read /sys, /proc and /etc under this directory instead of /
# (tools/test-collect.sh builds fake machines there). Commands come from PATH.
R=${STOCKY_COLLECT_ROOT:-}

out=''
push_url=''
token_file=''
use_sudo=1
physical_only=0
print_systemd=0
print_cron=0
dry=0

usage() {
  sed -n 's/^# Usage: *//p' "$0"
  echo "  -o FILE           write the JSON to FILE instead of stdout"
  echo "  --push URL        POST snapshot to <URL>/api/stocky/ingest"
  echo "  --token-file FILE read ingest bearer token from FILE (or set STOCKY_TOKEN env)"
  echo "  --no-sudo         skip the two sudo commands (dmidecode, smartctl)"
  echo "  --physical-only   refuse VMs, cloud VPSes, containers and WSL (exit 3)"
  echo "  --print-systemd   print ready-to-install systemd user timer & service units"
  echo "  --print-cron      print ready-to-install crontab snippet"
  echo "  --dry-run         print what would be read and run, collect nothing"
}

while [ $# -gt 0 ]; do
  case "$1" in
    -o)
      [ $# -ge 2 ] || { usage >&2; exit 2; }
      out=$2
      shift
      ;;
    --push)
      [ $# -ge 2 ] || { usage >&2; exit 2; }
      push_url=${2%/}
      shift
      ;;
    --token-file)
      [ $# -ge 2 ] || { usage >&2; exit 2; }
      token_file=$2
      shift
      ;;
    --token | --token=*)
      echo "error: raw tokens on the command line are refused (visible in ps); use --token-file FILE or STOCKY_TOKEN env" >&2
      exit 2
      ;;
    --no-sudo) use_sudo=0 ;;
    --physical-only) physical_only=1 ;;
    --print-systemd) print_systemd=1 ;;
    --print-cron) print_cron=1 ;;
    --dry-run) dry=1 ;;
    -h | --help) usage; exit 0 ;;
    --version) echo "stocky-collect $VERSION"; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [ $print_systemd -eq 1 ]; then
  target_url=${push_url:-https://stocky.example.com}
  tfile=${token_file:-~/.config/stocky/ingest.token}
  cat <<EOF
# ~/.config/systemd/user/stocky-collect.service
[Unit]
Description=Stocky hardware discovery snapshot push
After=network-online.target

[Service]
Type=oneshot
ExecStart=$HOME/bin/stocky-collect.sh --push $target_url --token-file $tfile

# ~/.config/systemd/user/stocky-collect.timer
[Unit]
Description=Run Stocky hardware discovery daily and after boot

[Timer]
OnBootSec=5min
OnCalendar=daily
Persistent=true
RandomizedDelaySec=15min

[Install]
WantedBy=timers.target
EOF
  exit 0
fi

if [ $print_cron -eq 1 ]; then
  target_url=${push_url:-https://stocky.example.com}
  tfile=${token_file:-~/.config/stocky/ingest.token}
  cat <<EOF
# Stocky hardware discovery — daily at 04:15 + 5 min after reboot
15 4 * * * $HOME/bin/stocky-collect.sh --push $target_url --token-file $tfile >/dev/null 2>&1
@reboot sleep 300 && $HOME/bin/stocky-collect.sh --push $target_url --token-file $tfile >/dev/null 2>&1
EOF
  exit 0
fi

# --- messages and log -------------------------------------------------------------------
LOG_DIR="${HOME:-/tmp}/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/stocky-collect_$(date +%Y%m%d_%H%M%S).log"
if [ -t 2 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != dumb ]; then
  c_info=$'\033[36m' c_warn=$'\033[33m' c_err=$'\033[31m' c_off=$'\033[0m'
else
  c_info='' c_warn='' c_err='' c_off=''
fi
log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >>"$LOG"; }
info() { printf '%s%s%s\n' "$c_info" "$*" "$c_off" >&2; log "INFO $*"; }
warn() { printf '%swarning: %s%s\n' "$c_warn" "$*" "$c_off" >&2; log "WARN $*"; }
die() { printf '%s%s%s\n' "$c_err" "$*" "$c_off" >&2; log "ERROR $*"; exit "${2:-1}"; }
have() { command -v "$1" >/dev/null 2>&1; }
join_list() { # "a, b"
  local out='' x
  for x in "$@"; do out+="${out:+, }$x"; done
  printf '%s' "$out"
}

log "stocky-collect $VERSION root=${R:-/} sudo=$use_sudo physical_only=$physical_only dry=$dry"

# --- small readers -----------------------------------------------------------------------
rd() {
  local f="$R$1"
  [ -r "$f" ] || return 0
  local v
  v=$(tr -d '\000' <"$f" 2>/dev/null | head -n 1) || true
  v=${v#"${v%%[![:space:]]*}"}
  v=${v%"${v##*[![:space:]]}"}
  printf '%s' "$v"
}
rf() {
  [ -r "$1" ] || return 0
  tr -d '\000' <"$1" 2>/dev/null | head -n 1 || true
}
trim() {
  local v=$1
  v=${v#"${v%%[![:space:]]*}"}
  printf '%s' "${v%"${v##*[![:space:]]}"}"
}
placeholder() {
  case "${1,,}" in
    '' | 'to be filled by o.e.m.' | 'default string' | 'not specified' | 'not available' | \
      'system serial number' | 'none' | 'unknown' | '0' | '00000000' | '0123456789' | \
      'serial number' | 'base board serial number' | 'n/a' | 'no asset tag' | \
      'system product name' | 'system manufacturer' | 'o.e.m.' | 'oem' | 'sernum'*) return 0 ;;
  esac
  return 1
}

# --- JSON -----------------------------------------------------------------------------------
json_str() {
  local s=$1
  if have iconv; then s=$(printf '%s' "$s" | iconv -c -f UTF-8 -t UTF-8 2>/dev/null) || true; fi
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  case "$s" in
    *[$'\001'-$'\037']* | *$'\177'*)
      local out='' c i LC_ALL=C
      for ((i = 0; i < ${#s}; i++)); do
        c=${s:i:1}
        case "$c" in
          $'\n') out+='\n' ;;
          $'\r') out+='\r' ;;
          $'\t') out+='\t' ;;
          [$'\001'-$'\037'] | $'\177') out+=$(printf '\\u%04x' "'$c") ;;
          *) out+=$c ;;
        esac
      done
      s=$out
      ;;
  esac
  printf '"%s"' "$s"
}

# fields for one object: obj k1 v1 k2 v2 ... ; empty values are left out;
# a key ending in '#' is a number, '?' a boolean, '@' raw pre-encoded JSON
obj() {
  local first=1 k v body=''
  while [ $# -ge 2 ]; do
    k=$1 v=$2
    shift 2
    [ -n "$v" ] || continue
    case "$k" in
      *'#') [[ $v =~ ^[0-9]+$ ]] || continue; k=${k%'#'}; v=$((10#$v)) ;;
      *'?') k=${k%'?'}; [ "$v" = true ] || v=false ;;
      *'@') k=${k%'@'} ;; # already JSON
      raw) ;; # already JSON
      *) v=$(json_str "$v") ;;
    esac
    [ $first -eq 1 ] || body+=', '
    body+="$(json_str "$k"): $v"
    first=0
  done
  printf '{%s}' "$body"
}
raw() {
  local first=1 body='' k v
  while [ $# -ge 2 ]; do
    k=$1 v=$2
    shift 2
    [ -n "$v" ] || continue
    [ $first -eq 1 ] || body+=', '
    body+="$(json_str "$k"): $(json_str "$v")"
    first=0
  done
  [ -n "$body" ] && printf '{%s}' "$body"
  return 0
}
join() {
  local sep=$1 first=1 x
  shift
  for x in "$@"; do
    [ -n "$x" ] || continue
    [ $first -eq 1 ] || printf '%s' "$sep"
    printf '%s' "$x"
    first=0
  done
}

items=()
skipped=()
warnings=()
add_item() {
  if [ ${#items[@]} -ge $MAX_ITEMS ]; then
    [ ${#items[@]} -eq $MAX_ITEMS ] && warnings+=("$(json_str "more than $MAX_ITEMS items; the rest were left out")")
    items+=('')
    return
  fi
  items+=("$1")
}
skip() { skipped+=("$(obj kind "$1" reason "$2")"); warn "$1 skipped: $2"; }
note() { warnings+=("$(json_str "$1")"); warn "$1"; }

# --- sudo ---------------------------------------------------------------------------------
as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif [ $use_sudo -eq 1 ] && have sudo; then
    sudo -n "$@"
  else
    return 1
  fi
}
why_no_root() {
  if [ $use_sudo -eq 0 ]; then echo 'needs sudo (--no-sudo given)'; else echo 'needs sudo (sudo -n is not allowed without a password here)'; fi
}

# --- environment & virtualization classification ------------------------------------------
virt_label=''
virtual_bool=false
virtual_type='bare-metal'

if [ -r "$R/etc/synoinfo.conf" ] || [ -r "$R/etc.defaults/synoinfo.conf" ]; then
  virtual_bool=false
  virtual_type='nas'
elif grep -qi microsoft "$R/proc/sys/kernel/osrelease" 2>/dev/null || grep -qi microsoft "$R/proc/version" 2>/dev/null; then
  virt_label='WSL'
  virtual_bool=true
  virtual_type='wsl'
elif [ -e "$R/.dockerenv" ] || [ -e "$R/run/.containerenv" ]; then
  virt_label='container'
  virtual_bool=true
  virtual_type='lxc'
fi

if [ "$virtual_type" = 'bare-metal' ] && have systemd-detect-virt; then
  v=$(systemd-detect-virt --vm 2>/dev/null || true)
  if [ -n "$v" ] && [ "$v" != none ]; then
    virt_label="virtual machine ($v)"
    virtual_bool=true
    case "$v" in
      kvm | qemu) virtual_type='kvm' ;;
      vmware) virtual_type='vmware' ;;
      microsoft | hyperv) virtual_type='hyperv' ;;
      xen) virtual_type='xen' ;;
      *) virtual_type='unknown' ;;
    esac
  else
    vc=$(systemd-detect-virt --container 2>/dev/null || true)
    if [ -n "$vc" ] && [ "$vc" != none ]; then
      virt_label="container ($vc)"
      virtual_bool=true
      case "$vc" in
        wsl) virtual_type='wsl' ;;
        *) virtual_type='lxc' ;;
      esac
    fi
  fi
fi

dmi_all="$(rd /sys/class/dmi/id/sys_vendor) $(rd /sys/class/dmi/id/product_name) $(rd /sys/class/dmi/id/board_vendor)"
case "${dmi_all,,}" in
  *digitalocean* | *hetzner* | *linode* | *akamai* | *'amazon ec2'* | *'google compute engine'* | *vultr* | *upcloud* | *scaleway* | *ovh* | *openstack*)
    [ -n "$virt_label" ] || virt_label="virtual machine ($(trim "$dmi_all"))"
    virtual_bool=true
    [ "$virtual_type" = 'bare-metal' ] && virtual_type='cloud'
    ;;
  *vmware*)
    [ -n "$virt_label" ] || virt_label="virtual machine ($(trim "$dmi_all"))"
    virtual_bool=true
    [ "$virtual_type" = 'bare-metal' ] && virtual_type='vmware'
    ;;
  *hyper-v* | *'microsoft corporation'*'virtual machine'*)
    [ -n "$virt_label" ] || virt_label="virtual machine ($(trim "$dmi_all"))"
    virtual_bool=true
    [ "$virtual_type" = 'bare-metal' ] && virtual_type='hyperv'
    ;;
  *xen*)
    [ -n "$virt_label" ] || virt_label="virtual machine ($(trim "$dmi_all"))"
    virtual_bool=true
    [ "$virtual_type" = 'bare-metal' ] && virtual_type='xen'
    ;;
  *kvm* | *qemu* | *bochs* | *virtualbox* | *innotek* | *'virtual machine'* | *parallels*)
    [ -n "$virt_label" ] || virt_label="virtual machine ($(trim "$dmi_all"))"
    virtual_bool=true
    [ "$virtual_type" = 'bare-metal' ] && virtual_type='kvm'
    ;;
esac

if [ $physical_only -eq 1 ] && [ "$virtual_bool" = true ]; then
  die "${virt_label:-virtual machine}: Stocky tracks physical hardware only" 3
fi

# --- what sudo would run here ------------------------------------------------------------
platform=$(uname -m)
x86=0
case "$platform" in x86_64 | i?86) x86=1 ;; esac
sudo_plan=()
[ $x86 -eq 1 ] && [ "$virtual_bool" = false ] && have dmidecode && sudo_plan+=('dmidecode (memory modules, board and system serials)')
have smartctl && sudo_plan+=('smartctl (drive serials and SMART health)')
sudo_text=$(join_list "${sudo_plan[@]+"${sudo_plan[@]}"}")

# --- dry run --------------------------------------------------------------------------------
if [ $dry -eq 1 ]; then
  info "stocky-collect $VERSION, dry run: nothing is collected or written"
  echo "would read: /sys/class/dmi/id, /proc/device-tree, /proc/cpuinfo, /proc/meminfo, /proc/uptime, /etc/os-release, /sys/class/net, /sys/block, /sys/bus/usb/devices, /etc/machine-id (hashed)"
  echo "would run:  lsblk, lscpu, uname$(have lspci && echo ', lspci')$(have lsusb && echo ', lsusb')$(have nvidia-smi && echo ', nvidia-smi')"
  if [ $use_sudo -eq 0 ]; then
    echo "no sudo (--no-sudo): ${sudo_text:-nothing here would need it}"
  elif [ -n "$sudo_text" ]; then
    echo "with sudo -n (never prompts): $sudo_text"
  else
    echo "with sudo: nothing on this platform ($platform)"
  fi
  echo "output:     ${out:-stdout}${push_url:+ (push to $push_url)}; log: $LOG"
  exit 0
fi

if [ $use_sudo -eq 1 ] && [ "$(id -u)" -ne 0 ] && [ -n "$sudo_text" ]; then
  info "sudo -n (no prompt) for: $sudo_text; use --no-sudo to skip"
fi

# --- host & OS telemetry --------------------------------------------------------------------
hostname=$(rd /proc/sys/kernel/hostname)
[ -n "$hostname" ] || hostname=$(hostname 2>/dev/null || true)
machine_id=$(rd /etc/machine-id)
mid=''
if [ -n "$machine_id" ] && have sha256sum; then
  mid="sha256:$(printf '%s' "$machine_id" | sha256sum | cut -d' ' -f1)"
fi

syno_model=''
syno_serial=''
if [ -r "$R/etc.defaults/synoinfo.conf" ]; then
  syno_model=$(sed -n 's/^upnpmodelname="\([^"]*\)".*/\1/p' "$R/etc.defaults/synoinfo.conf" 2>/dev/null | head -n 1)
  [ -n "$syno_model" ] || syno_model=$(sed -n 's/^unique="synology_[^_]*_\([^"]*\)".*/DS\1/p' "$R/etc.defaults/synoinfo.conf" 2>/dev/null | head -n 1)
fi
if [ -z "$syno_model" ] && [ -r "$R/etc/synoinfo.conf" ]; then
  syno_model=$(sed -n 's/^unique="synology_[^_]*_\([^"]*\)".*/DS\1/p' "$R/etc/synoinfo.conf" 2>/dev/null | head -n 1)
  [ -n "$syno_model" ] || syno_model=$(sed -n 's/^upnpmodelname="\([^"]*\)".*/\1/p' "$R/etc/synoinfo.conf" 2>/dev/null | head -n 1)
fi
if [ -r "$R/proc/sys/kernel/syno_serial" ]; then
  syno_serial=$(rd /proc/sys/kernel/syno_serial)
fi

dt_model=$(rd /proc/device-tree/model)
sys_vendor=$(rd /sys/class/dmi/id/sys_vendor)
product=$(rd /sys/class/dmi/id/product_name)
if [ -n "$syno_model" ]; then
  host_model="Synology $syno_model"
elif [ -n "$dt_model" ]; then
  host_model=$dt_model
elif ! placeholder "$product"; then
  host_model=$(trim "$sys_vendor $product")
else
  host_model=$(trim "$(rd /sys/class/dmi/id/board_vendor) $(rd /sys/class/dmi/id/board_name)")
fi
if [ -z "$host_model" ] && [ "$virtual_type" = 'wsl' ]; then
  host_model='WSL2 Virtual Machine'
fi
is_pi=0
case "$dt_model" in *'Raspberry Pi'*) is_pi=1 ;; esac

# OS / Kernel / Uptime
os_name=''
os_version=''
if [ -r "$R/etc/os-release" ]; then
  os_name=$(sed -n 's/^NAME="\?\([^"]*\)"\?$/\1/p' "$R/etc/os-release" 2>/dev/null | head -n 1)
  os_version=$(sed -n 's/^VERSION_ID="\?\([^"]*\)"\?$/\1/p' "$R/etc/os-release" 2>/dev/null | head -n 1)
  [ -n "$os_version" ] || os_version=$(sed -n 's/^VERSION="\?\([^"]*\)"\?$/\1/p' "$R/etc/os-release" 2>/dev/null | head -n 1)
fi
if [ "$virtual_type" = 'nas' ] && [ -r "$R/etc.defaults/VERSION" ]; then
  dsm_ver=$(sed -n 's/^productversion="\([^"]*\)".*/\1/p' "$R/etc.defaults/VERSION" 2>/dev/null | head -n 1)
  dsm_build=$(sed -n 's/^buildnumber="\([^"]*\)".*/\1/p' "$R/etc.defaults/VERSION" 2>/dev/null | head -n 1)
  os_name='Synology DSM'
  os_version="${dsm_ver}${dsm_build:+-$dsm_build}"
fi
kernel_ver=$(rd /proc/sys/kernel/osrelease)
[ -n "$kernel_ver" ] || kernel_ver=$(uname -r 2>/dev/null || true)
os_json=$(obj name "$os_name" version "$os_version" kernel "$kernel_ver")

uptime_sec=''
if [ -r "$R/proc/uptime" ]; then
  up_raw=$(rd /proc/uptime)
  uptime_sec=${up_raw%%[\. ]*}
fi

dmidecode_ok() { [ $x86 -eq 1 ] && [ "$virtual_bool" = false ] && have dmidecode; }
dmi_s() {
  local v
  v=$(as_root dmidecode -s "$1" 2>/dev/null | head -n 1) || return 0
  v=$(trim "$v")
  placeholder "$v" || printf '%s' "$v"
}

# --- system ----------------------------------------------------------------------------------
sys_mem_bytes=''
if [ -n "$syno_model" ]; then
  add_item "$(obj kind system vendor 'Synology' model "Synology $syno_model" serial "$syno_serial")"
elif [ -n "$dt_model" ]; then
  serial=$(rd /proc/device-tree/serial-number)
  mem=''
  revision=$(sed -n 's/^Revision[[:space:]]*:[[:space:]]*//p' "$R/proc/cpuinfo" 2>/dev/null | head -n 1)
  if [[ $revision =~ ^[0-9a-fA-F]+$ ]] && (((16#$revision >> 23) & 1)); then
    mem=$(((256 << ((16#$revision >> 20) & 7)) * 1048576))
    sys_mem_bytes=$mem
  fi
  vendor=''
  [ $is_pi -eq 1 ] && vendor='Raspberry Pi Ltd'
  add_item "$(obj kind system vendor "$vendor" model "$dt_model" serial "$serial" 'memoryBytes#' "$mem" raw "$(raw revision "$revision")")"
else
  serial=''
  if dmidecode_ok; then
    serial=$(dmi_s system-serial-number) || true
    [ -n "$serial" ] || as_root true 2>/dev/null || note "system serial $(why_no_root)"
  fi
  if ! placeholder "$product"; then
    add_item "$(obj kind system vendor "$sys_vendor" model "$product" serial "$serial" raw "$(raw version "$(rd /sys/class/dmi/id/product_version)")")"
  fi
  board_vendor=$(rd /sys/class/dmi/id/board_vendor)
  board_name=$(rd /sys/class/dmi/id/board_name)
  if [ -n "$board_name" ] && ! placeholder "$board_name"; then
    bserial=''
    dmidecode_ok && bserial=$(dmi_s baseboard-serial-number)
    add_item "$(obj kind board vendor "$board_vendor" model "$board_name" serial "$bserial" raw "$(raw version "$(rd /sys/class/dmi/id/board_version)")")"
  fi
fi

# --- cpu --------------------------------------------------------------------------------------
cpu_summary_json=''
if have lscpu; then
  cpu_text=$(LC_ALL=C lscpu 2>/dev/null || true)
  field() { sed -n "s/^$1:[[:space:]]*//p" <<<"$cpu_text" | head -n 1; }
  cpu_model=$(field 'Model name')
  cpu_vendor=$(field 'Vendor ID')
  sockets=$(field 'Socket(s)')
  cores=$(field 'Core(s) per socket')
  [ -n "$cores" ] || cores=$(field 'Core(s) per cluster')
  logical=$(field 'CPU(s)')
  max_mhz=$(field 'CPU max MHz')
  max_mhz=${max_mhz%%.*}
  case "$cpu_vendor" in
    GenuineIntel) cpu_vendor=Intel ;;
    AuthenticAMD) cpu_vendor=AMD ;;
  esac
  [[ $sockets =~ ^[0-9]+$ ]] || sockets=1
  phys_cores=''
  if [[ $cores =~ ^[0-9]+$ ]]; then
    phys_cores=$((cores * sockets))
  elif [[ $logical =~ ^[0-9]+$ ]]; then
    phys_cores=$logical
  fi
  [[ $logical =~ ^[0-9]+$ ]] || logical=$phys_cores
  if [ -n "$cpu_model" ]; then
    for ((i = 0; i < sockets && i < 8; i++)); do
      add_item "$(obj kind cpu vendor "$cpu_vendor" model "$cpu_model" slot "$([ "$sockets" -gt 1 ] && echo "socket $i")" raw "$(raw cores "${cores:-}" architecture "$(field Architecture)")")"
    done
    cpu_summary_json=$(obj model "$cpu_model" 'physicalCores#' "$phys_cores" 'logicalCores#' "$logical" 'maxMhz#' "$max_mhz")
  fi
elif [ -r "$R/proc/cpuinfo" ]; then
  cpu_model=$(sed -n 's/^model name[[:space:]]*:[[:space:]]*//p' "$R/proc/cpuinfo" 2>/dev/null | head -n 1)
  cpu_vendor=$(sed -n 's/^vendor_id[[:space:]]*:[[:space:]]*//p' "$R/proc/cpuinfo" 2>/dev/null | head -n 1)
  cores=$(sed -n 's/^cpu cores[[:space:]]*:[[:space:]]*//p' "$R/proc/cpuinfo" 2>/dev/null | head -n 1)
  logical=$(grep -c '^processor[[:space:]]*:' "$R/proc/cpuinfo" 2>/dev/null || true)
  [ -n "$cores" ] || cores=$logical
  case "$cpu_vendor" in
    GenuineIntel) cpu_vendor=Intel ;;
    AuthenticAMD) cpu_vendor=AMD ;;
  esac
  if [ -n "$cpu_model" ]; then
    add_item "$(obj kind cpu vendor "$cpu_vendor" model "$cpu_model" raw "$(raw cores "${cores:-}" architecture "$platform")")"
    cpu_summary_json=$(obj model "$cpu_model" 'physicalCores#' "$cores" 'logicalCores#' "$logical")
  else
    skip cpu 'lscpu not found'
  fi
else
  skip cpu 'lscpu not found'
fi

# --- memory (x86 dmidecode + /proc/meminfo summary) -------------------------------------------
dmi_mem_total=0
if [ $x86 -eq 1 ] && [ "$virtual_bool" = false ]; then
  if ! have dmidecode; then
    skip memory 'dmidecode not installed'
  elif mem_text=$(as_root dmidecode -t 17 2>/dev/null); then
    while IFS=$'\037' read -r size type speed form locator bank vendor part serial; do
      [ -n "$size" ] || continue
      case "$size" in *'No Module'* | *'Not Installed'* | 0*) continue ;; esac
      bytes=''
      if [[ $size =~ ^([0-9]+)[[:space:]]*GB ]]; then bytes=$((BASH_REMATCH[1] * 1073741824)); fi
      if [[ $size =~ ^([0-9]+)[[:space:]]*MB ]]; then bytes=$((BASH_REMATCH[1] * 1048576)); fi
      [ -n "$bytes" ] && dmi_mem_total=$((dmi_mem_total + bytes))
      [[ $speed =~ ^([0-9]+) ]] && speed=${BASH_REMATCH[1]} || speed=''
      placeholder "$vendor" && vendor=''
      placeholder "$part" && part=''
      placeholder "$serial" && serial=''
      placeholder "$type" && type=''
      case "$form" in SODIMM | DIMM) ;; *) placeholder "$form" && form='' ;; esac
      add_item "$(obj kind memory vendor "$vendor" model "$part" serial "$serial" 'sizeBytes#' "$bytes" memoryType "$type" 'speedMTs#' "$speed" formFactor "$form" slot "$locator" raw "$(raw bank "$bank" size "$size")")"
    done < <(awk -F': ' '
      function flush() { if (inside) printf "%s\037%s\037%s\037%s\037%s\037%s\037%s\037%s\037%s\n", size, type, speed, form, loc, bank, man, part, ser }
      /^Memory Device/ { flush(); inside=1; size=type=speed=form=loc=bank=man=part=ser=""; next }
      /^Handle / { flush(); inside=0; next }
      inside {
        sub(/^[ \t]+/, "", $1); v=$2; gsub(/[ \t]+$/, "", v); gsub(/[\t\037]/, " ", v)
        if ($1=="Size") size=v; else if ($1=="Type") type=v; else if ($1=="Speed") speed=v
        else if ($1=="Form Factor") form=v; else if ($1=="Locator") loc=v
        else if ($1=="Bank Locator") bank=v; else if ($1=="Manufacturer") man=v
        else if ($1=="Part Number") part=v; else if ($1=="Serial Number") ser=v
      }
      END { flush() }' <<<"$mem_text")
  else
    skip memory "dmidecode $(why_no_root)"
  fi
fi

mem_total_bytes=''
swap_total_bytes=''
zram_total_bytes=0
if [ -r "$R/proc/meminfo" ]; then
  mt_kb=$(awk '/^MemTotal:/ {print $2}' "$R/proc/meminfo" 2>/dev/null || true)
  st_kb=$(awk '/^SwapTotal:/ {print $2}' "$R/proc/meminfo" 2>/dev/null || true)
  [[ $mt_kb =~ ^[0-9]+$ ]] && mem_total_bytes=$((mt_kb * 1024))
  [[ $st_kb =~ ^[0-9]+$ ]] && swap_total_bytes=$((st_kb * 1024))
fi
[ -z "$mem_total_bytes" ] && [ -n "$sys_mem_bytes" ] && mem_total_bytes=$sys_mem_bytes
[ -z "$mem_total_bytes" ] && [ "$dmi_mem_total" -gt 0 ] && mem_total_bytes=$dmi_mem_total

# --- drives & SMART summary -------------------------------------------------------------------
slot_of() {
  local p
  p=$(readlink -f "$R/sys/block/$1" 2>/dev/null || true)
  if [[ $p =~ /(ata[0-9]+)/ ]]; then echo "${BASH_REMATCH[1]}"
  elif [[ $p =~ /nvme/(nvme[0-9]+)/ ]]; then echo "${BASH_REMATCH[1]}"
  elif [[ $p =~ /(mmc[0-9]+)/ ]]; then echo "${BASH_REMATCH[1]}"
  elif [[ $p =~ /(usb[0-9]+/[0-9.-]+)/ ]]; then echo "${BASH_REMATCH[1]}"
  elif [[ $p =~ /(virtio[0-9]+)/ ]]; then echo "${BASH_REMATCH[1]}"
  fi
}

storage_total_bytes=0
storage_drive_count=0
smart_overall='unknown'
smart_max_temp=''
unhealthy_drives=()

if have lsblk; then
  smart_skipped=0
  while IFS= read -r line; do
    declare -A d=()
    rest=$line
    while [[ $rest =~ ^([A-Z0-9_-]+)=\"([^\"]*)\"[[:space:]]*(.*)$ ]]; do
      printf -v val '%b' "${BASH_REMATCH[2]}"
      d[${BASH_REMATCH[1]}]=$(trim "$val")
      rest=${BASH_REMATCH[3]}
    done
    name=${d[NAME]:-}
    if [[ $name == zram* ]] && [[ ${d[SIZE]:-} =~ ^[0-9]+$ ]]; then
      zram_total_bytes=$((zram_total_bytes + d[SIZE]))
    fi
    if [ "${d[TYPE]:-}" = raid1 ] || [ "${d[TYPE]:-}" = raid5 ] || [ "${d[TYPE]:-}" = raid6 ] || [ "${d[TYPE]:-}" = raid10 ]; then
      add_item "$(obj kind raid model "${d[MODEL]:-$name}" 'sizeBytes#' "${d[SIZE]:-}" interface "${d[TYPE]:-}" raw "$(raw name "$name")")"
      unset d
      continue
    fi
    [ "${d[TYPE]:-}" = disk ] || { unset d; continue; }
    case "$name" in loop* | zram* | ram* | md* | dm-* | nbd* | sr* | synoboot*) unset d; continue ;; esac
    model=${d[MODEL]:-}
    vendor=${d[VENDOR]:-}
    [ "$vendor" = ATA ] && vendor=''
    serial=${d[SERIAL]:-}
    iface=${d[TRAN]:-}
    [[ $name == vd* ]] && [ -z "$iface" ] && iface='virtio'
    rawextra=()
    if [[ $name == mmcblk* ]]; then
      [ -n "$model" ] || model=$(rd "/sys/block/$name/device/name")
      [ -n "$serial" ] || serial=$(rd "/sys/block/$name/device/serial")
      case "$(rd "/sys/block/$name/device/type")" in MMC) iface=emmc ;; *) iface=sd ;; esac
      rawextra=(manfid "$(rd "/sys/block/$name/device/manfid")" oemid "$(rd "/sys/block/$name/device/oemid")")
    fi

    drive_smart=''
    drive_temp=''
    drive_wear=''
    if have smartctl; then
      s_json=''
      if s_json=$(as_root smartctl -i -H -A -j "/dev/$name" 2>/dev/null) || s_json=$(as_root smartctl -i -j "/dev/$name" 2>/dev/null); then
        if [ -z "$serial" ]; then
          serial=$(sed -n 's/^[[:space:]]*"serial_number":[[:space:]]*"\(.*\)",\{0,1\}$/\1/p' <<<"$s_json" | head -n 1)
          serial=${serial//\\\"/\"}
          serial=${serial//\\\\/\\}
        fi
        if [ -z "$model" ]; then
          model=$(sed -n 's/^[[:space:]]*"model_name":[[:space:]]*"\(.*\)",\{0,1\}$/\1/p' <<<"$s_json" | head -n 1)
          model=${model//\\\"/\"}
          model=${model//\\\\/\\}
        fi
        if grep -q '"passed":[[:space:]]*true' <<<"$s_json"; then
          drive_smart='PASSED'
          [ "$smart_overall" = 'unknown' ] && smart_overall='ok'
        elif grep -q '"passed":[[:space:]]*false' <<<"$s_json"; then
          drive_smart='FAILED'
          smart_overall='fail'
          unhealthy_drives+=("$(json_str "$name (${model:-disk}): SMART FAILED")")
        fi
        t_val=$(sed -n 's/^[[:space:]]*"temperature":[[:space:]]*{[[:space:]]*"current":[[:space:]]*\([0-9]\+\).*/\1/p' <<<"$s_json" | head -n 1)
        [ -n "$t_val" ] || t_val=$(sed -n '/"temperature"[[:space:]]*:/,/}/ s/^[[:space:]]*"current":[[:space:]]*\([0-9]\+\).*/\1/p' <<<"$s_json" | head -n 1)
        if [[ $t_val =~ ^[0-9]+$ ]]; then
          drive_temp=$t_val
          if [ -z "$smart_max_temp" ] || [ "$t_val" -gt "$smart_max_temp" ]; then
            smart_max_temp=$t_val
          fi
          if [ "$t_val" -ge 65 ] && [ "$smart_overall" != 'fail' ]; then
            smart_overall='warn'
            unhealthy_drives+=("$(json_str "$name (${model:-disk}): high temp ${t_val}C")")
          fi
        fi
        w_val=$(sed -n 's/.*"\(percentage_used\|wear_leveling_count\)":[[:space:]]*\([0-9]\+\).*/\2/p' <<<"$s_json" | head -n 1)
        if [[ $w_val =~ ^[0-9]+$ ]]; then
          drive_wear=$w_val
          if [ "$w_val" -ge 90 ] && [ "$smart_overall" != 'fail' ]; then
            smart_overall='warn'
            unhealthy_drives+=("$(json_str "$name (${model:-disk}): wear ${w_val}%")")
          fi
        fi
      elif [ -z "$serial" ] && [ $smart_skipped -eq 0 ]; then
        note "drive serials behind USB bridges: smartctl $(why_no_root)"
        smart_skipped=1
      fi
    fi
    placeholder "$serial" && serial=''
    if [[ ${d[SIZE]:-} =~ ^[0-9]+$ ]]; then
      storage_total_bytes=$((storage_total_bytes + d[SIZE]))
      storage_drive_count=$((storage_drive_count + 1))
    fi
    add_item "$(obj kind drive vendor "$vendor" model "$model" serial "$serial" 'sizeBytes#' "${d[SIZE]:-}" interface "$iface" slot "$(slot_of "$name")" 'removable?' "$([ "${d[RM]:-0}" = 1 ] && echo true || echo false)" smartStatus "$drive_smart" 'tempC#' "$drive_temp" 'wearPercent#' "$drive_wear" raw "$(raw name "$name" wwn "${d[WWN]:-}" rotational "${d[ROTA]:-}" "${rawextra[@]}")")"
    unset d
  done < <(LC_ALL=C lsblk -d -b -n -P -o NAME,MODEL,VENDOR,SERIAL,SIZE,TRAN,ROTA,TYPE,RM,WWN 2>/dev/null || true)
elif [ -d "$R/sys/block" ]; then
  smart_bin=''
  if have smartctl; then smart_bin='smartctl'
  elif [ -x /volume1/@appstore/synocli-disk/sbin/smartctl ]; then smart_bin='/volume1/@appstore/synocli-disk/sbin/smartctl'
  fi
  for bdev in "$R"/sys/block/*; do
    [ -e "$bdev" ] || continue
    name=${bdev##*/}
    case "$name" in loop* | zram* | ram* | md* | dm-* | nbd* | sr* | synoboot*) continue ;; esac
    sectors=$(rd "/sys/block/$name/size")
    [[ $sectors =~ ^[0-9]+$ ]] && [ "$sectors" -gt 0 ] || continue
    size_bytes=$((sectors * 512))
    model=$(rd "/sys/block/$name/device/model")
    vendor=$(rd "/sys/block/$name/device/vendor")
    [ "$vendor" = ATA ] && vendor=''
    serial=$(rd "/sys/block/$name/device/serial")
    rota=$(rd "/sys/block/$name/queue/rotational")
    rm_flag=$(rd "/sys/block/$name/removable")
    iface=''
    case "$name" in
      nvme*) iface='nvme' ;;
      sata* | sd*) iface='sata' ;;
      mmcblk*) iface='sd' ;;
      vd*) iface='virtio' ;;
    esac
    drive_smart=''
    drive_temp=''
    drive_wear=''
    if [ -n "$smart_bin" ]; then
      s_json=''
      if s_json=$(as_root "$smart_bin" -i -H -A -j "/dev/$name" 2>/dev/null) || s_json=$(as_root "$smart_bin" -i -H -A -j -d sat "/dev/$name" 2>/dev/null); then
        if [ -z "$serial" ]; then
          serial=$(sed -n 's/^[[:space:]]*"serial_number":[[:space:]]*"\(.*\)",\{0,1\}$/\1/p' <<<"$s_json" | head -n 1)
        fi
        if grep -q '"passed":[[:space:]]*true' <<<"$s_json"; then
          drive_smart='PASSED'
          [ "$smart_overall" = 'unknown' ] && smart_overall='ok'
        elif grep -q '"passed":[[:space:]]*false' <<<"$s_json"; then
          drive_smart='FAILED'
          smart_overall='fail'
          unhealthy_drives+=("$(json_str "$name (${model:-disk}): SMART FAILED")")
        fi
        t_val=$(sed -n 's/^[[:space:]]*"temperature":[[:space:]]*{[[:space:]]*"current":[[:space:]]*\([0-9]\+\).*/\1/p' <<<"$s_json" | head -n 1)
        [ -n "$t_val" ] || t_val=$(sed -n '/"temperature"[[:space:]]*:/,/}/ s/^[[:space:]]*"current":[[:space:]]*\([0-9]\+\).*/\1/p' <<<"$s_json" | head -n 1)
        if [[ $t_val =~ ^[0-9]+$ ]]; then
          drive_temp=$t_val
          if [ -z "$smart_max_temp" ] || [ "$t_val" -gt "$smart_max_temp" ]; then
            smart_max_temp=$t_val
          fi
        fi
      fi
    fi
    placeholder "$serial" && serial=''
    storage_total_bytes=$((storage_total_bytes + size_bytes))
    storage_drive_count=$((storage_drive_count + 1))
    add_item "$(obj kind drive vendor "$vendor" model "$model" serial "$serial" 'sizeBytes#' "$size_bytes" interface "$iface" slot "$(slot_of "$name")" 'removable?' "$([ "$rm_flag" = 1 ] && echo true || echo false)" smartStatus "$drive_smart" 'tempC#' "$drive_temp" 'wearPercent#' "$drive_wear" raw "$(raw name "$name" rotational "$rota")")"
  done
else
  skip drive 'lsblk not found'
fi

# --- GPUs (lspci / sysfs / nvidia-smi) -------------------------------------------------------
nvidia_bin=''
if have nvidia-smi; then nvidia_bin='nvidia-smi'
elif [ -x /usr/lib/wsl/lib/nvidia-smi ]; then nvidia_bin='/usr/lib/wsl/lib/nvidia-smi'
fi
if [ -n "$nvidia_bin" ]; then
  while IFS=',' read -r g_name g_uuid g_mem_mib g_bus; do
    g_name=$(trim "$g_name")
    [ -n "$g_name" ] || continue
    g_uuid=$(trim "$g_uuid")
    g_mem_mib=$(trim "$g_mem_mib")
    g_mem_mib=${g_mem_mib%% *}
    g_bus=$(trim "$g_bus")
    vram_b=''
    [[ $g_mem_mib =~ ^[0-9]+$ ]] && vram_b=$((g_mem_mib * 1048576))
    add_item "$(obj kind gpu vendor 'NVIDIA' model "$g_name" serial "$g_uuid" 'vramBytes#' "$vram_b" bus 'pci' slot "$g_bus")"
  done < <(LC_ALL=C "$nvidia_bin" --query-gpu=name,uuid,memory.total,pci.bus_id --format=csv,noheader,nounits 2>/dev/null || true)
elif have lspci; then
  while IFS= read -r gline; do
    [ -n "$gline" ] || continue
    if [[ $gline =~ ^([^[:space:]]+)[[:space:]]+\"(VGA compatible controller|3D controller|Display controller)\"[[:space:]]+\"([^\"]*)\"[[:space:]]+\"([^\"]*)\" ]]; then
      g_slot=${BASH_REMATCH[1]}
      g_vendor=${BASH_REMATCH[3]}
      g_model=${BASH_REMATCH[4]}
      case "${g_vendor,,} ${g_model,,}" in
        *bochs* | *cirrus* | *qxl* | *virtio* | *'vmware svga'* | *'microsoft basic'*) continue ;;
      esac
      add_item "$(obj kind gpu vendor "$g_vendor" model "$g_model" bus 'pci' slot "$g_slot")"
    fi
  done < <(LC_ALL=C lspci -mm 2>/dev/null || true)
fi

# --- network adapters ------------------------------------------------------------------------------
for dev in "$R"/sys/class/net/*; do
  [ -e "$dev/device" ] || continue
  ifname=${dev##*/}
  mac=$(rd "/sys/class/net/$ifname/address")
  bus=$(basename "$(readlink -f "$dev/device/subsystem" 2>/dev/null || echo unknown)")
  driver=$(basename "$(readlink -f "$dev/device/driver" 2>/dev/null || echo '')")
  addr=$(basename "$(readlink -f "$dev/device" 2>/dev/null || echo '')")
  vendor='' model='' onboard='' ids=''
  case "$bus" in
    pci)
      ids="$(rd "/sys/class/net/$ifname/device/vendor" | sed 's/^0x//'):$(rd "/sys/class/net/$ifname/device/device" | sed 's/^0x//')"
      if have lspci && [ -z "$R" ]; then
        mm=$(lspci -mm -s "$addr" 2>/dev/null | head -n 1 || true)
        if [[ $mm =~ ^[^\"]*\"[^\"]*\"[[:space:]]+\"([^\"]*)\"[[:space:]]+\"([^\"]*)\" ]]; then
          vendor=${BASH_REMATCH[1]}
          model=${BASH_REMATCH[2]}
        fi
      fi
      [ -n "$model" ] || model="PCI network adapter $ids"
      [[ $addr =~ ^[0-9a-f]{4}:00: ]] && onboard=true
      ;;
    usb)
      usbdev=$(readlink -f "$dev/device/.." 2>/dev/null || true)
      vendor=$(rf "$usbdev/manufacturer")
      model=$(rf "$usbdev/product")
      ids="$(rf "$usbdev/idVendor"):$(rf "$usbdev/idProduct")"
      [ -n "$model" ] || model="USB network adapter $ids"
      onboard=false
      ;;
    virtio*)
      bus='pci'
      model="VirtIO Ethernet${driver:+ ($driver)}"
      onboard=true
      ;;
    *)
      onboard=true
      if [ -d "$dev/wireless" ] || [ -d "$dev/phy80211" ]; then
        model="Onboard Wi-Fi${driver:+ ($driver)}"
      else
        model="Onboard Ethernet${driver:+ ($driver)}"
      fi
      ;;
  esac
  add_item "$(obj kind nic vendor "$(trim "$vendor")" model "$(trim "$model")" serial "$mac" bus "$bus" 'onboard?' "$onboard" raw "$(raw interface "$ifname" driver "$driver" ids "$ids" address "$addr")")"
done

# --- USB devices -------------------------------------------------------------------------------------
for udev in "$R"/sys/bus/usb/devices/*; do
  base=${udev##*/}
  [[ $base =~ ^[0-9]+-[0-9.]+$ ]] || continue
  [ -r "$udev/idVendor" ] || continue
  cls=$(rf "$udev/bDeviceClass")
  [ "$cls" = 09 ] && continue
  storage=0 net=0
  for intf in "$udev"/"$base":*; do
    [ -e "$intf" ] || continue
    [ "$(rf "$intf/bInterfaceClass")" = 08 ] && storage=1
    [ -d "$intf/net" ] && net=1
  done
  [ $storage -eq 0 ] && [ $net -eq 0 ] || continue
  vid=$(rf "$udev/idVendor")
  pid=$(rf "$udev/idProduct")
  vendor=$(rf "$udev/manufacturer")
  model=$(rf "$udev/product")
  if [ -z "$model" ] && have lsusb && [ -z "$R" ]; then
    model=$(lsusb -d "$vid:$pid" 2>/dev/null | head -n 1 | sed 's/^.*ID [0-9a-f]*:[0-9a-f]* *//' || true)
  fi
  [ -n "$model" ] || model="USB device $vid:$pid"
  serial=$(rf "$udev/serial")
  add_item "$(obj kind usb vendor "$(trim "$vendor")" model "$(trim "$model")" serial "$(trim "$serial")" bus usb slot "usb $base" raw "$(raw id "$vid:$pid" class "$cls")")"
done

# --- Pi HATs with an ID EEPROM ----------------------------------------------------------------------
if [ -d "$R/proc/device-tree/hat" ]; then
  hat_vendor=$(rd /proc/device-tree/hat/vendor)
  hat_product=$(rd /proc/device-tree/hat/product)
  if [ -n "$hat_product" ]; then
    add_item "$(obj kind hat vendor "$hat_vendor" model "$hat_product" serial "$(rd /proc/device-tree/hat/uuid)" raw "$(raw product_id "$(rd /proc/device-tree/hat/product_id)" product_ver "$(rd /proc/device-tree/hat/product_ver)")")"
  fi
fi

# --- summaries & output -----------------------------------------------------------------------------
mem_summary_json=''
if [ -n "$mem_total_bytes" ] || [ -n "$swap_total_bytes" ] || [ "$zram_total_bytes" -gt 0 ]; then
  mem_summary_json=$(obj 'totalBytes#' "${mem_total_bytes:-0}" 'swapBytes#' "${swap_total_bytes:-0}" 'zramBytes#' "$zram_total_bytes")
fi
storage_summary_json=$(obj 'totalBytes#' "$storage_total_bytes" 'driveCount#' "$storage_drive_count")
unhealthy_arr="[$(join ', ' "${unhealthy_drives[@]+"${unhealthy_drives[@]}"}")]"
smart_summary_json=$(obj status "$smart_overall" 'maxTempC#' "$smart_max_temp" 'unhealthyDrives@' "$unhealthy_arr")

[ "$os_json" = '{}' ] && os_json=''

emit() {
  printf '{\n'
  printf '  "schema": %s,\n' "$(json_str "$SCHEMA")"
  printf '  "collector": %s,\n' "$(json_str "stocky-collect $VERSION")"
  printf '  "collectedAt": %s,\n' "$(json_str "$(date +%Y-%m-%dT%H:%M:%S%:z)")"
  printf '  "host": %s,\n' "$(obj hostname "$hostname" machineIdHash "$mid" platform "$platform" 'virtual?' "$virtual_bool" virtualType "$virtual_type" model "$host_model" 'os@' "$os_json" 'uptimeSeconds#' "$uptime_sec" 'cpuSummary@' "$cpu_summary_json" 'memorySummary@' "$mem_summary_json" 'storageSummary@' "$storage_summary_json" 'smartSummary@' "$smart_summary_json")"
  printf '  "items": [\n    %s\n  ],\n' "$(join $',\n    ' "${items[@]}")"
  printf '  "skipped": [%s],\n' "$(join ', ' "${skipped[@]+"${skipped[@]}"}")"
  printf '  "warnings": [%s]\n' "$(join ', ' "${warnings[@]+"${warnings[@]}"}")"
  printf '}\n'
}

count=0
for x in "${items[@]+"${items[@]}"}"; do [ -n "$x" ] && count=$((count + 1)); done

if [ -n "$out" ]; then
  tmp="$out.tmp.$$"
  emit >"$tmp"
  mv "$tmp" "$out"
  info "wrote $count items to $out (log: $LOG)"
fi

if [ -n "$push_url" ]; then
  tok="${STOCKY_TOKEN:-}"
  if [ -n "$token_file" ]; then
    [ -r "$token_file" ] || die "cannot read token file: $token_file" 1
    tok=$(tr -d '\r\n[:space:]' <"$token_file")
  fi
  [ -n "$tok" ] || die "--push requires --token-file FILE or STOCKY_TOKEN environment variable" 2
  have curl || die "--push requires curl" 1
  payload_file=$(mktemp)
  resp_file=$(mktemp)
  trap 'rm -f "$payload_file" "$resp_file"' EXIT
  emit >"$payload_file"
  ingest_endpoint="$push_url/api/stocky/ingest"
  http_code=000
  for attempt in 1 2 3; do
    # Pass Authorization header via stdin (-H @-) so the bearer token never appears in ps
    http_code=$(printf 'Authorization: Bearer %s\n' "$tok" | curl -sS -o "$resp_file" -w '%{http_code}' --connect-timeout 10 --max-time 30 -X POST "$ingest_endpoint" -H 'Content-Type: application/json' -H @- --data-binary "@$payload_file" 2>>"$LOG" || echo 000)
    case "$http_code" in
      200 | 201)
        info "pushed $count items to $ingest_endpoint (HTTP $http_code)"
        log "push ok: HTTP $http_code"
        break
        ;;
      400 | 401 | 403 | 404 | 413 | 429)
        die "push failed (HTTP $http_code): $(head -c 200 "$resp_file")" 1
        ;;
      *)
        warn "push attempt $attempt failed (HTTP $http_code); retrying..."
        [ "$attempt" -lt 3 ] && sleep 2
        ;;
    esac
  done
  case "$http_code" in
    200 | 201) ;;
    *) die "push to $ingest_endpoint failed after 3 attempts (HTTP $http_code)" 1 ;;
  esac
elif [ -z "$out" ]; then
  emit
  info "$count items (log: $LOG)"
fi
log "done: $count items, ${#skipped[@]} skipped, ${#warnings[@]} warnings"
