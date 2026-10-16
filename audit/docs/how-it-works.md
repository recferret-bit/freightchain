# How the Multi-Agent Audit Suite Works

> **Visual HTML Explainer**: Open [`audit/docs/index.html`](index.html) (`audit/docs/style.css`) in any browser for interactive SVG architecture diagrams, lifecycle charts, CLI isolation cards, and scoring charts styled identically to `report.html`.

---

## 1. Overview & Design Goals

The audit suite audits any local repository (`--repo <path>`) or remote GitHub repository (`--github <owner/repo>`) using four local agentic CLIs (**`claude`**, **`codex`**, **`grok`**, **`agy`**) while enforcing two strict invariants:

1. **All builds, tests, static scanners, lead harnesses, file reads, searches, and PoCs execute inside a single disposable one-shot Docker container (`audit-sandbox:local`, running as `uid 10001:10001`).**
2. **The one-shot Docker container is airgapped before any AI agent connects, and is guaranteed to be killed and removed (`docker rm -f`) when the audit completes.**

---

## 2. End-to-End Architecture

```mermaid
flowchart LR
    subgraph Host["Host Machine"]
        Orch["docker-agent-orchestrator.mjs<br/>(Lifecycle & Scheduling)"]
        CLIs["Local Agentic CLIs<br/>claude · codex · grok · agy<br/>(Empty /tmp cwd, host tools OFF)"]
        Bridge["docker-mcp-bridge.mjs<br/>(JSON-RPC 2.0 MCP Stdio)"]
        Reports["Saved Report Directory<br/>audit/reports/&lt;ts&gt;-&lt;repo&gt;/"]
    end

    subgraph Docker["One-Shot Docker Container (audit-sandbox:local, uid 10001)"]
        Inside["sandbox-inside.mjs + harness.mjs<br/>(Builds, Tests, Scanners, 31 Lead Rules)"]
        FS["/work/src · /out/harness<br/>/out/pocs · /out/auditors"]
    end

    Orch -->|"1. Boot & hold"| Inside
    Inside -->|"2. Write leads & airgap"| FS
    Orch -->|"3. Spawn per surface"| CLIs
    CLIs <-->|"stdio JSON-RPC"| Bridge
    Bridge <-->|"docker exec --user 10001:10001"| FS
    Bridge -->|"4. Validated JSON/MD"| Reports
    Orch -->|"5. Kill container & adjudicate"| Reports
```

---

## 3. The 5 Lifecycle Stages

### Stage 1: Target Resolution & Sealed Source Manifest
- `audit/bin/audit` and `audit/scripts/resolve-target.sh` resolve `--repo <path>` (in-place directory) or `--github <url>` (shallow clone with git hooks disabled into `/tmp/audit-targets`).
- `docker-agent-orchestrator.mjs` captures a SHA-256 manifest of all audited text files (`source-manifest.json`).

### Stage 2: One-Shot Docker Boot, In-Container Scanners & Network Airgap
- `docker-agent-orchestrator.mjs` starts `audit/scripts/sandbox.sh` with `--hold-file <hold.lock>` and `--ready-file <ready.json>`.
- `sandbox-lib.mjs` copies a sanitized tree into the Docker volume at `/work/src`, stripping `.env`, keypairs (`id.json`, `*.pem`, `*.key`), `.ssh`, `.aws`, `.git`, `node_modules`, and `target`.
- Inside `audit-sandbox:local` (running as `10001:10001` with `--cap-drop ALL` and `--security-opt no-new-privileges`), `sandbox-inside.mjs` runs:
  1. **`harness.mjs` + `audit-plans.mjs`**:
     - Generates `/out/harness-leads/{summary,solana,web,config,deps,tools}.md` (31 regex patterns covering Sealevel, Trail of Bits instruction introspection, Ackee vectors, escrow invariants, OWASP sinks, and CI/container risks, plus `gitleaks`, `semgrep`, `cargo-audit`, and `osv-scanner`).
     - Detects the project's active protocols & risk domains (`http`, `grpc`, `websockets`, `databases`, `crypto`, `scopes_roles`, `bots_economy`, `api_dto_abuse`) and writes `/out/harness-leads/stack-profile.json` and `/out/harness-leads/attack-plans.md` with dedicated attack checklists and `file:line` entry-point leads.
  2. **Builds & tests**: `cargo build`, `cargo test --locked`, `anchor build`, `cargo-build-sbf` (when Solana version is pinned), `npm/pnpm/yarn audit`, and local OWASP ZAP.
- When `sandbox-inside.mjs` writes `/out/checks.done`:
  - `sandbox.sh` copies `/out/harness-leads/*.{md,json}` and `sandbox.md` to `<report-dir>/harness/` and `/out/harness/`.
  - **Airgapping**: `sandbox.sh` disconnects the container from the allowlist proxy network (`docker network disconnect`) and terminates the proxy container.
  - `sandbox.sh` writes `ready.json` with `{ container, hostRunDir }` and waits while `hold.lock` exists.

