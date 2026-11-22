#!/usr/bin/env bash
# Author:      0xWulf
# Description: Tests for tools/stocky-collect.sh v2.0.0 and tools/stocky-fleet-pull.sh
#              without touching any real machine: builds fake /sys, /proc and /etc
#              trees for a Pi 5 with NVMe, an x86 desktop, a KVM cloud VPS, a Synology
#              DSM NAS, a WSL2 host, an NVIDIA GPU workstation, a host with a SMART
#              drive warning, and a Pi full of hostile strings. Validates bash -n,
#              shellcheck (if installed), JSON validity against docs/discovery-schema.json,
#              exact round-trip of hostile strings, --no-sudo, --physical-only refusal of
#              VMs/WSL/containers (exit 3), --push with mock HTTP endpoint, and
#              committed fixtures in tools/fixtures.
# Usage:       tools/test-collect.sh [--write-fixtures]
# Modified:    2026-11-22
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
COLLECT="$ROOT/tools/stocky-collect.sh"
PULL="$ROOT/tools/stocky-fleet-pull.sh"
FIX="$ROOT/tools/fixtures"
write_fixtures=0
for arg in "$@"; do
  case "$arg" in
    --write-fixtures) write_fixtures=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

chmod +x "$COLLECT" "$PULL"

if [ -t 1 ]; then
  green=$'\033[32m' red=$'\033[31m' off=$'\033[0m'
else
  green='' red='' off=''
fi
pass=0
fail=0
ok() { pass=$((pass + 1)); printf '%sPASS%s  %s\n' "$green" "$off" "$1"; }
bad() { fail=$((fail + 1)); printf '%sFAIL%s  %s %s\n' "$red" "$off" "$1" "${2:-}"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "(got '$3', want '$2')"; fi; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export HOME="$work/home"
mkdir -p "$HOME"

# --- stub commands ---------------------------------------------------------------------
BIN="$work/bin"
mkdir -p "$BIN"
stub() {
  {
    echo '#!/usr/bin/env bash'
    cat
  } >"$BIN/$1"
  chmod +x "$BIN/$1"
}
stub lsblk <<'EOF'
cat "$FAKE/cmd/lsblk"
EOF
stub lscpu <<'EOF'
cat "$FAKE/cmd/lscpu"
EOF
stub uname <<'EOF'
if [ "${1:-}" = -m ]; then cat "$FAKE/cmd/arch"
elif [ "${1:-}" = -r ]; then cat "$FAKE/root/proc/sys/kernel/osrelease" 2>/dev/null || echo 6.8.0
else echo Linux; fi
EOF
stub systemd-detect-virt <<'EOF'
case "${1:-}" in
  --vm) v=$(cat "$FAKE/cmd/virt-vm" 2>/dev/null || echo none) ;;
  --container) v=$(cat "$FAKE/cmd/virt-container" 2>/dev/null || echo none) ;;
esac
echo "$v"; [ "$v" != none ]
EOF
stub dmidecode <<'EOF'
case "$*" in
  '-t 17') cat "$FAKE/cmd/dmidecode-memory" ;;
  '-s system-serial-number') cat "$FAKE/cmd/dmidecode-system-serial" ;;
  '-s baseboard-serial-number') cat "$FAKE/cmd/dmidecode-board-serial" ;;
  *) exit 1 ;;
esac
EOF
stub smartctl <<'EOF'
dev=${*: -1}; f="$FAKE/cmd/smartctl-${dev##*/}"
[ -r "$f" ] && cat "$f" || exit 2
EOF
stub nvidia-smi <<'EOF'
[ -r "$FAKE/cmd/nvidia-smi" ] && cat "$FAKE/cmd/nvidia-smi" || exit 1
EOF
stub lspci <<'EOF'
[ -r "$FAKE/cmd/lspci" ] && cat "$FAKE/cmd/lspci" || exit 0
EOF
stub sudo <<'EOF'
[ "${1:-}" = -n ] && shift
[ -e "$FAKE/cmd/sudo-denied" ] && { echo 'sudo: a password is required' >&2; exit 1; }
exec "$@"
EOF
export PATH="$BIN:$PATH"

# --- fake machines ---------------------------------------------------------------------------
put() {
  mkdir -p "$(dirname "$1")"
  printf '%b' "$2" >"$1"
}

