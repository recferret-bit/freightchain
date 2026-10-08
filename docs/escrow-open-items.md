# Escrow program – what is not done, open questions, todo

State on 2026-10-08, after the program verification, the `initialize` fix, the localnet money test and the pool crank. Keep this file current: tick items
off here, move answers into the docs they belong to (`program-deploy.md`, `paid-tickets-status.md`, the program README), delete what no longer applies.
Related: [deploy + operate](program-deploy.md) · [paid tickets status](paid-tickets-status.md) (its §3 Q1–Q8 still stand, Q3 is answered below) ·
[contract spec](pool-program/index.html) · [localnet test](localnet-e2e/index.html).

## Where things are

| what | where | state |
|---|---|---|
| program: verifiable build, `initialize` by the upgrade authority, `play_deadline` cap | `main` | merged; hash `8846f590…` in `programs/freightchain-pools/verifiable-build.hash` |
| `program-check` skill, `docs/pool-program/`, `docs/program-deploy.md` | `main` | merged |
| localnet money test, pool crank, ticket-only program mode, refundable missed goals, `docs/localnet-e2e/`, this file | branch `localnet-e2e` (worktree `.claude/worktrees/localnet-e2e`) | **not merged**: `main` moved since – rebase (AGENTS.md / CLAUDE.md skill lines conflict, re-apply ours on top) then fast-forward |
| devnet / production | – | **nothing deployed**: program id is a placeholder, production runs `PAYMENT_MODE=transfer` |

## Not done

**Deploy and keys**
- The program is not on devnet. `declare_id!` is the placeholder `B79YY…`; the program-id keypair, the deploy / upgrade-authority wallet (~5 devnet SOL), the crank key and the seed / fee treasury addresses do not exist yet (`program-deploy.md` steps 1–9).
- Production env not set for the escrow: `PAYMENT_MODE=program`, `TICKET_PROGRAM_ID`, `FEE_TREASURY`, `SEED_TREASURY`, `FEE_PAYER_SECRET`, `CRANK_SECRET` (+ `CRANK_INTERVAL_MS`), `WEBHOOK_SECRET`, an RPC that allows `getProgramAccounts` (the crank lists tickets with it).
- No public "verified" badge: `solana-verify verify-from-repo` + `remote submit-job` need the repo public and a PDA signed by the upgrade authority.
- The main checkout has no verifiable `.so` in `target/deploy` yet – run `npm run program:verify` there before `npm run test:localnet` or a deploy.

**Admin tooling**
- No UI for Phantom-signed admin actions: `create_pool`, `set_config` (pause, platform cut), `propose_authority` / `accept_authority`, `cancel_pool`. Only `server/scripts/pool-admin.mjs` with keypair FILES.
- Payouts: `GET /api/pools/:id/payout` builds the `pay_prize` / `close_pool` transactions, but there is no button for them on the admin page.
- Nobody creates the weekly pools automatically: when a pool ends, its tier shows "NO POOL · NEXT POOL SOON" until the admin creates the next one.

**Crank operations**
- No alerting: crank failures are only logged (`CrankPoolsHandler` / `PoolCrankScheduler`), not on the admin page; no low-balance warning for the crank key (the gas sponsor has one).
- Not tested with several server instances cranking at once (the program makes duplicates harmless – a refund batch that races fails whole – but it was not exercised).
- The crank uses the `refund` priority-fee quote for `fail_pool` / `expire_pool`; fine on devnet, unmeasured under congestion.
- It never closes a pool that paid prizes, even after the grace (deliberately – see Q10).

**Security / program**
- **Not audited.** The Trail of Bits classes were checked by hand; their scanner plugin is not installed (user-level `/plugin marketplace add trailofbits/skills`).
- `pay_prize` pays any address the admin signs for (capped); a program-owned `to` would strand a prize – documented, not coded (Q9).
- After the play deadline the admin may close a pool without paying prizes (prize share → seed treasury). The escape hatches protect against an absent admin, not a dishonest one – documented trust.
- The binary is SBPF v0 (LiteSVM 0.10 cannot load v3); a v3 deploy needs its own verifiable build and pin (Q11).
- Session keys / deposits (plan phase 2) not built.

