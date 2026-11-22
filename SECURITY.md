# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

Please do **not** open public GitHub issues for security vulnerabilities (such as authentication bypasses, cross-user data exposure, XSS in hardware snapshot fields, or container/supply-chain issues).

Instead, report vulnerabilities privately via GitHub Security Advisories (**Security → Advisories → Report a vulnerability**) or email `dev@0xwulf.dev` with:

- A description of the vulnerability and its impact
- Reproduction steps or a minimal proof of concept
- Affected Stocky version (shown in the About dialog's diagnostics line)

You can expect an initial acknowledgement within 72 hours.

## Security Model

- **Single-tenant / per-user isolated PocketBase backend:** Every collection enforces `user = @request.auth.id` on list/view rules. Public sign-up is disabled (`users.createRule = null`). Stock quantities, movement ledgers, serialized `units`, `imports`, `ingest_tokens`, and `pending_snapshots` are mutated exclusively through transactional server routes.
- **SHA-256 hashed ingest tokens:** Automated hardware ingest (`POST /api/stocky/ingest`) authenticates via scoped `stky_<random>` bearer tokens. Plaintext tokens are returned once at creation and never stored; only their SHA-256 hex digest is persisted and compared in constant time (`$security.equal`). Tokens can be scoped to a single host, a site, or the fleet and revoked immediately.
- **Untrusted snapshot sanitization & rate bounds:** Hardware discovery snapshots are parsed server-side with a 512 KB payload cap, maximum 200 items per snapshot, and 60 snapshots/hour rate limit. Control characters are stripped, string lengths are bounded, and all fields are rendered as inert text (never HTML).
- **Read-only POSIX collector (`tools/stocky-collect.sh`):** Collects hardware facts read-only using standard Linux utilities and `/sys` + `/proc`. `/etc/machine-id` is hashed locally with SHA-256 before leaving the host. When `--push` is used, the bearer token is read from a `0600` file or environment variable and passed to `curl` via stdin (`-H @-`) so it never appears in process listings (`ps`).
- **Non-root container & Trivy release gate:** The multi-arch (`linux/amd64`, `linux/arm64`) Alpine container runs as non-root `stocky` (`uid/gid 1000`), upgrades Alpine packages at build time, emits SBOM and SLSA provenance attestations, and passes a Trivy vulnerability gate that blocks publication on any fixable `CRITICAL` CVE.