### Stage 3: Multi-Agent Surface Audit via MCP Stdio Bridge & Staged Skill
- For each scheduled surface job (`<agent>-<s1..s6>-<slug>`), `docker-agent-orchestrator.mjs` creates an isolated, empty `0700` temp directory on the host, stages the `security-audit` skill (`SKILL.md`) into `.claude/skills/security-audit/SKILL.md` and `.agents/skills/security-audit/SKILL.md`, injects the surface-specific attack plans and skill guidance into the prompt, and launches the agent CLI connected to `docker-mcp-bridge.mjs`:
  - **`claude`**: `--print --strict-mcp-config --mcp-config mcp.json --tools "" --permission-mode dontAsk --allowedTools mcp__audit_docker__*`
  - **`codex`**: `codex exec --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules -s read-only -C <workDir> -c mcp_servers={audit_docker={...}} -c model_reasoning_effort="high" -m <model> -`
  - **`grok`**: `grok -p <prompt> --cwd <workDir> --trust --tools "" --always-approve --permission-mode bypassPermissions --no-subagents --disable-web-search -m <model>` (with `<workDir>/.grok/config.toml`)
  - **`agy`**: `agy --output-format stream-json --dangerously-skip-permissions --disable-slash-commands --model <model> --print="<prompt>"` (with `<workDir>/.agents/plugins/audit-docker/{plugin.json,mcp_config.json,hooks.json}` blocking host tools via a `PreToolUse` hook)
- Every MCP tool carries `annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }` so non-interactive CLIs auto-approve calls to `audit_docker`.
- Grok's `--trust` applies only to the generated workspace and its bridge config, never the target repository. Without folder trust the project MCP server is skipped. AGY hook files use named definitions and a default-deny allowlist for the audit MCP server, staged skill reads and completion; all other tools and integrations are blocked. Codex excludes global configuration/hooks with `--ignore-user-config` while retaining native authentication.
- Reviews have no runner time limit. Every 30 seconds a heartbeat records elapsed time and time since the last output; quiet reasoning keeps its transport and inspection tools available. Private heartbeat records mark process exits, and Ctrl-C/SIGTERM cancels owned resources. Actual failures and provider limits remain incomplete even if report files exist; missing verdicts/citations are never synthesized. Absent surfaces still submit an explicit empty report.

A saved AGY review can be finalized separately through the internal request API (`resume: {fromReport, conversationId, sourceDigest}`). The parent verifies the original timed-out job, model, conversation and source digest. The unlimited completion phase exposes submission only, starts no container, and explicitly reuses prior coverage records; the failed original job remains unchanged.

### Stage 4: Peer Cross-Check Pass & Guaranteed Teardown
- Once all surface auditors finish, `loadAuditorFindings()` collects every reported finding.
- Each agent is invoked a second time (`--role crosscheck`) with the claims reported by the **other** models (`<report-dir>/crosscheck/<agent>.json`).
- Reviewers inspect the cited `file:line` locations inside the container via `read_file` / `search_code` / `run_container_check` / `get_attack_plan` and call `submit_crosscheck_report` with `upheld`, `partial`, or `refuted` verdicts (`auditors/crosscheck-<agent>.json`).
- **Guaranteed Teardown**: In the orchestrator's `finally` block (and `SIGINT`/`SIGTERM` handlers), `session.stop()` deletes `hold.lock`, waits for `sandbox.sh`'s `trap finish EXIT` cleanup, and runs `docker rm -f <container>` so no container, volume, or network is ever left behind.

### Stage 5: Quorum Adjudication & HTML Report Generation
- `verify-and-adjudicate.mjs` validates all auditor JSON/Markdown outputs against `report-contract.mjs`, clusters findings with matching normalized titles and overlapping `file:line` citations, applies cross-check verdicts, and writes:
  - `findings-and-scores.json`
  - `verified-safe.json`
  - `report-health.json` (`validated_outputs` or `incomplete`)
- `generate-html-report.mjs` renders standalone, offline-ready `report.html` and `findings-by-model.html`.

---

## 4. Stack Detection & 8-Domain Attack Plans (`audit-plans.mjs`)

