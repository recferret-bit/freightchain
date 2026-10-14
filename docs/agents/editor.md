# The 3D model editor – detail

Agent reference for the server half of the entity editor. The HTTP contract is `docs/editor-api.md`. The entity format and the client builder are in `docs/agents/world.md` ("Entities"). Keep this file current like AGENTS.md ("Maps stay current").

## In short

- Every 3D model is an entity: a data-only JS module, shipped in code as a seed (`client/shared/entity/seed/`).
- The database (`asset` schema) keeps the editor's history on top: append-only revisions, a **HEAD** (what the editor works on) and a **PUBLISHED** revision (what players draw).
- `GET /api/entities/bundle` is the seed with every published revision on top. It is public, cached, and the only thing the game reads.
- Editors are the wallets in `EDITOR_WALLETS`. They sign in on `storybook.<apex>`, save drafts, restore and publish. A publish is wallet-signed and audited.
- The AI chat is a **job**: the bridge (in the app) checks the request, runs the 3d-assets skill's spec gate, then drives a model (Anthropic by default; OpenAI, Gemini, z.ai when their key is set) whose only tools are the **entity MCP's** (`mcp/`). The MCP writes back through `/api/editor/mcp/*` as that job, so every AI change is an ordinary draft revision. Nothing an AI does is published.

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
- After a publish in this process it is rebuilt at once. Otherwise it is rechecked at most every `BUNDLE_RECHECK_MS` (10 s) with one cheap query (`publishedStamp`: count plus max `publishedAt`), so other processes converge.
- The controller adds `Cache-Control: public, max-age=60, stale-while-revalidate=600`. Express's weak ETag answers a 304.
- Throttle bucket `entities` (`THROTTLE_ENTITIES_LIMIT`, per IP). The `default` bucket skips it.
- nginx adds `fc_entities` limit_req, `fc_conn` and a 30 s microcache. The files are `deploy/nginx/fc-limits.conf` and the snippet in `remote/setup.sh`.

## Editor sign-in and guard

The routes mirror the admin ones: `auth/nonce` → `auth/verify` → cookie, plus `auth/logout` and `me`.
- `RequestEditorChallengeHandler` and `VerifyEditorSignInHandler` use challenge key `editor:<wallet>` and the statement "EDITOR sign-in…". A wallet not in `EDITOR_WALLETS` gets 404. A sign-in is audited as `editor.signin`.
- `JoseEditorTokenSigner` signs tokens with audience `editor` and its own key: `EDITOR_JWT_SECRET`, else derived from `JWT_SECRET`. The TTL is `EDITOR_SESSION_TTL_MINUTES`.
- The cookie is `fc_editor`: httpOnly, SameSite=Strict, `Path=/api/editor`, no Domain (`editor-cookie.interceptor.ts`).

`EditorGuard` checks, in order, and answers 404 on every failure except the CSRF header (403):
1. Host = `storybook.<COOKIE_DOMAIN>` (`EnvService.editorHost`; any host when `COOKIE_DOMAIN` is unset). It reads `Host`, never `X-Forwarded-Host`.
2. The client IP is inside `EDITOR_IP_ALLOWLIST` (`infrastructure/config/ip-rules.ts`, IPv4 / IPv6 CIDRs) when one is set.
3. The `fc_editor` wallet is still in `EDITOR_WALLETS`.
4. `X-FC-Editor: 1` is present on changes.

Throttle bucket `editor` (`THROTTLE_EDITOR_LIMIT`) counts per editor wallet, else per IP. The sign-in also counts in `auth`.

`OriginGuard` 404s every other API path on the storybook host, whatever the method. That is the second wall behind nginx (pentest H7). `browserCors` gives storybook no credentials: the editor is same-origin.

## The AI editor: bridge, providers, MCP

