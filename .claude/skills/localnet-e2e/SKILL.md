---
name: localnet-e2e
description: End-to-end test of the REAL money flows on a LOCAL Solana chain – solana-test-validator with the escrow program (the pinned verifiable .so, upgradeable), the real server in PAYMENT_MODE=program on a throwaway database, wallets as Node keypairs and a fake Phantom in headless Chrome that signs real transactions. Covers initialize by the upgrade authority, create_pool, ticket purchases (lobby gasless, Node gasless /submit, self-paid /confirm), the sponsor's byte-exact co-sign boundary, sponsor(), ticket rides in the real game with verified recordings, missed goals refunded from the lobby (fail_pool bundled) and the API, ticket-only tiers, the pool crank (fail / expire / refund / close by the chain clock), expire_pool and the permissionless grace close on "three weeks old" pools baked by the real program, ranked payouts and close_pool – every lamport delta asserted; plus TEN riders on one pool (lobby / gasless / self-paid buys, finished rides made over the player API with real hash-chained recordings – honest, flagged + accepted by the admin's signed review, a cheater, a crash –, the re-judge "cron", the payout job, exact prizes to every ranked wallet and nothing to the rest, fee / platform / seed / creator legs, every Ticket rent back via close_ticket, the seed rolled into the next pool's jackpot), pause, sold out, cancel_pool, the authority handover, and a 100 % coverage gate (14/14 instructions and 12/12 events on the validator, 24/24 error codes asserted). Use when asked to test payments / tickets / sponsorship / payouts / refunds / the crank / treasury / the contract end to end, "localnet", or after changing the program, the chain adapters, the ticket / refund / payout / crank code or the lobby's pay.js.
---

# Money e2e on a local chain

The walkthrough for people: `docs/localnet-e2e/index.html`. This file is the runbook.

```sh
npm run program:verify                           # once: the verifiable .so in target/deploy (the run warns when it is not the pinned build)
bash .claude/skills/localnet-e2e/run.sh          # root: npm run test:localnet   (~10 min: both scenarios + the coverage gate, paced by the pools' deadlines)
SCENARIO=payout bash .claude/skills/localnet-e2e/run.sh   # only the ten-rider payout scenario (~6 min; coverage printed, not gated)
SCENARIO=money  bash .claude/skills/localnet-e2e/run.sh   # only the first scenario (~4 min)
SCENARIO=chaos  bash .claude/skills/localnet-e2e/run.sh   # the flaky-RPC + several-servers / crankers scenario (~5 min; local only, no coverage gate)
KEEP=1 bash .claude/skills/localnet-e2e/run.sh   # keep the scratch dir: keys/, both ledgers + their logs, server.log, accounts/
LIKE_DEVNET=1 bash .claude/skills/localnet-e2e/run.sh   # the devnet settings on the local validator (funder + sweep, small prices, no baked pools)
bash server/scripts/devnet.sh rehearse           # = TARGET=devnet: the same scenario against the program on DEVNET (Phase 2 of docs/escrow-open-items.md)
```

**TARGET=devnet** needs the program deployed + initialized on devnet with the code built for its id, `server/.env.devnet` (`devnet.sh env`) and the funded keys
in the main checkout's `deploy/secrets/devnet/` (`funder` pays the throwaway players, swept back at the end). It refuses a non-devnet RPC. Other pools on the
cluster are tolerated: the ticket-only checks and the crank's balance checks are skipped (with a NOTE) when another live pool would mix in. Every run ends
with `deploy/scripts/smoke.mjs` against its program-mode server (the escrow checks the production deploy will run).

Local and throwaway: keys are generated into a scratch dir, ledgers live there, the database is `freightchain_localnet_<pid>` (dropped at the end), ports
are free ones. Nothing touches devnet, the global Solana config or `~/.config/solana/id.json` – every call passes an explicit URL. Needs Docker (compose
PostgreSQL), `solana-test-validator` (Agave 4.1.2), Chrome, `server/node_modules`, internet once (web3.js + three.js from CDNs).