make_pi() {
  local F=$1 hostile=$2 r
  r="$F/root"
  local hat_vendor='Pimoroni Ltd.' hat_product='NVMe Base' kb_vendor='Logitech' kb_product='USB Keyboard'
  local nvme_model='Samsung SSD 980 PRO 1TB' sd_name='SN128'
  if [ "$hostile" = 1 ]; then
    hat_vendor='Evil "HAT" \\ co\x01\x1b[31m'
    hat_product="<script>alert(1)</script> ' || 1=1 -- 日本語 ✓"
    kb_vendor='Logi"tech\\'
    kb_product='Key\tboard\x7f "quoted" \\path\\ ünïcödé\xff'
    nvme_model='Q\x22uote\x5c\x01 NVMe ½'
    sd_name='S"D\\x5c'
  fi
  mkdir -p "$F/cmd" "$r/etc" "$r/sys/class/net" "$r/sys/block" "$r/sys/bus/usb/devices" "$r/sys/bus/platform/drivers/macb" "$r/sys/bus/sdio/drivers/brcmfmac"
  put "$F/cmd/arch" 'aarch64\n'
  put "$r/proc/device-tree/model" 'Raspberry Pi 5 Model B Rev 1.0\0'
  put "$r/proc/device-tree/serial-number" 'e4a1b2c3d4e5f607\0'
  put "$r/proc/device-tree/hat/vendor" "$hat_vendor\\0"
  put "$r/proc/device-tree/hat/product" "$hat_product\\0"
  put "$r/proc/device-tree/hat/product_id" '0x0001\0'
  put "$r/proc/device-tree/hat/product_ver" '0x0002\0'
  put "$r/proc/device-tree/hat/uuid" '3f2504e0-4f89-11d3-9a0c-0305e82c3301\0'
  put "$r/proc/cpuinfo" 'processor\t: 0\nRevision\t: d04170\nSerial\t\t: e4a1b2c3d4e5f607\n'
  put "$r/proc/meminfo" 'MemTotal:        8388608 kB\nSwapTotal:             0 kB\n'
  put "$r/proc/uptime" '86400.42 340000.00\n'
  put "$r/etc/os-release" 'NAME="Ubuntu"\nVERSION_ID="26.04"\n'
  put "$r/proc/sys/kernel/hostname" 'pi-test\n'
  put "$r/proc/sys/kernel/osrelease" '6.6.51+rpt-rpi-2712\n'
  put "$r/etc/machine-id" '0123456789abcdef0123456789abcdef\n'
  put "$F/cmd/lscpu" 'Architecture:            aarch64\nCPU(s):                  4\nVendor ID:               ARM\nModel name:              Cortex-A76\nSocket(s):               -\nCore(s) per cluster:     4\nCPU max MHz:             2400.0000\n'

  local nv="$r/sys/devices/platform/axi/1000110000.pcie/pci0000:00/0000:00:00.0/0000:01:00.0/nvme/nvme0/nvme0n1"
  local mmc="$r/sys/devices/platform/axi/1000fff000.mmc/mmc_host/mmc0/mmc0:aaaa"
  mkdir -p "$nv" "$mmc/block/mmcblk0"
  ln -s "../devices/platform/axi/1000110000.pcie/pci0000:00/0000:00:00.0/0000:01:00.0/nvme/nvme0/nvme0n1" "$r/sys/block/nvme0n1"
  ln -s "../devices/platform/axi/1000fff000.mmc/mmc_host/mmc0/mmc0:aaaa/block/mmcblk0" "$r/sys/block/mmcblk0"
  ln -s ../.. "$mmc/block/mmcblk0/device"
  put "$mmc/name" "$sd_name\n"
  put "$mmc/serial" '0x1234abcd\n'
  put "$mmc/type" 'SD\n'
  put "$mmc/manfid" '0x000003\n'
  put "$mmc/oemid" '0x5344\n'
  {
    printf 'NAME="loop0" MODEL="" VENDOR="" SERIAL="" SIZE="4096" TRAN="" ROTA="0" TYPE="loop" RM="0" WWN=""\n'
    printf 'NAME="mmcblk0" MODEL="" VENDOR="" SERIAL="" SIZE="127865454592" TRAN="" ROTA="0" TYPE="disk" RM="0" WWN=""\n'
    printf 'NAME="nvme0n1" MODEL="%s" VENDOR="" SERIAL="S5GXNF0R123456X" SIZE="1000204886016" TRAN="nvme" ROTA="0" TYPE="disk" RM="0" WWN="eui.002538b231b2c3d4"\n' "$nvme_model"
    printf 'NAME="zram0" MODEL="" VENDOR="" SERIAL="" SIZE="2147483648" TRAN="" ROTA="0" TYPE="disk" RM="0" WWN=""\n'
  } >"$F/cmd/lsblk"

  local eth="$r/sys/devices/platform/axi/1f00100000.ethernet" wl="$r/sys/devices/platform/axi/1000fff100.mmc/mmc_host/mmc1/mmc1:0001/mmc1:0001:1"
  mkdir -p "$eth/net/eth0" "$wl/net/wlan0/wireless" "$r/sys/class/net/docker0"
  ln -s ../../devices/platform/axi/1f00100000.ethernet/net/eth0 "$r/sys/class/net/eth0"
  ln -s ../../devices/platform/axi/1000fff100.mmc/mmc_host/mmc1/mmc1:0001/mmc1:0001:1/net/wlan0 "$r/sys/class/net/wlan0"
  ln -s ../.. "$eth/net/eth0/device"
  ln -s ../.. "$wl/net/wlan0/device"
  ln -s "$r/sys/bus/platform" "$eth/subsystem"
  ln -s "$r/sys/bus/platform/drivers/macb" "$eth/driver"
  ln -s "$r/sys/bus/sdio" "$wl/subsystem"
  ln -s "$r/sys/bus/sdio/drivers/brcmfmac" "$wl/driver"
  put "$eth/net/eth0/address" '2c:cf:67:00:00:01\n'
  put "$wl/net/wlan0/address" '2c:cf:67:00:00:02\n'
  put "$r/sys/class/net/docker0/address" '02:42:00:00:00:01\n'

  local u="$r/sys/bus/usb/devices"
  mkdir -p "$u/1-1/1-1:1.0" "$u/1-2/1-2:1.0" "$u/1-3" "$u/usb1"
  put "$u/1-1/idVendor" '046d\n'
  put "$u/1-1/idProduct" 'c31c\n'
  put "$u/1-1/bDeviceClass" '00\n'
  put "$u/1-1/manufacturer" "$kb_vendor\n"
  put "$u/1-1/product" "$kb_product\n"
  put "$u/1-1/1-1:1.0/bInterfaceClass" '03\n'
  put "$u/1-2/idVendor" '0781\n'
  put "$u/1-2/idProduct" '5591\n'
  put "$u/1-2/bDeviceClass" '00\n'
  put "$u/1-2/product" 'Ultra Flair\n'
  put "$u/1-2/1-2:1.0/bInterfaceClass" '08\n'
  put "$u/1-3/idVendor" '2109\n'
  put "$u/1-3/idProduct" '3431\n'
  put "$u/1-3/bDeviceClass" '09\n'
  put "$u/usb1/idVendor" '1d6b\n'
}