**Request pipeline** (`CreateEditorJobHandler`, `POST /api/editor/jobs` → 202 `{ jobId }`), in order:
1. `EditorGuard`, then the Zod body (`prompt` ≤ 4000, `entityId?`, `baseRevisionId?`, `provider?`, `model?`).
2. The AI editor is on: `EDITOR_MCP_TOKEN` is set, otherwise 503. The provider and model are among the enabled ones, otherwise 400 `bad_provider`.
3. A `baseRevisionId` that is given must equal the head, otherwise 409 `stale_base`.
4. The daily cap per wallet (`editor_jobs_per_day`), otherwise 429 `job_cap` with `Retry-After`.
5. One open job per wallet and per entity, otherwise 409 `job_running`.
6. The 3d-assets skill's spec gate on the words (the MCP's `POST /spec`, the skill's `validate.mjs`). A `rejected` verdict (a car with 2 wheels) is a 422 `spec_invalid` with the validator's `errors`. No job is stored and no model is called.
7. A queued job and a `status` event; the runner picks it up.

**Runner** (`EditorJobRunnerService`, the app process only):
- At most `editor_jobs_parallel` jobs run at once (0 pauses the AI editor).
- Each job has its own AbortController: cancel, and `EDITOR_JOB_TIMEOUT_MS` (default 10 min).
- Every move is a `status` event; the last one is `done` or `error`.
- `EditorJobSweepScheduler` (AppModule only) fails orphans: every open job on boot, then every minute those past the timeout.

**Agent loop** (`EditorAgentService`):
1. A job capability token (`JobTokenPort`, `jose.job-token-signer.ts`: audience `mcp-job`, `{ jobId, wallet, entityId }`, valid for the timeout + 1 min) opens the MCP (`McpSdkClientAdapter`: SDK Client + StreamableHTTP to `EDITOR_MCP_URL/mcp`, bearer `EDITOR_MCP_TOKEN`, header `x-fc-job`).
2. The MCP's `entity-editor` prompt is the system prompt; its tools, sorted by name for a stable cache prefix, are the model's tools.
3. Each turn's text, tool calls and results, and token usage become events.
4. It stops on the model's end, a refusal, the output limit, the step limit (`editor_max_steps`), or the abort.
5. The prompt asks the model to `check_entity` before `save_draft`. An unchecked save is still validated by the MCP and the server, and is recorded with `unchecked: true`.

**Providers** (`LlmProviderPort` → `LlmRegistryAdapter`). A provider is offered when its key is set. Model ids are env defaults (`EDITOR_MODEL_<P>`); check them when a provider renames one. Each session keeps its own native history, append-only:

