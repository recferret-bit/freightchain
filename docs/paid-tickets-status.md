# Paid tickets – status, open questions, next steps, how to test

Branch `paid-tickets` (worktree `.claude/worktrees/paid-tickets`). Written Oct 8, 2026 (head f4c50db + this file). Submission: Sun Oct 12 noon PT.
The plan and the as-built notes per workstream are in [`paid-tickets-plan.md`](paid-tickets-plan.md). The plain-language explainer is the whitepaper, chapter 05 (`landing/whitepaper.html#onchain`, served at `whitepaper.<apex>#onchain`). The contract spec is [`pool-program/index.html`](pool-program/index.html).

## 1. Current status

**Built, merged on this branch, and verified together. Not deployed, not run against a real chain.**

| part | what it does | state |
|---|---|---|
| **Solana program** `programs/freightchain-pools/` (Anchor 1.2, Rust) | one program, many pools; each pool = its own escrow vault (PDA, no private key) with fixed rules: price, minimum tickets to play, max per wallet, preparation + play deadlines, prize / seed / fee split, two treasury addresses. Instructions: `initialize`, two-step authority handover, `pause`, `create_pool`, `cancel_pool`, `buy_ticket` (a separate fee payer is allowed; the server no longer uses it), `sponsor`, `fail_pool` / `refund` / `close_ticket` / `expire_pool` (anyone), `pay_prize` (capped at the prize share), `close_pool` | 50 tests (48 LiteSVM + 2 unit) green. **Program id is a placeholder** (`anchor keys sync` before deploy). Not audited. Session keys (phase 2) not built |
| **Server: pools, tickets, promo** | mirror of the pool accounts; tickets per wallet per pool (capped like free rides, audit trail); promo codes add tickets of a tier (and, since the promo-codes work, extra free rides or cosmetics – docs/promocodes.md); a paid ride spends one ticket; admin CLI | done |
| **Server: orders, settlement** | order → server-built transaction (the wallet signs AND sends it, paying its own fee and Ticket rent; the gas sponsor and `/submit` were removed Oct 10) → confirm → the program's `TicketBought` event credits the tickets; refunds; admin payout transactions (top 3 25/15/10 + top-20 share) | done |
| **Server: chain** | IDL-driven codec checked byte for byte against the program; fee estimator (priority fees); **program-log watcher** (the "callback when a ticket is paid": credits even if the tab closed), webhook for QuickNode / Helius, finality pass (dropped transactions are undone), pool sync (the chain wins) | done; **crank** (server-side `fail_pool` with `CRANK_SECRET`) not built |
| **Client** | lobby pool cards (progress "7 / 10 committed", countdowns, split, explorer links, RIDE / BUY / CLAIM REFUND), promo input, profile tickets + history; landing pools board + "how the escrow works" | done against the real API shapes; buy / refund only exercised against a stub + fake wallet |

Tests after merging `main` (verified play + admin) into this branch: `npm run check` green (client trace, landing 59, server 777 unit), server integration 205 (fresh DB, migration order init → free_ride_cap → verified_play → admin → pools_tickets → ride_pool → order_settlement), program 47; e2e-lobby (56 checks) + e2e-wallet green against a live server (seeded pools, transfer mode). Screenshots looked at (desktop + phone). Pool payouts rank like the paid boards: verified recordings only when `VERDICT_ENFORCE` is on, every completed ride in shadow mode.

Kept on purpose: the legacy pay-per-ride routes (`/api/rides/:id/payment|confirm|reconcile`) as the `PAYMENT_MODE=transfer` fallback. In `program` mode paid rides are ticket-only.

## 2. What is needed from you

| # | what | when | notes |
|---|---|---|---|
| 1 | **Program keypair** – or OK for me to generate one inside the repo (gitignored) | before the devnet deploy (Oct 9) | never your global Solana config / `~/.config/solana/id.json` |
| 2 | **~5 devnet SOL** on that keypair (deploy ≈ 3 SOL) | same | faucets give 1–2 SOL/day/address; QuickNode faucet too |
| 3 | **Phantom on devnet** = the admin authority (`TREASURY_PUBKEY`): named as admin by `initialize` (which the upgrade-authority deploy wallet signs), then signs each `create_pool`, later `pay_prize` / `close_pool` | at deploy, and at payout time | the server never holds this key |
| 4 | **Seed + fee treasury addresses** (any wallets you control; devnet is fine) | before `create_pool` | written into every pool, never changeable |
| 5 | **Pool settings**: price, minimum, preparation / play deadlines for the week pools + a short demo pool | before `create_pool` | the 1 hour pool is $5 and **min 20** (`ride-tier.ts`): fewer sold by the prep deadline and every ticket is refunded. A short demo pool may pass a smaller `--min` |
| 6 | **RPC provider**: `SOLANA_RPC` (+ `SOLANA_WS`) URL, e.g. QuickNode devnet; optionally a Streams webhook → `POST /api/chain/webhook` with `WEBHOOK_SECRET` | before the devnet run | the public devnet RPC works for a test, rate-limited |
| 7 | ~~Gas sponsor keypair~~ – removed Oct 10: every buyer pays its own fee | – | |
| 8 | Answers to the open questions below | any time; Q1, Q2, Q5 by Oct 9 | |