make_x86() {
  local F=$1 r
  r="$F/root"
  mkdir -p "$F/cmd" "$r/etc" "$r/sys/class/net" "$r/sys/block" "$r/sys/bus/usb/devices" "$r/sys/bus/pci/drivers/e1000e" "$r/sys/bus/usb/drivers/r8152"
  put "$F/cmd/arch" 'x86_64\n'
  local d="$r/sys/class/dmi/id"
  put "$d/sys_vendor" 'LENOVO\n'
  put "$d/product_name" 'ThinkCentre M70q\n'
  put "$d/product_version" 'Not Specified\n'
  put "$d/board_vendor" 'LENOVO\n'
  put "$d/board_name" '0M5F7T\n'
  put "$d/board_version" 'A00\n'
  put "$r/proc/sys/kernel/hostname" 'desktop-test\n'
  put "$r/proc/sys/kernel/osrelease" '6.8.0-45-generic\n'
  put "$r/proc/meminfo" 'MemTotal:       25165824 kB\nSwapTotal:       4194304 kB\n'
  put "$r/proc/uptime" '172800.10 500000.00\n'
  put "$r/etc/os-release" 'NAME="Ubuntu"\nVERSION_ID="24.04"\n'
  put "$r/etc/machine-id" 'fedcba9876543210fedcba9876543210\n'
  put "$F/cmd/lscpu" 'Architecture:                         x86_64\nCPU(s):                               12\nVendor ID:                            GenuineIntel\nModel name:                           Intel(R) Core(TM) i5-10500T CPU @ 2.30GHz\nSocket(s):                            1\nCore(s) per socket:                   6\nCPU max MHz:                          3800.0000\n'
  put "$F/cmd/dmidecode-system-serial" '7XQ1234\n'
  put "$F/cmd/dmidecode-board-serial" '/7XQ1234/CNWS20012345/\n'
  cat >"$F/cmd/dmidecode-memory" <<'MEM'
# dmidecode 3.5
Getting SMBIOS data from sysfs.
SMBIOS 3.2.0 present.

Handle 0x0040, DMI type 17, 92 bytes
Memory Device
	Array Handle: 0x003F
	Total Width: 64 bits
	Size: 16 GB
	Form Factor: SODIMM
	Locator: DIMM A
	Bank Locator: BANK 0
	Type: DDR4
	Speed: 3200 MT/s
	Manufacturer: Kingston
	Serial Number: 1A2B3C4D
	Part Number: KF432S20IB/16
	Configured Memory Speed: 2933 MT/s

Handle 0x0041, DMI type 17, 92 bytes
Memory Device
	Array Handle: 0x003F
	Size: 8192 MB
	Form Factor: SODIMM
	Locator: DIMM B
	Bank Locator: BANK 2
	Type: DDR4
	Speed: 2666 MT/s
	Manufacturer: Samsung
	Serial Number: 00000000
	Part Number: M471A1K43DB1-CWE

Handle 0x0042, DMI type 17, 92 bytes
Memory Device
	Size: No Module Installed
	Form Factor: Unknown
	Locator: DIMM C
	Bank Locator: BANK 4
	Type: Unknown
	Speed: Unknown
	Manufacturer: Not Specified
	Serial Number: Not Specified
	Part Number: Not Specified
MEM
  local sa="$r/sys/devices/pci0000:00/0000:00:17.0/ata1/host0/target0:0:0/0:0:0:0/block/sda"
  local nv="$r/sys/devices/pci0000:00/0000:00:1d.0/0000:02:00.0/nvme/nvme0/nvme0n1"
  local ub="$r/sys/devices/pci0000:00/0000:00:14.0/usb2/2-1/2-1:1.0/host2/target2:0:0/2:0:0:0/block/sdb"
  mkdir -p "$sa" "$nv" "$ub"
  ln -s "../devices/pci0000:00/0000:00:17.0/ata1/host0/target0:0:0/0:0:0:0/block/sda" "$r/sys/block/sda"
  ln -s "../devices/pci0000:00/0000:00:1d.0/0000:02:00.0/nvme/nvme0/nvme0n1" "$r/sys/block/nvme0n1"
  ln -s "../devices/pci0000:00/0000:00:14.0/usb2/2-1/2-1:1.0/host2/target2:0:0/2:0:0:0/block/sdb" "$r/sys/block/sdb"
  {
    printf 'NAME="sda" MODEL="Samsung SSD 870 EVO 500GB" VENDOR="ATA     " SERIAL="S62ANJ0R123456A" SIZE="500107862016" TRAN="sata" ROTA="0" TYPE="disk" RM="0" WWN="0x5002538f00000001"\n'
    printf 'NAME="sdb" MODEL="USB3.0 SATA Bridge" VENDOR="JMicron " SERIAL="" SIZE="2000398934016" TRAN="usb" ROTA="1" TYPE="disk" RM="0" WWN=""\n'
    printf 'NAME="sr0" MODEL="DVD+-RW" VENDOR="HL-DT-ST" SERIAL="KZ1" SIZE="1073741312" TRAN="sata" ROTA="1" TYPE="rom" RM="1" WWN=""\n'
    printf 'NAME="nvme0n1" MODEL="WDC WDS100T2B0C-00PXH0" VENDOR="" SERIAL="21123X801234" SIZE="1000204886016" TRAN="nvme" ROTA="0" TYPE="disk" RM="0" WWN="eui.e8238fa6bf530001"\n'
  } >"$F/cmd/lsblk"
  cat >"$F/cmd/smartctl-sdb" <<'SMART'
{
  "json_format_version": [1, 0],
  "model_name": "WDC WD20EZAZ-00GGJB0",
  "serial_number": "WD-WX12A3B4C5D6",
  "firmware_version": "80.00A80",
  "smart_status": { "passed": true },
  "temperature": { "current": 34 }
}
SMART

  local pci="$r/sys/devices/pci0000:00/0000:00:1f.6" usbnic="$r/sys/devices/pci0000:00/0000:00:14.0/usb2/2-2"
  mkdir -p "$pci/net/eno1" "$usbnic/2-2:1.0/net/enx00e04c680001" "$r/sys/class/net/wg0" "$r/sys/class/net/br0"
  ln -s ../../devices/pci0000:00/0000:00:1f.6/net/eno1 "$r/sys/class/net/eno1"
  ln -s ../../devices/pci0000:00/0000:00:14.0/usb2/2-2/2-2:1.0/net/enx00e04c680001 "$r/sys/class/net/enx00e04c680001"
  ln -s ../.. "$pci/net/eno1/device"
  ln -s ../.. "$usbnic/2-2:1.0/net/enx00e04c680001/device"
  ln -s "$r/sys/bus/pci" "$pci/subsystem"
  ln -s "$r/sys/bus/pci/drivers/e1000e" "$pci/driver"
  ln -s "$r/sys/bus/usb" "$usbnic/2-2:1.0/subsystem"
  ln -s "$r/sys/bus/usb/drivers/r8152" "$usbnic/2-2:1.0/driver"
  put "$pci/vendor" '0x8086\n'
  put "$pci/device" '0x0d4c\n'
  put "$pci/net/eno1/address" 'a4:bb:6d:00:00:01\n'
  put "$usbnic/2-2:1.0/net/enx00e04c680001/address" '00:e0:4c:68:00:01\n'
  put "$usbnic/idVendor" '0bda\n'
  put "$usbnic/idProduct" '8153\n'
  put "$usbnic/bDeviceClass" '00\n'
  put "$usbnic/manufacturer" 'Realtek\n'
  put "$usbnic/product" 'USB 10/100/1000 LAN\n'
  put "$usbnic/serial" '000001\n'
  put "$usbnic/2-2:1.0/bInterfaceClass" 'ff\n'
  ln -s ../../../devices/pci0000:00/0000:00:14.0/usb2/2-2 "$r/sys/bus/usb/devices/2-2"
  put "$r/sys/class/net/wg0/address" '\n'
}

