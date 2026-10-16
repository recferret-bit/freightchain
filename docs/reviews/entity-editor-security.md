# Entity editor: three-pass application and security review

Reviewed branch: `entity-editor`, starting at `e5e89d7d67d4fc1958ad7716eeb98422e7a6e932`.
Review date: 2026-10-15. Changes are local; no production deployment or live model-provider call was performed.

## Scope and passes

1. **Application and asset workflow:** literal-only source parser, expression interpreter, entity validation, materials and references, browser/game builders, drafts, revisions, restoration and publication. Reproduced the broken MCP diff, malformed-data failures, missing material bindings, unbounded painter work and excessive diff allocation; fixed these and added regressions.
2. **MCP and AI boundaries:** HTTP/stdio tools, capability tokens, authentication/authorization, job scope and concurrency, prompt/tool-output handling, provider histories and budgets, Redis counters, browser state races and cancellation. Fixed revision overwrites, endpoint budget multiplication, unsafe outage fallbacks, redirect handling, cumulative output limits and stale browser work.
3. **Adversarial verification and infrastructure:** reran application tests, actual PostgreSQL/Redis races, real Chrome and model parity; built and started the production MCP/Redis services in an isolated local Compose project. This caught Redis ACL CLI argument parsing and ioredis URL/password precedence during implementation; both were corrected and verified against the real services. Added publication-stamp and canonical-source-size regressions discovered during this pass.

## Findings and fixes

| Priority | Finding | Result |
|---|---|---|
| High | AI saves used the current HEAD and could overwrite a human edit made after job creation. | Admission records the starting revision even when omitted by the caller. A newer foreign HEAD produces `409 stale_base`; the same job can revise its own drafts. Unit, HTTP and PostgreSQL race tests cover this. |
| High | Nest's default rate-limit keys include the controller method, multiplying budgets when callers switch endpoints. | Auth, entity, editor and callback budgets aggregate across controllers/methods, while retaining distinct IP/wallet/job trackers and RPS/minute windows. Actual two-app Redis tests prove shared enforcement and IP separation. |
| High | Protected Redis limits fell back to independent process-local allowances during outages. | Auth/editor/MCP buckets fail closed. Public counters retain a bounded local fallback. |
| High | Counter-map overflow cleared every local budget; Redis eviction could also remove active counters. | Expired entries are pruned; a full live map rejects new keys without clearing existing counters. Production Redis uses `noeviction`. |
| High | MCP HTTP RPS counters were process-local. | Production MCP requires Redis and uses an atomic expiring per-IP counter. A restricted `fc-mcp` ACL permits counter operations only under `fc:mcp-rl:*`; it cannot read app data or run DEL or administrative commands. |
| High | Redirects could forward custom job-token headers away from their configured endpoint. | Both HTTP directions reject redirects. Regression servers verify that the destination receives no capability token. |
| High | Geometry limits did not bound facade painter loops or validate resolved material capabilities. | Validation rejects nested face-material lists and checks resolved slots and painter availability through references, finite/integer colours and flag indices, facade grids, and light/banner dimensions. Facade iteration and sign fitting are bounded at runtime as well. Invalid inputs produce validation errors rather than unexpected exceptions. |
| High | Output-token allowance restarted on every model turn and Anthropic continuation. | All provider adapters reduce their remaining allowance by accumulated output; the agent stops before more tool work at the cumulative cap. Exhausted Anthropic continuations fail explicitly. |
| Medium | Unexpected SDK/transport errors could be copied into logs and chat with embedded credentials. | The job runner and MCP HTTP error logger discard raw exception messages. Known provider errors still produce fixed useful sentences. |
| Medium | MCP initialization ignored job cancellation and used the SDK's default timeout. | Initialization receives the job signal, has a 10-second timeout and closes failed connections. Cancellation revokes the database capability before returning to the caller. |
| Medium | The HTTP transport accepted browser-origin requests and unknown Host values; local mode listened on every interface. | Browser Origins and unknown Hosts are refused before tool work; development binds loopback. POSTs require JSON, spec inputs are typed/bounded, and oversized bodies return a real 413. |
| Medium | `diff_entity` shadowed its list-clipping helper with a string and failed on every call. | The tool now works, distinguishes missing entities from backend failures and has equality/change regressions. |
| Medium | Browser LCS diffs could allocate a quadratic table for newline-heavy 64 KB files. | Above two million cells, diffing uses a linear middle comparison. The history view renders at most 500 changed lines. |
| Medium | Late HEAD responses, polls and historical replays could act on a different selection/session; helper-part drafts could move the selected entity. | HEAD reads use generations and identity checks. Chat guards stale work, paginates historical events, preserves the requested entity during helper creation and stops following logged-out sessions. Selector keyboard input stays out of viewer controls. |
| Medium | Aggregate throttles exposed normal UI request bursts; named Nest buckets lacked the standard retry header. | The API emits standard `Retry-After`. The client retries explicit pre-handler throttle refusals at most twice, while daily job caps remain final. |
| Medium | The stdio file backend could follow linked seed paths. | Linked files/directories and hardlinked seeds are refused; writes use `O_NOFOLLOW`. |
| Medium | A referenced prop without debris could throw in the actual three.js builder. | Missing debris is treated as an empty list. |
| Medium | Production bundle invalidation used count/max timestamp; simultaneous publications could have the same fingerprint. The memory implementation hid that discrepancy. | Production and memory repositories use count plus summed monotonic row versions; PostgreSQL verifies publications at the exact same timestamp still change the fingerprint. |
| Medium | A compact accepted source could expand beyond the 64 KB limit when canonicalized, leaving an unreusable stored file. | Server and file-backed saves bound the canonical source before writing. |
| Medium | Successful app health did not prove the MCP was running or its Redis access worked; rollback assumed every older release had MCP. | MCP waits for healthy Redis, its own health checks Redis readiness, release success waits for MCP health, and rollback handles releases without an MCP service. |