**TARGET=devnet / LIKE_DEVNET=1** default to `SCENARIO=money` (the payout scenario pauses the program and hands its authority around – local only).

## What `run.sh` sets up

1. Keys: `mint` (faucet only – the validator pays it a few lamports, never use it for an exact balance check), `upgrader` (program upgrade authority), `admin` (= `TREASURY_PUBKEY`, `Config.authority`), `sponsor` (`FEE_PAYER_SECRET`),
   `crank` (`CRANK_SECRET`), `fee` / `seed` / `plat` treasuries.
2. **Phase 1 – fixtures** (`server/scripts/localnet-fixtures.mjs`, its own validator): `initialize` by a stranger is refused, by the upgrader naming the admin
   accepted (platform cut 500 bps); two 8h pools with real buys (one rent paid by the sponsor) and one real `pay_prize`; Config, Pools, vaults, Tickets dumped;
   ONLY `prep_deadline` / `play_deadline` (Pool bytes 63 / 71) moved 16 days back, verified by decoding. Why: a validator's clock can't be warped
   (`--warp-slot` on restart moves the slot, not `unix_timestamp`, and stalls) – and `expire_pool` / the grace close need 14 days.
3. **Phase 2**: a fresh ledger with `--upgradeable-program <id> <so> <upgrader>` + `--account` for every dumped account (Config `pool_count = 2`).
4. The server (`dist/main.js`) with every chain key set explicitly (a stray `server/.env` cannot leak in): program mode, local RPC + WS, sponsor, crank with
   `CRANK_INTERVAL_MS=0` (the scenario runs `pool:crank` itself), treasuries, `WATCH_INTERVAL_MS=2000`, `SOL_USD=118`, `DEMO_WALLETS=* DEMO_SCALE=1200`
   (a 1h ticket ride = 3 s / 42 m), `VERDICT_ENFORCE=true`, PostHog off, priority fee 0, `ADMIN_WALLETS` = the admin (the signed ride review).