**Tests – what a green run does not cover**
- A real Phantom (popups, its own RPC, whether it rewrites transactions before signing). The localnet fake signs exactly what it is given.
- Devnet conditions: congestion, dropped / expired transactions, RPC rate limits and providers that refuse `getProgramAccounts`.
- On a real validator: `cancel_pool`, the authority handover, pause (the LiteSVM program tests cover them).
- The sponsor-down fallback against the real server (only `e2e-tickets-stub.mjs` covers it).

**Small known gaps**
- `docs/pool-escrow` (and its served copy `client/escrow/`) still says "44 tests" – now 49 (47 LiteSVM + 2 unit); the landing drift test needs both edited together.
- The lobby's "N pools on sale" counts active pools whose play window already closed.
- An unfinished ticket order has no CANCEL – it lapses after `ORDER_TTL_MINUTES` (60).
- The legacy pay-per-ride routes still exist (status Q1: delete after the devnet run is green).
- Status Q8 items: `profile.stats.paidRides` stays 0 for ticket rides; 409 problems carry `title: "Error"`; `pool:seed` cannot make a `refunding` pool.

## Open questions (owner decisions)

| # | question | recommendation |
|---|---|---|
| Q-A | Merge `localnet-e2e` into `main` now? | yes – all suites green (localnet 77/77, `npm run check`, integration 228, lobby e2e 56) |
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
- [ ] Merge `localnet-e2e` into `main` (rebase on the current `main` first) – Q-A
- [ ] `npm run program:verify` in the main checkout; `npm run test:localnet` green there
- [ ] Deploy smoke test: checks for program mode (tiers report `paymentMode: program`, pools listed, sponsor + crank balances, the webhook refuses a bad secret) – used in Phase 3
- [ ] `server/scripts/devnet-payout.mjs`: sign in with the admin keypair, fetch `GET /api/pools/:id/payout`, sign + send each `pay_prize`, then `close_pool`, settle each
- [ ] `server/scripts/devnet-rehearsal.mjs`: the localnet scenario's API steps (buy gasless + self-paid, sponsor, refund, crank, payout) against any RPC + server, throwaway wallets, no browser
- [ ] A local devnet profile for the server (`server/.env.devnet.example`: program mode, devnet RPC + WS, sponsor, crank, treasuries, webhook secret; a separate local database `freightchain_devnet`)

### Phase 1 – the program on devnet
- [ ] Keys into `deploy/secrets/` (gitignored, never printed): program id, deploy wallet (= upgrade authority), admin (also imported into Phantom), sponsor, crank, fee + seed treasuries – Q-B
- [ ] Fund them on devnet (faucet – QuickNode's faucet or faucet.solana.com): deploy ~5 SOL, sponsor ~1, crank ~0.5, admin ~0.5, treasuries 0.002 each
- [ ] QuickNode: a Solana **devnet** endpoint (HTTP + WSS); check on it: `getProgramAccounts` answers (the crank), `getRecentPrioritizationFees`; optionally enable the Priority Fee API add-on
- [ ] Program id into the code: `anchor keys sync` → `program:build` → `program:idl` → `vendor-idl` → `UPDATE_PIN=1 npm run program:verify` → codec fixture → `npm run check` + `npm run test:localnet` → commit
- [ ] Deploy the verifiable `.so` (hash guard first) – `program-deploy.md` step 4
- [ ] `initialize` (deploy wallet signs, `--admin` = the admin key, platform 0) and read `Config.authority` back
- [ ] `check.sh onchain`: the deployed bytes = the pin
- [ ] Pools: one each of 1h / 4h / 8h with short test deadlines, plus a "fail" pool (min high, prep ~15 min) – `pool-admin.mjs create-pool -k admin.json`

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
- [ ] `devnet-rehearsal.mjs` green against devnet
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
- [ ] `docs/pool-escrow` + `client/escrow/`: 44 → 49 tests
- [ ] Lobby "pools on sale" count: only pools that still sell
- [ ] CANCEL for an unfinished ticket order
- [ ] Status Q8 items (`paidRides`, problem titles, `pool:seed refunding`)
- [ ] Localnet test: add `cancel_pool`, pause, authority handover, the sponsor-down fallback; a run with two server instances cranking
