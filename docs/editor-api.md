# Entity editor – HTTP contract

The storybook model viewer's editor and the MCP server talk to the API through this contract. Server: `server/src/presentation/{entities,editor}/`. Client: `client/js/editor/` and `client/js/world/entities.js`. MCP: `mcp/`.

Bodies are JSON. Errors are `application/problem+json` and carry `code`. A rejected entity answers **422** `code: 'entity_invalid'` with `errors: string[]` and `warnings: string[]` (from `validateEntity` in `client/shared/entity/schema.js`). `Revision` and `EntityRow` are defined at the end.

## Public (every host that proxies `/api/entities/`)

| route | answer |
|---|---|
| `GET /api/entities/bundle` | `{ rev, entities: EntityConfig[] }`: the code's seed (`client/shared/entity/seed/`) with every **published** DB revision on top (the DB wins per id). `rev` is a short hash of the content. `Cache-Control: public, max-age=60, stale-while-revalidate=600`, weak ETag, 304 on `If-None-Match`. Throttle buckets `entities` (per minute) and `entities-rps` (per second), per IP. Built once per publish and held in memory, so no request reaches the DB. |

## Editor (`/api/editor/*`, `EditorGuard`)

- **Host.** `headers.host` must be `storybook.<COOKIE_DOMAIN>`. Locally, when `COOKIE_DOMAIN` is unset, any host is accepted, the same way the admin guard behaves there.
- **Session.** Cookie `fc_editor`: a JWT with aud `editor`, `Path=/api/editor`, httpOnly, SameSite=Strict, no Domain.
- **Allowlist.** The wallet is re-checked against `EDITOR_WALLETS` on every request. An unknown wallet, a missing session or a wrong host gets **404**.
- **IP.** When `EDITOR_IP_ALLOWLIST` (comma-separated CIDRs or IPs) is set, the client IP must match it, otherwise 404.
- **CSRF.** Unsafe methods need the header `x-fc-editor: 1`, otherwise 403.
- **Same origin only.** No CORS headers on storybook; a change whose `Origin` is not storybook itself is 403 `bad_origin` (siblings included).

