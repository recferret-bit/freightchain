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
| Q-F | Turn the crank on in production right away (`CRANK_SECRET` + 60 s), and which RPC provider (needs `getProgramAccounts`, e.g. QuickNode devnet)? | yes, with QuickNode; the public devnet RPC is rate-limited |
| Q-G | Build the admin UI (create pool, pause, payout buttons, Phantom-signed) before the devnet demo, or run admin actions from the CLI? | CLI for the first devnet run, UI if time allows before Oct 12 |
| Q-H | Who creates each week's pools – by hand, or a scheduled job (needs the admin key on the server, which the design avoids)? | by hand / CLI, with a reminder; no admin key on the server |
| Q-I | `MAX_POOL_SECS` = 365 days – right cap? | fine for weekly pools; lower to ~60 days if you prefer |
| Q9 | `pay_prize` to a program-owned account: allow (Squads winners) or refuse (system accounts only)? | allow; the admin checks the address |
| Q10 | Should the crank also close prize-paid pools after the 14-day grace (money only to the declared treasuries)? | no – the admin closes after paying; keeps "the crank never sweeps prize money" simple |
| Q11 | Deploy SBPF v0 (what is tested) or v3? | v0 for devnet |
| Q12 | `platform_fee_bps` at `initialize`: 0 for the hackathon? | 0 (the localnet test uses 500 only to exercise the leg) |
| Q13 | The legacy weekly round when production switches to program mode: let it run out, or settle / refund its entries first? | check `GET /api/pool` entries before switching; it holds nothing new once ticket-only |
| status Q3 | (crank) | **answered – built** (`pool:crank`, `CRANK_INTERVAL_MS`) |

## Todo

**Before the devnet demo**
- [ ] Merge `localnet-e2e` into `main` (rebase on the current `main` first) – Q-A
- [ ] `npm run program:verify` in the main checkout
- [ ] Keys: program id, deploy wallet, crank key, seed + fee treasuries (rent-exempt) – Q-B
- [ ] Devnet deploy of the verifiable `.so`, `initialize` (deploy wallet signs, Phantom = admin), `check.sh onchain` – `program-deploy.md` steps 1–6
- [ ] Create + `pool:register` the week's pools and a short demo pool
- [ ] Production env for program mode + crank (Q-F), then `npm run deploy` **when you ask for it**
- [ ] A real devnet run with Phantom: buy (gasless + self-paid), ride, CLAIM REFUND on a failed pool, payout + close
- [ ] Say "devnet only, not audited" in the submission

**After the demo / before real money**
- [ ] Admin UI: create pool, pause, payout + close buttons (Phantom-signed) – Q-G
- [ ] Crank: failures and the crank key's balance on the admin page
- [ ] Delete the legacy pay-per-ride routes (status Q1)
- [ ] Public verification (repo public, `verify-from-repo`) – Q-E
- [ ] Upgrade authority to a multisig – Q-C
- [ ] Audit – Q-D
- [ ] Session keys / deposits (phase 2) – only if still wanted

**Small fixes**
- [ ] `docs/pool-escrow` + `client/escrow/`: 44 → 49 tests
- [ ] Lobby "pools on sale" count: only pools that still sell
- [ ] CANCEL for an unfinished ticket order
- [ ] Status Q8 items (`paidRides`, problem titles, `pool:seed refunding`)
- [ ] Localnet test: add `cancel_pool`, pause, authority handover, the sponsor-down fallback; a run with two server instances cranking
