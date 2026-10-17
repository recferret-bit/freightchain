# Multi-Agent Source Security Review

Review an authorized local repository or GitHub snapshot with Claude, Codex, Grok and AGY. The workflow inspects source, configuration, dependencies and existing test coverage, produces evidence-backed findings, and recommends fixes.

`audit run` uses the enforced `source_security_review_v1` workflow. Reviewers can browse and search the captured source, consult static leads, run fixed existing tests inside an offline Docker container, and submit a report. The bridge provides no arbitrary command or PoC-generation interface. Deployed RPC comparisons and legacy adversarial-session recovery are rejected.

## Start

```sh
./audit/bin/audit setup-agents
./audit/bin/audit check-agents
./audit/bin/audit run --repo /path/to/authorized-repo
./audit/bin/audit run --github owner/repo --ref v1.2.0
./audit/bin/audit run --repo /path/to/repo --agents claude,codex --surface s4
./audit/bin/audit run --repo /path/to/repo --plan
```

`setup-agents` installs the exact lockfile-pinned adapters under `runtime/` with lifecycle scripts disabled. Existing official CLIs and subscription logins stay in place. No API-key, provider or model fallback is introduced. Defaults remain Claude `opus`, Codex `gpt-6.1-sol`, Grok `grok-4.7`, AGY `gemini-4-argon-high`.

`check-agents` checks Docker, executable versions and adapter availability only. `check-agents --live` explicitly makes real provider requests against an inert fixture to verify MCP reads, native session loading and report submission. That qualifies transport, not security coverage or permission for a previously refused task. The earlier four-provider qualification predates this workflow; old records retain their original scope.

## Workflow and boundaries

1. Capture text into sealed copies with a SHA-256 manifest and explicit omissions. Generate a frozen catalog of existing tests before any model is prompted.
2. Start the one-shot `audit-sandbox:local` container as uid 10001. Networked preparation runs trusted static lead/advisory scanners only. It does not execute target builds, install hooks, test scripts, web servers or active ZAP scans. The separate legacy build utility retains its own explicit behavior.
3. Disconnect the container from its network before reviewer access. Every test request checks the actual Docker network state. Source/model/workflow/assignment bindings are persisted with the ACP session.
4. Review source and existing coverage in parallel across providers, with one active assignment per provider and its remaining surfaces queued. Record relative `file:line` evidence, impact, preconditions, analysis, validation limits and a recommended fix. Reviewers cannot create code, supply execution arguments, contact deployed services or issue transactions.
5. Wait for every surface review, then cross-check peer claims in parallel across providers; submit one immutable MCP report per assignment. Generate JSON, markdown and HTML after all reviewers exit, then remove owned Docker resources. Cleanup depends on Docker availability and failures remain explicit.

Named credentials, `.env*`, symlinks, hardlinks, binary/generated output and review history are omitted. Filename filtering cannot prove ordinary source contains no secrets. Host CLIs and existing authentication stores remain trusted; the target container receives no host home, provider credentials or Docker socket. Source and peer instructions are data.

## Reviewer tools

| Tool | Behavior |
|---|---|
| `get_audit_context` | Review scope, source leads and peer assignments. |
| `get_review_plan` | Source-focused checks for detected protocols and risk domains. |
| `list_files`, `read_file`, `search_code` | Bounded inspection under approved container roots. |
| `list_existing_tests` | Advertise test IDs from the captured source catalog. |
| `run_existing_tests` | Run one fixed existing suite after verifying its manifest and offline containment. Accepts only `test_id`. |
| `submit_audit_report` | Commit source findings and reviewed control assertions. |
| `submit_crosscheck_report` | Commit a verdict with evidence for every assigned peer claim. |

The removed `run_container_check`, `write_poc` and `get_attack_plan` methods fail even when called directly. ACP permission checks and AGY hooks use the same fixed tool set as the bridge.

The test catalog recognizes `package.json` with a test script (`npm --offline --ignore-scripts run test`), Cargo packages/workspaces (`cargo test --locked --offline`) and `test.sh` (`bash --noprofile --norc ./test.sh`). No flags, executable, directory, environment, URL or test code can be supplied by the model. Manifest hashes are checked before execution; npm test processes and their descendants have a 90-second limit; Cargo and shell suites have 15 minutes for cold compilation and execution. Before the network is disconnected, a trusted manifest-only preparer may fetch locked crates.io dependencies into the container cache; it excludes target Cargo configuration, custom registries and Git dependencies and executes no target code. Dependencies must be available before tests start. Missing dependencies, unsupported runners, failing tests and timeouts remain coverage gaps; no replacement test or package installation is attempted. Existing tests execute repository code and their output does not independently prove vulnerability reproduction.