## 3. Open questions

The current list of what is not done, the newer open questions (Q-A … Q13) and the todo list: [`escrow-open-items.md`](escrow-open-items.md).

| # | question | my recommendation |
|---|---|---|
| Q1 | Delete the legacy pay-per-ride routes now, or keep them as the transfer-mode fallback until devnet is green? | keep until the devnet run is green, then delete (one commit) |
| Q2 | Refunds are **self-paid** (the buyer sends the refund and pays ~5 000 lamports). The plan said "a refund must never cost the victim a fee". Sponsor them (needs a server-signed path, which no longer exists) or keep? | keep self-paid for the hackathon: a refund then never depends on our server; the closed ticket account returns its rent (more than the fee) to whoever paid it |
| Q3 | Crank: should the server fail expired pools by itself (`CRANK_SECRET`)? | **answered – built** on Oct 8: `pool:crank` + `CRANK_INTERVAL_MS` (fail, expire, refunds, close) |
| Q4 | Session keys (phase 2 of §2.10): go / no-go | no-go – too risky for the time left (and the gas sponsor that was meant to cover the fee step was removed Oct 10: every wallet pays its own fee) |
| Q5 | Landing / lobby copy that runs ahead of the build ("Program written and tested; devnet deploy next", dev-seeded pools shown as "IN ESCROW ON CHAIN") and the old "50 % grand prize · draw" legend (the top-3 change is planned on `main`) – who changes it and when? | I adjust it right after the devnet deploy, together with the top-3 rebase |
| Q6 | Merge order with `main` / `verified-play`: our migrations are `20261009000000…02`, after verified-play's `20261008000002/3` | merge `verified-play` first if it is ready, then rebase this branch and re-run the drift test |
| Q7 | Mainnet: the program is not audited. Say so in the submission ("devnet only, not audited")? | yes |
| Q8 | Small known gaps – fix now or after the submission? `profile.stats.paidRides` stays 0 for ticket rides; 409 problems carry `title: "Error"`; `pool:seed` cannot make a `refunding` pool; a dropped transaction with no order (pool-only event / explorer purchase) is never undone, only re-synced | fix `paidRides` before recording; the rest after |

## 3b. Built since (Oct 8)

- **The pool crank** (`CRANK_SECRET`): fails missed pools, expires unsettled ones after the 14-day grace, refunds their tickets 8 per transaction and closes them – by the chain clock, every step settled into the mirror. CLI `pool:crank` (one pass) and `PoolCrankScheduler` (`CRANK_INTERVAL_MS`, 60 s). Never touches a pool that paid prizes.
- **Ticket-only in program mode**: no pay-per-ride fallback when an on-sale tier has no live pool (tiers / lobby NO POOL card / landing table / rides 409).
- **4h and 8h are not on sale** (Oct 9): `onSale: false` in `ride-tier.ts`. No live pool → lobby SOON, no lamport price, `POST /api/rides` 409 `tier_not_on_sale`. Planned prices stay $15 and $50. A registered open or active pool of that tier still sells tickets.
- **1h is not on sale either** (Oct 11): same flag, same card, same refusal. Planned price stays $5 and the pool minimum stays 20. A registered open or active 1 hour pool still sells tickets. Pay-per-ride tests opt the tier back on with `setTierOnSaleForTest` and reset it.
- **1 hour pool opens at 20 tickets** (Oct 10): `minTickets: 20` on the 1h tier. `pool:seed` and `pool-admin create-pool` use that when `--min` is omitted. Below 20 at the prep deadline the pool fails and every ticket is refunded. At 20 × $5 the server builds $26 / $16 / $11 / $1 for places 1–20. A test pool may still pass a smaller `--min`.
- **Refundable at once**: a missed-goal pool's buyers see CLAIM REFUND before anyone failed it (the refund transaction bundles `fail_pool`).
- The lobby's unfinished-order note says "nothing was charged" when nothing was sent.
- **`npm run test:localnet`** covers all of it on a local validator, including `sponsor`, `expire_pool` and the permissionless grace close (baked "three weeks old" pools) – walkthrough: `docs/localnet-e2e/index.html`.

## 4. What to do next

