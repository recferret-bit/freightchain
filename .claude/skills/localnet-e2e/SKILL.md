---
name: localnet-e2e
description: End-to-end test of the REAL money flows on a LOCAL Solana chain – solana-test-validator with the escrow program (the pinned verifiable .so, upgradeable), the real server in PAYMENT_MODE=program on a throwaway database, wallets as Node keypairs and a fake Phantom in headless Chrome that signs real transactions. Covers initialize by the upgrade authority, create_pool, ticket purchases (lobby gasless, Node gasless /submit, self-paid /confirm), the sponsor's byte-exact co-sign boundary, ticket rides in the real game with verified recordings, a missed goal → refunds (API fail_pool+refund bundle and lobby CLAIM REFUND), permissionless close of a refunded pool, ranked pay_prize payouts by the admin and close_pool – every lamport delta asserted against the program's maths. Use when asked to test payments / tickets / payouts / refunds / treasury / the contract end to end, "localnet", "test the escrow for real", or after changing the program, the chain adapter, the ticket / refund / payout routes or the lobby's pay.js.
---

# Money e2e on a local chain

```sh
bash .claude/skills/localnet-e2e/run.sh          # root: npm run test:localnet   (~3 min, paced by the pools' deadlines)
KEEP=1 bash .claude/skills/localnet-e2e/run.sh   # keep the scratch dir: keys/, ledger/, validator.log, server.log
```

Everything is local and throwaway: keys are generated into a scratch dir, the validator's ledger lives there, the database is `freightchain_localnet_<pid>`
(dropped at the end), ports are free ones. Nothing touches devnet, the global Solana config or `~/.config/solana/id.json` – every call passes an explicit URL.
Needs: Docker (compose PostgreSQL), `solana-test-validator` (Agave 4.1.2, on the PATH line in the script), Chrome, `server/node_modules`, internet once
(the lobby loads web3.js and the game three.js from CDNs), and the program binary `programs/freightchain-pools/target/deploy/freightchain_pools.so` –
build it with `npm run program:verify` (the script warns when it is not the pinned verifiable build: then you test other bytes than a deploy ships).

## What it sets up (`run.sh`)

1. Keypairs: `mint` (validator faucet), `upgrader` (program upgrade authority), `admin` (= `TREASURY_PUBKEY`, `Config.authority`), `sponsor` (`FEE_PAYER_SECRET`), `fee` / `seed` / `plat` treasuries.
2. `solana-test-validator --upgradeable-program <id> <so> <upgrader>` – a real upgradeable program with a ProgramData account, so `initialize`'s upgrade-authority check runs for real.
3. `initialize` signed by the upgrader naming the admin, platform cut 500 bps (production uses 0 – this is the only place the platform leg is exercised).
4. The server (`dist/main.js`) with every chain key set explicitly (a stray `server/.env` cannot leak in): program mode, local RPC + WS, sponsor, treasuries, `WATCH_INTERVAL_MS=2000`, `SOL_USD=118`,
   `DEMO_WALLETS=* DEMO_SCALE=1200` (a 1h ticket ride = 3 s / 42 m), `VERDICT_ENFORCE=true` (only verified rides rank), PostHog off, priority fee 0.

## What the scenario checks (`server/scripts/e2e-localnet.mjs`)

| step | path | asserted |
|---|---|---|
| pools | `scripts/pool-admin.mjs create-pool` + `pool:register` | open on chain + server, vaults = rent minimum |
| P1 buys 2 (pool A) | **lobby** BUY, fake Phantom `signTransaction`, server co-signs + sends | buyer −2×price exactly, vault +2×price, sponsor −(fee + Ticket rent), `rent_payer` = sponsor, wallet asked only to sign |
| P2 buys 1 | Node, `?selfPaid=1`, sign + send, `/confirm` | buyer −(price + fee + rent) exactly, pool → Active on chain + server |
| P3 buys 1 (pool B) | Node gasless `/submit` | buyer −price exactly; a tampered message is refused (400) |
| rides | real game, 2 × P1 + 1 × P2 | completed + VERIFIED, tickets spent |
| pool B misses min | P4 `GET pools/:id/refund` (`needsFail`: fail_pool + refund in one tx) | P4 +price +own rent −fee, chain refunding, Ticket closed, server refunding |
| P3 refund | **lobby** CLAIM REFUND, `signAndSendTransaction` | P3 +price −fee, sponsor +rent |
| close B | `pool-admin close-pool` by a stranger | cancelled, vault 0, creator +rent minimum |
| payout A | admin signs in, `GET pools/:id/payout` (403 for a player), signs each `pay_prize` | ranking P1 > P2, amounts = `poolPayouts(prizeBound)`, winners + exact lamports, close only after every rank |
| close A | the offered `close_pool` | fee / platform / seed (+ unclaimed) / creator legs = `closeSplit`, vault 0, settled on chain + server, conservation |

Expected values come from the server's own `domain/economy` maths (`dist/…/vault-split.js`, `pool-payouts.js`); fees are read from each transaction (`meta.fee`), never assumed.
Screenshots: `$TMPDIR/fc-localnet-shots` (lobby after the buy and after the refund) – look at them.

## Admin CLI (`server/scripts/pool-admin.mjs`)

`initialize`, `create-pool`, `set-config`, `close-pool`, `show` with keypair FILES and an explicit `--url` (mainnet refused); `+secs` deadlines use the chain clock.
The harness uses it on localnet; it also works for the owner's devnet setup with the deploy wallet (`docs/program-deploy.md`). It does not do Phantom
signing – a pool created by a Phantom admin still needs a UI.

## Known gaps it shows (not bugs in the harness)

- **No crank**: nothing runs `fail_pool` on a schedule (`CRANK_SECRET` is unused). A pool that missed its goal shows "GOAL MISSED – REFUND SOON" with no button
  until someone fails it; only the API refund bundles `fail_pool`. The scenario therefore refunds P4 through the API first, which flips the pool for everyone.
- Deadlines run on the validator's wall clock (no warp after start), so the run is paced by `PREP_A` / `PLAY_A` / `PREP_B` (seconds, env). Make them longer on a slow machine (headless rides take ~20 s each).
- Not covered: `sponsor` (no route builds it), `expire_pool` / the 14-day grace (needs a clock warp – the LiteSVM tests cover it), the sponsor-down fallback (the stub e2e covers it).

## Reporting

The script prints one `ok`/`FAIL` line per check and ends with `✓ all money flows verified on the local chain` or the failed names; on failure `run.sh` prints the
server log tail and keeps the scratch dir. Say which steps passed, the failing check with its numbers, and what was not covered.