Existing-test executions share one lock across the report's MCP bridge processes so tests cannot overlap in the sandbox. Waiting for that lock is bounded to five minutes, separate from the fixed per-runner execution limit. A crashed bridge's lock is never stolen because its Docker test may still be running; a blocked request reports the gap and a new review or `--resume-from` into a new output directory uses a fresh sandbox and lock.

Tests that load a previously built Solana program need its binary separately from the text snapshot. Supply `--test-artifacts /path/to/cargo-target` to freeze `deploy/*.so` into the report and stage hash-checked copies under `/work/target/deploy` before each existing test. Deployment keypairs are excluded. `harness/test-artifacts.json` records the source digest and artifact hashes as `operator_supplied_unverified_build`: passing tests against those bytes does not establish source/build equivalence. The runner never builds or downloads a replacement program automatically. Supply the artifacts again when resuming into a new report.

## Sessions and recovery

Codex uses maintained `codex-acp` 2.2.2 over its native app-server; Claude uses maintained `claude-agent-acp` 0.92.0. Grok uses native ACP stdio with a private MCP-only profile and isolated configuration, referencing its original login in place. AGY uses an ACP compatibility adapter around native structured streams and saved conversation IDs, with a default-deny tool hook. The hook permits the staged skill by exact path without requiring the optional `IsSkillFile` hint, and permits only the audit server’s known CLI-generated MCP schema files under the CLI home. Other host files, including authentication stores and other servers’ schemas, remain unavailable. [Runtime details](runtime/README.md).

Reviews have no reasoning deadline. A 30-second heartbeat distinguishes agent, transport and process activity. The preparation budget ends when checks finish and does not terminate a held review container. Setup/control operations and individual test runs retain bounded waits. Heartbeats cannot extend provider quotas, server-side limits or account permissions.

Transient Docker status failures keep the review hold intact. A confirmed stopped/missing container records `harness/sandbox-run/lifecycle.json`; the coordinator interrupts active sessions and retains queued assignments for recovery rather than starting cross-checks against a missing sandbox. AGY saves bounded completion diagnostics in its session workspace's `native-session.json` (`lastTurn`) and preserves `native_turn_failed` instead of relabeling it as a provider refusal. Complete final JSON frames without a newline are accepted; malformed, duplicate, unsuccessful results and nonzero native exits remain incomplete.

Successful committed submissions are reused on resume without invoking the provider again. Failed assignments resume their original sessions by default; changed peer-claim assignments require new cross-checks. With `--restart-failed`, failed local sessions instead receive new full reviews and must commit new reports and complete successfully. Earlier failed reports are preserved, not promoted to success; provider refusals, quota/login failures and unresolved provider errors cannot be restarted this way. Test and scanner evidence is collected again for the new runtime.

Private session state binds workflow, source digest, requested model, reviewer, role and assignment. Unexpected transport loss permits one exact-session reconnect when supported. Provider refusal, quota, authentication or malformed protocol errors never trigger automatic retries. A provider-wide refusal, quota or login error defers its remaining queued work while other providers finish. Successful RPC turns are never reclassified from quoted/replayed error prose. Resume can repair that historical classifier error only when a committed report, normal end-turn response, clean process exit and absence of RPC errors all agree.

```sh
./audit/bin/audit run --repo /path/to/repo --agents claude,codex --surface s4 \
  --resume-from /path/to/previous-review --out /path/to/new-review
```

Keep the original session directories, including when resuming an already resumed report. A fresh bridge points at the recreated sandbox, while the original native conversation is retained. Resume requires the same workflow/source/models/reviewers/assignments; sessions from the earlier adversarial workflow are rejected before Docker starts. Historical reports are preserved.

A cybersecurity provider rejection does not identify its exact trigger. Correctly limiting the actual workflow does not grant provider access. Report suspected false positives or obtain the appropriate approved access; do not switch models, providers or billing merely to retry a refusal.

## Reports