make_kvm_vps() {
  local F=$1 r
  r="$F/root"
  mkdir -p "$F/cmd" "$r/etc" "$r/sys/class/net" "$r/sys/block" "$r/sys/bus/pci/drivers/virtio_net"
  put "$F/cmd/arch" 'x86_64\n'
  put "$F/cmd/virt-vm" 'kvm\n'
  put "$r/sys/class/dmi/id/sys_vendor" 'QEMU\n'
  put "$r/sys/class/dmi/id/product_name" 'Standard PC (Q35 + ICH9, 2009)\n'
  put "$r/proc/sys/kernel/hostname" 'vps-node-01\n'
  put "$r/proc/sys/kernel/osrelease" '6.12.0-generic\n'
  put "$r/proc/meminfo" 'MemTotal:        8192000 kB\nSwapTotal:       2097152 kB\n'
  put "$r/proc/uptime" '432000.00 860000.00\n'
  put "$r/etc/os-release" 'NAME="Ubuntu"\nVERSION_ID="26.04"\n'
  put "$r/etc/machine-id" 'aaaa1111bbbb2222cccc3333dddd4444\n'
  put "$F/cmd/lscpu" 'Architecture:            x86_64\nCPU(s):                  4\nVendor ID:               AuthenticAMD\nModel name:              AMD EPYC-Genoa Processor\nSocket(s):               1\nCore(s) per socket:      4\n'
  local vd="$r/sys/devices/pci0000:00/0000:00:04.0/virtio1/block/vda"
  mkdir -p "$vd"
  ln -s "../devices/pci0000:00/0000:00:04.0/virtio1/block/vda" "$r/sys/block/vda"
  printf 'NAME="vda" MODEL="QEMU HARDDISK" VENDOR="0x1af4" SERIAL="drive-scsi0-0-0" SIZE="85899345920" TRAN="virtio" ROTA="0" TYPE="disk" RM="0" WWN=""\n' >"$F/cmd/lsblk"
  local vnic="$r/sys/devices/pci0000:00/0000:00:03.0/virtio0"
  mkdir -p "$vnic/net/eth0"
  ln -s ../../devices/pci0000:00/0000:00:03.0/virtio0/net/eth0 "$r/sys/class/net/eth0"
  ln -s ../.. "$vnic/net/eth0/device"
  ln -s "$r/sys/bus/virtio" "$vnic/subsystem"
  ln -s "$r/sys/bus/pci/drivers/virtio_net" "$vnic/driver"
  put "$vnic/net/eth0/address" '52:54:00:12:34:56\n'
}

