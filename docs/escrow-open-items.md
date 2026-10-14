# Escrow program – what is not done, open questions, todo

State on 2026-10-12, after program v3 (attestation-gated prizes, per-km pledges, the road seed committed on chain – an in-place upgrade of `8No42h…`), on top of v2 (the pool day: daily series, payout key, review window), the program verification, the localnet money test, the pool crank and the ten-rider payout run with its coverage gate. Keep this file current: tick items
off here, move answers into the docs they belong to (`program-deploy.md`, `docs/agents/escrow.md`, the program README), delete what no longer applies.
Related: [deploy + operate](program-deploy.md) · [escrow detail](agents/escrow.md) ·
[contract spec](pool-program/index.html) · [localnet test](localnet-e2e/index.html).

## Where things are

| what | where | state |
|---|---|---|
| program: verifiable build, `initialize` by the upgrade authority, `play_deadline` cap | `main` | merged; placeholder-id build `8846f590…` (superseded on the branch by the devnet-id build `27c0cb40…` in `verifiable-build.hash`) |
| `program-check` skill, `docs/pool-program/`, `docs/program-deploy.md` | `main` | merged |
| localnet money test, pool crank, ticket-only program mode, refundable missed goals, `docs/localnet-e2e/`, this file | `main` | merged (`git log main..localnet-e2e` is empty) |
| ten-rider payout scenario + the program coverage gate (`SCENARIO=payout`, `server/scripts/localnet-coverage.mjs`), `pool-admin.mjs` refund / close-ticket / cancel-pool / propose- / accept-authority, the LiteSVM `MathOverflow` test | `main` | Oct 9: 14/14 instructions + 12/12 events on the validator, 24/24 error codes asserted |
| program v2: `set_series` / `open_next_pool` (one 1 h pool a day: 24 h sale, 2 h more rides, 48 h review), `set_payout_authority`, `payout_at` on every pool (no prize / close before it, grace counted from it), sales close for active pools too; server: the crank opens pools, the payout job (`pool:payout`, `PAYOUT_SECRET`) pays verified winners once every ride is decided, the signed HOLD, public standings, paid-ride review + `ride-review` skill | branch `pool-series` | not merged, **not deployed** – v2 needs a fresh program id (Config / Pool grew); `program-deploy.md` "v2" |
| program v3: `record_attestation`, `create_pledge` / `settle_pledge` / `refund_pledge`, `pay_prize` needs a VERIFIED attestation, `create_pool` / `open_next_pool` commit the road seed from SlotHashes; `record_yield` ("JitoSOL yield", nothing staked) removed; server: attestations for winners and pledged drivers, pledges that follow the chain (`POST /api/pledges` + `/confirm`, the pledge job), the watch page's PLEDGE block | `main` (Oct 12, branch `escrow-v3-fix`) | **on devnet since Oct 12** (in-place upgrade of `8No42h…`, tx `2qJNYBef…`, deployed = pin `47a630e8…`); every v2 pool was settled first. The first v3 commit `fa99e22a` had reached production's SERVER while devnet still ran v2 – it could not decode v2 pools (none synced, payouts stalled) until this upgrade |
| devnet / production | – | **v2 on devnet since Oct 11** (`8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p`, deployed bytes = pin `84fe8679…`, `Config.authority` = the devnet admin, platform cut 0, `payout_authority` = `6zoY5f…Utds`; 1 h series: a TEST schedule – 1 h sale, 2 h more rides (from pool #1, Oct 11 17:00 UTC; pool #0 had 0), 1 h review, min 2, 0.002 SOL, slots on the hour); v1 `9e7ph…BSvx` stays, every pool terminal |

## Not done

**Pentest Oct 2026 (program findings H4, H5, M6, M8, L4–L8)**: planned as ONE settle-first program v4 upgrade (H5 = a committed winners root grows `Pool`; with it H4, M6, M8, L4 `seal_road`, L5–L8) – WP5 in [the fix plan](reviews/pentest-2026-10/fix-plan.md). Not started.

**Deploy and keys**
- The program is not on devnet yet. The keys exist (`deploy/secrets/devnet/`) and the code carries the devnet id `9e7phdJzKMNJX8ZnqR8SdxNzafNJjYXeZNsjQze3BSvx`; the wallets are unfunded, so nothing is deployed (`program-deploy.md` devnet runbook).
- Production env not set for the escrow: `PAYMENT_MODE=program`, `TICKET_PROGRAM_ID`, `FEE_TREASURY`, `SEED_TREASURY`, `CRANK_SECRET` (+ `CRANK_INTERVAL_MS`), `WEBHOOK_SECRET`, an RPC that allows `getProgramAccounts` (the crank lists tickets with it).
- No public "verified" badge: `solana-verify verify-from-repo` + `remote submit-job` need the repo public and a PDA signed by the upgrade authority.
- The main checkout has no verifiable `.so` in `target/deploy` yet – run `npm run program:verify` there before `npm run test:localnet` or a deploy.

**Admin tooling**
- No UI for Phantom-signed admin actions: `create_pool`, `set_config` (pause, platform cut), `propose_authority` / `accept_authority`, `cancel_pool`. Only `server/scripts/pool-admin.mjs` with keypair FILES.
- Payouts are automatic since v2 (Oct 10): the payout job (`PayPoolsCommand`, `PAYOUT_SECRET` = the key the admin names with `set-payout-authority`, every `PAYOUT_INTERVAL_MS`) runs `PoolAttentionService.markPool`, waits while ANY completed ride of the pool is undecided (`waiting_review`), pays the verified top 20 (claimed in `economy.PoolPayout` before each broadcast) and closes the pool. The admin page's pools view shows each pool's winners and the signed HOLD. Not built: the payout job's state / `payout-grace` warnings are only logged and shown on the admin page – no push alert. `GET /api/pools/:id/payout` (Phantom, by hand) and `devnet-payout.mjs` now rank verified rides only and wait for `payout_at`, but do not wait for the review queue – the job does.
- Pools are created by schedule since v2: the admin writes each tier's series once (`pool-admin.mjs set-series`, 1 h: min 20, 24 h / 2 h / 48 h from `ride-tier.ts`) and the crank opens the next pool on its slot. The 1 h card can still say NO POOL between a missed slot and the next crank pass (≤ `CRANK_INTERVAL_MS`). Fewer than 20 tickets in the 24 h sale and that pool refunds. The 4 hour and 8 hour shifts are not on sale (`onSale: false`): with no live pool the card says SOON and a pay-per-ride order is 409 `tier_not_on_sale`. A registered live pool of either still sells.
- Nothing rolls the seed treasury into the next pool: "seeds the next pool" (the lobby's rules text) is an operator step – `pool-admin.mjs sponsor -k seed.json` (the localnet payout scenario does exactly that).

**Crank operations**
- No alerting: crank failures are only logged (`CrankPoolsHandler` / `PoolCrankScheduler`), not on the admin page; no low-balance warning for the crank key.
- ~~Not tested with several server instances cranking at once~~ – covered since Oct 10 by `SCENARIO=chaos` (T6: three crank CLIs + a stranger's refund on a 10-ticket pool: identical transactions dedupe, a step that lost a race is retried by the next pass, every buyer refunded exactly once). Two servers crank-SCHEDULING at once is the same handler, not run separately.
- **A refused ticket read stopped the whole crank pass** (found by `SCENARIO=chaos`, Oct 10; fixed): `listTickets` (`getProgramAccounts`) throwing escaped `CrankPoolsHandler.crankPool`, so every pool after it starved. Now caught per pool and reported as a failed action; unit-tested.
- **The gas sponsor and `POST /api/tickets/orders/:id/submit` were removed** (Oct 10, `SCENARIO=chaos` had just found that `/submit` answered 503 for a purchase that had landed, so the lobby could pay twice): every wallet now signs AND sends its own buy and refund (network fee ≈ 0.0001 SOL + the Ticket rent ≈ 0.0015 SOL, returned at refund / close). Gone with it: `FEE_PAYER_SECRET`, `FEE_PAYER_MIN_SOL`, `SPONSOR_PER_WALLET_PER_DAY`, the co-signer, the `SponsoredTx` table (migration `20261018000000_drop_sponsored_tx` – it DROPS a table, the owner's OK is needed before it reaches production), `?selfPaid=1`, `sponsored` in the payment / refund / fees DTOs. The program is untouched (`buy_ticket` still takes a separate `fee_payer`, which nothing in the server uses now). A leftover `FEE_PAYER_SECRET` in a real env file is ignored.
- The crank uses the `refund` priority-fee quote for `fail_pool` / `expire_pool`; fine on devnet, unmeasured under congestion.
- It never closes a pool that paid prizes, even after the grace (Q10) – the payout job's key closes it right after paying.
- **Nothing reclaims Ticket rents after a settlement** (found by the ten-rider localnet run, Oct 9): `close_ticket` (permissionless, rent → the ticket's `rent_payer`) is in the program but neither the crank nor any server path sends it. Every buyer of a settled pool leaves ~0.0015 SOL (1 496 400 lamports) of ITS OWN money locked in its Ticket account until someone sends `close_ticket` (rent → `rent_payer` = the buyer; the gas sponsor that used to be the payer was removed Oct 10) – a real cost to every winner and loser of a live pool, on top of the ticket price. Refunded pools are fine (`refund` closes the ticket). Fix: a crank step `close_ticket` for Settled pools (needs a ticket listing per settled pool – mark a pool "tickets closed" in the mirror so it is listed once), or a CLI sweep. The localnet scenario does it by hand (`pool-admin.mjs close-ticket`) and asserts every rent lands back.

**Security / program**
- **No staking (decided Oct 12).** Idle vault money earns nothing and no copy says it does (landing, whitepaper, README, docs): ~3 days idle × ~7 % APY = ~0.3 ¢ per $5 ticket, below the ~0.1 % unstake fee; an exit also takes an epoch, longer than a refund may wait. The program no longer has staking fields or `record_yield` (removed before v3 went live), and migration `20261026000000_drop_staking_yield_columns` drops the server's always-0 `stakedLamports` / `yieldEarned` columns – it DROPS two columns, the owner's OK is needed before it reaches production. Where yield could make sense later: the seed treasury, held off-program as JitoSOL by the operator.
- **Not audited.** The Trail of Bits classes were checked by hand; their scanner plugin is not installed (user-level `/plugin marketplace add trailofbits/skills`).
- `pay_prize` pays any address the admin signs for (capped); a program-owned `to` would strand a prize – documented, not coded (Q9).
- After `payout_at` the admin – or the payout key – may close a pool without paying prizes (prize share → seed treasury). The payout job never does that (no winners = `no_winners`, the admin decides). A stolen payout key could misdirect a pool's prize share after its review window; that key sits on the server (`PAYOUT_SECRET`), so rotate it with `set-payout-authority` if the server is ever compromised. The escape hatches protect against an absent operator, not a dishonest one – documented trust.
- The binary is SBPF v0 (LiteSVM 0.10 cannot load v3); a v3 deploy needs its own verifiable build and pin (Q11).
- Session keys / deposits (plan phase 2) not built.

**Tests – what a green run does not cover**
- A real Phantom (popups, its own RPC, whether it rewrites transactions before signing). The localnet fake signs exactly what it is given.
- Devnet conditions: real congestion timing. The refusals, 429s, swallowed / lost sends and `getProgramAccounts` refusals are imitated locally since Oct 10 (`SCENARIO=chaos`, the fault proxy `server/scripts/localnet-fault-proxy.mjs`); what stays unmeasured is how a real provider behaves under load (`TARGET=devnet`).
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
| Q-H | Who creates each week's pools – by hand, or a scheduled job (needs the admin key on the server, which the design avoids)? | **answered (Oct 10, v2): by schedule without the admin key** – the admin writes a `Series` once, anyone (the crank) opens each day's pool from it |
| Q-I | `MAX_POOL_SECS` = 365 days – right cap? | fine for weekly pools; lower to ~60 days if you prefer |
| Q-J | Where does the devnet-phase server run: your machine (`npm run server:dev` against devnet, local DB, Phantom on localhost) or a separate staging host? | your machine; a tunnel (cloudflared / ngrok) only to test the QuickNode webhook |
| Q-K | What counts as "real tests passed" before production? | **answered: production is switched only after the Solana Colosseum results are announced** – and only once the Phase 2 exit list has passed (twice, two different days) and on an explicit "deploy" |
| Q-L | Production stays pay-per-ride through the judging: how do the Colosseum judges see the escrow? | a devnet demo – the Phase 2 run recorded (video) + the explorer links to the program and its pools + `docs/pool-program` / `docs/localnet-e2e`; say in the submission that the live site switches after the results |
| Q9 | `pay_prize` to a program-owned account: allow (Squads winners) or refuse (system accounts only)? | allow; the admin checks the address |
| Q10 | Should the crank also close prize-paid pools after the 14-day grace (money only to the declared treasuries)? | **answered (Oct 10, v2): no need** – the payout job closes with the payout key right after paying; the crank still never sweeps prize money |
| Q15 | v2 windows for the 1 h tier: 24 h sale, rides count 2 h past the sale (so a last-minute buyer can finish a shift), 48 h review – right? A slot nobody opened (crank down) is skipped, not shifted | your call; the numbers are one row in `ride-tier.ts` + `set-series` |
| Q16 | A pool with NO verified winner after review: close it by hand (prize share → seed treasury, i.e. the next pools) or let it expire into full refunds after 14 days? | refunds are the fairer default; the job leaves it to you either way |
| Q11 | Deploy SBPF v0 (what is tested) or v3? | v0 for devnet |
| Q12 | `platform_fee_bps` at `initialize`: 0 for the hackathon? | 0 (the localnet test uses 500 only to exercise the leg) |
| Q13 | The legacy weekly round when production switches to program mode: let it run out, or settle / refund its entries first? | check `GET /api/pool` entries before switching; it holds nothing new once ticket-only |
| Q14 | One road per pool: every ticket ride of a pool is driven on the pool's `rideSeed` (built Oct 10 – drawn when the pool enters the mirror, never updated; same route, start hour, layout, holes, starting traffic). (a) **answered – built**: the legacy pay-per-ride (production through the judging, Q-L) shares one seed per tier per UTC day (`ride.DailySeed`). Open: (b) the seed is public once the first rider starts (the watch page needs it), so later riders can watch the road first, and a wallet with several tickets drives it again; (c) solana-features F6a (a per-ride seed from a blockhash) would become per pool | (b) accept – the same for everyone who looks; (c) commit the pool seed's hash when the pool is registered, reveal at its first ride |
| status Q3 | (crank) | **answered – built** (`pool:crank`, `CRANK_INTERVAL_MS`) |

## Todo

**Rule: devnet first. Production is switched only after the Solana Colosseum results are announced, after the devnet phase passed its exit list, and only on an explicit "deploy" from the owner (Q-K).**
**Oct 11: the owner switched production to program mode early** (release `20261011-161246-234e634`, still on devnet, test schedule) – rollback = `PAYMENT_MODE=transfer` in `deploy/.env` + redeploy.

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
- [ ] Phantom on devnet, lobby on localhost: buy (Phantom signs AND sends: check its fee + rent line), ride a ticket to VERIFIED
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
- [ ] Gate: the Colosseum results are out (Q-K) – skipped on the owner's go, Oct 11
- [x] A production QuickNode devnet endpoint (or the same one) + fund the production sponsor + crank (devnet SOL – production still runs on devnet)
- [x] `deploy/.env` (Oct 11; `TREASURY_PUBKEY` kept as the owner's wallet, not the devnet admin – the manual payout page stays closed, the payout job pays; plus `PAYOUT_SECRET`, `PAYOUT_INTERVAL_MS=300000`, `SOLANA_RPC_FALLBACKS`): `PAYMENT_MODE=program`, `TICKET_PROGRAM_ID`, `TREASURY_PUBKEY` = admin, `FEE_TREASURY`, `SEED_TREASURY`, `CRANK_SECRET`, `CRANK_INTERVAL_MS`, `SOLANA_RPC`, `SOLANA_WS`, `WEBHOOK_SECRET`
- [ ] Settle the legacy weekly round first (Q13)
- [x] `npm run deploy -- --dry-run` → the owner says "deploy" → `npm run deploy` → smoke (with the new program checks)
- [ ] QuickNode Stream → `https://api.freightchain.fun/api/chain/webhook`
- [ ] The Phase 2 Phantom run once more on freightchain.fun; rollback = `PAYMENT_MODE=transfer` + redeploy (money stays refundable on chain)
- [ ] Say "devnet only, not audited" in the submission

### v3 – to do
- [ ] Not audited – v3 adds three money paths (pledges) and the attestation gate; `program-check` (Trail of Bits classes by hand) before any real money
- [ ] A pledge settles on the driver's attestation for the POOL (best verified ride there), not on the ride id it names – documented; per-ride attestations only if that matters
- [ ] Pledge UI: no "refund it myself" button (the pledge job sends `refund_pledge`; the instruction is permissionless if the server is gone – `pool-admin.mjs refund-pledge`)
- [ ] The attestation is the server's verdict (payout key), not a proof the program checks – said in README / whitepaper; a trustless version is a research item
- [ ] Alerting when the payout key runs low (it now pays Attestation rents)

### v2 (the pool day) – to do
- [ ] Merge `pool-series` into `main` (needs the owner's go; it also carries the paid-ride review and `pool-ride-seed`'s identical hunks)
- [x] Deploy v2 to devnet under its fresh program id `8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p` (code, IDL, fixtures and the pin `84fe8679…` are built for it; the key is `deploy/secrets/devnet/program-id.json`, v1's is `program-id-v1.json`; `bash server/scripts/devnet.sh deploy`); then `set-payout-authority`, `set-series --tier 1h`, `PAYOUT_SECRET` + `CRANK_SECRET` in `server/.env.devnet`
- [ ] Watch one whole day on devnet with a short series (`--sale-hours 1 --review-hours 1 --min 2`): open → sell → refunds for a missed goal / rides → review → automatic payout → close
- [x] The localnet scenario + its coverage gate for the three new instructions, two new events and `SeriesDisabled` (17 / 14 / 25) – Oct 11: `SCENARIO=day` (phase 3: the 1h series opened by the crank on its schedule, the missed next slot failed + refunded by it, review window, marks + the admin's signed decisions and HOLD, the payout key pays and closes); `npm run test:localnet` green in ~16 min, 17/17 instructions + 14/14 events on the validator, 24/25 errors there (`MathOverflow` LiteSVM only)
- [ ] Alerting for `payout-grace` / `error` pools beyond the log and the admin page

### Later (before any real money)
- [ ] Admin UI: create pool / set series, pause (Phantom-signed) – Q-G (payouts are automatic now; the pools view has the HOLD)
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

### Achievement cNFTs (docs/agents/achievements.md)
- [x] Tiered catalogue, mint outbox, Bubblegum v2 adapter, mint job, lobby ladders, analytics, tests (Oct 11)
- [ ] Devnet: fund a key, `setup-tree.mjs --yes`, upload art to Irys (`upload-irys.mjs --yes`), commit `nft-metadata-uris.ts`, `smoke-mint.mjs --yes` (incl. the refused transfer), set the three `ACHIEVEMENT_*` keys on the dev server
- [ ] Mainnet tree + collection + production keys – only after the Colosseum results and passed devnet tests (like the program)
- [ ] A DAS reconciler (minted rows vs the tree) and a `podium` family (pool winners) – later