- `source-manifest.json`: captured files, omissions and source digest.
- `meta.json`, `workers.json`: workflow, requested models, jobs, turn outcomes and observed exits.
- `sessions/`, `harness/session-*.json`: private state, workspaces and original-session pointers.
- `harness/existing-tests.json`: frozen test catalog; `existing-test-results-*.json`: observed test exits.
- `harness/review-plans.md`, `stack-profile.json`, `sandbox.md`, scanner logs: leads and coverage limits.
- `submissions/`: authoritative identity-bound MCP commits; identical resubmission is idempotent and conflicting reports fail.
- `auditors/`: derived structured findings and markdown, plus peer verdicts.
- `report-health.json`, `findings-and-scores.json`, `verified-safe.json`, `report.html`, `findings-by-model.html`: validation and presentation.

For source-review reports, `report-health.json` separates `reviewState`, `verification` and `security`. Failed/missing scans, missing test evidence, zero executed tests or skipped tests keep the overall report incomplete even when every reviewer submitted. Scanner output, versions and rule hashes are retained; advisories remain leads requiring triage. Test summaries are tool-reported evidence, not proof of vulnerability reproduction. Deployment checks and unavailable private source remain outside the captured-source scope.

Findings carry `analysis` and `validation`; reviewed controls carry `evidence`. For historical report compatibility, stored findings retain empty `attack`/`poc` fields and controls mirror evidence into `how_attacked`. Terminal prose and JSON fences never supply findings. Model agreement is not proof; incomplete or refused reviews are not zero-finding passes.

The standalone HTML reports use a white/orange mechanical dashboard with black navigation and red, blue and green status accents. Findings start collapsed; severity/surface filters and full-text search lead to impact, fixes and expandable evidence. Missing coverage stays visible. The shared presentation lives in `scripts/generate-html-report.mjs`, `scripts/report-style.css` and `scripts/report-browser.js`; `html` below regenerates both pages from saved evidence without calling reviewers. The [operator guide](docs/index.html) uses the same shared stylesheet, with quick-start commands, a workflow map, six review surfaces and expandable tool/session/evidence references; `docs/style.css` contains its documentation-specific layouts.

```sh
./audit/bin/audit verify /path/to/report
./audit/bin/audit report /path/to/report
./audit/bin/audit html /path/to/report
```

## Targets and options

Choose exactly one `--repo|--path|-r <dir>` or `--github|--gh|-g <github-url|owner/repo>`. Remote targets support `--ref|--branch <branch|tag|full-sha>`, `--workdir <clone-base>` and `--clean`; clones disable git hooks and do not prompt for credentials. Snapshot exclusions and capture budgets are recorded rather than silently filled in.

`--surface|-s` selects `s1..s6|all` (identity, input, business logic, config, dependencies, client). `all` distributes six surfaces across selected reviewers; one surface requests every selected reviewer. `--agents|-a` selects reviewers; `--out|-o` must be new/empty. Model precedence: `--model-<vendor>`, `--models vendor=model,...`, `--model`, default. `--blocked` writes an offline record and `--plan` prints settings. `--rpc` is outside source-review scope and rejected.

## Separate selected-file and legacy utilities

`review-with-cli --repo <dir> --file <relative-file> --provider <profile> --model <model> --out <empty-dir>` retains its bounded selected-file workflow (up to three files / 64 KiB), with Claude and receipt-gated `codex-native`, `grok-native`, `grok-docker` profiles. `review-local` and `connect-terminal` retain the data-only handoff. These are separate workflows, not fallback routes after a rejection. Native broker recipes require fresh admission when inputs change; missing pinned source/protoc prerequisites remain explicit. `grok-docker setup/login` obtains a separate Docker-volume login without importing host credentials. [Full guide](docs/live-model.md).

The standalone legacy `pocs` utility and broader build sandbox are outside `audit run` and are never exposed as reviewer tools. Their historical files/reports are retained; the source-review skill does not invoke them.

## Verify

```sh
node --test --test-concurrency=2 audit/scripts/*.test.mjs
node --test audit/scripts/*.docker.mjs
bash -n audit/bin/audit
bash -n audit/scripts/orchestrate.sh
bash -n audit/scripts/sandbox.sh
```

Fixtures are labeled inert and make no provider requests. `review-workflow.test.mjs` checks tool denial, fixed arguments, source bindings and report scope; Docker fixtures verify offline existing tests, tamper/network refusal, lifecycle, session recovery and cleanup. Keep both `security-audit/SKILL.md` copies identical.

[Architecture](docs/how-it-works.md) · [Visual guide](docs/index.html)