make_synology_nas() {
  local F=$1 r
  r="$F/root"
  mkdir -p "$F/cmd" "$r/etc" "$r/etc.defaults" "$r/sys/class/net" "$r/sys/block" "$r/sys/bus/pci/drivers/igb"
  put "$F/cmd/arch" 'x86_64\n'
  put "$r/etc/synoinfo.conf" 'upnpmodelname="DS423+"\nunique="synology_geminilake_423+"\n'
  put "$r/etc.defaults/VERSION" 'productversion="7.2.2"\nbuildnumber="72806"\n'
  put "$r/proc/sys/kernel/syno_serial" '2090SBR123456\n'
  put "$r/proc/sys/kernel/hostname" 'nas-box\n'
  put "$r/proc/sys/kernel/osrelease" '4.4.302+\n'
  put "$r/proc/meminfo" 'MemTotal:        8192000 kB\nSwapTotal:       4194304 kB\n'
  put "$r/proc/uptime" '950000.00 1800000.00\n'
  put "$r/etc/machine-id" '11112222333344445555666677778888\n'
  put "$F/cmd/lscpu" 'Architecture:            x86_64\nCPU(s):                  4\nVendor ID:               GenuineIntel\nModel name:              Intel(R) Celeron(R) J4125 CPU @ 2.00GHz\nSocket(s):               1\nCore(s) per socket:      4\n'
  local s1="$r/sys/devices/pci0000:00/0000:00:12.0/ata1/host0/target0:0:0/0:0:0:0/block/sda"
  local s2="$r/sys/devices/pci0000:00/0000:00:12.0/ata2/host1/target1:0:0/1:0:0:0/block/sdb"
  mkdir -p "$s1" "$s2"
  ln -s "../devices/pci0000:00/0000:00:12.0/ata1/host0/target0:0:0/0:0:0:0/block/sda" "$r/sys/block/sda"
  ln -s "../devices/pci0000:00/0000:00:12.0/ata2/host1/target1:0:0/1:0:0:0/block/sdb" "$r/sys/block/sdb"
  {
    printf 'NAME="sda" MODEL="ST8000VN004-2M2101" VENDOR="ATA" SERIAL="WSD10001" SIZE="8001563222016" TRAN="sata" ROTA="1" TYPE="disk" RM="0" WWN=""\n'
    printf 'NAME="sdb" MODEL="ST8000VN004-2M2101" VENDOR="ATA" SERIAL="WSD10002" SIZE="8001563222016" TRAN="sata" ROTA="1" TYPE="disk" RM="0" WWN=""\n'
  } >"$F/cmd/lsblk"
  cat >"$F/cmd/smartctl-sda" <<'SMART'
{
  "smart_status": { "passed": true },
  "temperature": { "current": 36 }
}
SMART
  cat >"$F/cmd/smartctl-sdb" <<'SMART'
{
  "smart_status": { "passed": true },
  "temperature": { "current": 37 }
}
SMART
}

make_wsl2() {
  local F=$1 r
  r="$F/root"
  mkdir -p "$F/cmd" "$r/etc" "$r/sys/class/net" "$r/sys/block"
  put "$F/cmd/arch" 'x86_64\n'
  put "$r/proc/sys/kernel/hostname" 'dev-wsl2\n'
  put "$r/proc/sys/kernel/osrelease" '5.15.167.4-microsoft-standard-WSL2\n'
  put "$r/proc/meminfo" 'MemTotal:       16384000 kB\nSwapTotal:       4194304 kB\n'
  put "$r/proc/uptime" '12000.00 40000.00\n'
  put "$r/etc/os-release" 'NAME="Ubuntu"\nVERSION_ID="24.04"\n'
  put "$r/etc/machine-id" '99998888777766665555444433332222\n'
  put "$F/cmd/lscpu" 'Architecture:            x86_64\nCPU(s):                  16\nVendor ID:               AuthenticAMD\nModel name:              AMD Ryzen 7 7840HS w/ Radeon 780M Graphics\nSocket(s):               1\nCore(s) per socket:      8\n'
  printf 'NAME="sdc" MODEL="Virtual Disk" VENDOR="Msft" SERIAL="" SIZE="274877906944" TRAN="" ROTA="0" TYPE="disk" RM="0" WWN=""\n' >"$F/cmd/lsblk"
}

