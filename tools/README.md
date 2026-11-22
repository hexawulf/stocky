# tools

## stocky-collect.sh (v2.0.0)

A read-only hardware snapshot of a Linux machine for Stocky's discovery import
and automated fleet ingest. Prints JSON (`stocky.discovery/2`, see
`docs/discovery-schema.json`) to stdout, `-o FILE`, or pushes directly to
Stocky's `/api/stocky/ingest` endpoint via `--push URL`.

Supports bare-metal Linux, Raspberry Pi / ARM64 SBCs, Cloud KVM VPSes,
Synology DSM NASes, and WSL2 (`--physical-only` restores v1's exit-3 refusal
of virtual machines and containers).

```sh
# What it would read and run:
tools/stocky-collect.sh --dry-run

# Automated push using a scoped ingest token file (mode 0600, never visible in ps):
tools/stocky-collect.sh --push https://stocky.example.com --token-file ~/.config/stocky/ingest.token

# Print ready-to-install nightly cron or systemd user timer:
tools/stocky-collect.sh --push https://stocky.example.com --token-file ~/.config/stocky/ingest.token --print-cron
tools/stocky-collect.sh --push https://stocky.example.com --token-file ~/.config/stocky/ingest.token --print-systemd

# Offline JSON file for manual upload in Stocky → Import:
tools/stocky-collect.sh -o ~/stocky-$(hostname).json
```

- Needs only standard Linux utilities (`lsblk`, `lscpu`, `/sys`, `/proc`).
  Uses `smartctl`, `lspci`, `lsusb`, and `nvidia-smi` if present.
- `sudo -n` (never prompts) runs only `dmidecode` (x86 memory modules, board
  and system serials) and `smartctl` (drive serials and SMART health/temperature).
  `--no-sudo` skips both cleanly.
- Served directly by every running Stocky container at `/tools/stocky-collect.sh`
  alongside `/tools/stocky-collect.sh.sha256`.
- Logs to `~/logs/stocky-collect_YYYYMMDD_HHMMSS.log` (never logs the token).

## stocky-fleet-pull.sh

Central read-only SSH collector for hosts that cannot push inbound to Stocky
(such as Synology NAS boxes or isolated LAN / WireGuard nodes). Reads a host
list (`tools/hosts.conf.example`), streams `stocky-collect.sh` over SSH, and
posts each snapshot to `/api/stocky/ingest`.

```sh
tools/stocky-fleet-pull.sh -c ~/.config/stocky/hosts.conf \
  --push https://stocky.example.com --token-file ~/.config/stocky/ingest.token
```

## test-collect.sh

Runs the collector against 8 fake machine profiles (Pi 5 with NVMe, x86 desktop,
KVM cloud VPS, Synology DSM NAS, WSL2 host, NVIDIA GPU workstation, SMART
warning host, and hostile strings) and validates output against
`docs/discovery-schema.json`. Part of `npm run test:api`.
`tools/test-collect.sh --write-fixtures` regenerates the committed fixtures in
`tools/fixtures/`.