1. **Devnet deploy** (needs §2 items 1–4): follow `docs/program-deploy.md` – program id → `anchor keys sync` → IDL + `vendor-idl` → `UPDATE_PIN=1 npm run program:verify` → codec fixture → deploy **the verifiable `.so`** with `solana program deploy` (never `anchor deploy`: it ships host-built bytes that never verify) → `initialize` at once → `check.sh onchain` → `create_pool` for the week pools + the demo pool (signed in Phantom).
2. **Register the pools**: `node dist/cli/index.js pool:register <id> --label "1 HOUR · week 42"` per pool.
3. **Real devnet run** (server in `program` mode, `TICKET_PROGRAM_ID` set): buy from the lobby with Phantom (it signs and sends), the watcher credits it, ride with the ticket; let the demo pool fail → CLAIM REFUND; a live pool past its deadline → admin payout + close. Write `server/scripts/devnet-pool.mjs` (replaces `devnet-pay.mjs`) to repeat it headless.
4. Delete the legacy pay-per-ride routes (Q1), fix `paidRides` (Q8), copy pass (Q5).
5. Deploy: `deploy/.env.example` + `init.sh` (program id, treasuries, crank key, webhook secret), smoke check (program, Config, pools, sponsor balance), `deploy/README.md` "Program" section; then `npm run deploy` (with you).
6. Submission material: AGENTS.md / backend-architecture final pass, `hackathon-plan-v2.md` (architecture line, "escrowed pools" slide), demo video of buy → ride → refund / payout.

## 5. How to test it

All from the repo root unless noted. PostgreSQL: `npm run db:up` (127.0.0.1:15433).

| what | command | proves |
|---|---|---|
| **the money, end to end on a local chain** | `npm run test:localnet` (skill `localnet-e2e`; Docker + `solana-test-validator`, ~3 min) | real program transactions against the real server: lobby + Node purchases (each wallet signs and sends), verified ticket rides, missed goal → refunds (API bundle + lobby), payouts + close – every lamport delta |
| everything Docker-free | `npm run check` (once: `npm run install:landing`) | client lint + bundle + headless trace, landing lint / build / tests, server build + typecheck + 654 unit / audit / in-memory HTTP tests |
| server on PostgreSQL | `cd server && TEST_DATABASE_URL=postgresql://freight:freight_dev_password@localhost:15433/freightchain_paidtickets_test npm run test:integration` (create the DB once: `docker compose exec -T postgres psql -U freight -d postgres -c 'CREATE DATABASE freightchain_paidtickets_test'`) | repositories, the same HTTP scenarios, concurrency (one ticket = one ride, last promo redemption, duplicate events credited once, purchases racing a failing pool), migration drift. **Use this branch's own DB** – the shared `freightchain_test` is also used by the verified-play worktree |
| the program | `export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"` then `npm run program:build && npm run program:test` | 51 tests (49 LiteSVM + 2 unit): escrow, refunds, settle, grace / expiry, authority, rent, CU, the shared money table |
| the deployable binary | `npm run program:verify` (Docker; skill `program-check`) | `solana-verify` reproduces the pinned `verifiable-build.hash`, the 51 tests pass on that exact `.so`, clippy + `cargo audit` clean; after the deploy `PROGRAM_ID=<id> bash .claude/skills/program-check/check.sh onchain` |
| lobby + landing in real Chrome | `cd server && npm run build`; own DB: `DATABASE_URL=…/freightchain_paidtickets_e2e npx prisma migrate deploy`; start `DATABASE_URL=… FREE_RIDE_SECONDS=3 SOL_USD=118 TREASURY_PUBKEY=<any address> PORT=3128 node dist/main.js`; then `DATABASE_URL=… SEED=1 PORT=9361 BASE=http://localhost:3128 node scripts/e2e-lobby.mjs` and `PORT=9367 BASE=http://localhost:3128 node ../landing/tools/e2e-wallet.mjs` (`npm run landing:build` first) | seeded pools (1h live, 4h open 7/10), promo redeem, ride with a ticket, 409 messages, profile tickets, landing pools board, the whitepaper escrow chapter, sign-in. Look at the screenshots |
| buy / refund flows without a chain | `npm --prefix server run test:tickets-stub` | the lobby's buy (signed and sent by the wallet), the reload-and-retry banner, CLAIM REFUND – against `scripts/stub-api.mjs` and a fake wallet |
| by hand, no chain | dev CLI on your DB: `node dist/cli/index.js pool:seed --id 1 --tier 1h --status active --min 2` · `promo:create WELCOME --tier 1h --credits 2` · `tickets:grant <wallet> 1 2` · `promo:list` | lobby without a deployed program (also the demo fallback) |
| devnet (after §4.1) | server with `PAYMENT_MODE=program TICKET_PROGRAM_ID=<id> SOLANA_RPC=<devnet url> WATCH_INTERVAL_MS=15000`, Phantom on devnet | the real thing: buy, watcher credit, ride, refund, payout |

Stop servers by PID, never `pkill -f` (other sessions run servers too). Never point tests at the dev database `freightchain`.
