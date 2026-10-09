# Escrow program – what is not done, open questions, todo

State on 2026-10-09, after the program verification, the `initialize` fix, the localnet money test, the pool crank and the ten-rider payout run with its coverage gate. Keep this file current: tick items
off here, move answers into the docs they belong to (`program-deploy.md`, `paid-tickets-status.md`, the program README), delete what no longer applies.
Related: [deploy + operate](program-deploy.md) · [paid tickets status](paid-tickets-status.md) (its §3 Q1–Q8 still stand, Q3 is answered below) ·
[contract spec](pool-program/index.html) · [localnet test](localnet-e2e/index.html).

## Where things are

| what | where | state |
|---|---|---|
| program: verifiable build, `initialize` by the upgrade authority, `play_deadline` cap | `main` | merged; placeholder-id build `8846f590…` (superseded on the branch by the devnet-id build `27c0cb40…` in `verifiable-build.hash`) |
| `program-check` skill, `docs/pool-program/`, `docs/program-deploy.md` | `main` | merged |
| localnet money test, pool crank, ticket-only program mode, refundable missed goals, `docs/localnet-e2e/`, this file | `main` | merged (`git log main..localnet-e2e` is empty) |
| ten-rider payout scenario + the program coverage gate (`SCENARIO=payout`, `server/scripts/localnet-coverage.mjs`), `pool-admin.mjs` refund / close-ticket / cancel-pool / propose- / accept-authority, the LiteSVM `MathOverflow` test | `main` | Oct 9: 14/14 instructions + 12/12 events on the validator, 24/24 error codes asserted |
| devnet / production | – | **nothing deployed**: the code carries the devnet program id `9e7ph…BSvx` (keys made, not funded yet), production runs `PAYMENT_MODE=transfer` |

## Not done

**Deploy and keys**
- The program is not on devnet yet. The keys exist (`deploy/secrets/devnet/`) and the code carries the devnet id `9e7phdJzKMNJX8ZnqR8SdxNzafNJjYXeZNsjQze3BSvx`; the wallets are unfunded, so nothing is deployed (`program-deploy.md` devnet runbook).
- Production env not set for the escrow: `PAYMENT_MODE=program`, `TICKET_PROGRAM_ID`, `FEE_TREASURY`, `SEED_TREASURY`, `FEE_PAYER_SECRET`, `CRANK_SECRET` (+ `CRANK_INTERVAL_MS`), `WEBHOOK_SECRET`, an RPC that allows `getProgramAccounts` (the crank lists tickets with it).
- No public "verified" badge: `solana-verify verify-from-repo` + `remote submit-job` need the repo public and a PDA signed by the upgrade authority.
- The main checkout has no verifiable `.so` in `target/deploy` yet – run `npm run program:verify` there before `npm run test:localnet` or a deploy.