| Domain ID | Subsystem / Focus | What It Detects & Audits |
|---|---|---|
| `http` | **HTTP / REST / GraphQL** | Route/controller inventory, default-deny guards, `@ZodBody/@ZodQuery/@ZodParams` schema validation, CSRF (`SameSite`, `Origin`, `__Host-`), `CORS: *` vs credentials, rate limits. |
| `grpc` | **gRPC & Protobuf** | `.proto` services & `rpc` methods, `@GrpcMethod`/`@GrpcStreamMethod` auth interceptors, proto3 zero-value traps (`0`, `""`, `false`), stream floods, `maxReceiveMessageLength`, reflection exposure. |
| `websockets` | **WebSockets & Realtime** | `@WebSocketGateway`/`@SubscribeMessage`/`socket.io`/`ws`/SSE, handshake vs per-frame auth revocation, room/channel join IDOR (`socket.join`), CSWSH `Origin` checks, frame backpressure. |
| `databases` | **Databases & Row Locking** | Prisma/SQL/NoSQL/Redis, atomic single-transaction mutations under pessimistic row locks (`SELECT ... FOR UPDATE` / `findByWalletForUpdate`), canonical lock ordering, TOCTOU check-then-act races, raw SQL/Redis injection. |
| `crypto` | **Crypto, Web3 & Custody** | SIWS / Ed25519 challenge byte-for-byte binding & replay protection, Merkle root/proof leaf domain separation, `mulberry32` / CSPRNG vs `Math.random()`, Solana/Anchor signer/owner/PDA/CPI/escrow invariants. |
| `scopes_roles` | **Scopes & Roles Misvalidation** | Horizontal IDOR on `:id` / `rideId` / `poolId` / `wallet` routes, vertical role & host-plane bypass (`fc_admin` on `admin.<domain>`), cross-scope confusion (demo/guest/free-ride vs paid pool). |
| `bots_economy` | **Bot Resistance & Economy** | Headless bot bypass of paid prize games, telemetry forgery, stripped traffic collisions, cross-rider replay copying, seed lookahead before ticket commitment, sale cutoff/deadline/revocation bypass, sybil promo/free-tier farming. |
| `api_dto_abuse` | **API Abuse & Response DTOs** | Enumeration oracles in error/response messages (e.g. `"user already registered"`, `"promo already used"` — double-checked in source), over-broad DTOs leaking raw ORM rows/seeds/internal flags, unbounded batch/query abuse. |

---

## 5. MCP Bridge Tool Reference (`docker-mcp-bridge.mjs`)

| Tool | Role | Container Roots | Description |
|---|---|---|---|
| `get_audit_context` | `auditor`, `crosscheck` | `/out/harness`, `/out/crosscheck` | Returns container ID, assigned surface, skill checklist, detected stack plans, `harness/summary.md`, `solana.md`, and assigned peer claims. |
| `get_attack_plan` | `auditor`, `crosscheck` | `/out/harness` | Returns the dedicated attack check plan and codebase `file:line` leads for `http`, `grpc`, `websockets`, `databases`, `crypto`, `scopes_roles`, `bots_economy`, `api_dto_abuse`, or `all`. |
| `list_files` | `auditor`, `crosscheck` | `/work/src`, `/out/*` | Lists files and sizes up to depth 6 inside the container. |
| `read_file` | `auditor`, `crosscheck` | `/work/src`, `/out/harness` | Reads up to 400 lines with 1-based line numbers (`1: ...`). |
| `search_code` | `auditor`, `crosscheck` | `/work/src`, `/out/harness` | Searches files inside the container by regex or literal string, returning `file:line: snippet`. |
| `run_container_check` | `auditor`, `crosscheck` | `/work/src` | Runs allowlisted commands (`cargo`, `anchor`, `rustc`, `osv-scanner`, `gitleaks`, `semgrep`, `node`, `npm`, `grep`, `find`, etc.) as `uid 10001`. |
| `write_poc` | `auditor`, `crosscheck` | `/out/pocs/<auditor>` | Saves a PoC file and optionally compiles/runs Rust `#[test]` PoCs via `cargo test --locked --test <name>`. |
| `submit_audit_report` | `auditor` | `/out/auditors/<auditor>.{json,md}` | Validates and writes the auditor's final `.json` and `.md` surface report. |
| `submit_crosscheck_report` | `crosscheck` | `/out/auditors/crosscheck-<agent>.json` | Validates and writes peer cross-check verdicts (`upheld`, `partial`, `refuted`) for all assigned claims. |

---

## 6. Scoring Formula

Each clustered finding receives a heuristic priority score (`0.0` – `10.0`):

$$\text{Score} = \text{SeverityWeight} \times \text{StatusMultiplier} \times \text{ConfidenceFactor}$$

- **Severity Weights**: `critical = 10.0`, `high = 8.5`, `medium = 5.5`, `low = 2.5`, `info = 1.0`
- **Status Multipliers**:
  - `MODEL_AGREEMENT` (2+ independent first-pass models cite overlapping `file:line`): `× 0.80`
  - `UPHELD_REVIEW` (single model, upheld by peer cross-check): `× 0.75`
  - `PARTIAL_REVIEW` (mixed/partial peer cross-check): `× 0.70`
  - `MODEL_ASSERTION` (unreviewed single model claim): `× 0.60`
  - `REFUTED_REVIEW` (all peer cross-checkers refuted): `× 0.00`
- **Confidence Factor**: `confirmed = × 1.00`, `probable = × 0.85`