make_nvidia_workstation() {
  local F=$1
  make_x86 "$F"
  put "$F/root/proc/sys/kernel/hostname" 'gpu-ws\n'
  put "$F/cmd/nvidia-smi" 'NVIDIA GeForce RTX 4070, GPU-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d, 12282, 00000000:01:00.0\n'
}

make_smart_warning() {
  local F=$1
  make_x86 "$F"
  put "$F/root/proc/sys/kernel/hostname" 'smart-warn-host\n'
  cat >"$F/cmd/smartctl-nvme0n1" <<'SMART'
{
  "smart_status": { "passed": true },
  "temperature": { "current": 72 },
  "nvme_smart_health_information_log": { "percentage_used": 95 }
}
SMART
}

run() {
  local name=$1
  shift
  export FAKE="$work/$name"
  local rc=0
  STOCKY_COLLECT_ROOT="$FAKE/root" "$COLLECT" "$@" >"$work/$name.json" 2>"$work/$name.err" || rc=$?
  echo "$rc" >"$work/$name.rc"
}
q() { node -e "const j = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); console.log(JSON.stringify($2))" "$1"; }

echo '# static checks'
bash -n "$COLLECT" && ok 'bash -n stocky-collect.sh' || bad 'bash -n stocky-collect.sh'
bash -n "$PULL" && ok 'bash -n stocky-fleet-pull.sh' || bad 'bash -n stocky-fleet-pull.sh'
if command -v shellcheck >/dev/null; then
  if shellcheck -S warning "$COLLECT" "$PULL" >"$work/sc.out"; then ok 'shellcheck (warnings and errors)'; else bad 'shellcheck' "$(head -c 400 "$work/sc.out")"; fi
else
  echo 'shellcheck not installed: skipped'
fi
check '--version' 'stocky-collect 2.0.0' "$("$COLLECT" --version)"
rc=0; "$COLLECT" --bogus >/dev/null 2>&1 || rc=$?
check 'unknown option exits 2' 2 "$rc"
rc=0; "$COLLECT" --token secret >/dev/null 2>&1 || rc=$?
check 'raw --token on CLI argv refused (exit 2)' 2 "$rc"
check '--print-systemd outputs timer unit' 1 "$("$COLLECT" --print-systemd | grep -c 'OnCalendar=daily')"
check '--print-cron outputs cron snippet' 1 "$("$COLLECT" --print-cron | grep -c '@reboot')"

echo '# Raspberry Pi 5 with NVMe (v2 schema)'
make_pi "$work/pi5" 0
run pi5
check 'exit 0' 0 "$(cat "$work/pi5.rc")"
check 'schema is stocky.discovery/2' '"stocky.discovery/2"' "$(q "$work/pi5.json" 'j.schema')"
check 'kinds: system, cpu, 2 drives, 2 NICs, USB keyboard, HAT' \
  '["system","cpu","drive","drive","nic","nic","usb","hat"]' "$(q "$work/pi5.json" 'j.items.map(i => i.kind)')"
check 'system: model, serial, 8 GB from the revision code' \
  '["Raspberry Pi Ltd","Raspberry Pi 5 Model B Rev 1.0","e4a1b2c3d4e5f607",8589934592]' \
  "$(q "$work/pi5.json" '(s => [s.vendor, s.model, s.serial, s.memoryBytes])(j.items[0])')"
check 'host v2 telemetry: virtualType bare-metal, os, cpuSummary, memorySummary, storageSummary' \
  '["aarch64","pi-test","bare-metal","Ubuntu",4,2]' \
  "$(q "$work/pi5.json" '[j.host.platform, j.host.hostname, j.host.virtualType, j.host.os.name, j.host.cpuSummary.physicalCores, j.host.storageSummary.driveCount]')"
check 'SD card: name and serial from sysfs, interface sd, slot mmc0' \
  '["SN128","0x1234abcd","sd","mmc0",127865454592]' \
  "$(q "$work/pi5.json" '(d => [d.model, d.serial, d.interface, d.slot, d.sizeBytes])(j.items.find(i => i.kind === "drive" && i.interface === "sd"))')"
check 'NVMe: slot nvme0' '["Samsung SSD 980 PRO 1TB","S5GXNF0R123456X","nvme","nvme0"]' \
  "$(q "$work/pi5.json" '(d => [d.model, d.serial, d.interface, d.slot])(j.items.find(i => i.interface === "nvme"))')"
check 'NICs onboard, by driver, MAC as serial' \
  '[["Onboard Ethernet (macb)","2c:cf:67:00:00:01",true],["Onboard Wi-Fi (brcmfmac)","2c:cf:67:00:00:02",true]]' \
  "$(q "$work/pi5.json" 'j.items.filter(i => i.kind === "nic").map(n => [n.model, n.serial, n.onboard])')"
check 'HAT from the EEPROM, uuid as serial' '["Pimoroni Ltd.","NVMe Base","3f2504e0-4f89-11d3-9a0c-0305e82c3301"]' \
  "$(q "$work/pi5.json" '(h => [h.vendor, h.model, h.serial])(j.items.find(i => i.kind === "hat"))')"
