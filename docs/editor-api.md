# Entity editor – HTTP contract

The storybook model viewer's editor and the MCP server talk to the API through this contract. Server: `server/src/presentation/{entities,editor}/`. Client: `client/js/editor/` and `client/js/world/entities.js`. MCP: `mcp/`.

Bodies are JSON. Errors are `application/problem+json` and carry `code`. A rejected entity answers **422** `code: 'entity_invalid'` with `errors: string[]` and `warnings: string[]` (from `validateEntity` in `client/shared/entity/schema.js`). `Revision` and `EntityRow` are defined at the end.

## Public (every host that proxies `/api/entities/`)

| route | answer |
|---|---|
| `GET /api/entities/bundle` | `{ rev, entities: EntityConfig[] }`: the code's seed (`client/shared/entity/seed/`) with every **published** DB revision on top (the DB wins per id). `rev` is a short hash of the content. `Cache-Control: public, max-age=60, stale-while-revalidate=600`, weak ETag, 304 on `If-None-Match`. Throttle bucket `entities`, per IP (`THROTTLE_ENTITIES_LIMIT`). Built once per publish and held in memory, so no request reaches the DB. |

## Editor (`/api/editor/*`, `EditorGuard`)

- **Host.** `headers.host` must be `storybook.<COOKIE_DOMAIN>`. Locally, when `COOKIE_DOMAIN` is unset, any host is accepted, the same way the admin guard behaves there.
- **Session.** Cookie `fc_editor`: a JWT with aud `editor`, `Path=/api/editor`, httpOnly, SameSite=Strict, no Domain.
- **Allowlist.** The wallet is re-checked against `EDITOR_WALLETS` on every request. An unknown wallet, a missing session or a wrong host gets **404**.
- **IP.** When `EDITOR_IP_ALLOWLIST` (comma-separated CIDRs or IPs) is set, the client IP must match it, otherwise 404.
- **CSRF.** Unsafe methods need the header `x-fc-editor: 1`, otherwise 403.

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
| `POST /api/editor/entities/:id/publish` | `{ revisionId, signature }` → `{ rev }` (the new bundle rev). Audited as `entity.publish`. The only thing that changes what players see. |
| `POST /api/editor/jobs` | `{ prompt (≤ 4000), entityId?, baseRevisionId?, provider?, model? }` → **202** `{ jobId }`. 422 `spec_invalid` with `errors` when the skill's validator rejects the prompt. 409 `job_running` when one is already running for this wallet or entity. 429 at the daily cap. |
| `GET /api/editor/jobs?entityId=` | → `Job[]`, newest first, at most 50 |
| `GET /api/editor/jobs/:id` | → `Job` |
| `GET /api/editor/jobs/:id/events?after=<seq>` | → `{ status, events: [{ seq, type, payload, at }] }`. Types: `status`, `text`, `tool_call`, `tool_result`, `draft` (payload `{ revisionId, entityId }`), `usage`, `error`, `done`. Poll about every 1 s. |
| `POST /api/editor/jobs/:id/cancel` | → `{ ok: true }` |

## MCP callbacks (`/api/editor/mcp/*`, `McpJobGuard`)

- **Token.** Header `x-fc-job: <JWT>`, aud `mcp-job`, carrying `{ jobId, wallet, entityId }`. It is valid for about 10 minutes, and only while the job is `running` and the wallet is still listed.
- **Not through nginx.** A request with `X-Forwarded-For` or `X-Real-IP` gets 404.
- **Throttling.** Own bucket `mcp`, keyed by job id. The `default` bucket skips these routes.

| route | answer |
|---|---|
| `GET /api/editor/mcp/entities` | `EntityRow[]` |
| `GET /api/editor/mcp/entities/:id` | `{ row, source, config }` (head) |
| `GET /api/editor/mcp/configs` | `{ [id]: EntityConfig }`: every head config, the lookup for `use` / `ref` |
| `POST /api/editor/mcp/entities/:id/drafts` | `{ source, message }` → `Revision`. Based on the current head; records `jobId`; the server re-validates. When the job has an `entityId`, only that id or a new `part` entity may be written. |

## Types

```
EntityRow = { id, kind, label, source: 'seed' | 'db', headRevisionId, publishedRevisionId, headSeq, publishedSeq, updatedAt }   // ids / seqs null for seed-only
Revision  = { id, entityId, seq, parentId, message, authorWallet, jobId, prompt, createdAt, head: boolean, published: boolean, source?, config? }
Job       = { id, wallet, prompt, provider, model, entityId, baseRevisionId, resultRevisionId, status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled', error, tokensIn, tokensOut, createdAt, finishedAt }
```