| provider | adapter | notes |
|---|---|---|
| `anthropic` | `anthropic.llm.adapter.ts` | `messages.stream(…).finalMessage()` per turn, adaptive thinking, effort high, `tool_choice` auto. Cached system block and last tool. Thinking blocks go back unchanged; tool results go back in one user message; `pause_turn` continues. On the official API, claude-opus-5-5 / claude-sonnet-5-5 / claude-fable-5-1 use the beta stream with `server-side-fallback-2026-07-01` and `fallbacks: 'default'`. Default `claude-opus-5-5` |
| `zai` | the same class, `compat` | `ZAI_BASE_URL` (Anthropic-compatible); no thinking, effort, fallbacks or betas. Default `glm-5.2` |
| `openai` | `openai-responses.llm.adapter.ts` | Responses API, function tools, `store: false` with encrypted reasoning; output items go back as input, results as `function_call_output`. Default `gpt-6` (an env default; verify against OpenAI's model list) |
| `gemini` | `gemini-chat.llm.adapter.ts` | the openai SDK's Chat Completions against Google's OpenAI-compatible endpoint. The assistant message (thought signatures) goes back unchanged; results are role `tool`. Default `gemini-3.1-pro-preview` |
| `fake` | `fake.llm.adapter.ts` | TEST ONLY: `NODE_ENV=test`, or `EDITOR_FAKE_LLM=1` outside production (the schema refuses it in production). A scripted get_entity → check_entity (a `note: 'fake edit: …'` line) → save_draft → "done (fake)", so a browser e2e can drive a real job through the real MCP |

Provider errors are mapped by the SDKs' error classes to a sentence; a key never appears in an event or a log.

**MCP callbacks** (`EditorMcpHttpController`, `McpJobGuard`):
- The guard wants a valid job token of a RUNNING job whose wallet is still listed.
- A request with `X-Forwarded-For` or `X-Real-IP` (that is, through nginx) is a 404. So is every other refusal.
- They have their own throttle bucket `mcp` per job; `default` and `editor` skip them.
- `McpSaveDraftHandler`:
  - A job may write the entity it was opened on, or a NEW `part` entity; anything else is 403 `job_scope`.
  - The draft goes through `EntityWriteService` on the current head, authored by the job's wallet, with `jobId`.
  - It appends a `draft` event `{ revisionId, entityId, seq }` and sets the job's `resultRevisionId`.

**Limits:** `/api/editor/*` takes JSON bodies up to 256 KB (configure-app.ts – a whole entity file JSON-escaped); every other route keeps Nest's 100 KB. GameSettings rows (signed admin API): `editor_jobs_per_day` 40, `editor_max_steps` 24, `editor_max_output_tokens` 32000, `editor_jobs_parallel` 2.

**Deploy:**
- The `mcp` compose service is built from `deploy/Dockerfile.mcp`. It sits on the internal `editor` network with the app only, publishes no port, and holds no key but `EDITOR_MCP_TOKEN`.
- `release.sh` builds and starts it only when `deploy/.env` has `EDITOR_MCP_TOKEN` (`npm run deploy:init` generates one). The app gets `EDITOR_MCP_URL=http://mcp:3100`.

**Local recipe:**
1. In `server/.env`, set `EDITOR_WALLETS=<your wallet>`, `EDITOR_MCP_TOKEN=<24+ chars>`, and one AI key, or `EDITOR_FAKE_LLM=1`.
2. Run `npm run server:dev` (:3000), then `npm run editor:mcp` (:3100; it reads the same `server/.env`, `FC_APP_URL` defaults to `http://127.0.0.1:3000`).
3. Open `http://localhost:3000/viewer.html` and sign in with the wallet.

## Tools

- `npm run entities:export` (root, which builds the server; or `node dist/cli/index.js entities:export`) writes every PUBLISHED revision of `DATABASE_URL` back over `client/shared/entity/seed/<kind>/<id>.js`, then regenerates `seed/index.js`. Review and commit the result.
- Tests:
  - unit: `test/unit/**/entit*`, `editor*`, `ip-rules`
  - HTTP: `test/scenarios/editor.scenarios.ts` (in-memory + PostgreSQL) and `test/http/editor-host.spec.ts` (storybook host, IP allowlist, the bundle's 429)
  - integration: `entity.prisma.repository.integration.spec.ts` plus the concurrency spec, `editor-job.prisma.repository.integration.spec.ts` (concurrent event appends)
  - AI editor: unit specs per adapter (SDK clients faked; the MCP client against a real in-process MCP server on loopback), the agent and the runner; `test/scenarios/editor-jobs.scenarios.ts` (in-memory + PostgreSQL: the fake model through `test/support/test-mcp.ts`, which calls back into `/api/editor/mcp/*` with the job token – spec gate, caps, cancel, the callbacks' guard and scope); `test/http/editor-ai.spec.ts` (providers from keys, the 256 KB limit, no MCP token = off, the fake refused in production)
  - real Chrome: `bash .claude/skills/run-tests/e2e.sh editor` (`server/scripts/e2e-editor.mjs`). It starts the real `mcp/src/http.js` and the server with `EDITOR_FAKE_LLM=1`, then checks a stranger refused, the editor signing in, a hand edit previewed in place, HISTORY (each revision once), a signed publish reaching the bundle and the viewer, a chat job through the MCP, the spec gate, and the game booting from the bundle.
- MCP: `npm run mcp:check` (`mcp/test/`). The tools run over the SDK's in-memory transport against a temp copy of the seed.
- **Claude Code on a checkout**, with no server and no database: `claude mcp add fc-entities -- node mcp/src/stdio.js` gives the same tools over stdio on the repo's seed files (`FileBackend`). A save is a file change you review and commit. It never publishes.