5. The scenarios (`SCENARIO`), then the **coverage gate** (`server/scripts/localnet-coverage.mjs`): the phase-1 ledger is scanned by the fixtures script
   before that validator stops, the phase-2 ledger at the end (every transaction naming the program: instructions by IDL discriminator, events through the
   server's codec, the error of a failed one); refusals never land, so the scenarios record each one (step + program error). The report adds the LiteSVM
   tests (static: which `PoolError::X` they assert) and fails `SCENARIO=all` unless every instruction succeeded and every event was emitted on the validator
   and every error code is asserted on the validator or in LiteSVM. Report: `$TMP/coverage.txt` (+ `coverage.json`, `KEEP=1`).

## What the scenario checks (`server/scripts/e2e-localnet.mjs`)

| step | asserted |
|---|---|
| baked pools | active, deadlines 16 days back, one prize paid; registered on the server |
| pools A / B / C created by the admin | ids after the baked ones, open on chain + server, vaults = rent minimum |
| P1 lobby BUY ×2 (gasless) | wallet only signs; buyer −2×price exactly; sponsor −(fee + rent); `rent_payer` = sponsor |
| P2 self-paid (`/confirm`) | buyer −(price + fee + rent) exactly; pool A Active on chain + server |
| `sponsor` 0.03 SOL into A, 0.02 into C | sponsor −(amount + fee), vault + amount, `Pool.sponsored`, server mirror via the watcher |
| B / C buys (Node gasless + self-paid), a tampered `/submit` | buyer −price exactly; tampered = 400, nothing sent |
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
| pool D (1h, min 10, ≤ 2 per wallet): 10 wallets, 11 tickets | lobby BUY in Chrome (gasless: only signs), 4 Node gasless, 4 self-paid – each buyer's delta exact; OPEN at 9 sold, ACTIVE at 11; `WalletCap` at 3; a 0.05 SOL sponsorship (`InvalidParams` for 0) |
| a live pool is nobody's to touch early | `NotFailable`, `PoolNotOpen` (cancel), `NotRefunding`, `NotSettled` (close_ticket), `TooEarly` (pay_prize) |
| the finished rides – over the player API, no admin back door | each bot spends its ticket, starts, heartbeats (answers the dispatch prompts), uploads hash-chained 10 Hz batches that take the planned holes' damage, ends; R1 drives the real game in Chrome. Honest ×6 + one wallet with 2 rides → VERIFIED; R7 crashes → FAILED (no verdict); R9 an unhashed batch → FLAGGED, then the admin ACCEPTS it with a signed review (`/api/admin`); R10 a teleport → REJECTED |
| "cron" | `verdict:rejudge --status all` keeps every verdict (the admin's decision too); `pool:crank` leaves the live pool alone; `GET payout` 409 before the deadline, 403 for a rider |
| after the play deadline | `TooLate` (buy), `Unauthorized` / `PrizeExceedsShare` / `AccountMismatch` (to = vault) / `BelowRentMin` (pay_prize); the pot still counts the crash's and the cheater's tickets |
| the payout job (`devnet-payout.mjs --yes`) | ranks = the 8 counted wallets by summed distance; each gets exactly `poolPayouts(prizeBound)`; R7 / R10 get 0; prizes ≤ the share; fee / platform / seed (= seed share + unclaimed) legs = `closeSplit`; the admin + rent minimum − its 9 fees; vault 0; conservation; `PoolNotActive` after |
| Ticket rents | `close_ticket` ×10 by a stranger: the gas sponsor gets its 6 rents back, each self-paid buyer its own, accounts gone |
| the next jackpot | the seed treasury sponsors pool E with exactly D's seed leg (an operator step – nothing moves it by itself); server mirror + the lobby's 1h card show it |
| the rest of the program | pause (`Paused` for buy + create_pool), `SoldOut` (pool F, max 1), F closed by the admin with no prize (prize share → seed), pool G: `Unauthorized` / `cancel_pool` / `PoolNotOpen` / `PoolNotActive` / `RefundsPending` / refund / `AlreadyRefunded` / close; the handover: `NoPendingAuthority`, propose, `Unauthorized` accept, accept, the old admin refused, and back |

Scenario 1 also records `MustExpire` and `PrizesAlreadyPaid` (expire of the baked pool that paid a prize); `MathOverflow` is only reachable from a forged
account – LiteSVM `checked_maths_refuse_overflow_instead_of_wrapping`.

Expected values come from the server's own `dist/domain/economy` (`prizeBound`, `poolPayouts`, `closeSplit`); fees are read from each transaction (`meta.fee`).
Screenshots: `$TMPDIR/fc-localnet-shots` (after the lobby buy, after the lobby refund, the NO POOL card, the ten-rider lobby buy, the next pool's sponsored card) – look at them.

### Chaos (`server/scripts/e2e-localnet-chaos.mjs`, `SCENARIO=chaos`)

The server's view of the chain is made flaky; the scenario's own view (balances, the clock, `pool-admin`) stays direct, so only the servers it spawns see the faults. `server/scripts/localnet-fault-proxy.mjs` is a JSON-RPC proxy with rules per method (`error`, `http` 429, `blackhole` = a send nobody forwards, `lose-response` = it lands but the caller gets an error, `delay`; `'*'` = a whole provider outage; `times` limits a rule). The scenario starts two servers (S1 ← proxy 1, S2 ← proxy 2 and a dead websocket) on the one database and runs the crank CLI behind a third proxy. `run.sh` starts the usual server too but with the watcher off (inert), so nothing else credits purchases. Standalone smoke of the proxy: `node server/scripts/localnet-fault-proxy.mjs <rpc url>`.

| step | asserted |
|---|---|
| T1 one landed purchase told to two servers | `/confirm` ×2, `/chain/settle` on both, the webhook on both and both watchers at once: 1 ticket, 1 sold, buyer paid price + fee + rent exactly |
| T4 gasless `/submit` through a bad send path | first 2 sends swallowed → the re-send loop lands it, paid once; the cluster took a send but the answer was lost → paid once; the status read refused → `/submit` answers 200 with the signature (pending or paid, never an error) and the purchase is credited exactly once; every send swallowed until the blockhash dies → 409 `transaction_dropped`, nothing charged to anyone, the same order asked again is paid exactly once |
| T2 / T3 who credits what | S1's polls refused + S2 without a websocket → S2's polling credits a purchase nobody confirmed; nobody watching → uncredited (control), then S2 restarts → its boot poll catches up with no API call; every RPC call 429 for a while → both servers alive, a purchase afterwards is credited, 7 sold on chain and in the mirror |
| T5 `getProgramAccounts` refused (the crank's ticket read) | the pass does not throw, reports the refund as failed, still serves the pool after it (fail + close); with `SOLANA_RPC_FALLBACKS` = a working RPC the next pass refunds and closes, each buyer +price +rent exactly |
| T6 the race | a stranger fails a 10-ticket pool, then 3 crank CLIs + the stranger's own refund run at once: identical transactions dedupe on the validator (same crank key, same blockhash); a step that lost is retried by the next pass; at the end every buyer +price +rent exactly once, the crank key paid exactly the fees of the transactions that landed, the creator the vault rent minimum once, the seed nothing, the mirror cancelled on both servers |

What it found (Oct 10, both fixed): one refused ticket read threw out of the whole crank pass, so every pool after it starved – now caught per pool (`CrankPoolsHandler`); and a gasless `/submit` whose status read failed answered 503 although the purchase had landed, which made the lobby fall back to a second self-paid payment – now `200 pending` with the signature (`cosignAndSend` returns `confirmed: false`). Both unit-tested.

## Admin CLI (`server/scripts/pool-admin.mjs`)

`initialize`, `create-pool`, `set-config`, `sponsor`, `buy`, `pay-prize`, `fail-pool`, `expire-pool`, `refund`, `close-ticket`, `cancel-pool`, `propose-authority`, `accept-authority`, `close-pool`, `show` – keypair FILES, explicit `--url`
(mainnet refused), `+secs` deadlines on the chain clock. Also usable for the owner's devnet setup (`docs/program-deploy.md`); no Phantom signing.

## Not covered

A real Phantom (popups, its RPC, transaction rewriting), a REAL congested cluster (the chaos proxy imitates its failure modes: refusals, 429s, swallowed and slow sends, lost answers – not its timing; `TARGET=devnet` is the only real one), a websocket fault (a dead websocket is covered, a flapping one is not), two servers that CRANK on a schedule at once (the crank CLIs race, the scheduler is the same handler), session keys. Nothing in the server reclaims Ticket rents after a settlement (the scenario does it with
`pool-admin.mjs close-ticket` – docs/escrow-open-items.md), and nothing rolls the seed treasury into the next pool (the scenario's `sponsor` stands in for
the operator). The program is not audited; coverage here means "every instruction / event / error exercised", not line coverage of the Rust – and host-side `cargo llvm-cov` cannot give that: LiteSVM runs the compiled SBF `.so`, so the handlers are not instrumented. Slow machine:
raise `PLAY_A` (seconds until pool A's play deadline; rides must finish before it) – also `PREP_A` / `PREP_B` / `PREP_C`, and `PREP_D` / `PLAY_D` (150 / 270).

## Reporting

One `ok`/`FAIL` line per check, then `✓ all money flows verified on the local chain` (and `✓ ten riders paid by the program, every lamport accounted for`) or the failed names, then the coverage table; on failure `run.sh` prints the server log tail and
keeps the scratch dir. Say which steps passed, the failing check with its numbers, and what was not covered.
