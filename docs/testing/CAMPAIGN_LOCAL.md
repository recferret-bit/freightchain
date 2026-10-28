# Campaign local acceptance

The Profile campaign panel has EN/RU copy, accessible input labels and status messages, server progress, retry states, a full-wallet X proof code, Telegram Login Widget and Turnstile integration. `POST /api/airdrop/preseason/claim-attempt` issues one event 1h grant under the player row lock after verified MEDIUM/HARD training, signed Telegram channel/group membership, authenticated group activity, X follow/post proof, age/current terms and explicit event consent.

The authenticated Telegram webhook requires `X-Telegram-Bot-Api-Secret-Token`. Only fresh original human messages in the configured group count: at least 20 characters and three words, without links, forwarding or slash commands. Replays and unknown accounts change nothing.

The reserved `SYSTEM-PRESEASON-2026-11` promo code identifies the event source. It cannot be created/redeemed through the public/admin promo API. The grant and consent/issuance stamps commit together, and one wallet cannot receive a second grant. Event 1h orders select this source only, excluding an older ordinary or Convoy grant. They share a persisted event road seed and full distance, including demo wallets. Event ranked starts reject other ticket sources, repeat ranked starts, disabled/invalid windows and late starts. Event rides cannot start unranked. Ordering waits for the event window; a ready event entry that outlives its window or is disabled closes on the next order, allowing free training without restoring the spent grant. Training stays free under the existing one-open-ride rule.

## Owner configuration

The admin Settings tab exposes all six campaign controls, each with signed changes and its numeric bounds. All event dates and flags start disabled/zero. Through the signed admin settings API configure `event_week_start_utc`, `event_last_start_utc`, `event_week_end_utc` as integer UTC epoch seconds. Last start must be at least 75 minutes before end. Set `event_mode_enabled=1` only for the authorized event. The grant is consumed at ordering; cancellation/abandonment does not reissue it.

Configure the Telegram bot/token, channel, group, public login bot name and webhook secret. Register its webhook and approved Login Widget domain. Configure X and Turnstile secret/site keys. Tests never register webhooks, send social posts or contact real providers.

`airdrop_x_check_cost_cents=0` means outbound X verification is unavailable until the owner supplies a conservative integer-cent cost bound covering all three provider requests. `airdrop_x_budget_cents` defaults to 10,000 cents and cannot exceed it. A reservation commits before provider calls; provider failure or process death does not refund it. All wallets share one durable campaign budget. A wallet waits ten minutes between attempts; the identical successful handle/post proof is cached for ten minutes across restarts. This is a reservation accounting limit, not proof of actual provider billing. Recheck vendor costs before enabling it.

Task evidence carries into Season 1. The plan does not specify weights converting each task into economic points: `completedTasks` reports 0–3 categories and existing `points` remain preserved. Agree those weights before a snapshot or allocation. No future TGE TEN4 is minted. The legacy 48-hour ledger-claim flag remains separate from event issuance.

## Verification

- Server unit/architecture/HTTP and PostgreSQL integration suites exercise these APIs with inert provider responses.
- `test/integration/preseason-campaign.integration.spec.ts` races eight claims and message replays, and competing wallets for the final reserved budget cent; retries must not duplicate provider work or grants.
- Shared HTTP scenarios cover authenticated webhook refusal, insufficient activity, missing consent, event ride creation, shared event seed and mandatory ranked start.
- `node frontend/client/tools/e2e-campaign.mjs` drives real Chrome against local inert HTTP fixtures, blocks external provider requests, checks invalid input, provider failure/retry, Telegram callback payload, consent, issued state, EN/RU and mobile width. It writes `fc-campaign-shots` below the OS temporary directory. Browser fixtures validate the UI; shared HTTP/PostgreSQL tests validate actual backend/provider adapters.

Real provider credentials and production-origin widget/webhook operation require owner acceptance. The future points snapshot remains governed by the launch plan; this task does not deploy or authorize it.

## $500 event settlement (local)

Configure, through the signed settings API, `event_week_start_utc`, `event_week_end_utc`, `event_review_end_utc` (after week end) and `event_appeals_end_utc` (after review end); otherwise the public table stays empty and the lock is refused. The admin `EVENT TOP-20` tab lists the top 35 candidates (country, Trust, ride, subnet-HMAC overlaps, sanctions state) and signs the review flags, the mocked sanctions check, the prize table, the lock (only from the appeals end, once) and each manual USDC `txSignature` (`POST /api/admin/event/payouts`; clean sanctions check under 24 h, Trust >= 50, unique per winner and signature). The local sanctions adapter is a deterministic fake (addresses ending `SNCT` are "listed"); it is not a screening. `GET /api/event/board` and the Profile table (`site/lobby-event.js`, EN/RU) show the preliminary table after the review end and the final list after the lock. Evidence: `test/unit/domain/prize/event-settlement.spec.ts`, the handler/service/controller unit specs, `test/integration/repositories/event-settlement.prisma.repository.integration.spec.ts` (including the payout races), and the shared HTTP scenario `test/scenarios/event-settlement.scenarios.ts` (in-memory and PostgreSQL). Not covered: a real-Chrome run of the new tab/table, live Chainalysis, an appeal intake.

## Evidence — 2026-10-26

Isolated campaign branch: server 464 files / 2,664 tests passed; full PostgreSQL suite 61 files / 642 tests passed on `freightchain_campaign_ui_v2_20261026_test`. The final event-expiry and grant-source scenarios also passed on PostgreSQL after the broader run. Client 179 tests, client ESLint and server typecheck passed. Real Chrome campaign fixtures passed; desktop EN/RU and 390px mobile screenshots were inspected. Broader merged-root/chain acceptance is recorded by the coordinating local-readiness run.