**Admin tooling**
- No UI for Phantom-signed admin actions: `create_pool`, `set_config` (pause, platform cut), `propose_authority` / `accept_authority`, `cancel_pool`. Only `server/scripts/pool-admin.mjs` with keypair FILES.
- Payouts: `GET /api/pools/:id/payout` builds the `pay_prize` / `close_pool` transactions, but there is no button for them on the admin page.
- Nobody creates the weekly pools automatically: when a pool ends, its tier shows "NO POOL · NEXT POOL SOON" until the admin creates the next one.
- Nothing rolls the seed treasury into the next pool: "seeds the next pool" (the lobby's rules text) is an operator step – `pool-admin.mjs sponsor -k seed.json` (the localnet payout scenario does exactly that).

**Crank operations**
- No alerting: crank failures are only logged (`CrankPoolsHandler` / `PoolCrankScheduler`), not on the admin page; no low-balance warning for the crank key (the gas sponsor has one).
- Not tested with several server instances cranking at once (the program makes duplicates harmless – a refund batch that races fails whole – but it was not exercised).
- The crank uses the `refund` priority-fee quote for `fail_pool` / `expire_pool`; fine on devnet, unmeasured under congestion.
- It never closes a pool that paid prizes, even after the grace (deliberately – see Q10).
- **Nothing reclaims Ticket rents after a settlement** (found by the ten-rider localnet run, Oct 9): `close_ticket` (permissionless, rent → the ticket's `rent_payer`) is in the program but neither the crank nor any server path sends it. Every gasless buyer of a settled pool leaves ~0.0015 SOL (1 496 400 lamports) of the gas sponsor's money locked in its Ticket account – 10 buyers a week ≈ 0.015 SOL a week, forever. Refunded pools are fine (`refund` closes the ticket). Fix: a crank step `close_ticket` for Settled pools (needs a ticket listing per settled pool – mark a pool "tickets closed" in the mirror so it is listed once), or a CLI sweep. The localnet scenario does it by hand (`pool-admin.mjs close-ticket`) and asserts every rent lands back.

**Security / program**
- **Not audited.** The Trail of Bits classes were checked by hand; their scanner plugin is not installed (user-level `/plugin marketplace add trailofbits/skills`).
- `pay_prize` pays any address the admin signs for (capped); a program-owned `to` would strand a prize – documented, not coded (Q9).
- After the play deadline the admin may close a pool without paying prizes (prize share → seed treasury). The escape hatches protect against an absent admin, not a dishonest one – documented trust.
- The binary is SBPF v0 (LiteSVM 0.10 cannot load v3); a v3 deploy needs its own verifiable build and pin (Q11).
- Session keys / deposits (plan phase 2) not built.

**Tests – what a green run does not cover**
- A real Phantom (popups, its own RPC, whether it rewrites transactions before signing). The localnet fake signs exactly what it is given.
- Devnet conditions: congestion, dropped / expired transactions, RPC rate limits and providers that refuse `getProgramAccounts`.
- ~~On a real validator: `cancel_pool`, the authority handover, pause~~ – covered since Oct 9 by the ten-rider scenario (with every reachable error code; `MathOverflow` only in LiteSVM, from a forged account).
- The sponsor-down fallback against the real server (only `e2e-tickets-stub.mjs` covers it).

**Small known gaps**
- The lobby's "N pools on sale" counts active pools whose play window already closed.
- An unfinished ticket order has no CANCEL – it lapses after `ORDER_TTL_MINUTES` (60).
- The legacy pay-per-ride routes still exist (status Q1: delete after the devnet run is green).
- Status Q8 items: `profile.stats.paidRides` stays 0 for ticket rides; 409 problems carry `title: "Error"`; `pool:seed` cannot make a `refunding` pool.

## Open questions (owner decisions)

| # | question | recommendation |
|---|---|---|
| Q-A | Merge `localnet-e2e` into `main` now? | **answered: merged** |
| Q-B | Who makes the keys: you, or I generate them into `deploy/secrets/` (program id, deploy wallet, crank key)? | I generate them; you fund the deploy wallet and the crank from a faucet |
| Q-C | Upgrade authority long term: keep on the deploy keypair, move to a hardware wallet / Squads multisig, or make the program immutable (`--final`) after an audit? | devnet: keep; before any real money: multisig; `--final` only after an audit |
| Q-D | Audit before mainnet – and is mainnet a goal at all? | devnet only, "not audited" said plainly in the submission (status Q7) |
| Q-E | Make the repo (or a public mirror) public for the explorer's "verified" badge? | yes after the devnet deploy, if the code may be public |
| Q-F | Which devnet RPC? | **answered: QuickNode devnet** (HTTP + WSS; the same provider later for production). Streams on devnet support the *Block* and *Logs (with Programs)* datasets – use Logs filtered on the program id for the webhook. To check on the endpoint in Phase 1: `getProgramAccounts` (the crank needs it) and the Priority Fee API add-on (optional – without it the server falls back to `getRecentPrioritizationFees`) |
| Q-G | Admin actions during the devnet phase: CLI (`pool-admin.mjs`) + the admin keypair imported into Phantom, or build the admin UI first? | CLI + imported keypair for devnet; the UI before production |
| Q-H | Who creates each week's pools – by hand, or a scheduled job (needs the admin key on the server, which the design avoids)? | by hand / CLI, with a reminder; no admin key on the server |
| Q-I | `MAX_POOL_SECS` = 365 days – right cap? | fine for weekly pools; lower to ~60 days if you prefer |
| Q-J | Where does the devnet-phase server run: your machine (`npm run server:dev` against devnet, local DB, Phantom on localhost) or a separate staging host? | your machine; a tunnel (cloudflared / ngrok) only to test the QuickNode webhook |
| Q-K | What counts as "real tests passed" before production? | **answered: production is switched only after the Solana Colosseum results are announced** – and only once the Phase 2 exit list has passed (twice, two different days) and on an explicit "deploy" |
| Q-L | Production stays pay-per-ride through the judging: how do the Colosseum judges see the escrow? | a devnet demo – the Phase 2 run recorded (video) + the explorer links to the program and its pools + `docs/pool-program` / `docs/localnet-e2e`; say in the submission that the live site switches after the results |
| Q9 | `pay_prize` to a program-owned account: allow (Squads winners) or refuse (system accounts only)? | allow; the admin checks the address |
| Q10 | Should the crank also close prize-paid pools after the 14-day grace (money only to the declared treasuries)? | no – the admin closes after paying; keeps "the crank never sweeps prize money" simple |
| Q11 | Deploy SBPF v0 (what is tested) or v3? | v0 for devnet |
| Q12 | `platform_fee_bps` at `initialize`: 0 for the hackathon? | 0 (the localnet test uses 500 only to exercise the leg) |
| Q13 | The legacy weekly round when production switches to program mode: let it run out, or settle / refund its entries first? | check `GET /api/pool` entries before switching; it holds nothing new once ticket-only |
| status Q3 | (crank) | **answered – built** (`pool:crank`, `CRANK_INTERVAL_MS`) |

## Todo

**Rule: devnet first. Production is switched only after the Solana Colosseum results are announced, after the devnet phase passed its exit list, and only on an explicit "deploy" from the owner (Q-K).**
Until then production stays as it is (`PAYMENT_MODE=transfer`, no escrow keys in `deploy/.env`).

### Phase 0 – local (no chain, no money)
- [x] Merge `localnet-e2e` into `main` – Q-A (done; the note below is history). Rebased on `main` and green (`npm run check` 901 tests, localnet 80 checks, devnet path 70) on Oct 8; the fast-forward waits for the main checkout's uncommitted `landing/src/main.js` edits (another session) – then `git merge --ff-only localnet-e2e` there. After the merge, rerun `devnet.sh env` in the main checkout (`server/.env.devnet` is per checkout)
- [x] `npm run program:verify` in the main checkout (Oct 8: reproduced `8846f590…`, 49 tests, clippy, audit) – `npm run test:localnet` there after the merge
- [x] Deploy smoke test: program-mode checks (no pay-per-ride fallback, pools listed, the webhook refuses a call without its secret, the fee quote answers) – `deploy/scripts/smoke.mjs`, run at the end of every `test:localnet`
- [x] `server/scripts/devnet-payout.mjs` (`devnet.sh payout <poolId> [--yes]`): signs in as the admin, pays the ranked prizes, closes, settles each
- [x] The rehearsal: the localnet scenario itself runs against devnet (`devnet.sh rehearse` = `TARGET=devnet run.sh`: no validator / baked pools, players funded by `funder` and swept back, small prices, own server on a throwaway DB); `LIKE_DEVNET=1` tests that path on the local validator
- [x] The local devnet profile: `server/.env.devnet.example` → `devnet.sh env` writes `server/.env.devnet` (600, gitignored); the server / CLI read it with `ENV_FILE=.env.devnet`; database `freightchain_devnet` (`devnet.sh db`); `devnet.sh check-rpc` checks the endpoint

### Phase 1 – the program on devnet
- [x] Keys generated (Oct 8) into the main checkout's `deploy/secrets/devnet/` (gitignored, 600): program-id `9e7phdJzKMNJX8ZnqR8SdxNzafNJjYXeZNsjQze3BSvx`, deploy, admin, sponsor, crank, fee, seed, plat, funder – `devnet.sh keys` lists the addresses. **Back the folder up** (the program-id and deploy keys can't be recreated)
- [x] Funded (Oct 8): 10 SOL to the deploy wallet, `devnet.sh distribute` topped up the others
- [x] QuickNode Solana devnet endpoint (HTTPS + WSS) in `server/.env.devnet` (Oct 8, worktree `localnet-e2e`; redo `devnet.sh env` in the main checkout after the merge). `check-rpc`: devnet ✓, getProgramAccounts ✓, fees ✓, Priority Fee add-on not enabled (optional)
- [x] Program id into the code (Oct 8): `anchor keys sync` → `program:build` → `program:idl` → `vendor-idl` → new pin → codec fixture → suites → commit
- [x] `devnet.sh deploy` (Oct 8): **the program is on devnet** – `9e7phdJzKMNJX8ZnqR8SdxNzafNJjYXeZNsjQze3BSvx`, deploy tx `2uBQ1fCa…`, `initialize` (admin = the admin key, platform 0), the deployed bytes = the pin `27c0cb40…` (`check.sh onchain`)
- [ ] Pools: one each of 1h / 4h / 8h with short test deadlines, plus a "fail" pool (min high, prep ~15 min) – `pool-admin.mjs create-pool -k admin.json`

### Devnet findings (Oct 8 – fixed, each with a test)
- **The vault rent minimum differs per cluster**: devnet 650 240 lamports, mainnet / local 890 880. The server had it hard-coded → every pool's escrow under-reported on devnet. Now read from the cluster (`getMinimumBalanceForRentExemption(0)`, cached).
- **Unlucky wallets could never buy / be refunded**: the Ticket PDA bump search costs ~1 600 CU per try, fixed per wallet + pool; the server's compute limits (30 000 / 18 000) were too tight for ~1 in 128 buyers / ~1 in 8 refunds. Now 60 000 / 45 000; program test with a ≥ 10-extra-tries buyer: 36 166 / 30 324 CU.
- **QuickNode rate limit (429)** under polling: reads now fall back to the public devnet RPC (`SOLANA_RPC_FALLBACKS`); sends stay on QuickNode. **Production needs a plan with enough requests/s, or fallbacks** (Q-F).
- **QuickNode refuses `solana program deploy`'s batches (413)**: `devnet.sh deploy` uploads through the public devnet RPC.
- **Dropped transactions** on a real cluster: the admin CLI and the scenario re-send until confirmed (new blockhash when one expires).

### Phase 2 – real tests on devnet (server on your machine – Q-J)
- [ ] Server against devnet with the devnet profile; pools appear by themselves (the watcher registers them) or `pool:register --label`
- [ ] Phantom on devnet, lobby on localhost: buy gasless (only "sign"), buy self-paid (sponsor drained or cap reached), ride a ticket to VERIFIED
- [ ] Callbacks, each path alone:
  - [ ] fast path: lobby buy → "Paid – N tickets credited" at once
  - [ ] watcher: `pool-admin.mjs buy` straight on chain (no order) → credited within ~15 s; with `SOLANA_WS` set, sooner
  - [ ] webhook: QuickNode Stream (devnet, dataset *Logs*, filtered on the program id, custom header `x-webhook-secret`) → tunnel → `POST /api/chain/webhook`; `curl` without the header = 401, with a real signature = settled; a buy with `WATCH_INTERVAL_MS=0` credited by the webhook alone
- [ ] Missed goal: the "fail" pool shows CLAIM REFUND right after its deadline; one buyer claims from the lobby, the crank (`pool:crank`, then the 60 s scheduler) refunds the rest and closes it
- [ ] Sponsorship: `pool-admin.mjs sponsor` → the pot and prize cap grow on the pool card
- [ ] Payout: after a play deadline, ranked `pay_prize` (admin page in Phantom or `devnet-payout.mjs`), then `close_pool`; treasuries match `closeSplit`
- [x] `devnet.sh rehearse` green against devnet (Oct 8, run 5: 65 checks + the deploy smoke; the crank also cleaned the leftover pools of the interrupted runs; leftovers #0 / #3 closed by the admin – every devnet pool is terminal now)
- [ ] Optional: public verification (repo public, `solana-verify verify-from-repo`) – Q-E
- [ ] Record the Phase 2 Phantom run (buy → ride → refund → payout) + explorer links for the Colosseum submission – Q-L

**Phase 2 exit list** (all, twice, on two different days – Q-K): every box above ticked · no manual DB or chain fix needed · `npm run ops`-style logs clean (no `crank: … ✗`, no `batch-refused`, no 5xx) · lamports reconciled for each pool (vault 0 after close, treasuries = `closeSplit`) · the explorer shows the program as the pinned hash.

### Phase 3 – production (only after the Colosseum results AND the Phase 2 exit list, only on "deploy")
- [ ] Gate: the Colosseum results are out (Q-K)
- [ ] A production QuickNode devnet endpoint (or the same one) + fund the production sponsor + crank (devnet SOL – production still runs on devnet)
- [ ] `deploy/.env`: `PAYMENT_MODE=program`, `TICKET_PROGRAM_ID`, `TREASURY_PUBKEY` = admin, `FEE_TREASURY`, `SEED_TREASURY`, `FEE_PAYER_SECRET`, `CRANK_SECRET`, `CRANK_INTERVAL_MS`, `SOLANA_RPC`, `SOLANA_WS`, `WEBHOOK_SECRET`
- [ ] Settle the legacy weekly round first (Q13)
- [ ] `npm run deploy -- --dry-run` → the owner says "deploy" → `npm run deploy` → smoke (with the new program checks)
- [ ] QuickNode Stream → `https://api.freightchain.fun/api/chain/webhook`
- [ ] The Phase 2 Phantom run once more on freightchain.fun; rollback = `PAYMENT_MODE=transfer` + redeploy (money stays refundable on chain)
- [ ] Say "devnet only, not audited" in the submission

### Later (before any real money)
- [ ] Admin UI: create pool, pause, payout + close buttons (Phantom-signed) – Q-G
- [ ] Crank: failures and the crank key's balance on the admin page
- [ ] Delete the legacy pay-per-ride routes (status Q1)
- [ ] Upgrade authority to a multisig – Q-C
- [ ] Audit – Q-D
- [ ] Session keys / deposits (phase 2 of the plan) – only if still wanted

### Small fixes (any time)
- [ ] Lobby "pools on sale" count: only pools that still sell
- [ ] CANCEL for an unfinished ticket order
- [ ] Status Q8 items (`paidRides`, problem titles, `pool:seed refunding`)
- [x] Localnet test: `cancel_pool`, pause, authority handover (Oct 9, the ten-rider scenario)
- [ ] Localnet test: the sponsor-down fallback; a run with two server instances cranking
- [ ] Reclaim Ticket rents of settled pools (`close_ticket` in the crank or a CLI) – see "Crank operations"
