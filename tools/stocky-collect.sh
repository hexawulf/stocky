#!/usr/bin/env bash
# Author:      0xWulf
# Description: stocky-collect — a read-only hardware snapshot for Stocky's
#              discovery import (spec §13.2). Prints JSON (schema
#              stocky.discovery/1, docs/discovery-schema.json) to stdout or
#              -o FILE; upload it in Stocky under Settings → Hosts → Import.
#              Physical machines only: VMs, containers and WSL are refused.
#              Writes nothing but the JSON and its log
#              (~/logs/stocky-collect_YYYYMMDD_HHMMSS.log). Needs no extra
#              packages; uses smartctl, lspci and lsusb only if present.
#              sudo is used for two read-only commands only, never with a
#              prompt (sudo -n): dmidecode (memory modules, board and system
#              serials on x86) and smartctl -i (drive serials hidden behind
#              USB bridges). --no-sudo skips them.
# Source:      https://github.com/hexawulf/stocky tools/stocky-collect.sh
#              (a copy kept elsewhere records the Stocky commit it came from
#              here; update a copy only by copying a newer Stocky version)
# Usage:       stocky-collect.sh [-o FILE] [--no-sudo] [--dry-run] [-h] [--version]
# Exit codes:  0 ok, 1 error, 2 usage, 3 virtual machine or container
# Modified:    2026-10-05
set -euo pipefail

VERSION=1.0.0
SCHEMA=stocky.discovery/1
MAX_ITEMS=200

# For tests only: read /sys, /proc and /etc under this directory instead of /
# (tools/test-collect.sh builds fake machines there). Commands come from PATH.
R=${STOCKY_COLLECT_ROOT:-}

out=''
use_sudo=1
dry=0
usage() {
  sed -n 's/^# Usage: *//p' "$0"
  echo "  -o FILE    write the JSON to FILE instead of stdout"
  echo "  --no-sudo  skip the two sudo commands (memory modules, hidden serials)"
  echo "  --dry-run  print what would be read and run, collect nothing"
}
while [ $# -gt 0 ]; do
  case "$1" in
    -o)
      [ $# -ge 2 ] || { usage >&2; exit 2; }
      out=$2
      shift
      ;;
    --no-sudo) use_sudo=0 ;;
    --dry-run) dry=1 ;;
    -h | --help) usage; exit 0 ;;
    --version) echo "stocky-collect $VERSION"; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

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

log "stocky-collect $VERSION root=${R:-/} sudo=$use_sudo dry=$dry"