check 'no sudo needed on a Pi: nothing skipped' '[[],[]]' "$(q "$work/pi5.json" '[j.skipped, j.warnings]')"
FAKE="$work/pi5" STOCKY_COLLECT_ROOT="$work/pi5/root" "$COLLECT" --dry-run >"$work/pi5-dry.out" 2>&1
check 'Pi: --dry-run lists no dmidecode' 0 "$(grep -c dmidecode "$work/pi5-dry.out" || true)"

echo '# x86 desktop'
make_x86 "$work/x86"
run x86
check 'exit 0' 0 "$(cat "$work/x86.rc")"
check 'kinds: system, board, cpu, 2 memory, 3 drives (no DVD), 2 NICs (no wg0/br0)' \
  '["system","board","cpu","memory","memory","drive","drive","drive","nic","nic"]' "$(q "$work/x86.json" 'j.items.map(i => i.kind)')"
check 'system and board serials through sudo dmidecode' '["ThinkCentre M70q","7XQ1234","0M5F7T","/7XQ1234/CNWS20012345/"]' \
  "$(q "$work/x86.json" '[j.items[0].model, j.items[0].serial, j.items[1].model, j.items[1].serial]')"
check 'memory: size, type, speed, form, slot, part number; placeholder serial dropped' \
  '[["Kingston","KF432S20IB/16","1A2B3C4D",17179869184,"DDR4",3200,"SODIMM","DIMM A"],["Samsung","M471A1K43DB1-CWE",null,8589934592,"DDR4",2666,"SODIMM","DIMM B"]]' \
  "$(q "$work/x86.json" 'j.items.filter(i => i.kind === "memory").map(m => [m.vendor, m.model, m.serial ?? null, m.sizeBytes, m.memoryType, m.speedMTs, m.formFactor, m.slot])')"
check 'drives: ATA vendor dropped, slots ata1/usb2/nvme0, the bridge serial and SMART temp from smartctl' \
  '[["","Samsung SSD 870 EVO 500GB","S62ANJ0R123456A","sata","ata1",null],["JMicron","USB3.0 SATA Bridge","WD-WX12A3B4C5D6","usb","usb2/2-1",34],["","WDC WDS100T2B0C-00PXH0","21123X801234","nvme","nvme0",null]]' \
  "$(q "$work/x86.json" 'j.items.filter(i => i.kind === "drive").map(d => [d.vendor ?? "", d.model, d.serial, d.interface, d.slot, d.tempC ?? null])')"

echo '# universal fleet classes: KVM VPS, Synology NAS, WSL2, NVIDIA GPU, SMART warning'
make_kvm_vps "$work/kvm"
run kvm
check 'KVM VPS collected cleanly (exit 0)' 0 "$(cat "$work/kvm.rc")"
check 'KVM VPS virtual=true, virtualType=kvm' '[true,"kvm","vps-node-01"]' "$(q "$work/kvm.json" '[j.host.virtual, j.host.virtualType, j.host.hostname]')"

make_synology_nas "$work/synology"
run synology
check 'Synology NAS collected cleanly (exit 0)' 0 "$(cat "$work/synology.rc")"
check 'Synology NAS virtual=false, virtualType=nas, DSM OS' '[false,"nas","Synology DS423+","Synology DSM",2,"ok"]' \
  "$(q "$work/synology.json" '[j.host.virtual, j.host.virtualType, j.host.model, j.host.os.name, j.host.storageSummary.driveCount, j.host.smartSummary.status]')"

make_wsl2 "$work/wsl2"
run wsl2
check 'WSL2 collected cleanly (exit 0)' 0 "$(cat "$work/wsl2.rc")"
check 'WSL2 virtual=true, virtualType=wsl' '[true,"wsl","dev-wsl2"]' "$(q "$work/wsl2.json" '[j.host.virtual, j.host.virtualType, j.host.hostname]')"

make_nvidia_workstation "$work/nvidia"
run nvidia
check 'NVIDIA workstation exit 0' 0 "$(cat "$work/nvidia.rc")"
check 'NVIDIA GPU item captured with VRAM and UUID' '["NVIDIA","NVIDIA GeForce RTX 4070","GPU-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",12878610432]' \
  "$(q "$work/nvidia.json" '(g => [g.vendor, g.model, g.serial, g.vramBytes])(j.items.find(i => i.kind === "gpu"))')"

make_smart_warning "$work/smartwarn"
run smartwarn
check 'SMART warning host exit 0' 0 "$(cat "$work/smartwarn.rc")"
check 'SMART summary flags warn with maxTempC=72 and unhealthyDrives' '["warn",72,2]' \
  "$(q "$work/smartwarn.json" '[j.host.smartSummary.status, j.host.smartSummary.maxTempC, j.host.smartSummary.unhealthyDrives.length]')"

echo '# --no-sudo, and sudo that wants a password'
run x86 --no-sudo
check '--no-sudo: memory skipped with the reason' '[{"kind":"memory","reason":"dmidecode needs sudo (--no-sudo given)"}]' "$(q "$work/x86.json" 'j.skipped')"
check '  ...no serials from dmidecode or smartctl' '[null,null,null]' \
  "$(q "$work/x86.json" '[j.items[0].serial ?? null, j.items[1].serial ?? null, j.items.find(i => i.interface === "usb").serial ?? null]')"
