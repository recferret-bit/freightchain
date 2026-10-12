---
name: localnet-e2e
description: End-to-end test of the REAL money flows on a LOCAL Solana chain – solana-test-validator with the escrow program (the pinned verifiable .so, upgradeable), the real server in PAYMENT_MODE=program on a throwaway database, wallets as Node keypairs and a fake Phantom in headless Chrome that signs real transactions. Covers initialize by the upgrade authority, create_pool, ticket purchases (the lobby and Node wallets sign AND send, each paying its own fee and Ticket rent, /confirm), sponsor() (a pool sponsorship), ticket rides in the real game with verified recordings, missed goals refunded from the lobby (fail_pool bundled) and the API, ticket-only tiers, the pool crank (fail / expire / refund / close by the chain clock), expire_pool and the permissionless grace close on "three weeks old" pools baked by the real program, ranked payouts and close_pool – every lamport delta asserted; plus TEN riders on one pool (lobby / Node buys, finished rides made over the player API with real hash-chained recordings – honest, flagged + accepted by the admin's signed review, a cheater, a crash –, the re-judge "cron", the payout job, exact prizes to every ranked wallet and nothing to the rest, fee / platform / seed / creator legs, every Ticket rent back via close_ticket, the seed rolled into the next pool's jackpot), pause, sold out, cancel_pool, the authority handover; plus THE AUTONOMOUS DAY of program v2 on its own validator and server (a 1h series written by the admin, its pools opened on their slots by the server's crank, a buy after the sale end refused, the missed-goal next slot failed + refunded + closed by the crank, the review window binding everyone, the payout job's pool-level marks + waiting_review, the admin's signed decisions and HOLD, then the payout key paying the verified ranks and closing the pool – no admin signature on chain; the payout key refused everything else), and a 100 % coverage gate (17/17 instructions and 14/14 events on the validator, every error code asserted – 24/25 on the validator, MathOverflow in LiteSVM). Use when asked to test payments / tickets / sponsorship / payouts / refunds / the crank / treasury / the contract end to end, "localnet", or after changing the program, the chain adapters, the ticket / refund / payout / crank / series code, the payout job or the lobby's pay.js.
---

# Money e2e on a local chain

The walkthrough for people: `docs/localnet-e2e/index.html`. This file is the runbook.

```sh
npm run program:verify                           # once: the verifiable .so in target/deploy (the run warns when it is not the pinned build)
bash .claude/skills/localnet-e2e/run.sh          # root: npm run test:localnet   (~16 min: the three scenarios + the coverage gate, paced by the pools' deadlines)
SCENARIO=payout bash .claude/skills/localnet-e2e/run.sh   # only the ten-rider payout scenario (~6 min; coverage printed, not gated)
SCENARIO=day    bash .claude/skills/localnet-e2e/run.sh   # only the autonomous day (phase 1 + phase 3, ~9 min; DAY_SALE / DAY_PLAY / DAY_REVIEW / DAY_LEAD / DAY_CRANK_MS tune it)
SCENARIO=money  bash .claude/skills/localnet-e2e/run.sh   # only the first scenario (~4 min)
SCENARIO=chaos  bash .claude/skills/localnet-e2e/run.sh   # the flaky-RPC + several-servers / crankers scenario (~5 min; local only, no coverage gate)
KEEP=1 bash .claude/skills/localnet-e2e/run.sh   # keep the scratch dir: keys/, the ledgers + their logs, server.log, server-day.log, accounts/ (+ accounts/day/)
LIKE_DEVNET=1 bash .claude/skills/localnet-e2e/run.sh   # the devnet settings on the local validator (funder + sweep, small prices, no baked pools)
bash server/scripts/devnet.sh rehearse           # = TARGET=devnet: the same scenario against the program on DEVNET (Phase 2 of docs/escrow-open-items.md)
```

**TARGET=devnet** needs the program deployed + initialized on devnet with the code built for its id, `server/.env.devnet` (`devnet.sh env`) and the funded keys
in the main checkout's `deploy/secrets/devnet/` (`funder` pays the throwaway players, swept back at the end). It refuses a non-devnet RPC. Other pools on the
cluster are tolerated: the ticket-only checks and the crank's balance checks are skipped (with a NOTE) when another live pool would mix in. Every run ends
with `deploy/scripts/smoke.mjs` against its program-mode server (the escrow checks the production deploy will run).

Local and throwaway: keys are generated into a scratch dir, ledgers live there, the databases are `freightchain_localnet_<pid>` and `…_<pid>_day` (dropped at the end), ports
are free ones. Nothing touches devnet, the global Solana config or `~/.config/solana/id.json` – every call passes an explicit URL. Needs Docker (compose
PostgreSQL), `solana-test-validator` (Agave 4.1.2), Chrome, `server/node_modules`, internet once (web3.js + three.js from CDNs).

**TARGET=devnet / LIKE_DEVNET=1** default to `SCENARIO=money` (the payout scenario pauses the program and hands its authority around, the day needs a baked series – local only).

## What `run.sh` sets up

1. Keys: `mint` (faucet only – the validator pays it a few lamports, never use it for an exact balance check), `upgrader` (program upgrade authority), `admin` (= `TREASURY_PUBKEY`, `Config.authority`),
   `crank` (`CRANK_SECRET`), `fee` / `seed` / `plat` treasuries, `payout` (phase 3's `PAYOUT_SECRET`, named on chain by `set_payout_authority`).
2. **Phase 1 – fixtures** (`server/scripts/localnet-fixtures.mjs`, its own validator): `initialize` by a stranger is refused, by the upgrader naming the admin
   accepted (platform cut 500 bps); two 8h pools with real buys (every buyer pays its own rent) and one real `pay_prize`; Config, Pools, vaults, Tickets dumped;
   ONLY `prep_deadline` / `play_deadline` / `payout_at` (Pool bytes 63 / 71 / 79 – v2 counts the grace and `expire_pool` from `payout_at`) moved 16 days back,
   verified by decoding. Why: a validator's clock can't be warped (`--warp-slot` on restart moves the slot, not `unix_timestamp`, and stalls) – and
   `expire_pool` / the grace close need 14 days. Then the admin's real `set_series` for the 1h tier (min 4, ≤ 2 per wallet, play 45 s, review 45 s, the sale
   window at the program's minimum of 3600 s); its account goes to `accounts/day/` (NOT into phase 2, where it would open pools under the money scenarios) with
   ONLY `sale_secs` (byte 28) shortened to `DAY_SALE` (120 s) – the same time compression: `open_next_pool` re-checks the money rules, not the cadence.
3. **Phase 2**: a fresh ledger with `--upgradeable-program <id> <so> <upgrader>` + `--account` for every dumped account (Config `pool_count = 2`).
4. The server (`dist/main.js`) with every chain key set explicitly (a stray `server/.env` cannot leak in): program mode, local RPC + WS, crank with
   `CRANK_INTERVAL_MS=0` (the scenario runs `pool:crank` itself), treasuries, `WATCH_INTERVAL_MS=2000`, `SOL_USD=118`, `DEMO_WALLETS=* DEMO_SCALE=1200`
   (a 1h ticket ride = 3 s / 42 m; phase 3 runs at 48 = 1 050 m – program v3 attests whole verified km and a winner needs at least 1: the API bots drive past 1 km,
   the short Chrome game rides' winners are attested by hand with `pool-admin.mjs record-attestation`), `VERDICT_ENFORCE=true`, PostHog off, priority fee 0, `ADMIN_WALLETS` = the admin (the signed ride review).
5. **Phase 3 – the autonomous day** (`SCENARIO=all|day`): the phase-2 server and validator stop; the series dump gets `next_open_at` (byte 122) = now +
   `DAY_LEAD` (75 s) (`RETIME=1 localnet-fixtures.mjs`); a fresh ledger with the program + that one account; `initialize` by the upgrader (Config fresh,
   pool ids from 0); a second throwaway database and server with `PAYOUT_SECRET` = the payout key, `CRANK_INTERVAL_MS=2000` (the crank on its schedule – the
   scenario never runs it), `PAYOUT_INTERVAL_MS=0` (the scenario runs `pool:payout` passes against the same database: deterministic states) and
   `TRUST_PROXY=1` (each rider signs in from its own `X-Forwarded-For`, so the pool-level shared-IP mark stays quiet).
6. The scenarios (`SCENARIO`), then the **coverage gate** (`server/scripts/localnet-coverage.mjs`): the phase-1 ledger is scanned by the fixtures script
   before that validator stops, the phase-2 and phase-3 ledgers before theirs (every transaction naming the program: instructions by IDL discriminator, events through the
   server's codec, the error of a failed one); refusals never land, so the scenarios record each one (step + program error). The report adds the LiteSVM
   tests (static: which `PoolError::X` they assert) and fails `SCENARIO=all` unless every instruction succeeded and every event was emitted on the validator
   and every error code is asserted on the validator or in LiteSVM. Report: `$TMP/coverage.txt` (+ `coverage.json`, `KEEP=1`).

## What the scenario checks (`server/scripts/e2e-localnet.mjs`)

| step | asserted |
|---|---|
| baked pools | active, deadlines 16 days back, one prize paid; registered on the server |
| pools A / B / C created by the admin | ids after the baked ones, open on chain + server, vaults = rent minimum |
| P1 lobby BUY ×2 | the wallet is asked to sign AND send; buyer −(2×price + fee + rent) exactly; `rent_payer` = the buyer |
| P2 Node buy (`/confirm`) | buyer −(price + fee + rent) exactly; pool A Active on chain + server |
| `sponsor` 0.03 SOL into A, 0.02 into C | sponsor −(amount + fee), vault + amount, `Pool.sponsored`, server mirror via the watcher |
| B / C buys (Node wallets), no gasless route | buyer −(price + fee + rent) exactly; `POST …/submit` is a 404 |
| 3 ticket rides in the real game | COMPLETED + VERIFIED, tickets spent |
| B missed its goal, nobody failed it | lobby card CLAIM REFUND at once (fail_pool + refund signed and sent by the wallet); P4's API refund without fail_pool; a stranger closes → cancelled |
| ticket-only | `/api/tiers` 4h not available, no price; lobby NO POOL card; `POST /api/rides` 409 |
| the crank (`pool:crank`) | stranger's close of the unpaid baked pool refused (`MustExpire`); one pass = expire + refund + close (baked) and fail + refund + close (C); every refund to the right wallet, rents back to their payers, sponsorship to the seed, creator rent ×2, crank pays fees only; second pass empty |
| grace close by a stranger | the baked prize-paid pool settles; fee / platform / seed (+ unclaimed) / creator legs exact |
| payout + close of A | ranking P1 > P2; prize cap includes the sponsorship; `pay_prize` exact; close only after every rank; all legs = `closeSplit`; conservation tickets + sponsorship = prizes + legs |

### Ten riders (`server/scripts/e2e-localnet-payout.mjs`)

| step | asserted |
|---|---|
| `create_pool` refused | `BpsSum`, `PriceBelowRentMin`, `TreasuryNotRentExempt` (each refusal recorded with its program error) |
| pool D (1h, min 10, ≤ 2 per wallet): 10 wallets, 11 tickets | lobby BUY in Chrome (the wallet signs AND sends), 8 Node buys, R8 two at once – each buyer's delta exact (price + fee + Ticket rent); OPEN at 9 sold, ACTIVE at 11; `WalletCap` at 3; a 0.05 SOL sponsorship (`InvalidParams` for 0) |
| a live pool is nobody's to touch early | `NotFailable`, `PoolNotOpen` (cancel), `NotRefunding`, `NotSettled` (close_ticket), `TooEarly` (pay_prize) |
| the finished rides – over the player API, no admin back door | each bot spends its ticket, starts, heartbeats (answers the dispatch prompts), uploads hash-chained 10 Hz batches that take the planned holes' damage, ends; R1 drives the real game in Chrome. Honest ×6 + one wallet with 2 rides → VERIFIED; R7 crashes → FAILED (no verdict); R9 an unhashed batch → FLAGGED, then the admin ACCEPTS it with a signed review (`/api/admin`); R10 a teleport → REJECTED |
| "cron" | `verdict:rejudge --status all` keeps every verdict (the admin's decision too); `pool:crank` leaves the live pool alone; `GET payout` 409 before the deadline, 403 for a rider |
| after `payout_at` | `Unauthorized` / `PrizeExceedsShare` / `AccountMismatch` (to = vault) / `BelowRentMin` (pay_prize); the pot still counts the crash's and the cheater's tickets |
| the sale end, the review window | v2: `TooLate` for a buy into the ACTIVE pool D after its sale end, `POST /api/tickets` 409; D has a 20 s review window (`REVIEW_D`): the admin's own `pay_prize` after the play deadline is `TooEarly`, `GET payout` 409 until `payout_at`; `devnet-payout.mjs` (dry run) says when the window ends, waits for it on the chain clock, then prints the plan |
| the payout job (`devnet-payout.mjs --yes`) | ranks = the 8 counted wallets by summed distance; each gets exactly `poolPayouts(prizeBound)`; R7 / R10 get 0; prizes ≤ the share; fee / platform / seed (= seed share + unclaimed) legs = `closeSplit`; the admin + rent minimum − its 9 fees; vault 0; conservation; `PoolNotActive` after |
| Ticket rents | `close_ticket` ×10 by a stranger: every buyer gets its own rent back, accounts gone |
| the next jackpot | the seed treasury sponsors pool E with exactly D's seed leg (an operator step – nothing moves it by itself); server mirror + the lobby's 1h card show it |
| the rest of the program | pause (`Paused` for buy + create_pool), `SoldOut` (pool F, max 1), F closed by the admin with no prize (prize share → seed), pool G: `Unauthorized` / `cancel_pool` / `PoolNotOpen` / `PoolNotActive` / `RefundsPending` / refund / `AlreadyRefunded` / close; the handover: `NoPendingAuthority`, propose, `Unauthorized` accept, accept, the old admin refused, and back |

Scenario 1 also records `MustExpire` and `PrizesAlreadyPaid` (expire of the baked pool that paid a prize); `MathOverflow` is only reachable from a forged
account – LiteSVM `checked_maths_refuse_overflow_instead_of_wrapping`.

Expected values come from the server's own `dist/domain/economy` (`prizeBound`, `poolPayouts`, `closeSplit`); fees are read from each transaction (`meta.fee`).
Screenshots: `$TMPDIR/fc-localnet-shots` (after the lobby buy, after the lobby refund, the NO POOL card, the ten-rider lobby buy, the next pool's sponsored card) – look at them.

### The autonomous day (`server/scripts/e2e-localnet-day.mjs`, phase 3, `SCENARIO=day`)

Program v2's point: after the admin's setup nothing on chain needs the admin key. The 1h series runs on a 120 s grid (sale 120 s, play +45 s, review +45 s);
the crank runs on its schedule in the day's own server; the payout job is the server's `pool:payout` (same database and `PAYOUT_SECRET`).

| step | asserted |
|---|---|
| before the slot | fresh Config (no payout key), the series ahead; a hand-sent `open_next_pool` → `TooEarly`; the crank opened nothing; `pool:payout` is off and says the program names no payout key |
| the admin's last signatures | `set_payout_authority` (Config names the payout key); a DISABLED 4h series (`set_series`) → `open_next_pool` `SeriesDisabled`; the payout key's `create_pool` / `set_series` / `propose_authority` / (later) `cancel_pool` → `Unauthorized` |
| the crank opens slot 1 | by itself: the pool's creation tx is the crank's `open_next_pool` (fee payer = crank), `PoolCreated.from_series = true`; the crank paid Pool rent + vault rent minimum + fee exactly and is `pool.authority`; deadlines = the series' grid; `GET /api/pools` lists it |
| buys + rides | R1 in the lobby (the 1h card sells the series pool), R2–R8 from Node – each −(price + fee + Ticket rent) exactly; 8 sold → ACTIVE; rides over the player API: R1–R5 VERIFIED, R6 FLAGGED (unhashed batch), R7 REJECTED (teleport), R8 never rides |
| the sale ends | `buy` and `sponsor` into the ACTIVE pool → `TooLate`, `POST /api/tickets` 409; the crank opens slot 2 where slot 1 stopped selling; R9 buys 1 (< min 4) |
| the review window | `pool:payout` → `pending`; the payout key's `pay_prize` / `close_pool` → `TooEarly`; standings provisional, `underReview` 2 |
| `payout_at` | a stranger's `pay_prize` → `Unauthorized`; `pool:payout` runs the pool-level marks (the top 3 by distance get `pool-new-wallet-top3`, nobody `pool-shared-ip`) → `waiting_review`, standings `underReview` 4 |
| the admin | signed HOLD; signed decisions (R4–R6 accepted, R7 rejected); `pool:payout` → `held`, not a lamport moved; signed release |
| the payout key pays | one `pool:payout` pass: 6 `pay_prize` (fee payer = the payout key) – each verified rank exactly `poolPayouts(prizeBound)`, R7 / R8 nothing, prizes ≤ the share – then `close_pool` by the payout key: fee / platform / seed legs = `closeSplit`, the crank (creator) + the vault rent minimum; the payout key paid only its 7 fees; vault 0, settled (chain + mirror); conservation; standings `final`, every rank `paid` with its signature; a second pass pays nothing; `PoolNotActive` after |
| slot 2 missed its goal | the crank alone: `fail_pool`, `refund`, `close_pool` (each fee-paid by the crank); R9 + price + its Ticket rent; cancelled on chain and in the mirror |

### Chaos (`server/scripts/e2e-localnet-chaos.mjs`, `SCENARIO=chaos`)

The server's view of the chain is made flaky; the scenario's own view (balances, the clock, `pool-admin`) stays direct, so only the servers it spawns see the faults. `server/scripts/localnet-fault-proxy.mjs` is a JSON-RPC proxy with rules per method (`error`, `http` 429, `blackhole` = a send nobody forwards, `lose-response` = it lands but the caller gets an error, `delay`; `'*'` = a whole provider outage; `times` limits a rule). The scenario starts two servers (S1 ← proxy 1, S2 ← proxy 2 and a dead websocket) on the one database and runs the crank CLI behind a third proxy. `run.sh` starts the usual server too but with the watcher off (inert), so nothing else credits purchases. Standalone smoke of the proxy: `node server/scripts/localnet-fault-proxy.mjs <rpc url>`.

| step | asserted |
|---|---|
| T1 one landed purchase told to two servers | `/confirm` ×2, `/chain/settle` on both, the webhook on both and both watchers at once: 1 ticket, 1 sold, buyer paid price + fee + rent exactly |
| T2 / T3 who credits what | S1's polls refused + S2 without a websocket → S2's polling credits a purchase nobody confirmed; nobody watching → uncredited (control), then S2 restarts → its boot poll catches up with no API call; every RPC call 429 for a while → both servers alive, a purchase afterwards is credited, 4 sold on chain and in the mirror |
| T5 the crank's send path swallows 2 sends AND `getProgramAccounts` is refused | the re-send loop still lands each step once; the pass does not throw, reports the refund as failed, still serves the pool after it (fail + close); with `SOLANA_RPC_FALLBACKS` = a working RPC the next pass refunds and closes, each buyer +price +rent exactly |
| T6 the race | a stranger fails a 10-ticket pool, then 3 crank CLIs + the stranger's own refund run at once: identical transactions dedupe on the validator (same crank key, same blockhash); a step that lost is retried by the next pass; at the end every buyer +price +rent exactly once, the crank key paid exactly the fees of the transactions that landed, the creator the vault rent minimum once, the seed nothing, the mirror cancelled on both servers |

What it found (Oct 10, fixed): one refused ticket read threw out of the whole crank pass, so every pool after it starved – now caught per pool (`CrankPoolsHandler`). It also found that a gasless `/submit` whose status read failed answered 503 although the purchase had landed; the gas sponsor and `/submit` were removed the same day (every wallet pays its own fee), so those tests (the old T4) went with them.

## Admin CLI (`server/scripts/pool-admin.mjs`)

`initialize`, `create-pool` (`--payout`: the review window's end, default = `--play`), `set-series` (`--sale-secs` / `--play-secs` / `--review-secs` or hours), `open-next-pool`, `set-payout-authority`, `set-config`, `sponsor`, `buy`, `pay-prize`, `fail-pool`, `expire-pool`, `refund`, `close-ticket`, `cancel-pool`, `propose-authority`, `accept-authority`, `close-pool`, `show` – keypair FILES, explicit `--url`
(mainnet refused), `+secs` deadlines on the chain clock. Also usable for the owner's devnet setup (`docs/program-deploy.md`); no Phantom signing.

## Not covered

A real Phantom (popups, its RPC, transaction rewriting), a REAL congested cluster (the chaos proxy imitates its failure modes: refusals, 429s, swallowed and slow sends, lost answers – not its timing; `TARGET=devnet` is the only real one), a websocket fault (a dead websocket is covered, a flapping one is not), two servers that CRANK on a schedule at once (the crank CLIs race, the scheduler is the same handler), the payout job on its SCHEDULE (`PAYOUT_INTERVAL_MS` – the day runs the same handler from the CLI, so its states can be asserted pass by pass), a real-length day (24 h sale / 2 h play / 48 h review: the day's grid is compressed to 120 / 45 / 45 s by editing the series' `sale_secs` in its dump – `set_series` itself refuses a sale window under an hour), session keys. Nothing in the server reclaims Ticket rents after a settlement (the scenario does it with
`pool-admin.mjs close-ticket` – docs/escrow-open-items.md), and nothing rolls the seed treasury into the next pool (the scenario's `sponsor` stands in for
the operator). The program is not audited; coverage here means "every instruction / event / error exercised", not line coverage of the Rust – and host-side `cargo llvm-cov` cannot give that: LiteSVM runs the compiled SBF `.so`, so the handlers are not instrumented. Slow machine:
raise `PLAY_A` (seconds until pool A's play deadline; rides must finish before it) – also `PREP_A` / `PREP_B` / `PREP_C`, `PREP_D` / `PLAY_D` / `REVIEW_D` (150 / 270 / 20),
and for the day `DAY_SALE` (120; the lobby buy + 7 Node buys + 7 rides must fit), `DAY_LEAD` (75; seconds from the retime to the first slot – the day takes
the next slot's pool when the first one has less than `DAY_MIN_LEFT` 75 s of sale left).

## Reporting

One `ok`/`FAIL` line per check, then `✓ all money flows verified on the local chain` (and `✓ ten riders paid by the program, every lamport accounted for`, `✓ the autonomous day: opened by the crank, paid by the payout key after the review window, every lamport accounted for`) or the failed names, then the coverage table; on failure `run.sh` prints the server log tail and
keeps the scratch dir. Say which steps passed, the failing check with its numbers, and what was not covered.