Priority describes potential impact within this editor's trust boundary. Draft editing requires an allowlisted wallet or an active scoped job; these are not claims that every finding was remotely exploitable by an anonymous visitor.

## Current 3D workflow and injection boundary

The architecture remains data-only: canonical entity source → shared parser/validator/interpreter → the same builder in the viewer and game. Entity data cannot execute JavaScript. Gameplay contracts remain in the roster/shared simulation. Creating a new viewer entity does not automatically place it on a route.

The model receives seven locally defined narrow tools and fenced untrusted text; it has no shell, arbitrary URL fetcher, provider key, wallet signing key or publish tool. The server independently enforces a running job, current editor permission, target scope, at most four new helper entities, entity validation and revision concurrency. Publication remains a separate wallet-signed, audited operation.

Prompt formatting cannot prove that a model never obeys hostile text. The bridge now owns its system instructions and tool schemas, validates arguments independently, and requires an exact successful source/id check before each save. Remote MCP prompts are never fetched or elevated to system instructions. Server-enforced authority and human publication remain necessary even if a model follows an injected instruction. Text from notes, tool outputs and models is rendered as text, not HTML.

## Verification

| Check | Result |
|---|---|
| Root `npm run check` | Passed: client lint/bundle/headless and 132 unit checks; 126 landing checks/build; server build/typecheck and 2,062 tests across 345 files; MCP and media checks. The final MCP Redis credential change was additionally verified separately below. Root checks were repeated after dependency hardening; focused regressions cover the final cancellation/material guards. |
| Full `npm run server:integration` | Passed: 517 tests across 46 files, using `freightchain_entity_editor_review_test`, never the development database. |
| Final affected PostgreSQL/Redis suites | Passed: 11 tests, covering publication fingerprints, concurrent human/AI drafts and Redis isolation. |
| `TEST_REDIS_URL=redis://127.0.0.1:16389 npm --prefix mcp test` | Passed: all 13 tests, including real restricted-user authentication, special characters in the credential and atomic shared limits. Without `TEST_REDIS_URL`, that external-service case is skipped. Use a throwaway local Redis; the test creates/removes its `fc-mcp` user. |
| Real Chrome editor | Passed: stranger refusal, sign-in, delayed HEAD response, hand edit/preview, signed publication, history, selector focus, real MCP chat job, impossible-spec refusal and game boot. All seven screenshots inspected. |
| Real Chrome model viewer | Passed: all 139 catalogue items selected without exceptions; orbit, zoom, pan and keyboard controls exercised; all seven screenshots inspected. |
| Real Chrome admin | Passed, including separate admin/editor sessions for one wallet. |
| `trace:save` on the branch baseline, then `trace:diff` | Trace identical. |
| `test:parity` | All 11,643 recorded objects identical to the pre-entity builders. |
| Production MCP image and isolated Compose services | Image built; Redis and MCP healthy. Container smoke verified HTTP health 200, Redis app-key access denied and impossible-model spec rejection. |

