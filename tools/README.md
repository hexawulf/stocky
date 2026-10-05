# tools

## stocky-collect.sh

A read-only hardware snapshot of one physical Linux machine for Stocky's
discovery import (spec §13). It prints JSON (`stocky.discovery/1`, see
`docs/discovery-schema.json`) that you upload in Stocky under
Settings → Hosts → a host → Import discovery. Stocky shows a preview and writes
only what you confirm.

```sh
tools/stocky-collect.sh --dry-run                  # what it would read and run
tools/stocky-collect.sh -o ~/stocky-$(hostname).json
tools/stocky-collect.sh --no-sudo -o …             # skip the two sudo commands
```

- Needs only what a standard Ubuntu or Raspberry Pi OS install has (`lsblk`,
  `lscpu`, `/sys`, `/proc`). It uses `smartctl`, `lspci` and `lsusb` if present.
- `sudo -n` (never prompts) runs only `dmidecode` (x86 memory modules, board and
  system serials) and `smartctl -i` (drive serials behind USB bridges). Without
  sudo those are listed under `skipped` / `warnings`.
- Refuses VMs, containers and WSL with exit code 3 and no output.
- Logs to `~/logs/stocky-collect_YYYYMMDD_HHMMSS.log`.
- The output contains serial numbers and MAC addresses (needed for matching).
  `/etc/machine-id` is only sent as a SHA-256 hash.

**Copies elsewhere** (for example in a scripts repository you deploy to your
machines) should record the Stocky commit they came from in the `# Source:`
header line, and be updated only by copying a newer version from here, never
edited in place (spec §13.2.1).

## test-collect.sh

Runs the collector against fake machines (fake `/sys`/`/proc` trees and
stubbed commands, via the test-only `STOCKY_COLLECT_ROOT`) and validates the
output against the schema. Part of `npm run test:api`.
`tools/test-collect.sh --write-fixtures` regenerates `fixtures/pi5-nvme.json`,
`x86-desktop.json` and `hostile-strings.json`.
