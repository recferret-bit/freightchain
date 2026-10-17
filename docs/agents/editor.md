# The 3D model editor – detail

Agent reference for the server half of the entity editor. The HTTP contract is `docs/editor-api.md`. The entity format and the client builder are in `docs/agents/world.md` ("Entities"). Keep this file current like AGENTS.md ("Maps stay current").

## In short

- Every 3D model is an entity: a data-only JS module, shipped in code as a seed (`client/shared/entity/seed/`).
- The database (`asset` schema) keeps the editor's history on top: append-only revisions, a **HEAD** (what the editor works on) and a **PUBLISHED** revision (what players draw).
- `GET /api/entities/bundle` is the seed with every published revision on top. It is public, cached, and the only thing the game reads.
- Editors are the wallets in `EDITOR_WALLETS`. They sign in on `storybook.<apex>`, save drafts, restore and publish. A publish is wallet-signed and audited. `EDITOR_OPEN=1` (local only, refused in production) skips that sign-in and acts as the first listed editor, so the MCP can be used without a wallet popup.
- The AI chat is a **job**: the API checks the request, runs the 3d-assets skill's spec gate and admits it to the queue. The bridge in the dedicated worker then drives a model (Anthropic by default; OpenAI, Gemini, z.ai when their key is set) whose only tools are the **entity MCP's** (`mcp/`). The MCP writes back through `/api/editor/mcp/*` as that job, so every AI change is an ordinary draft revision. Nothing an AI does is published.

## Tables (`server/prisma/asset/asset.prisma`, migration `20261029000000_entities`)