Live Anthropic/OpenAI/Gemini/z.ai requests were not executed: provider tests use SDK-shaped mocks and the browser uses the scripted provider through the real MCP. Provider-account/model availability and billing behavior are therefore not certified by this review. No production host, secret or database was modified.

The follow-up replaces the process-local job queue with PostgreSQL admission, claims and terminal events, shared across app replicas. Redis continues to enforce shared HTTP limits. Parameter corner checks and geometry parity do not replace visual review of newly generated art.

## References

- [MCP Streamable HTTP transport security](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports): Origin checks, local binding and authentication.
- [Redis INCR and rate-limit patterns](https://redis.io/docs/latest/commands/incr/): atomic counter/expiry handling.
- [OWASP LLM01 prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/): untrusted content, authority boundaries and human approval.

## Follow-up: implemented solutions to the three remaining concerns

### Prompt injection: enforce permissions independently of the model

- `editor-tool-policy.ts` defines the trusted system workflow and all seven model-facing tool schemas/descriptions. The bridge checks the remote tool-name set but never uses remote prompts or descriptions as instructions. Format documentation stays a tool result, at data trust level.
- The bridge validates argument names, required fields, types, IDs and lengths locally. Unknown tools and undeclared arguments cannot reach MCP.
- A successful `check_entity` records its exact source and returned entity id. `save_draft` must match both. A save consumes that check: changing the source, retargeting it, omitting the check or replaying the save is refused before tool execution. The MCP and server still validate the source and independently enforce job scope.
- Adversarial tests inject instructions into remote metadata and tool output and script a model that follows them. They prove that publishing, arbitrary URL arguments, retargeted/modified sources and unchecked/repeated saves cannot bypass the bridge. Existing HTTP/PostgreSQL tests enforce target scope and signed publication.

This is containment, not proof of semantic intent: an injection can still influence a valid draft within the authorized scope. The model has no publishing capability, and a person must review the revision and rendered model before signing publication. No claim of universal prompt-injection prevention is made.

### Multiple app processes: use the existing PostgreSQL job table as the durable queue

- Short advisory-lock transactions atomically enforce daily admission, one open job per wallet/entity, global parallel capacity and unique claims. Job creation and its queued event commit together; terminal status and terminal events also commit together.
- Local enqueue is only a wakeup. Every app polls the shared queue each second; a committed queued row survives loss of the admitting process. Startup does not fail another replica's live work.
- A running claim has a fixed deadline from `startedAt + EDITOR_JOB_TIMEOUT_MS`. It is never automatically replayed: a crashed call may already have cost money or saved a draft. Any replica expires it; queued jobs also have a bounded wait.
- Cancellation commits shared revocation before returning. The owner normally observes it within one poll and aborts provider work; the bridge also checks status before tools and subsequent provider turns. Capability guards and the draft transaction reject elapsed deadlines even before a sweep. Database failures abort local provider work.
- This uses existing schema columns and infrastructure; no new migration, queue dependency or env key is required. All replicas must share PostgreSQL/Redis, provider and signing configuration, the same timeout, and synchronized clocks.

The production Compose topology remains one app until explicitly scaled. The first rollout must drain/cancel old active jobs and replace the old process-local runner everywhere before resuming: its old startup sweeper is unsafe beside the new runner. Provider abort is best effort for requests already submitted; this design avoids automatic duplicate execution, not every possible provider charge after cancellation.

### Dependency advisories: scoped Jayson 5 upgrade

The first review reduced the server's production audit from 21 affected packages (4 high, 17 moderate) to nine moderate transitive advisories. The follow-up removes those remaining packages with the scoped override `@solana/web3.js → jayson: 5.0.0`, preserving the Solana and Metaplex versions and APIs.

Jayson 5 removes its `uuid` and `stream-json` dependencies. Its breaking change concerns delimiter-based TCP/TLS framing, which this application's Solana transport does not use. Solana imports Jayson's browser HTTP client; compatibility tests exercise the actual Web3/Jayson and Metaplex stacks with only the HTTP boundary replaced: unique request IDs, concurrent calls, batches, transaction-submission encoding, errors, malformed responses, account reads and blockhash reads. Its Node >=20 requirement is met by the production Node 24 images.

**Current production server audit: zero advisories of every severity** (`npm --prefix server audit --omit=dev --json`, 2026-10-15). This is the npm production dependency audit, not a claim about development tooling, container OS packages or future advisories. MCP and landing reported zero in the initial review. Retain the override until Solana adopts the compatible upgrade upstream; rerun these transport tests when changing it.

Upstream references: [Jayson 5 changelog](https://github.com/tedeh/jayson#changelog-only-notable-milestoneschanges), [Jayson package and Node requirement](https://github.com/tedeh/jayson/blob/master/package.json), [stream-json advisory](https://github.com/advisories/GHSA-528h-pc64-c93x), [UUID affected APIs](https://github.com/advisories/GHSA-w5hq-g745-h8pq). The earlier undici, legacy bn.js and Prisma-scoped deepmerge overrides remain; [deepmerge 8 compatibility](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0) is covered by Prisma generation/build and integration checks.

### Follow-up verification

- Root `npm run check`: passed, including **2,072 server tests across 346 files**, build/typecheck, client, landing, MCP and media checks.
- Full `npm run server:integration`: **522 tests across 46 files passed**, using `freightchain_entity_editor_review_test` exclusively.
- Separate PostgreSQL clients race admission, claims and terminal transitions: shared wallet/entity/daily/parallel budgets hold, claims are unique, and expired work cannot be replayed. HTTP scenarios cover replacement-runner queue discovery and expired capability rejection; unit tests cover cross-runner cancellation and shutdown recovery.
- Real Chrome editor with real MCP and scripted provider: passed, including hand edits, checked AI draft creation, signed publication, history, impossible-spec refusal and game boot.
- Production npm audit: **0 total**. No live AI provider calls, production deployment, chain writes or commits to the user's branch were performed.

## Capacity follow-up: five concurrent jobs plus queued overflow

The fallback `editor_jobs_parallel` is now 5. PostgreSQL continues to enforce the cap globally and keep overflow in admission order. Existing stored settings override the fallback and must be changed via the signed admin Settings UI to enable five on that installation. The one-open-job-per-wallet/entity policy remains; five active jobs currently need distinct editor wallets. No live configuration was changed.

A controlled runner regression holds five scripted generations open, verifies five more stay queued, then releases slots one at a time and checks FIFO refill, peak concurrency exactly five, and completion of all ten. The real PostgreSQL two-client race uses the five-slot default, verifies five unique claims plus five queued rows, and checks that the next queued row takes a released slot. This proves queue/concurrency behavior, not live-provider throughput. Capacity limits and the measurement/scaling plan are documented in `docs/agents/editor.md`.

## Dedicated AI worker follow-up

AI execution is now owned by `EditorWorkerModule` and the `npm run editor:worker` entrypoint. HTTP admission only commits queued jobs; HTTP cancellation only revokes shared state. The API module imports no AI agent, runner or queue scheduler. The worker has no HTTP/publication endpoints or general game schedulers. The five-slot PostgreSQL queue and Redis protections remain.

Production adds an optional `editor-worker` container using the server image, no published port, a read-only root, 1 GB memory limit, bounded process count and health based on recent successful queue polls. Startup requires the same explicit JWT_SECRET as the API. Readiness does not invoke paid providers. Shutdown aborts/drains work before storage closes, including claims in flight; crashed claims still expire without replay. Release and rollback require worker health and stop outgoing workers before switching versions, including targets that predate this service.

Tests cover composition isolation, API-only queued admission/cancellation, independent worker discovery through real MCP, health/error/shutdown behavior, five-slot scheduling and release/rollback shell behavior with mocked Docker. The separate-process browser test caught an idle exit caused by an unreferenced timer; the worker poll timer now keeps the process alive between jobs. Provider discovery still uses matching keys in API and worker; this is execution isolation, not removal of provider credentials from the API. API-side draft validation remains an independent security check and uses shared host resources.

Verification on 2026-10-16:
- Root `npm run check` passed, including **2,080 server tests across 348 files**, builds/typechecks and client, landing, MCP and media checks.
- Full PostgreSQL integration passed: **522 tests across 46 files**, using only `freightchain_entity_editor_review_test`.
- Separate API/worker processes with real MCP and a scripted provider passed queue/cancel/discovery tests and the real Chrome editor suite; all seven screenshots were inspected.
- Production server image built successfully. An isolated Compose project passed worker health, idle restart, database-outage readiness removal and recovery checks. It also verified the 1 GB limit, read-only root, bounded process count, no published worker port and absence of money-signing keys. Its containers and test database volume were removed afterward.
- Four mocked deployment scenarios passed: successful release, failed health rollback, failed container startup rollback and manual rollback with matching worker version.
- No paid-provider requests, production deployment or commits to the user's branch. These checks establish scheduling and isolation behavior; live-provider throughput remains unmeasured.