| route | body → answer |
|---|---|
| `POST /api/editor/auth/nonce` | `{ wallet }` → `{ message }` (404 when the wallet is not listed). Challenge key `editor:<wallet>`. |
| `POST /api/editor/auth/verify` | `{ wallet, signature }` (base58, `signMessage` of `message`) → sets `fc_editor` → `{ wallet }`. Audited as `editor.signin`. |
| `POST /api/editor/auth/logout` | → `{ ok: true }` |
| `GET /api/editor/me` | → `{ wallet, providers: [{ id, label, models: string[], default: string }], defaultProvider }`. Only providers whose key is set; `[]` until the bridge exists. |
| `GET /api/editor/entities` | → `EntityRow[]`: every seed and DB entity |
| `GET /api/editor/entities/:id` | → `{ row: EntityRow, source, config }`, the HEAD: the head revision, or the seed printed with `printSource` when the DB has none |
| `GET /api/editor/entities/:id/revisions` | → `Revision[]` (no `source`), newest first, each with `prompt` (its job's prompt) or null |
| `GET /api/editor/revisions/:revId` | → `Revision` with `source` and `config` |
| `POST /api/editor/entities/:id/drafts` | `{ source, message, baseRevisionId: string \| null }` → `Revision` (the new head, with `source` / `config` and the validator's `warnings: string[]`). The stored `source` is the canonical text (`printSource` of the parsed file – comments are not kept; use `note` fields). 422 when invalid. 409 `stale_base` when `baseRevisionId` is not the head (null = "the seed, nothing in the DB yet"). A new id creates the entity (kind from the source). An entity with no DB row first gets revision 1 = the seed (author `seed`), then the draft as revision 2. |
| `POST /api/editor/entities/:id/restore` | `{ revisionId, baseRevisionId }` → `Revision`: a NEW head copying that revision (append-only) |
| `POST /api/editor/entities/:id/publish/challenge` | `{ revisionId }` → `{ message }` (AdminProof intent `entity_publish`) |
| `POST /api/editor/entities/:id/publish` | `{ revisionId, signature }` → `{ rev }` (the new bundle rev). Audited as `entity.publish`. The only thing that changes what players see. 422 `entity_invalid` (here and at the challenge, before any signature) when the published set would not build: the revision uses a part that is not published, or a published model that uses this part would break. |
| `POST /api/editor/jobs` | `{ prompt (≤ 4000), entityId?, baseRevisionId?, provider?, model? }` → **202** `{ jobId }`. 503 when the AI editor is off (no `EDITOR_MCP_TOKEN`); 400 `bad_provider` for a provider / model not offered by `/me`; 409 `stale_base` when a given `baseRevisionId` is not the head (null = "the seed / nothing saved yet"; omitted = not checked); 429 `job_cap` (with `Retry-After`) at the daily cap; 409 `job_running` when one is open for this wallet or entity; 422 `spec_invalid` with `errors` when the skill's validator rejects the prompt (no job is stored, no model is called). An `entityId` that does not exist yet is allowed (the model may create it). |
| `GET /api/editor/jobs?entityId=` | → `Job[]`, newest first, at most 50 |
| `GET /api/editor/jobs/:id` | → `Job` |
| `GET /api/editor/jobs/:id/events?after=<seq>` | → `{ status, events: [{ seq, type, payload, at }] }`. Types and payloads: `status` `{ status, provider?, model? }` · `text` `{ text }` · `tool_call` `{ name, summary, ok }` · `tool_result` `{ name, summary, ok }` · `draft` `{ revisionId, entityId, seq }` · `usage` `{ in, out }` · `error` `{ status, message }` · `done` `{ status }`. Seq 1, 2, … per job; at most 200 per answer. Poll about every 1 s. |
| `POST /api/editor/jobs/:id/cancel` | → `{ ok: true }` (the asking editor only, else 404; a job already over is left as it is) |

## MCP callbacks (`/api/editor/mcp/*`, `McpJobGuard`)

- **Token.** Header `x-fc-job: <JWT>`, aud `mcp-job`, carrying `{ jobId, wallet, entityId }`. It is valid for about 10 minutes, and only while the job is `running` and the wallet is still listed.
- **Not through nginx.** nginx answers `/api/editor/mcp/` with 404 on api.* and storybook; and a request with `X-Forwarded-For` or `X-Real-IP` gets 404 from the app.
- **Throttling.** Own bucket `mcp`, keyed by job id. The `default` bucket skips these routes.

| route | answer |
|---|---|
| `GET /api/editor/mcp/entities` | `EntityRow[]` |
| `GET /api/editor/mcp/entities/:id` | `{ row, source, config }` (head) |
| `GET /api/editor/mcp/configs` | `{ [id]: EntityConfig }`: every head config, the lookup for `use` / `ref` |
| `POST /api/editor/mcp/entities/:id/drafts` | `{ source, message }` → `Revision`. Based on the current head; records `jobId`; the server re-validates. A job with an `entityId` writes that id and at most 4 new `part` entities; a job without one only creates new entities (at most 4) and revises the ones it created (403 `job_scope` otherwise). Appends the job's `draft` event and sets its `resultRevisionId`. |

## Types

```
EntityRow = { id, kind, label, source: 'seed' | 'db', headRevisionId, publishedRevisionId, headSeq, publishedSeq, updatedAt }   // ids / seqs null for seed-only
Revision  = { id, entityId, seq, parentId, message, authorWallet, jobId, prompt, createdAt, head: boolean, published: boolean, source?, config? }
Job       = { id, wallet, prompt, provider, model, entityId, baseRevisionId, resultRevisionId, status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled', error, tokensIn, tokensOut, createdAt, finishedAt }
```
