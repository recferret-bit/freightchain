# The 3D model editor – detail

Agent reference for the server half of the entity editor. The HTTP contract is `docs/editor-api.md`. The entity format and the client builder are in `docs/agents/world.md` ("Entities"). Keep this file current like AGENTS.md ("Maps stay current").

## In short

- Every 3D model is an entity: a data-only JS module, shipped in code as a seed (`client/shared/entity/seed/`).
- The database (`asset` schema) keeps the editor's history on top: append-only revisions, a **HEAD** (what the editor works on) and a **PUBLISHED** revision (what players draw).
- `GET /api/entities/bundle` is the seed with every published revision on top. It is public, cached, and the only thing the game reads.
- Editors are the wallets in `EDITOR_WALLETS`. They sign in on `storybook.<apex>`, save drafts, restore and publish. A publish is wallet-signed and audited.

## Tables (`server/prisma/asset/asset.prisma`, migration `20261029000000_entities`)

| table | holds |
|---|---|
| `asset.Entity` | one row per id once it is first edited: `kind` (fixed from then on), `headRevisionId`, `publishedRevisionId` (null = players draw the seed), `version` (bumped on each pointer move), `publishedAt` |
| `asset.EntityRevision` | append-only: `seq` (1, 2, … unique per entity), `parentId`, `source` (the canonical file text, `printSource`), `config` (JSON), `hash` (sha256 of `source`), `authorWallet` (`seed` for the code's model), `jobId`, `message` |
| `asset.EditorJob`, `asset.EditorJobEvent` | the AI editor's requests and their steps (prompt, provider, model, status, tokens; events `seq` / `type` / `payload`). Only the revision list reads them for now; the bridge (Phase 4) writes them |

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

## Tools

- `npm run entities:export` (root, which builds the server; or `node dist/cli/index.js entities:export`) writes every PUBLISHED revision of `DATABASE_URL` back over `client/shared/entity/seed/<kind>/<id>.js`, then regenerates `seed/index.js`. Review and commit the result.
- Tests:
  - unit: `test/unit/**/entit*`, `editor*`, `ip-rules`
  - HTTP: `test/scenarios/editor.scenarios.ts` (in-memory + PostgreSQL) and `test/http/editor-host.spec.ts` (storybook host, IP allowlist, the bundle's 429)
  - integration: `entity.prisma.repository.integration.spec.ts` plus the concurrency spec
