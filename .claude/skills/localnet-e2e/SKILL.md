---
name: localnet-e2e
description: End-to-end test of the REAL money flows on a LOCAL Solana chain – solana-test-validator with the escrow program (the pinned verifiable .so, upgradeable), the real server in PAYMENT_MODE=program on a throwaway database, wallets as Node keypairs and a fake Phantom in headless Chrome that signs real transactions. Covers initialize by the upgrade authority, create_pool, ticket purchases (lobby gasless, Node gasless /submit, self-paid /confirm), the sponsor's byte-exact co-sign boundary, sponsor(), ticket rides in the real game with verified recordings, missed goals refunded from the lobby (fail_pool bundled) and the API, ticket-only tiers, the pool crank (fail / expire / refund / close by the chain clock), expire_pool and the permissionless grace close on "three weeks old" pools baked by the real program, ranked payouts and close_pool – every lamport delta asserted. Use when asked to test payments / tickets / sponsorship / payouts / refunds / the crank / treasury / the contract end to end, "localnet", or after changing the program, the chain adapters, the ticket / refund / payout / crank code or the lobby's pay.js.
---

# Money e2e on a local chain

The walkthrough for people: `docs/localnet-e2e/index.html`. This file is the runbook.

```sh
npm run program:verify                           # once: the verifiable .so in target/deploy (the run warns when it is not the pinned build)
bash .claude/skills/localnet-e2e/run.sh          # root: npm run test:localnet   (~4 min, paced by the pools' deadlines)
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
   (a 1h ticket ride = 3 s / 42 m), `VERDICT_ENFORCE=true`, PostHog off, priority fee 0.

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

Expected values come from the server's own `dist/domain/economy` (`prizeBound`, `poolPayouts`, `closeSplit`); fees are read from each transaction (`meta.fee`).
Screenshots: `$TMPDIR/fc-localnet-shots` (after the lobby buy, after the lobby refund, the NO POOL card) – look at them.

## Admin CLI (`server/scripts/pool-admin.mjs`)

`initialize`, `create-pool`, `set-config`, `sponsor`, `buy`, `pay-prize`, `fail-pool`, `expire-pool`, `close-pool`, `show` – keypair FILES, explicit `--url`
(mainnet refused), `+secs` deadlines on the chain clock. Also usable for the owner's devnet setup (`docs/program-deploy.md`); no Phantom signing.

## Not covered

A real Phantom (popups, its RPC, transaction rewriting), devnet congestion / dropped transactions / RPCs refusing `getProgramAccounts` (the crank needs it),
several server instances cranking at once, `cancel_pool`, the authority handover, pause, session keys (the LiteSVM tests cover the program side). The program
is not audited. Slow machine: raise `PLAY_A` (seconds until pool A's play deadline; rides must finish before it) – also `PREP_A` / `PREP_B` / `PREP_C`.

## Reporting

One `ok`/`FAIL` line per check, then `✓ all money flows verified on the local chain` or the failed names; on failure `run.sh` prints the server log tail and
keeps the scratch dir. Say which steps passed, the failing check with its numbers, and what was not covered.