touch "$work/x86/cmd/sudo-denied"
run x86
check 'sudo -n refused: exit 0, memory skipped, says why' 'dmidecode needs sudo (sudo -n is not allowed without a password here)' "$(q "$work/x86.json" 'j.skipped[0].reason' | tr -d '"')"
rm "$work/x86/cmd/sudo-denied"

echo '# hostile strings'
make_pi "$work/hostile" 1
run hostile
check 'exit 0' 0 "$(cat "$work/hostile.rc")"
if node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$work/hostile.json" 2>/dev/null; then ok 'output parses as JSON'; else bad 'output parses as JSON' "$(head -c 300 "$work/hostile.json")"; fi
check 'HAT vendor round-trips exactly' \
  "$(node -e 'console.log(JSON.stringify("Evil \"HAT\" \\ co\u0001\u001b[31m"))')" "$(q "$work/hostile.json" 'j.items.find(i => i.kind === "hat").vendor')"
check 'HAT product: markup, SQL-ish and non-ASCII kept as text' \
  "$(node -e 'console.log(JSON.stringify("<script>alert(1)</script> '"'"' || 1=1 -- 日本語 ✓"))')" "$(q "$work/hostile.json" 'j.items.find(i => i.kind === "hat").model')"

echo '# --physical-only refuses virtual machines, WSL and containers (exit 3, no output)'
for kind in vm wsl container; do
  make_pi "$work/$kind" 0
  case "$kind" in
    vm) echo kvm >"$work/$kind/cmd/virt-vm" ;;
    wsl) put "$work/$kind/root/proc/sys/kernel/osrelease" '5.15.153.1-microsoft-standard-WSL2\n' ;;
    container) touch "$work/$kind/root/.dockerenv" ;;
  esac
  run "$kind" --physical-only
  check "$kind (--physical-only): exit 3" 3 "$(cat "$work/$kind.rc")"
  check "$kind (--physical-only): nothing on stdout" 0 "$(wc -c <"$work/$kind.json" | tr -d ' ')"
done

echo '# -o FILE, --dry-run, and stocky-fleet-pull.sh --dry-run'
export FAKE="$work/pi5"
STOCKY_COLLECT_ROOT="$FAKE/root" "$COLLECT" -o "$work/out.json" >"$work/o.stdout" 2>/dev/null
check '-o writes the file, nothing on stdout' '0 true' "$(wc -c <"$work/o.stdout" | tr -d ' ') $(q "$work/out.json" 'j.items.length > 0')"
STOCKY_COLLECT_ROOT="$FAKE/root" "$COLLECT" --dry-run -o "$work/dry.json" >"$work/dry.out" 2>&1
check '--dry-run collects nothing' 'false 1' "$([ -e "$work/dry.json" ] && echo true || echo false) $(grep -c 'dry run' "$work/dry.out")"
printf 'pi-a\nnas-a --no-sudo\n' >"$work/hosts.conf"
"$PULL" -c "$work/hosts.conf" --push https://stocky.example.com --dry-run >"$work/pull-dry.out"
check 'stocky-fleet-pull.sh --dry-run lists targets' 2 "$(grep -c 'would collect via SSH' "$work/pull-dry.out")"

echo '# schema (docs/discovery-schema.json)'
if node "$ROOT/scripts/validate-schema.mjs" "$work/pi5.json" "$work/x86.json" "$work/kvm.json" "$work/synology.json" "$work/wsl2.json" "$work/nvidia.json" "$work/smartwarn.json" "$work/hostile.json" "$work/out.json" >"$work/schema.out"; then
  ok 'collector output validates across all 8 machine profiles'
else
  bad 'collector output validates' "$(cat "$work/schema.out")"
fi

if [ "$write_fixtures" -eq 1 ]; then
  mkdir -p "$FIX"
  run x86
  for pair in pi5:pi5-nvme x86:x86-desktop kvm:kvm-vps synology:synology-nas wsl2:wsl2-host nvidia:nvidia-workstation smartwarn:smart-warning hostile:hostile-strings; do
    src=${pair%%:*} dst=${pair##*:}
    sed -E 's/"collectedAt": "[^"]*"/"collectedAt": "2026-10-05T09:00:00+08:00"/' "$work/$src.json" >"$FIX/$dst.json"
    echo "wrote $FIX/$dst.json"
  done
fi
shopt -s nullglob
valid_fixtures=()
for f in "$FIX"/*.json; do
  case "${f##*/}" in invalid-* | vm-*) continue ;; esac
  valid_fixtures+=("$f")
done
if [ ${#valid_fixtures[@]} -gt 0 ]; then
  if node "$ROOT/scripts/validate-schema.mjs" "${valid_fixtures[@]}" >"$work/fix.out"; then
    ok "fixtures validate (${#valid_fixtures[@]})"
  else
    bad 'fixtures validate' "$(cat "$work/fix.out")"
  fi
fi
for f in "$FIX"/invalid-*.json; do
  if node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$f" 2>/dev/null; then
    bad "${f##*/} is meant to be invalid JSON"
  else
    ok "${f##*/} is invalid JSON (for the importer's invalid_json check)"
  fi
done

echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ]