| table | holds |
|---|---|
| `asset.Entity` | one row per id once it is first edited: `kind` (fixed from then on), `headRevisionId`, `publishedRevisionId` (null = players draw the seed), `version` (bumped on each pointer move), `publishedAt` |
| `asset.EntityRevision` | append-only: `seq` (1, 2, … unique per entity), `parentId`, `source` (the canonical file text, `printSource`), `config` (JSON), `hash` (sha256 of `source`), `authorWallet` (`seed` for the code's model), `jobId`, `message` |
| `asset.EditorJob`, `asset.EditorJobEvent` | the AI editor's requests and their steps: prompt, provider, model, status (`queued → running → done / failed / cancelled`), `resultRevisionId`, tokens; events `seq` (1, 2, … per job, under the job row lock) / `type` / `payload`. The revision list shows each revision's job prompt |

An entity that was never edited has no row: its HEAD and its published model are the seed. On its first save, the seed is recorded as revision #1 (author `seed`) and the edit becomes #2.

## Writes (`EntityWriteService`, the one critical section)

1. Before any lock, the file is read with `parseSource`, a literal-only parser that never executes it.
2. It is checked against the route id and validated with `validateEntity`. The validator looks up the other entities' HEAD configs (seed ⊕ DB heads). Every refusal is a **422 `entity_invalid`** with `errors[]` and `warnings[]`.
3. Then, in one transaction:
   - `ensure` the row with `INSERT … ON CONFLICT DO NOTHING`, then `lock` it with `SELECT … FOR UPDATE`. This row lock is the only lock.
   - The kind must not change.
   - `baseRevisionId` must equal the head, otherwise **409 `stale_base`**. Null means "the seed / a new entity".
   - Append the revision with `seq = max + 1`, then move HEAD.

Restore appends a NEW revision that copies an old one, re-validated against today's catalogue. Concurrency is covered by `test/integration/entity-concurrency.integration.spec.ts`: 8 racing first edits produce one winner and 7 `stale_base`.

## Publish

`POST …/publish/challenge` issues the text through `AdminProofService.issue(wallet, { action: 'entity_publish', entityId, revisionId, seq }, 'editor')`:
- It is pending under its own key, `editor-action:<wallet>`.
- It names the storybook host and reads "model editor action".

An admin text therefore never proves a publish, and an editor text never proves an admin change.

`PublishRevisionHandler`:
1. Re-checks `EDITOR_WALLETS`.
2. Proves the signature.
3. Under the row lock, moves `publishedRevisionId` and writes the `AdminAction` row `entity.publish`, which keeps the signed text, the previous revision and the hash.
4. Invalidates the bundle.

Publishing is the ONLY path that changes what players draw.

## The bundle (`EntityCatalogService`)

- It is built once and held in memory, so no request of the game reaches the database.
- `rev` is the first 16 hex characters of a sha256 over the sorted `id:hash` pairs. Seed hashes come from the printed seed.
- After a publish in this process it is rebuilt at once. Otherwise it is rechecked at most every `BUNDLE_RECHECK_MS` (10 s) with one cheap query (`publishedStamp`: count plus the sum of published rows' monotonic `version` values (timestamps can collide)), so other processes converge.
- The controller adds `Cache-Control: public, max-age=60, stale-while-revalidate=600`. Express's weak ETag answers a 304.
- Throttle buckets `entities` (`THROTTLE_ENTITIES_LIMIT`, per minute) and `entities-rps` (`THROTTLE_ENTITIES_RPS`, per second), both per IP. The `default` bucket skips it. With `REDIS_URL` the counters are in Redis. Budgets aggregate across controllers and methods, so rotating endpoints does not reset an allowance.
- nginx adds `fc_entities` limit_req, `fc_conn` and a 30 s microcache. The files are `deploy/nginx/fc-limits.conf` and the snippet in `remote/setup.sh`.

## Editor sign-in and guard

The routes mirror the admin ones: `auth/nonce` → `auth/verify` → cookie, plus `auth/logout` and `me`.
- `RequestEditorChallengeHandler` and `VerifyEditorSignInHandler` use challenge key `editor:<wallet>` and the statement "EDITOR sign-in…". A wallet not in `EDITOR_WALLETS` gets 404. A sign-in is audited as `editor.signin`.
- `JoseEditorTokenSigner` signs tokens with audience `editor` and its own key: `EDITOR_JWT_SECRET`, else derived from `JWT_SECRET`. The TTL is `EDITOR_SESSION_TTL_MINUTES`.
- The cookie is `fc_editor`: httpOnly, SameSite=Strict, `Path=/api/editor`, no Domain (`editor-cookie.interceptor.ts`). Production uses `__Host-fc_editor` with `Path=/` and `Secure`, so a sibling cannot plant one.

`EditorGuard` checks, in order, and answers 404 on every failure except the CSRF header (403):
1. Host = `storybook.<COOKIE_DOMAIN>` (`EnvService.editorHost`; any host when `COOKIE_DOMAIN` is unset – production refuses to boot without it once `EDITOR_WALLETS` or `ADMIN_WALLETS` is set). It reads `Host`, never `X-Forwarded-Host`.
2. The client IP is inside `EDITOR_IP_ALLOWLIST` (`infrastructure/config/ip-rules.ts`, IPv4 / IPv6 CIDRs) when one is set.
3. The `fc_editor` wallet is still in `EDITOR_WALLETS`.
4. `X-FC-Editor: 1` is present on changes.

Throttle bucket `editor` (`THROTTLE_EDITOR_LIMIT`) counts per editor wallet, else per IP, per minute. `editor-rps` (`THROTTLE_EDITOR_RPS`) counts per IP per second. Named limits also send standard `Retry-After`; the page retries only explicit throttle refusals, at most twice. Protected auth/editor/MCP buckets fail closed when Redis is unavailable; public bundle counters retain a bounded local fallback. The sign-in also counts in `auth` and `auth-rps`.

`OriginGuard` 404s every other API path on the storybook host, whatever the method. That is the second wall behind nginx (pentest H7). Storybook is treated like the admin host (pentest M4): `browserCors` sends no CORS headers there, and `OriginGuard` takes changes only from storybook itself – an allowlisted sibling (the apex, ride.*) is the same SITE, so the SameSite=Strict cookie would ride along.

The wallet signs only what the page checked (`client/js/editor/index.js`): a publish text must name the entity and revision that were clicked, and on storybook.* both texts must start with the page's host. Connect uses the shared handlers (`client/js/wallet/handlers.js`, the same `solana:signIn` as the landing page) against a 1-click editor challenge; a wallet with no sign-in connects and signs the wallet-bound text. `window.solana` is what the editor e2e installs. Storybook does not serve `/site/`, so the editor imports `js/wallet/`, not the lobby's copy.

The admin wallet may be an editor too (one address in both `ADMIN_WALLETS` and `EDITOR_WALLETS`): the sessions, JWT keys, audiences, challenge keys (`admin:` / `editor:` / `action:` / `editor-action:`) and throttle trackers are all separate; `e2e.sh admin` and `e2e.sh editor` run with one wallet in both lists. Publishing is open to every `EDITOR_WALLETS` wallet (signed, audited).

## The AI editor: bridge, providers, MCP

**Request pipeline** (`CreateEditorJobHandler`, `POST /api/editor/jobs` → 202 `{ jobId }`), in order:
1. `EditorGuard`, then the Zod body (`prompt` ≤ 4000, `entityId?`, `baseRevisionId?`, `provider?`, `model?`).
2. The AI editor is on: `EDITOR_MCP_TOKEN` is set, otherwise 503. The provider and model are among the enabled ones, otherwise 400 `bad_provider`.
3. A `baseRevisionId` that is given must equal the head, otherwise 409 `stale_base`.
4. The daily cap per wallet (`editor_jobs_per_day`), otherwise 429 `job_cap` with `Retry-After`.
5. The 3d-assets skill's spec gate on the words (the MCP's `POST /spec`, the skill's `validate.mjs`). A `rejected` verdict (a car with 2 wheels) is a 422 `spec_invalid` with the validator's `errors`. No job is stored and no model is called.
6. Atomic PostgreSQL admission rechecks the daily cap and enforces one open job per wallet and per entity (409 `job_running`), then commits a queued job and its `status` event together. The runner picks it up. The admission HEAD is recorded even when the caller omitted its base. A later human edit causes AI saves to fail with `stale_base`, rather than silently replacing it. Further saves by the same job can advance its own head.

**Runner** (`EditorJobRunnerService`, dedicated editor-worker processes only):
- The API imports no AI agent, runner or queue scheduler. `app/editor-worker.module.ts` owns them and boots without HTTP, replay verification, pool watchers or publication handlers. API cancellation changes shared database state directly.
- PostgreSQL is the durable queue. Short advisory-lock transactions serialize admission and claims across replicas; no provider or MCP network call holds that lock. The existing job table needs no migration.
- At most `editor_jobs_parallel` claims are running globally (0 pauses new claims). Each job is atomically claimed once. A committed queued job is discoverable even if its admitting API process crashes after the commit. Admission never starts execution in the API.
- `startedAt + EDITOR_JOB_TIMEOUT_MS` is the fixed claim deadline (default 10 min). Queued jobs also expire after that interval from admission. Running claims are never requeued automatically: a crashed provider call might already have incurred charges or saved a draft.
- Shutdown stops polling, aborts active provider calls and allows up to eight seconds for terminal events before disconnecting storage. A claim already in flight is included in that drain. The referenced poll timer keeps an idle headless worker alive.
- Terminal state and terminal events commit together. Cancellation revokes the shared capability before returning; any replica can cancel. The owner aborts provider work on its next poll (normally within one second), and the bridge rechecks status before tool calls and subsequent provider turns. Provider cancellation is best effort for work already submitted.
- `EditorJobSweepScheduler` polls each second, including at boot: it expires elapsed jobs, observes remote cancellations and claims queued work. Startup leaves another replica's fresh claims intact. Storage errors abort local provider calls; deadlines and the queued rows survive in PostgreSQL.
- Both the HTTP capability guard and the draft transaction reject expired claims even before a sweep. API and worker instances must share the same DB, runtime settings, timeout, token/signing secrets and provider/model configuration, with synchronized clocks. Local worker startup requires an explicit `JWT_SECRET` (the API's random development fallback cannot verify across processes). Provider keys remain configured in both API and worker for matching provider discovery; only the worker opens model sessions. Redis remains required for shared HTTP rate limits; it is not the durable job store.

**Agent loop** (`EditorAgentService`):
1. A job capability token (`JobTokenPort`, `jose.job-token-signer.ts`: audience `mcp-job`, `{ jobId, wallet, entityId }`, valid for the timeout + 1 min) opens the MCP (`McpSdkClientAdapter`: SDK Client + StreamableHTTP to `EDITOR_MCP_URL/mcp`, bearer `EDITOR_MCP_TOKEN`, header `x-fc-job`).
2. The system workflow, tool descriptions and input schemas come from the server's versioned `domain/editor/editor-tool-policy.ts`. The MCP tool list must have exactly the allowed names and bounded metadata; its prompt is never fetched and its descriptions/schemas are never handed to the model. `get_format` supplies format documentation as untrusted tool data.
3. Each turn's text, tool calls and results, and token usage become events. Arguments must satisfy the local contract; undeclared fields (including arbitrary URLs), unknown tools and oversized values are refused before MCP execution.
4. It stops on the model's end, a refusal, cumulative output/input limits, the step limit (`editor_max_steps`), cancellation or timeout.
5. A successful `check_entity` authorizes only its exact source and returned entity id. A changed source, different id, unchecked save or replayed save is refused by the bridge before `save_draft`. A save consumes that check; rechecking is required for another save. MCP and server still validate independently, and server scope/concurrency rules remain authoritative.

These controls constrain hostile instructions in model output, entity notes and MCP responses; they do not prove that a model will ignore every injection or that a valid in-scope draft matches the user's intent. Review the visual result and revision diff before wallet-signed publication.

**Providers** (`LlmProviderPort` → `LlmRegistryAdapter`). A provider is offered when its key is set. Model ids are env defaults (`EDITOR_MODEL_<P>`); check them when a provider renames one. Each session keeps its own native history, append-only:

| provider | adapter | notes |
|---|---|---|
| `anthropic` | `anthropic.llm.adapter.ts` | `messages.stream(…).finalMessage()` per turn, adaptive thinking, effort high, `tool_choice` auto. Cached system block and last tool. Thinking blocks go back unchanged; tool results go back in one user message; `pause_turn` continues. On the official API, claude-opus-5-5 / claude-sonnet-5-5 / claude-fable-5-1 use the beta stream with `server-side-fallback-2026-07-01` and `fallbacks: 'default'`. Default `claude-opus-5-5` |
| `openai` | `openai-responses.llm.adapter.ts` | Responses API, function tools, `store: false` with encrypted reasoning; output items go back as input, results as `function_call_output`. Default `gpt-6` (an env default; verify against OpenAI's model list) |
| `gemini` | `gemini-chat.llm.adapter.ts` (`ChatCompletionsSession`) | the openai SDK's Chat Completions against Google's OpenAI-compatible endpoint. The assistant message (thought signatures) goes back unchanged; results are role `tool`. Default `gemini-3.1-pro-preview` |
| `zai` | the same class | Chat Completions at `ZAI_BASE_URL` (default the pay-as-you-go `https://api.z.ai/api/paas/v4`; a GLM Coding Plan key: `https://api.z.ai/api/coding/paas/v4`). The assistant message (with GLM's `reasoning_content`) goes back unchanged. Default `glm-5.2` (checked against z.ai's model list 2026-10-15) |
| `fake` | `fake.llm.adapter.ts` | TEST ONLY: `NODE_ENV=test`, or `EDITOR_FAKE_LLM=1` outside production (the schema refuses it in production). A scripted get_entity → check_entity (a `note: 'fake edit: …'` line) → save_draft → "done (fake)", so a browser e2e can drive a real job through the real MCP |

Provider errors are mapped by the SDKs' error classes to a sentence. Unexpected SDK/transport exceptions produce a fixed error in logs and chat; raw messages can contain credentials and are discarded. MCP initialization has the job abort signal and a 10-second timeout; both HTTP directions refuse redirects so capability tokens cannot follow them.

**MCP callbacks** (`EditorMcpHttpController`, `McpJobGuard`):
- The guard wants a valid job token of a RUNNING job whose wallet is still listed.
- A request with `X-Forwarded-For` or `X-Real-IP` (that is, through nginx) is a 404. So is every other refusal.
- They have their own throttle buckets `mcp` (per minute) and `mcp-rps` (per second), per verified job. An unverified token shares one bucket. `default` and `editor` skip them.
- `McpSaveDraftHandler`:
  - `mayWrite` (domain/editor/editor-job.ts): a job opened on an entity writes that entity and at most 4 NEW `part` entities; a job without an entity only creates NEW entities (at most 4) and revises the ones it created (their head is its own draft). Anything else is 403 `job_scope` – the model never decides what it may write.
  - The draft goes through `EntityWriteService` on the current head, authored by the job's wallet, with `jobId`.
  - It appends a `draft` event `{ revisionId, entityId, seq }` and sets the job's `resultRevisionId`.

**Injection guards** (`EditorAgentService`, `domain/editor/editor-job.ts`). Entity text (notes, labels, comments, sign texts, revision messages) is written by other editors and earlier model runs and comes back to the model through the tools, so:
- Only `EDITOR_TOOLS` (the MCP's 7) reach the model; an MCP offering another tool, or a definition over 4 000 / 16 000 characters, fails the job before any model call. A call to a tool not offered answers an error without reaching the MCP; at most 8 calls run per turn.
- The bridge's own rules (`BRIDGE_PREAMBLE`) open the system prompt; the rest of the system workflow and tool definitions are also local policy. Remote MCP prompts and definitions cannot replace them.
- Every tool result goes back fenced as `<tool_output tool="…">…</tool_output>`, a closing tag inside it defused.
- Write scope is the server's (`mayWrite` above), publishing needs a person's signature, and the MCP can reach only the internal app and its restricted Redis counter service.
- Cost: `editor_max_input_ktokens` ends a job whose summed input tokens pass it (every turn re-sends the history); steps, cumulative output tokens across all turns (including Anthropic continuations), and the wall clock are capped too; cancel and timeout abort the MCP calls as well.
- Errors stored on a job are clipped to 300 characters (a refusal's detail is model text); provider errors are fixed sentences.

**Limits:** `/api/editor/*` takes JSON bodies up to 256 KB (configure-app.ts – a whole entity file JSON-escaped); every other route keeps Nest's 100 KB. GameSettings rows (signed admin API): `editor_jobs_per_day` 40, `editor_max_steps` 24, `editor_max_output_tokens` 32000, `editor_max_input_ktokens` 500 (input tokens per job, in thousands – the cost cap), `editor_jobs_parallel` 5.

**Capacity and queue:** the fallback is **5 running jobs globally**, shared across all editor-worker replicas, followed by queued overflow ordered by admission time and id. A stored `player.GameSetting.editor_jobs_parallel` overrides the fallback; use the admin Settings tab → “AI editor: parallel jobs” → 5 → SIGN & SAVE to change an existing installation. A lower value stops new starts until running claims fall below it; it does not cancel current work.

One wallet can have only one open job (queued or running), and one selected entity can have only one open job. Five simultaneous jobs therefore require five editor wallets targeting distinct entities (or creating new entities). The queue has no separate global count cap; its effective admission is restricted by editor allowlisting, one open job per wallet and 40 jobs per wallet per UTC day. Queued jobs expire after 10 minutes by default, independently of a running job's own 10-minute deadline. Queued rows survive app restarts; interrupted running jobs expire without automatic retry.

Generation runs at the external provider. The app and MCP coordinate HTTP requests, validate data and save drafts; they do not run a local generative model or render a frame for every model turn. MCP validation is synchronous CPU work within its Node event loop. Its 512 MB container cap and 40 HTTP requests/second per source IP are safety limits, not a measured generation capacity. One generation makes several MCP requests; a completed asset is not one MCP request. App callbacks additionally allow 20 requests/second and 600/minute per job. Jobs from the same app share its MCP source-IP allowance. Five jobs are the scheduling target, not a guarantee that provider quotas or the host can sustain every asset complexity.

For a mean job duration of `D` seconds, five fully utilized slots have a nominal throughput of `5 × 3600 / D` jobs/hour, before provider throttling, retries, validation and errors. With two-minute jobs this is 150/hour; the second wave of five waits roughly two minutes. These are estimates, not load-test measurements. Measure queue wait, job duration, provider 429s, MCP validation latency, event-loop lag, memory and game API p95 during a representative live-provider run. If queues grow, add bounded queue admission and a separate wait timeout before increasing concurrency. If validation blocks the game/API, move expensive validation into bounded worker threads or isolated MCP processes; generation coordination already runs in a dedicated worker. The general replay worker and the HTTP API do not execute AI jobs. Scale only with matching configuration and shared DB/Redis; more API or editor-worker replicas do not multiply the global five-slot budget.

**Deploy:**
- `editor-worker` uses the server image and `node dist/app/editor-worker.js`, with no listening or published port. It has a separate 1 GB memory budget, a read-only root, `/tmp` tmpfs, dropped capabilities and 128 processes. It receives AI configuration and the shared job-token signing secret; no payout, crank or badge-mint secret is supplied. Worker isolation separates generation histories and its event loop; the API still validates callback writes independently and all containers share host resources.
- Its readiness file `/tmp/fc-editor-worker-health-<pid>.json` is written atomically after a successful database queue poll and removed on errors/shutdown. The container checks PID 1's marker every five seconds and requires it to be less than 15 seconds old. Readiness does not spend provider tokens or certify provider account availability.
- Release starts MCP and the AI worker only when `EDITOR_MCP_TOKEN` is configured, waits for both health checks, and stops the old AI worker before swapping API versions. Automatic and manual rollback use the matching release's optional services and stop the new worker before returning to an old in-process runner.
- The `mcp` compose service is built from `deploy/Dockerfile.mcp`. It sits on the internal `editor` network with the app and the internal `cache` network for Redis, publishes no port, and holds no key but `EDITOR_MCP_TOKEN` (AI keys are configured in API/AI-worker containers and never in MCP). It runs as `node` with a read-only root, `cap_drop: ALL`, `no-new-privileges`, 512 MB and 128 processes. `mcp/src/http.js`: constant-time bearer check, one JSON-RPC message per request (no batches), 512 KB bodies, 30 s request timeout, rejects browser Origin headers and unknown Hosts, and never logs headers or raw exceptions. Development binds loopback only. Production requires Redis: the MCP has its own per-IP RPS counters using an atomic Lua script and the `fc-mcp` ACL user, restricted to `fc:mcp-rl:*` and counter commands. It cannot read app keys or run DEL or administrative commands. Its healthcheck includes Redis readiness, and the release checks MCP health before success. Redis uses `noeviction` so memory pressure cannot erase rate-limit counters. AI editing also requires `REDIS_URL` in the app in production.
- nginx: `^~` locations under `/api/` on storybook (no regex location can take an API path over), `/API/…` 404, `/api/editor/mcp/` 404 on api.* and storybook (the entities snippet), `frame-ancestors 'none'` / `nosniff` / `Referrer-Policy` on storybook.
- `release.sh` builds and starts it only when `deploy/.env` has `EDITOR_MCP_TOKEN` (`npm run deploy:init` generates one). The app gets `EDITOR_MCP_URL=http://mcp:3100`.

**Local recipe:**
1. In `server/.env`, set `EDITOR_WALLETS=<your wallet>`, `EDITOR_MCP_TOKEN=<24+ chars>`, and one AI key, or `EDITOR_FAKE_LLM=1`; set an explicit `JWT_SECRET` of at least 32 characters shared by API and worker.
2. Run `npm run server:dev` (:3000), `npm run editor:mcp` (:3100; `FC_APP_URL` defaults to `http://127.0.0.1:3000`), and `npm run server:build && npm run editor:worker` in separate terminals. All read the same `server/.env`. Restart the worker after rebuilding; the dev API watcher does not restart it.
3. Open `http://storybook.freightchain.localhost/` (`npm run infra:local`) and sign in with the wallet. The editor API answers only on that host once `deploy/local/dev.env` sets `COOKIE_DOMAIN`.

## Tools

- `npm run entities:export` (root, which builds the server; or `node dist/cli/index.js entities:export`) writes every PUBLISHED revision of `DATABASE_URL` back over `client/shared/entity/seed/<kind>/<id>.js`, then regenerates `seed/index.js`. Review and commit the result.
- Tests:
  - unit: `test/unit/**/entit*`, `editor*`, `ip-rules`
  - HTTP: `test/scenarios/editor.scenarios.ts` (in-memory + PostgreSQL) and `test/http/editor-host.spec.ts` (storybook host, IP allowlist, the bundle's 429)
  - integration: `entity.prisma.repository.integration.spec.ts` plus the concurrency spec, `editor-job.prisma.repository.integration.spec.ts` (concurrent event appends)
  - AI editor: unit specs per adapter (SDK clients faked; the MCP client against a real in-process MCP server on loopback), the agent and the runner; `test/scenarios/editor-jobs.scenarios.ts` (in-memory + PostgreSQL: the fake model through `test/support/test-mcp.ts`, which calls back into `/api/editor/mcp/*` with the job token – spec gate, caps, cancel, the callbacks' guard and scope); `test/http/editor-ai.spec.ts` (providers from keys, the 256 KB limit, no MCP token = off, the fake refused in production)
  - real Chrome: `bash .claude/skills/run-tests/e2e.sh editor` (`server/scripts/e2e-editor.mjs`). It starts the real `mcp/src/http.js` and the server with `EDITOR_FAKE_LLM=1`, then checks a stranger refused, the editor signing in, a hand edit previewed in place, HISTORY (each revision once), a signed publish reaching the bundle and the viewer, API-only queue/cancel behavior, a separate worker discovering the queued job through real MCP with fresh health, then a browser chat job, the spec gate, and the game booting from the bundle.
- MCP: `npm run mcp:check` (`mcp/test/`). The tools run over the SDK's in-memory transport against a temp copy of the seed.
- **Claude Code on a checkout**, with no server and no database: `claude mcp add fc-entities -- node mcp/src/stdio.js` gives the same tools over stdio on the repo's seed files (`FileBackend`). A save is a file change you review and commit. Seed directories and files cannot be symlinks, and seed files cannot be hardlinks. It never publishes.

## Review regressions

The 2026-10-15 three-pass review is recorded in `docs/reviews/entity-editor-security.md`. Real Redis tests cover shared budgets across app instances, TTL repair and the restricted MCP ACL. Browser regressions cover delayed HEAD responses and keyboard focus; chat ignores stale polls/replays after logout and does not switch to helper parts. Rendering validation rejects missing material bindings, unsupported painters, unbounded facade grids and non-finite numeric literals. Large source diffs use bounded memory.

Optional real Redis MCP regression: `TEST_REDIS_URL=redis://127.0.0.1:<throwaway-port> npm --prefix mcp test`. It creates/removes the `fc-mcp` ACL user; never point this at a shared or production Redis.