# --- small readers -----------------------------------------------------------------------
# a file's first line, trimmed, NULs removed (device-tree strings end in \0)
rd() {
  local f="$R$1"
  [ -r "$f" ] || return 0
  local v
  v=$(tr -d '\000' <"$f" 2>/dev/null | head -n 1) || true
  v=${v#"${v%%[![:space:]]*}"}
  v=${v%"${v##*[![:space:]]}"}
  printf '%s' "$v"
}
# the same for a path that already includes the root prefix
rf() {
  [ -r "$1" ] || return 0
  tr -d '\000' <"$1" 2>/dev/null | head -n 1 || true
}
trim() {
  local v=$1
  v=${v#"${v%%[![:space:]]*}"}
  printf '%s' "${v%"${v##*[![:space:]]}"}"
}
# placeholders firmware uses instead of a real value
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
# A JSON string: backslash, quote and control characters escaped; bytes
# 0x80+ pass through (invalid UTF-8 is dropped by iconv -c when available).
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

# fields for one item: obj k1 v1 k2 v2 ... ; empty values are left out;
# a key ending in '#' is a number, '?' a boolean
obj() {
  local first=1 k v body=''
  while [ $# -ge 2 ]; do
    k=$1 v=$2
    shift 2
    [ -n "$v" ] || continue
    case "$k" in
      *'#') [[ $v =~ ^[0-9]+$ ]] || continue; k=${k%'#'}; v=$((10#$v)) ;;
      *'?') k=${k%'?'}; [ "$v" = true ] || v=false ;;
      raw) ;; # already JSON
      *) v=$(json_str "$v") ;;
    esac
    [ $first -eq 1 ] || body+=', '
    body+="$(json_str "$k"): $v"
    first=0
  done
  printf '{%s}' "$body"
}
# raw: a flat object from key/value pairs (strings only)
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

items=()
skipped=()
warnings=()
add_item() {
  if [ ${#items[@]} -ge $MAX_ITEMS ]; then
    [ ${#items[@]} -eq $MAX_ITEMS ] && warnings+=("$(json_str "more than $MAX_ITEMS items; the rest were left out")")
    items+=('') # counts the overflow once
    return
  fi
  items+=("$1")
}
skip() { skipped+=("$(obj kind "$1" reason "$2")"); warn "$1 skipped: $2"; }
note() { warnings+=("$(json_str "$1")"); warn "$1"; }

# --- sudo ---------------------------------------------------------------------------------
# run a read-only command as root without ever prompting; fails (status 1)
# when that's not possible
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

# --- virtual machines (spec §13.2.2) ------------------------------------------------------
virt=''
if have systemd-detect-virt; then
  v=$(systemd-detect-virt --vm 2>/dev/null) && [ "$v" != none ] && virt="virtual machine ($v)"
  if [ -z "$virt" ]; then
    v=$(systemd-detect-virt --container 2>/dev/null) && [ "$v" != none ] && virt="container ($v)"
  fi
fi
if [ -z "$virt" ] && grep -qi microsoft "$R/proc/sys/kernel/osrelease" 2>/dev/null; then virt='WSL'; fi
if [ -z "$virt" ] && { [ -e "$R/.dockerenv" ] || [ -e "$R/run/.containerenv" ]; }; then virt='container'; fi
if [ -z "$virt" ]; then
  dmi="$(rd /sys/class/dmi/id/sys_vendor) $(rd /sys/class/dmi/id/product_name) $(rd /sys/class/dmi/id/board_vendor)"
  case "${dmi,,}" in
    *kvm* | *qemu* | *vmware* | *virtualbox* | *innotek* | *'virtual machine'* | *xen* | *bochs* | \
      *parallels* | *digitalocean* | *hetzner* | *linode* | *akamai* | *'amazon ec2'* | \
      *'google compute engine'* | *openstack* | *vultr* | *upcloud* | *scaleway* | *ovh*)
      virt="virtual machine ($(trim "$dmi"))" ;;
  esac
fi
if [ -n "$virt" ]; then
  die "$virt: Stocky tracks physical hardware only" 3
fi

# --- what sudo would run here (only what this platform uses) ------------------------------------
platform=$(uname -m)
x86=0
case "$platform" in x86_64 | i?86) x86=1 ;; esac
sudo_plan=()
[ $x86 -eq 1 ] && have dmidecode && sudo_plan+=('dmidecode (memory modules, board and system serials)')
have smartctl && sudo_plan+=('smartctl -i (serials of drives behind USB bridges, only if lsblk has none)')
sudo_text=$(join_list "${sudo_plan[@]+"${sudo_plan[@]}"}")

# --- dry run --------------------------------------------------------------------------------
if [ $dry -eq 1 ]; then
  info "stocky-collect $VERSION, dry run: nothing is collected or written"
  echo "would read: /sys/class/dmi/id, /proc/device-tree, /proc/cpuinfo, /sys/class/net, /sys/block, /sys/bus/usb/devices, /etc/machine-id (hashed)"
  echo "would run:  lsblk, lscpu, uname$(have lspci && echo ', lspci')$(have lsusb && echo ', lsusb')"
  if [ $use_sudo -eq 0 ]; then
    echo "no sudo (--no-sudo): ${sudo_text:-nothing here would need it}"
  elif [ -n "$sudo_text" ]; then
    echo "with sudo -n (never prompts): $sudo_text"
  else
    echo "with sudo: nothing on this platform ($platform)"
  fi
  echo "output:     ${out:-stdout}; log: $LOG"
  exit 0
fi

if [ $use_sudo -eq 1 ] && [ "$(id -u)" -ne 0 ] && [ -n "$sudo_text" ]; then
  info "sudo -n (no prompt) for: $sudo_text; use --no-sudo to skip"
fi

# --- host ------------------------------------------------------------------------------------
hostname=$(rd /proc/sys/kernel/hostname)
[ -n "$hostname" ] || hostname=$(hostname 2>/dev/null || true)
machine_id=$(rd /etc/machine-id)
mid=''
if [ -n "$machine_id" ] && have sha256sum; then
  mid="sha256:$(printf '%s' "$machine_id" | sha256sum | cut -d' ' -f1)"
fi
dt_model=$(rd /proc/device-tree/model)
sys_vendor=$(rd /sys/class/dmi/id/sys_vendor)
product=$(rd /sys/class/dmi/id/product_name)
if [ -n "$dt_model" ]; then
  host_model=$dt_model
elif ! placeholder "$product"; then
  host_model=$(trim "$sys_vendor $product")
else
  # firmware left the product name empty ("System Product Name"): the board says more
  host_model=$(trim "$(rd /sys/class/dmi/id/board_vendor) $(rd /sys/class/dmi/id/board_name)")
fi
is_pi=0
case "$dt_model" in *'Raspberry Pi'*) is_pi=1 ;; esac

dmidecode_ok() { [ $x86 -eq 1 ] && have dmidecode; }
dmi_s() { # dmidecode -s KEYWORD as root, placeholders dropped
  local v
  v=$(as_root dmidecode -s "$1" 2>/dev/null | head -n 1) || return 0
  v=$(trim "$v")
  placeholder "$v" || printf '%s' "$v"
}

# --- system ----------------------------------------------------------------------------------
if [ -n "$dt_model" ]; then
  serial=$(rd /proc/device-tree/serial-number)
  mem=''
  revision=$(sed -n 's/^Revision[[:space:]]*:[[:space:]]*//p' "$R/proc/cpuinfo" 2>/dev/null | head -n 1)
  if [[ $revision =~ ^[0-9a-fA-F]+$ ]] && (((16#$revision >> 23) & 1)); then
    mem=$(((256 << ((16#$revision >> 20) & 7)) * 1048576))
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
if have lscpu; then
  cpu_text=$(LC_ALL=C lscpu 2>/dev/null || true)
  field() { sed -n "s/^$1:[[:space:]]*//p" <<<"$cpu_text" | head -n 1; }
  cpu_model=$(field 'Model name')
  cpu_vendor=$(field 'Vendor ID')
  sockets=$(field 'Socket(s)')
  cores=$(field 'Core(s) per socket')
  case "$cpu_vendor" in
    GenuineIntel) cpu_vendor=Intel ;;
    AuthenticAMD) cpu_vendor=AMD ;;
  esac
  [[ $sockets =~ ^[0-9]+$ ]] || sockets=1
  if [ -n "$cpu_model" ]; then
    for ((i = 0; i < sockets && i < 8; i++)); do
      add_item "$(obj kind cpu vendor "$cpu_vendor" model "$cpu_model" slot "$([ "$sockets" -gt 1 ] && echo "socket $i")" raw "$(raw cores "$cores" architecture "$(field Architecture)")")"
    done
  fi
else
  skip cpu 'lscpu not found'
fi

# --- memory (x86, dmidecode) ---------------------------------------------------------------------
if [ $x86 -eq 1 ]; then
  if ! have dmidecode; then
    skip memory 'dmidecode not installed'
  elif mem_text=$(as_root dmidecode -t 17 2>/dev/null); then
    # one record per "Memory Device" block
    # fields are split on \037 (unit separator): a tab would collapse empty fields
    while IFS=$'\037' read -r size type speed form locator bank vendor part serial; do
      [ -n "$size" ] || continue
      case "$size" in *'No Module'* | *'Not Installed'* | 0*) continue ;; esac
      bytes=''
      if [[ $size =~ ^([0-9]+)[[:space:]]*GB ]]; then bytes=$((BASH_REMATCH[1] * 1073741824)); fi
      if [[ $size =~ ^([0-9]+)[[:space:]]*MB ]]; then bytes=$((BASH_REMATCH[1] * 1048576)); fi
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

# --- drives ------------------------------------------------------------------------------------
# the stable part of a block device's sysfs path: ata1, nvme0, mmc0, usb1/1-2
slot_of() {
  local p
  p=$(readlink -f "$R/sys/block/$1" 2>/dev/null || true)
  if [[ $p =~ /(ata[0-9]+)/ ]]; then echo "${BASH_REMATCH[1]}"
  elif [[ $p =~ /nvme/(nvme[0-9]+)/ ]]; then echo "${BASH_REMATCH[1]}"
  elif [[ $p =~ /(mmc[0-9]+)/ ]]; then echo "${BASH_REMATCH[1]}"
  elif [[ $p =~ /(usb[0-9]+/[0-9.-]+)/ ]]; then echo "${BASH_REMATCH[1]}"
  fi
}
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
    [ "${d[TYPE]:-}" = disk ] || { unset d; continue; }
    case "$name" in loop* | zram* | ram* | md* | dm-* | nbd* | sr*) unset d; continue ;; esac
    model=${d[MODEL]:-}
    vendor=${d[VENDOR]:-}
    [ "$vendor" = ATA ] && vendor=''
    serial=${d[SERIAL]:-}
    iface=${d[TRAN]:-}
    rawextra=()
    if [[ $name == mmcblk* ]]; then
      [ -n "$model" ] || model=$(rd "/sys/block/$name/device/name")
      [ -n "$serial" ] || serial=$(rd "/sys/block/$name/device/serial")
      case "$(rd "/sys/block/$name/device/type")" in MMC) iface=emmc ;; *) iface=sd ;; esac
      rawextra=(manfid "$(rd "/sys/block/$name/device/manfid")" oemid "$(rd "/sys/block/$name/device/oemid")")
    fi
    if [ -z "$serial" ] && have smartctl; then
      if s_json=$(as_root smartctl -i -j "/dev/$name" 2>/dev/null); then
        serial=$(sed -n 's/^[[:space:]]*"serial_number":[[:space:]]*"\(.*\)",\{0,1\}$/\1/p' <<<"$s_json" | head -n 1)
        [ -n "$model" ] || model=$(sed -n 's/^[[:space:]]*"model_name":[[:space:]]*"\(.*\)",\{0,1\}$/\1/p' <<<"$s_json" | head -n 1)
        # undo smartctl's JSON escaping of quotes and backslashes
        serial=${serial//\\\"/\"}
        serial=${serial//\\\\/\\}
        model=${model//\\\"/\"}
        model=${model//\\\\/\\}
      elif [ $smart_skipped -eq 0 ]; then
        note "drive serials behind USB bridges: smartctl $(why_no_root)"
        smart_skipped=1
      fi
    fi
    placeholder "$serial" && serial=''
    add_item "$(obj kind drive vendor "$vendor" model "$model" serial "$serial" 'sizeBytes#' "${d[SIZE]:-}" interface "$iface" slot "$(slot_of "$name")" 'removable?' "$([ "${d[RM]:-0}" = 1 ] && echo true || echo false)" raw "$(raw name "$name" wwn "${d[WWN]:-}" rotational "${d[ROTA]:-}" "${rawextra[@]}")")"
    unset d
  done < <(LC_ALL=C lsblk -d -b -n -P -o NAME,MODEL,VENDOR,SERIAL,SIZE,TRAN,ROTA,TYPE,RM,WWN 2>/dev/null || true)
else
  skip drive 'lsblk not found'
fi

# --- network adapters ------------------------------------------------------------------------------
# physical only: a net device with a backing device (skips lo, bridges, veth,
# Docker, WireGuard, Tailscale and VLANs, which have none)
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
        # "Class" "Vendor" "Device" ...
        mm=$(lspci -mm -s "$addr" 2>/dev/null | head -n 1 || true)
        if [[ $mm =~ ^[^\"]*\"[^\"]*\"[[:space:]]+\"([^\"]*)\"[[:space:]]+\"([^\"]*)\" ]]; then
          vendor=${BASH_REMATCH[1]}
          model=${BASH_REMATCH[2]}
        fi
      fi
      [ -n "$model" ] || model="PCI network adapter $ids"
      # on bus 00 it's part of the chipset
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
    *)
      # platform/sdio: built into the board (the Pi's Ethernet and Wi-Fi)
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
# devices only (not interfaces or root hubs); hubs, mass storage (listed as
# drives) and network adapters (listed as NICs) are left out
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

# --- output ---------------------------------------------------------------------------------------------
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
emit() {
  printf '{\n'
  printf '  "schema": %s,\n' "$(json_str "$SCHEMA")"
  printf '  "collector": %s,\n' "$(json_str "stocky-collect $VERSION")"
  printf '  "collectedAt": %s,\n' "$(json_str "$(date +%Y-%m-%dT%H:%M:%S%:z)")"
  printf '  "host": %s,\n' "$(obj hostname "$hostname" machineIdHash "$mid" platform "$platform" 'virtual?' false model "$host_model")"
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
else
  emit
  info "$count items (log: $LOG)"
fi
log "done: $count items, ${#skipped[@]} skipped, ${#warnings[@]} warnings"
