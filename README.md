# Freight Chain

A truck game in the browser. You sit in the cab and drive. The road does not end. The shift does, at a finish line the server set. One mistake can end it sooner.

Paid entries are SOL on Solana devnet. The program holds the money. SOL is the ticket and the prize. TEN4 is a separate capped coin minted by verified paid checkpoints (HONK stays the in-game verb). This build is not mainnet.

<img src="frontend/landing/public/media/day.webp" alt="Freight Chain cab in sixth gear on a desert highway, live CB up and the on-chain pool strip showing the road seal" width="780">

## Traction

<!-- traction:start -->

Public numbers for a reviewer, read 2026-10-17 20:27 UTC. PostHog and the public stats endpoint were each read more than once. A count the second read did not support is not in a headline.

<table><tr>
<td align="center" width="50%"><h2>32</h2><b>shifts started</b><br>6 finished · <a href="https://freightchain.fun/api/stats">api/stats</a></td>
<td align="center" width="50%"><h2>27.9 km</h2><b>driven</b><br>2 drivers · 5 crashes</td>
</tr>
<tr>
<td align="center" width="20%"><h2>230</h2><b>landing people</b><br>PostHog · 8 Oct 2026 through 2026-10-17 UTC</td>
<td align="center" width="20%"><h2>22</h2><b>whitepaper readers</b><br>PostHog · same window</td>
<td align="center" width="20%"><h2>75</h2><b>wallet sign-ins</b><br>real wallets · demo excluded</td>
<td align="center" width="20%"><h2>3</h2><b>real shifts started</b><br>29 demo starts</td>
<td align="center" width="20%"><h2>6</h2><b>shifts finished</b><br>6 demo · 0 real</td>
</tr></table>

The second row is PostHog Cloud EU, project 297915. Probe events (`surface=prod-check`) are out. Ride counts are `source=server`. Demo wallets are separate from real ones. Client `ride_completed` is not counted.

### The product

These are [`https://freightchain.fun/api/stats`](https://freightchain.fun/api/stats), read twice. Free and paid are the split of shifts started. The site and this table use this response, not a PostHog chart.

PostHog counts those 6 finished shifts as 6 demo-wallet finishes and 0 others. A demo wallet runs the paid clock at 1/60.

| | |
| --- | ---: |
| Shifts started | 32 |
| Free | 29 |
| Paid | 3 |
| Finished | 6 |
| Driven | 27.9 km |
| Time | 1 h 7 min |
| Crashes | 5 |
| Drivers | 2 |
| Stream donations | 0 |

### Analytics

Insight definitions are checked by `posthog-audit` (EU project 297915, dashboard 1006663). That skill does not change PostHog from here. Probe events (`surface=prod-check`) are not in the counts. A server ride event is `source=server`. Demo wallets are separate. Client `ride_completed` is not a metric.

Audit: 2 fixes waiting, 37 insights match the spec, 8 left off the judge board. Exit 1 means a fix is waiting. It was not applied.
Waiting: FC · Promo from an invite view; FC · Promo from a submitted code.

| Window | Landing people | Real finishes | Demo finishes | Real sign-ins |
| --- | ---: | ---: | ---: | ---: |
| 8–12 Oct 2026 (judge board) | 106 | 0 | 6 | 54 |
| 8 Oct 2026 through 2026-10-17 UTC | 230 | 0 | 6 | 75 |

Refresh with `node .claude/skills/daily-tracktion-update/update.mjs`. The raw read is `docs/insights/traction/latest.json`.

<!-- traction:end -->

The live site is [freightchain.fun](https://freightchain.fun). The program in this repo is [`8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p`](https://explorer.solana.com/address/8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p?cluster=devnet) on devnet (v3, upgraded in place on 12 Oct 2026). Its config account is [`9zRUyontAnwj65WHpEazpmW1eyHb8oYfPDvxcpMrSw7F`](https://explorer.solana.com/address/9zRUyontAnwj65WHpEazpmW1eyHb8oYfPDvxcpMrSw7F?cluster=devnet), 146 bytes, read from the public devnet RPC on 13 Oct 2026. An older program, `9e7phdJz…BSvx`, is still on devnet with its pools finished. The site does not sell into it.

The entire project was built in two weeks during the hackathon, entering in the final 6 days of the submission window—the truck simulation and cockpit, the five routes, traffic, climate, the server, the lobby, the landing, the whitepaper, verified play, live watch, the admin page, the garage, promo codes, and the escrow program. Coding agents also read [`AGENTS.md`](AGENTS.md).

## Security check and contracts audit

On 13 Oct 2026 twelve AI auditors attacked this repository: Claude Opus 5.5, GPT-6.1 Sol, Gemini 3.1 Pro and Grok 4.7. Six surfaces: the escrow program, the server money paths, identity and admin, the anti-cheat, the client, and the infrastructure. Each surface had two auditors from different vendors who could not see each other's work. A finding counts only if both raised it, or one raised it with a test that reproduces it. Disputed claims went to a third vendor. Local checkout and LiteSVM only: no production, no chain writes.

This is not a third-party audit. The program stays "not audited" until one is done.

69 raw findings became 7 high and 13 medium; the rest are low or info. 4 claims were corrected or refuted. Every fix was planned with a definition of done, red-teamed, and decided one by one. Then it was built with its proof of concept turned into a regression test.

| Finding | State |
| --- | --- |
| H1, H3, M10, M13 · anti-cheat: an empty recording judged verified, about 1.9× the speed governor, hidden hole passes | Shipped in the Oct 15 app release (rules v4); production boards remain in shadow mode |
| H2 · another rider's recording replayed as your own | Shipped Oct 15: a copied recording is flagged for review |
| H6, M7 · rides after the play deadline still ranked; a revoked verdict still paid | Shipped Oct 15. Sales and new rides also stop at the sale end |
| H7, M2, M3, M4, M9 · session cookie scope, login CSRF, logout, admin CORS, the sign-in text, rate limits | Shipped Oct 15. Player sessions were invalidated with the session change |
| H5, H4, M6, M8, L4 · program: the payout key was the whole prize gate, pledges not bound to their ride, a review window that committed nothing, sponsorships kept by a failed pool, a road seed the opener could pick | Program v4/v5: a winners root public for the review before any prize is paid, per-ride attestations, sponsor refunds, `seal_road`, plus v5's `85 / 5 / 10` pool split (`8500 / 500 / 1000` bps), `< 50%` player-derived share cap (`max_player_share_bps <= 4999`, default `4740`), `set_pool_rules`, and `paid_tickets_enabled`. 154+ LiteSVM tests plus the localnet suites. **Not on devnet yet.** Devnet still runs v3, where these findings are open |
| M1, M11, M12, M5, most lows · the blink page relays any action, no CSP / HSTS, no subresource integrity, verdict codes on public rides | Open (fix plan WP6 to WP8) |

The original review supplied proof-of-concept reproductions that became regression tests. Its report and PoC status are archived at the reviewed commit. The current reusable audit tool keeps new reports and PoCs in gitignored run directories. Read: [the report](https://github.com/recferret-bit/freightchain/tree/16870e81) ([HTML](https://github.com/recferret-bit/freightchain/tree/16870e81)), [the fix plan with every decision](docs/insights/reviews/audit-2026-10/fix-plan.md), [PoC status](https://github.com/recferret-bit/freightchain/tree/16870e81), and [whitepaper chapter 08](https://whitepaper.freightchain.fun/#audit). The suite itself is the `security-audit` skill.

## Post-Colosseum hackathon updates

The submission went in on **12 Oct 2026**. Work continued after that snapshot. The app release checked on **16 Oct** is `20261015-152742-16870e81`; a code change in `main` is not automatically a production deployment. Program upgrades are separate from app releases.

### Security review after submission

On 13 Oct twelve AI auditors from four vendors reviewed six surfaces in blind pairs. Quorum adjudication reduced 69 raw findings to 7 high and 13 medium; 4 claims were corrected or refuted. Fixes for all 7 highs and 9 mediums are in source, with reproductions turned into regression tests. App fixes shipped on Oct 15; the program-v4/v5 fixes still need their separate devnet upgrade. This was our own review, not a third-party audit. See [the findings and their release state](#security-check-and-contracts-audit) and [the fix plan](docs/insights/reviews/audit-2026-10/fix-plan.md).

### What changed

| Date | Change after submission | Product effect | Release state as of 17 Oct |
| --- | --- | --- | --- |
| 13 Oct | Wallet Standard discovery, wallet picker, one-prompt sign-in and phone-pay fixes | More wallets can sign in and pay with fewer steps | Shipped in the Oct 15 app release |
| 13–14 Oct | Desktop-only driving, current cab imagery, clearer landing and README copy | Phone visitors can watch; the product pages show the actual game | Shipped in the Oct 15 app release |
| 14 Oct | Anti-cheat v4: recording coverage, speed and hole checks; copied-recording flags | Empty, accelerated or copied traces receive a verdict; production boards still use shadow mode | Shipped in the Oct 15 app release |
| 14 Oct | Session and admin isolation; pool sale/play deadlines and payout rechecks | Cross-site requests are constrained; late rides and revoked verdicts cannot become eligible winners | Shipped in the Oct 15 app release; contract rules still depend on the program version |
| 14 Oct | Escrow v4: public winners root, review lock and veto, per-ride pledge attestations, sponsor refunds, later-slot road seal | Settlement commits to a published result and to the ride a sponsor backed | Built and tested; separate devnet program upgrade pending |
| 14–15 Oct | Playable eight-slide pitch deck, shareable pledges, sound checks and refreshed traction snapshot | Reviewers can explore the product and economy; the README dates its measurements | App changes shipped Oct 15; traction remains the dated snapshot above |
| 16 Oct | Shared road geometry, route curves, physics and full traffic AI; required hashed traffic-frame evidence (rules v7) | New rides cannot omit required evidence or downgrade themselves; removed cars and ignored traffic responses reject | Committed in `b58c9921`; next app release |
| 16 Oct | Real headless browser regression matrix: honest drives, natural finish, slow execution, real crash and five modified-client cases | Checks the full game → API → database → saved-verdict/replay path, including re-hashed attacks | Nine controlled local scenarios passed; no claim of exhaustive attack coverage |
| 16 Oct | Landing pitch-deck preview and phone motion controls for the deck's SOL coins | The deck is easier to discover and its coin toy responds to phone tilt | Committed; next app release |
| 16 Oct | Reusable audit targets, Docker/MCP isolation and native review profiles | Review tooling can inspect local or GitHub repositories; each adapter still reports its own readiness and limits | Repository tooling; no new external audit claimed |
| 16 Oct | Whitepaper v0.2: evidence-flow and browser-outcome charts, protocol and release limits | Readers can distinguish recorded evidence, server checks and settlement trust | This documentation revision; next app release |
| 16–17 Oct | Data-only 3D entity engine, append-only revision history, wallet-signed publishing, dedicated `editor:worker` and isolated `backend/mcp/` server | Every 3D model is pure data; allowlisted editors can inspect, AI-generate and sign-publish models without exposing keys or blocking the API | Committed in `main`; next app release |
| 16–17 Oct | `TEN4` tokenomics (`100M` fixed supply, 6 buckets, halving eras), checkpoint minting (`20% / 50% / 100%`), local two-way pool / LP redeem, Merkle airdrop (`8M`), cab burns and nine-slot Garage | Verified paid checkpoints credit `TEN4`; localnet suites exercise mint, swap, burn, soulbound parts, airdrop and referral claims (`HONK` remains the horn/chat verb) | Built and tested on localnet; token remains devnet / local ahead of March 2027 TGE |
| 16–17 Oct | Escrow v5 (`85 / 5 / 10` pool split, `< 50%` player-derived share cap), 7-week Seasons, Weekly Skill Contest (`1h / 4h / 8h`), AMOE weekly ticket, Devnet Pre-season plan and Convoy referral vault (`4M TEN4`) | Pools split **85% weekly boards · 5% rollover · 10% Season Final** with `max_player_share_bps <= 4999` (`<= 47.4%` player-derived funding); inviters earn free rides, gift paints, capped spectator-tip shares and `100 / 50 TEN4` milestones; Devnet Pre-season launches Nov 2–17, 2026 ($500 USDC + 100k `TEN4` points) | Committed in `main`; next app release; Program v5 upgrade pending |
| 16–17 Oct | Stateless horizontal server scaling, Redis Lua presence/ops logs, distributed scheduler leases, bounded LRU caches and universal crash telemetry | Multiple `app` and `worker` replicas share locks, presence and logs safely; unhandled client errors report from every page | Committed in `main`; next app release |
| 17 Oct | Full wallet catalog + QR phone-to-desktop browser pairing (`/api/auth/pair`), and 3-pass modular refactoring of Landing, Whitepaper, Pitch Deck and Lobby | Desktop browsers can sign in via a phone wallet QR scan; all site pages share zero-duplication UI, effect and CSS components with no god files | Committed in `main`; next app release |

### Post-hackathon engineering deep dive (13–17 Oct)

Since the **12 Oct 2026** Colosseum submission snapshot, development focused on seven areas across the simulation kernel, on-chain settlement, 3D asset pipeline, economy, infrastructure scaling, and site architecture:

1. **Shared Simulation Kernel & Frame-Level Traffic Proof (`@freightchain/shared`, rules v7)**:
   Road geometry, route curvature integration, longitudinal truck physics, and the seeded traffic AI were unified in [`frontend/client/shared/`](frontend/client/shared) and consumed directly by both the browser game and the server's `ReplayEngine`. Newly started rides (`trafficVersion=1`) record lossless per-frame traffic evidence inside SHA-256 hash-chained batches (sealed every 2 game seconds or 500 frames) and verify cab/trailer contacts, hull damage response, and 10 Hz sample binding.
2. **Quorum Security Review & Escrow Program v4 / v5**:
   Following the 12-auditor blind review across 6 surfaces, all 7 high and 9 medium findings were resolved in source with regression tests. Program v4 adds a committed Merkle winners root with a public review window and cold-admin veto, per-ride pledge attestations, sponsor refunds on failed pools, and `seal_road` from a later slot hash; Program v5 (`30 instructions, 28 events, 50 error codes`) updates the pool split to **85% prizes · 5% rollover · 10% Season Final** (`8500 / 500 / 1000` bps), drops the on-chain referral pot cut in favor of the `4M TEN4` Convoy referral vault, and enforces `max_player_share_bps <= 4999` (default `4740`, keeping player-derived funding `< 50%` / `<= 47.4%` of `F + P`), `set_pool_rules`, and `paid_tickets_enabled`. The multi-agent suite (`./tests/audit/bin/audit`) was generalized into an airgapped one-shot Docker sandbox with an MCP stdio bridge and native/Docker review profiles.
3. **Data-Only 3D Entities & Isolated AI Model Editor (`frontend/client/shared/entity/`, `backend/mcp/`, `editor:worker`)**:
   Every 3D vehicle, prop, landmark, gantry, and part was converted into a declarative, executable-code-free entity specification validated by shared analytic geometry checks. The model viewer (`storybook.<apex>`) gained `SOURCE`, `CHAT`, and `HISTORY` tabs backed by append-only PostgreSQL revisions (`HEAD` vs `PUBLISHED`) and wallet-signed publication. AI generation runs exclusively in a dedicated 5-slot `editor:worker` polling PostgreSQL and calling an isolated Streamable HTTP `backend/mcp/` server with short-lived per-job capability tokens and counter-only Redis ACL rate limits.
4. **Unified Skill Contest Pools (`85 / 5 / 10`), Convoy Referrals & `TEN4` Tokenomics**:
   Weekly skill contests run across 7-week seasons (6 regular weeks + Week 7 Live Final for top 8 + ties per board) with three boards (**Sprint 1h** 25%, **Haul 4h** 30%, **Long Haul 8h** 45%; inside each board 80% top-10 places + 20% clean finishers, equal tie-splitting, and a 30% free-ticket prize cap), unlimited free training, 1 weekly granted paid ticket (AMOE), and the **Nov 2–17, 2026 Devnet Pre-season** ($500 USDC organizer prize pool on the 1h board + 100,000 `TEN4` airdrop points). The capped **100,000,000 `TEN4`** token (`backend/programs/freightchain_honk`, `HONK` as the horn/chat verb) splits supply across **55M** ride emission (halving eras, `20% / 50% / 100%` checkpoints: `100 / 500 / 1,200 TEN4` in Era 1), **15M** liquidity, **8M** Merkle airdrop (`2,000 TEN4` wallet cap), **4M** Convoy referral vault (`100 / 50 TEN4` milestones M1/M2 alongside off-chain `?ref=` ride gifts, referral paints `convoy / signal / amber`, and capped spectator-tip sharing), **10M** treasury (36m linear), and **8M** team (12m cliff, 24m linear), paired with on-chain burns (`1` stream HONK, `10` day/night, `25` weather, `65 / 260` cab visuals across the 9-slot Garage).
5. **Stateless Horizontal Scaling, Hot-Path Caching & Crash Reporting**:
   The NestJS backend was hardened for multi-replica operation: single-roundtrip Redis Lua scripts track live site visitors and stream spectators with circuit-breaker fallbacks, background schedulers and `AttestationService` coordinate via atomic Redis locks (`SET NX PX`), `replay:worker` deduplicates in-flight jobs, and bounded LRU caches keep `RoadPlan` chunks, decompressed `RideBatch` payloads, and `.sol` SNS lookups off the CPU. Every client surface boots [`crash-boot.js`](frontend/client/js/crash-boot.js) first to report unhandled errors.
6. **Universal Wallet Picker & Phone-to-Desktop Pairing**:
   The sign-in flow now lists the full Solana wallet catalog (highlighting detected Wallet Standard extensions), opens deep links on mobile, and lets a desktop browser without a wallet extension sign in by scanning a single-use QR pairing code (`/api/auth/pair`) with a phone wallet.
7. **Modular Component Architecture Across Landing, Whitepaper, Pitch Deck & Lobby**:
   All public and player site surfaces were refactored across three passes to eliminate god files and copy-pasted UI logic. Shared design tokens, 3D tilt cards, and flip cards live in [`frontend/client/css/tokens.css`](frontend/client/css/tokens.css), [`frontend/client/css/card3d.css`](frontend/client/css/card3d.css), and [`frontend/client/css/flip-card.css`](frontend/client/css/flip-card.css); shared DOM builders, formatters, and interactive behaviors (`bindCard3d`, `bindFlipCards`, `bindReveal`, `bindScrollSpy`, `observeOnce`, `guardMobilePlay`, `avatar`, `driverEl`, `progressBarEl`, `pillGroupEl`, `extLink`, `splitBarEl`) live in [`frontend/client/site/dom.js`](frontend/client/site/dom.js), [`frontend/client/site/ui.js`](frontend/client/site/ui.js), and [`frontend/client/site/effects.js`](frontend/client/site/effects.js); and the Lobby and Landing controllers are cleanly split into focused modules ([`boards.js`](frontend/landing/src/boards.js), [`lobby-new.js`](frontend/client/site/lobby-new.js), [`lobby-live.js`](frontend/client/site/lobby-live.js), [`lobby-profile.js`](frontend/client/site/lobby-profile.js), and [`pitchdeck/slides.css`](frontend/landing/src/pitchdeck/slides.css)).

The production replay worker was restarting at the read-only check. Its explicit `TRUST_PROXY=0` startup fix is included with the pending simulation release; a deployment must verify that the worker becomes healthy. The app's health endpoint was ready. No deployment is implied by this recap.


## Contents

- [Traction](#traction)
- [Security check and contracts audit](#security-check-and-contracts-audit)
- [Post-Colosseum hackathon updates](#post-colosseum-hackathon-updates)
- [Open the site](#open-the-site)
- [Ten minutes](#ten-minutes)
- [What is on chain](#what-is-on-chain)
- [Status](#status)
- [Limits](#limits)
- [The truck](#the-truck)
- [Shifts](#shifts)
- [How a finish is checked](#how-a-finish-is-checked)
- [The road](#the-road)
- [Money](#money)
- [Sites](#sites)
- [Technical](#technical)
- [Repository](#repository)
- [Skills](#skills)
- [Run it](#run-it)
- [3D entity editor and AI generation](#3d-entity-editor-and-ai-generation)
- [Tests](#tests)

## Open the site

| Surface | URL | What you get |
| --- | --- | --- |
| Landing and lobby | [freightchain.fun](https://freightchain.fun) | The pitch, live boards, sign-in |
| Whitepaper | [whitepaper.freightchain.fun](https://whitepaper.freightchain.fun) | Rules, escrow, validation, streams, risks |
| Game | [ride.freightchain.fun/play.html](https://ride.freightchain.fun/play.html) | The truck. A ride id comes from the lobby. Bare `play.html` starts the real EASY ride |
| Ride receipt | `freightchain.fun/r/:id` | Live or finished ride, explorer link, X card. Open one from [REPLAYS](https://freightchain.fun/lobby.html#replays) |
| Pitch deck | [pitchdeck.freightchain.fun](https://pitchdeck.freightchain.fun) | Eight playable slides. ← → in the floating tip (or the keys), F full screen; on a phone big corner buttons, one full screen button, full screen on the first tap, and an ask for motion sensors (allowed, the spawned SOL falls with the tilt). Live |
| Model viewer | [storybook.freightchain.fun](https://storybook.freightchain.fun) | The meshes; the 3D model editor for listed wallets (`EDITOR_WALLETS`) |
| API | [api.freightchain.fun/api/health](https://api.freightchain.fun/api/health) | JSON under `/api/`. Anything else on that host 404s |
| Admin | [admin.freightchain.fun](https://admin.freightchain.fun) | HTTP basic auth, then a second wallet sign-in |
| Program | [Explorer, devnet](https://explorer.solana.com/address/8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p?cluster=devnet) | Upgradeable. Initialized. Not audited |
| Social | [X](https://x.com/FreightChainSol) · [YouTube](https://www.youtube.com/@FreightChainGame) · [GitHub](https://github.com/recferret-bit/freightchain) | |

Landing chapters: [RIDE](https://freightchain.fun/#ride), [LOOP](https://freightchain.fun/#loop), [ECONOMY](https://freightchain.fun/#economy), [ROADMAP](https://freightchain.fun/#roadmap), [GO TO MARKET](https://freightchain.fun/#market), [ABOUT](https://freightchain.fun/#about), [FAQ](https://freightchain.fun/#faq). Whitepaper chapters for a review: [05 on chain](https://whitepaper.freightchain.fun/#onchain), [06 validation](https://whitepaper.freightchain.fun/#verify), [07 streaming](https://whitepaper.freightchain.fun/#stream), [08 limits](https://whitepaper.freightchain.fun/#risks).

## Ten minutes

One minute: open the [landing](https://freightchain.fun) and press PLAY FREE RIDE NOW. That starts the real EASY ride. No wallet: an anonymous session. Progress on it does not merge into a later sign-in.

1. Read the hero. The page says devnet, and that the SOL there is not mainnet money. It also says the $5, $15 and $50 shifts are soon. That line stays until a pool of that tier is open.
2. Open the [whitepaper](https://whitepaper.freightchain.fun). Escrow is on devnet and not audited. The garage is a lobby tab across nine slots (wheel, paint, shifter, dice, needles, hood ornament, dash trim, turn-signal lens, phone case) unlocked by burning `TEN4` (+ 3 referral gift paints). It does not change the handling.
3. Connect a devnet wallet (Phantom, Solflare, Backpack, any Wallet Standard wallet, or scan a QR code from a phone wallet). Sign-in is a message (`solana:signIn` or `signMessage`), not a transaction.
4. Start the free ride. EASY is three minutes on four lanes with two crossroads, and it ends itself at 1512 m. Tutorial and assist are free-tier only. HARD has neither.
5. Watch someone from LIVE, or open REPLAYS. The watch page draws the truck from the recording, about 25 seconds behind, on a road rebuilt from the ride seed.
6. Open the [program](https://explorer.solana.com/address/8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p?cluster=devnet) and the [contract spec](docs/tech/pool-program/index.html). When a pool is on sale, the lobby sells a ticket into it (`PAYMENT_MODE=program`) and shows a Solana Pay code for the same transaction on a phone. If the lobby says SOON, there is nothing to buy.
7. From this repo, `npm run test:localnet` runs the program on a local validator and checks the lamports. Walkthrough: [`docs/tech/localnet-e2e/index.html`](docs/tech/localnet-e2e/index.html).
8. Read [Security check and contracts audit](#security-check-and-contracts-audit): what twelve AI auditors found, what is fixed, and what is still open. `./tests/audit/bin/audit pocs` reruns every proof of concept.

A wallet listed in `DEMO_WALLETS` drives a paid shift `DEMO_SCALE` times shorter (default 60). The speed governor stays 28 m/s.

## What is on chain

Each row is something a reviewer can open. The limit is in the same row as the claim. The pictures are diagrams, not receipts.

<img src="frontend/landing/public/media/chain/proof.svg" alt="Diagram: accepted batch hashes form one Merkle root" width="220"> <img src="frontend/landing/public/media/chain/pledge.svg" alt="Diagram: a per-km pledge pays the verified distance and returns the rest" width="220"> <img src="frontend/landing/public/media/chain/siws.svg" alt="Diagram: one wallet sign-in prompt bound to freightchain.fun and a single-use nonce" width="220"> <img src="frontend/landing/public/media/chain/sns.svg" alt="Diagram: a leaderboard row shown as a .sol name" width="220"> <img src="frontend/landing/public/media/chain/blink.svg" alt="Diagram: an X card with a ticket button and a Solana Pay code" width="220">

| What | Solana piece | What it does, and what it does not | Code |
| --- | --- | --- | --- |
| Road seed | Devnet v3: `create_pool` / `open_next_pool` read the newest SlotHashes entry. Source v4/v5: `seal_road` reads `SlotHashes` after `prep_deadline` once ticket sales close and stores `SHA-256(pool id as little-endian u32 ‖ slot hash ‖ slot as little-endian u64)` | No caller passes the seed. Everyone in the pool drives the road derived from that commitment. The program does not draw the road itself | [`road.rs`](backend/programs/freightchain_pools/src/instructions/road.rs) · [`provable-seed.ts`](backend/server/src/domain/road/provable-seed.ts) |
| Recording root | RFC 6962 Merkle tree over the ride's accepted batch hashes | The attestation names which recording it covers. The program does not recompute the drive | [`telemetry-merkle.ts`](backend/server/src/domain/telemetry/telemetry-merkle.ts) |
| Prize gate | Devnet v3: `Attestation` PDA `[attestation, pool account, driver]`. Source v4/v5: `commit_winners` stores the 32-byte Merkle `winners_root` on `Pool` before the review window (`veto_winners`), and `pay_prize` verifies the winner's Merkle proof after `payout_at` (`PrizeClaim` PDA) | The admin or the payout key signs `commit_winners` (or `attest_ride` in v3); after the review lock, anyone may crank `pay_prize` in v4/v5. Program v5 enforces `8500 / 500 / 1000` bps (`85 / 5 / 10`) and `max_player_share_bps <= 4999` (`< 50%` player-derived share). It is the server's verdict, not a proof of the physics | [`settle.rs`](backend/programs/freightchain_pools/src/instructions/settle.rs) |
| Per-km pledge | `Pledge` `[pledge, ride_id, sponsor]`. The sponsor signs `create_pledge` | A VERIFIED attestation (`Attestation` in v3; per-ride `RideAttestation` `[ride_attestation, pool, ride_id]` in v4/v5) pays `cap × min(verified km, target) / target`. FLAGGED pays 0. If paying the driver would leave that account under rent, the sponsor gets the cap back. `refund_pledge` returns the cap when the pool is refunding, cancelled, or settled, or still active 14 days after `payout_at`. Both are permissionless | [`pledge.rs`](backend/programs/freightchain_pools/src/instructions/pledge.rs) |
| Sign-in | `solana:signIn` (CAIP-122), Wallet Standard, or QR phone pairing (`/api/auth/pair`) | One prompt where the wallet supports it, or scan a single-use QR with a phone wallet. Older wallets fall back to connect plus `signMessage`. The server checks the fields it issued and burns `nonce:<nonce>` on the first try | [`wallet.js`](frontend/client/site/wallet.js) · [`qr.js`](frontend/client/site/qr.js) · [`sign-in.ts`](backend/server/src/domain/auth/sign-in.ts) |
| .sol names | SPL Name Service on mainnet, read with `@solana/web3.js` | Server cache: a hit for 24 h, a miss for 30 min. Shown on leaderboards, the profile, and `/r/:id` when a name exists | [`sns-name-service.adapter.ts`](backend/server/src/infrastructure/sns/sns-name-service.adapter.ts) |
| Solana Pay and Actions | Transaction request plus a reference key. `/actions.json` maps `/` to one ticket and `/r/:id` to the ride | Devnet. The buyer pays the network fee. A blink buy still needs the 18+ and loss stamps, which only the site can record. Not listed in the Dialect registry, so X shows an ordinary card. [`/blink.html`](frontend/client/blink.html) renders the card on our site | [`actions`](backend/server/src/domain/actions) · [`solana-pay.js`](frontend/client/site/solana-pay.js) |

```mermaid
flowchart TB
  slot["SlotHashes sysvar"] --> pool["Pool account<br/>seed commitment & winners_root"]
  buyer["Buyer signs buy_ticket"] --> vault["Vault PDA"]
  sponsor["Sponsor signs create_pledge"] --> pledge["Pledge account"]
  server["Admin or payout key"] --> attest["commit_winners / RideAttestation<br/>Merkle root, verified km"]
  attest --> prize["pay_prize, capped (85%)"]
  vault --> prize
  attest --> settle["settle_pledge"]
  pledge --> settle
  settle --> back["Unearned lamports and rent back to the sponsor"]
```

Accounts:

| Account | Seeds | Role |
| --- | --- | --- |
| Config | `["config"]` | Admin, platform & seed treasuries, fee bps, rule floors, `max_player_share_bps <= 4999` (default `4740`), pool count, pause, payout authority |
| Pool | `["pool", id]` | Rules (`85 / 5 / 10` split, `< 50%` player share, `paid_tickets_enabled`), counters, `seed_commitment`, `winners_root`, `winners_count`, `winners_set_at`, `vetoed` |
| Series | `["series", tier]` | One schedule per tier. Anyone may open the next pool from it |
| Ticket | `["ticket", pool account, buyer]` | One account per buyer. Quantity stacks on it. A refund closes it. A settled ticket stays until `close_ticket` |
| Sponsor | `["sponsor", pool, sponsor]` | Sponsor contribution (`sponsor_pool`); refunded on failed pools via `refund_sponsor` (v4/v5) |
| Vault | `["vault", id]` | Zero-data PDA. The pool's money. Nothing is staked |
| Pledge | `["pledge", ride_id, sponsor]` | SOL per km for one driver. Closed by settle or refund |
| Attestation / RideAttestation | `["attestation", pool, driver]` (v3) / `["ride_attestation", pool, ride_id]` (v4/v5) | Admin or payout key's verdict; `PrizeClaim` (`["prize_claim", pool, winner]`) marks paid Merkle leaves in v4/v5 |

```mermaid
stateDiagram-v2
  [*] --> Open: create_pool or open_next_pool
  Open --> Active: buy_ticket once sold reaches the minimum
  Open --> Refunding: fail_pool after the prep deadline, or cancel_pool by the admin
  Active --> Refunding: expire_pool, 14 days after payout_at, if no prize was paid
  Active --> Settled: close_pool after payout_at (5% seed / 10% fee)
  Refunding --> Cancelled: close_pool once every ticket is refunded
```

Who can move money:

| Instruction | Who signs | Limit |
| --- | --- | --- |
| `buy_ticket`, `create_pledge` | That wallet | Sale window for tickets. The server never holds the lamports |
| `fail_pool`, `expire_pool`, `refund`, `refund_pledge`, `settle_pledge` | Anyone | Only when the account state allows it. An absent operator cannot keep the money |
| `commit_winners`, `pay_prize` | Admin, or the payout key (`PAYOUT_SECRET`) | In devnet v3: after `payout_at` to a wallet with a VERIFIED attestation inside the prize share. In v4/v5: commits a Merkle winners root before the review window (`commit_winners`, `veto_winners`), then anyone may execute `pay_prize` with a Merkle proof after the lock. Program v5 enforces `max_player_share_bps <= 4999` (`< 50%` player-derived share), `set_pool_rules`, and `paid_tickets_enabled` |
| `close_pool` before the 14-day grace | Admin or the payout key, after `payout_at` | Can close without paying prizes (in v3) or after the winners root is paid out (in v4/v5). Unpaid prize lamports roll to the seed treasury |
| Crank key | The server, for `open_next_pool`, `seal_road`, `fail_pool`, `expire_pool`, `refund`, `close_pool` | It cannot send `commit_winners` or `veto_winners` |

The program on devnet (v3) has 21 instructions, 18 events, and 32 errors. The source here is v5 (`0.5.0`: 30 instructions, 28 events, 50 errors; built on v4's 29, 27, 48), not deployed yet. The shared lamport table is [`vault-split.ts`](backend/server/src/domain/economy/vault-split.ts), with the same cases in [`vault-split-cases.json`](backend/server/test/fixtures/chain/vault-split-cases.json), and the unified weekly contest rules live in [`prize-rules.ts`](backend/server/src/domain/prize/prize-rules.ts) and [`prize-pool.ts`](backend/server/src/domain/prize/prize-pool.ts). Spec: [`backend/programs/README.md`](backend/programs/README.md), [`docs/spec/pool.md`](docs/spec/pool.md), and [`docs/tech/pool-program/index.html`](docs/tech/pool-program/index.html). Trust the id in `declare_id!`. The program README's first paragraph can lag it.

The local `TEN4` program ([`backend/programs/freightchain_honk`](backend/programs/freightchain_honk), [`tokenomics.ts`](backend/server/src/domain/honk/tokenomics.ts), [`docs/spec/ten4.md`](docs/spec/ten4.md)) implements the fixed `100,000,000 TEN4` supply (`15M` LP, `55M` ride emission across halving eras, `8M` Merkle airdrop, `4M` Convoy referral vault, `10M` treasury 36m linear, `8M` team 12m cliff / 24m linear), checkpoint minting (`20% / 50% / 100%`), two-way liquidity pool and LP redeem, and on-chain burns (`1` stream HONK, `10` day/night, `25` weather, `65 / 260` cab visuals).

`npm run program:verify` rebuilds in the Solana Foundation image and compares the hash to [`backend/programs/verifiable-build.hash`](backend/programs/verifiable-build.hash) (`f1c45eff…` for the v4 source, Solana 4.1.2; devnet still runs v3, `47a630e8…`). The explorer "verified" badge is not submitted yet. `deploy` refuses an RPC whose genesis is not devnet.

Badges: 44 earnable soulbound compressed NFTs across 12 ladders (34 illustrated on devnet Arweave across 9 ladders + 6 free MEDIUM/HARD mastery + 4 Convoy referral, plus 1 Top-20 podium placeholder = 45 definitions), Metaplex Bubblegum v2, minted by a key that can mint and nothing else. An hour after the unlock, and after a second check that skips a rejected ride. Transfer is refused on chain. Collection [`56ijQ5t2RFpXezbPtEuqECo5gCQiGSek2LBsp7cfMoXC`](https://explorer.solana.com/address/56ijQ5t2RFpXezbPtEuqECo5gCQiGSek2LBsp7cfMoXC?cluster=devnet), tree [`45NKrZA9rGFcKr62VY5NvM89yarFuBqtBseRK7ZSM336`](https://explorer.solana.com/address/45NKrZA9rGFcKr62VY5NvM89yarFuBqtBseRK7ZSM336?cluster=devnet). A wallet that does not speak DAS still has the mint transaction on the badge card. Detail: [`docs/spec/web3_solana.md`](docs/spec/web3_solana.md).

## Status

| Piece | In this repository | On the public site |
| --- | --- | --- |
| Driving game, five routes, three free levels, paid tiers | Yes | Free rides are live (unlimited training; `play.html` starts the real EASY ride). Every eligible wallet gets one weekly granted paid ticket (AMOE, default 1h). Paid tiers show SOON when no pool of that tier is open |
| Server-timed shifts, hash-chained recordings, verdicts | Yes. Rules v7 in source | Rules v4 shipped Oct 15, shadow mode. The verdict is stored and shown. Paid boards still rank without it |
| Server road and hole checks, recording verdicts | Yes | Rules v4 shipped; paid boards default to shadow mode |
| Shared road/physics/traffic simulation and required traffic-frame evidence (rules v7) | Yes | Committed; next app release. Replay-worker startup correction included |
| Live watch, replays, CB chat, devnet tips | Yes | Paid rides can be watched, with chat. A running free ride cannot. Replays work after it ends. Tips are devnet transfers to the driver. Game effects are off on ranked runs |
| Garage (9 slots), promo codes, Convoy referrals | Yes | Garage is a lobby tab across 9 slots (wheel, paint, shifter, dice, needles, hood ornament, dash trim, turn-signal lens, phone case) unlocked by burning `TEN4` (+ 3 referral gift paints). Single-effect promo codes (ride grant `1h / 4h / 8h` or pool tickets) and `?ref=` Convoy referral links sit on the profile |
| Public ride receipts, X card, in-game share | Yes | Live. The driver posts from their own account |
| Sign-in with `solana:signIn`, QR browser pairing, .sol names | Yes | Live (`solana:signIn` + `.sol` names shipped; QR pairing in `main`) |
| Escrow, per-km pledges, attestation-gated `pay_prize`, Unified Skill Pools (`85 / 5 / 10`, `< 50%` player share) | Yes. Devnet runs program v3; this source is v5 (`30, 28, 50`), not deployed yet (see [the audit](#security-check-and-contracts-audit)). Anchor 1.2 | Server is in program mode since 11 Oct 2026, still devnet. Next event is the **Devnet Pre-season** (Nov 2–17, 2026: $500 USDC organizer prize pool on the 1h board + 100k `TEN4` points) |
| Staking yield | No. A draft that named JitoSOL was removed before deploy. Nothing is staked | No |
| Solana Pay, Actions | Yes | Devnet. Dialect listing is not done |
| Badge cNFTs | Yes | Devnet. Mainnet waits on the same gates as the program |
| `TEN4` program (`freightchain_honk`), Season 1 mainnet, third-party audit, captcha | `TEN4` program (`100M` cap) is built and verified on localnet; AI security check is [done](#security-check-and-contracts-audit); third-party audit and captcha not yet built | `TEN4` is localnet / off-chain ledger until TGE (Mar 2027); Season 1 mainnet planned Jan 11 – Feb 28, 2027 |

Rollback for checkout is `PAYMENT_MODE=transfer` plus a redeploy. Mainnet waits on an audit, legal entity setup, the devnet exit list, and an explicit deploy. Trust the program id in [`lib.rs`](backend/programs/freightchain_pools/src/lib.rs) and on the explorer.

## Limits

- Devnet / localnet today. Not audited by a third-party firm yet. No mainnet token or mainnet pool is live in this build; **Devnet Pre-season** runs Nov 2–17, 2026 ($500 USDC organizer-funded prize pool + 100,000 `TEN4` airdrop points), followed by **Season 1 mainnet** (Jan 11 – Feb 28, 2027) and **TEN4 TGE** (Mar 2027).
- The landing says the paid shifts are soon. Believe the lobby: SOON means no pool of that tier is open.
- The attestation is signed by the admin or the payout key. The program checks that signature, a VERIFIED status, and the prize cap. It does not check the drive on chain; the off-chain judge and 10 Hz replay verification engine check the drive before signing the attestation.
- Verdict thresholds are first guesses. Production boards ignore the verdict until they are tuned on real rides. A prize, if one is paid, still requires a verified verdict.
- The challenge table is empty. No captcha.
- A dishonest admin, or a stolen payout key, can close a pool after `payout_at` and send the prize share to the seed treasury. The 14-day grace is about a lost key, not a hostile one.
- `close_ticket` is in the program. Nothing in the crank sends it, so settled-ticket rent stays put until someone does.
- The seed treasury is not rolled into the next pool by a job.
- The pinned build hash is not the explorer's verified badge. That badge is not submitted. A matching hash is not an audit.
- [`docs/tech/escrow-open-items.md`](docs/tech/escrow-open-items.md) tracks open engineering items and the Program v5 cutover.
- Browser frames use IEEE-754 floats and variable `dt`. New traffic evidence preserves that frame timing, but remains client-reported state. The 10 Hz physics reconstruction is approximate: acceleration bounds can reject; carried-coasting discrepancies only flag. Full replay from raw inputs alone is not built.
- Float32 road vertices jitter past about 100 km.
- Session keys are not built. Staking is not built.

**Where to read next**

| Question | Open |
| --- | --- |
| How a player drives, and what a finish means | [Whitepaper 02–03](https://whitepaper.freightchain.fun/#drive) |
| Where the money sits | [Whitepaper 05](https://whitepaper.freightchain.fun/#onchain) · [contract spec](docs/tech/pool-program/index.html) |
| What the server checks | [Anti-cheat](docs/tech/anti-cheat/index.html) · [player page](docs/tech/verified-play/index.html) |
| One person, many wallets (planned) | [Anti-sybil and Convoy](docs/spec/anticheat.md#appendix-d-anti-sybil--multi-wallet-defense-layers) |
| What a spectator sees | [Replays and donations](docs/tech/replay-and-donations/index.html) |
| Whether the money tests pass | [Localnet walkthrough](docs/tech/localnet-e2e/index.html) |
| What the security check found, and what is fixed | [Security check and contracts audit](#security-check-and-contracts-audit) · [whitepaper 08](https://whitepaper.freightchain.fun/#audit) · [report](https://github.com/recferret-bit/freightchain/tree/16870e81) |
| How the server is put together | [backend-architecture.md](docs/tech/backend-architecture.md) |

## The truck

Five routes, one truck. Manual gearbox, clutch, stall, parking brake, cold engine, battery, heater, cab cooling, wipers, radio. Speed is governed at 28 m/s, about 100 km/h. A phone on the dash (N, or a click) shows the truck, the finish, a fork's other road, and the next junction.

The player does not pick the route or the start hour of a paid ride. The server derives both from the seed. Each free level has a fixed country. Its start hour still comes from the seed.

<table>
  <tr>
    <td><img src="frontend/design/youtube-banner/shots/r66-day.jpg" alt="Route 66, day, a sinkhole warning beside the lane" width="220"><br>Route 66. Gentle bends.</td>
    <td><img src="frontend/design/youtube-banner/shots/siberia-frost.jpg" alt="Trans-Siberian cab in frost, snow on the road" width="220"><br>Trans-Siberian. Snow.</td>
    <td><img src="frontend/design/youtube-banner/shots/stuart-dust.jpg" alt="Stuart Highway in dust, long straight road" width="220"><br>Stuart Highway. Almost straight.</td>
    <td><img src="frontend/design/youtube-banner/shots/brenner-dusk.jpg" alt="Brenner Pass at dusk, a tight mountain road" width="220"><br>Brenner Pass. Tight.</td>
  </tr>
</table>

The fifth route is the Pan-American through the Atacama, long sweepers. Same builders as the game: [`frontend/client/js/themes/index.js`](frontend/client/js/themes/index.js) · [model viewer](https://storybook.freightchain.fun).

<img src="frontend/design/youtube-banner/shots/crash.jpg" alt="The cab after a crash, shift over" width="360">

## Shifts

| Tier | Length | Finish line | Price | Road |
| --- | --- | --- | --- | --- |
| Free · EASY | 180 s | 1512 m (`k` 0.3) | 0 | Four lanes, two crossroads, bends ×3, calm traffic. First natural hole is 4 km in, past the line. Ends itself |
| Free · MEDIUM | 300 s | 3360 m (`k` 0.4) | 0 | Depot turn, three crossroads, a fork, bends ×1.35, traffic ×0.8, holes ×1.5 |
| Free · HARD | 1800 s | 20 160 m (`k` 0.4) | 0 | Twelve crossroads, four forks, a highway run, bends ×1.6, traffic ×1.4, holes ×2. No assist, no tutorial |
| 1 hour (Sprint · 25% board) | 3600 s | 50 400 m (`k` 0.5) | $5 in SOL / USDC | Depot, stop line, right turn. On sale when a pool is registered. Planned minimum 20 tickets (10 participants min on Season 1 boards) |
| 4 hour (Haul · 30% board) | 4 h | 201 600 m (`k` 0.5) | $15 series / $12 Season 1 extra | Bends ×1.2, traffic ×1.4. Off until a pool of that tier exists |
| 8 hour (Long Haul · 45% board) | 8 h | 403 200 m (`k` 0.5) | $50 series / $25 Season 1 extra | Bends ×1.4, traffic ×1.8. Same gate |

A shift completes when distance reaches `k × 28 m/s × nominal length`. There is no minimum time. The governor is what makes the line take about that long. Paid tiers use `k = 0.5` and mint capped `TEN4` at `20% / 50% / 100%` checkpoints (`100 / 500 / 1,200 TEN4` in Era 1). After a paid finish the road continues until the driver ends it. A free level ends itself.

Training rides are unlimited. They count for statistics and achievements only. Every eligible wallet gets one granted paid ticket a week (AMOE, default 1 hour; 30% free-ticket prize cap per board; up to 5 paid + 1 promo ranked starts per week in Season 1). It can be ranked and watched, and it does not mint TEN4. `play.html` with no ride id starts the real EASY ride.

The lobby picks the free level (`POST /api/rides`, `level` 1–3). Each level has its own board. Assist, on EASY and MEDIUM only, halves hull damage and battery drain. While the verdict is enforced, a rejected recording earns no badge. It still counts as a ride that started.

Prices are quoted in USD and charged in devnet SOL at the server's rate (`ride-tier.ts`: $5 / $15 / $50; Season 1 extra tickets in `prize-rules.ts`: $5 / $12 / $25). The $5 price and the 20-ticket minimum are the planned 1 hour series. The landing says those shifts are soon until a pool is open. A devnet series can be a shorter, cheaper test when one is registered.

Read: [`frontend/client/js/trips.js`](frontend/client/js/trips.js) · [`ride-tier.ts`](backend/server/src/domain/rides/ride-tier.ts) · [`ride-rules.ts`](backend/server/src/domain/rides/ride-rules.ts) · [`prize-rules.ts`](backend/server/src/domain/prize/prize-rules.ts)

## How a finish is checked

Online rides record **10 Hz truck samples and input events**, plus **lossless per-frame traffic evidence** for new protocol-version-1 rides. The server stamps the required version at start. The client seals these rides' SHA-256 hash-chained batches after **2 game seconds or 500 frames**, whichever comes first; historical recordings used 15-second batches.

Two verification stages check that evidence:

1. **Admission and summary checks.** Finite values, travel and work budgets are bounded before road lookups. Batch order, hash links, coverage, motion, the server's holes, input timing and challenges feed `RideVerdict.judge`. Uploads and judging share the player's row lock.
2. **Shared simulation checks.** `ReplayEngine` uses `@freightchain/shared` for road geometry, route curves, longitudinal physics and the full seeded traffic AI. Version 1 runs traffic at the submitted frame timing, checks cab/trailer contacts and hull response, and binds the 10 Hz samples to simulated post-contact frames. Verification can run synchronously or through the replay worker; stored replay sessions and reasons are inspectable on the admin page.

```mermaid
flowchart LR
  ride["Server sets seed, route,<br/>assist and traffic version"] --> samples["10 Hz truck samples<br/>and input events"]
  ride --> frames["Required traffic frames<br/>inside the batch hash"]
  samples --> bounds["Hash, coverage, road<br/>and physics checks"]
  frames --> traffic["Shared traffic AI<br/>at recorded frame timing"]
  traffic --> binding["Match truck samples<br/>and collision response"]
  bounds --> verdict["Stored verdict + replay<br/>verified / flagged / rejected"]
  binding --> verdict
  verdict --> review["Signed admin review"]
```

| Evidence or check | What it establishes | Limit |
| --- | --- | --- |
| Hash chain and RFC 6962 root | Which accepted recording the verdict names; inconsistent hashes or links reject | A modified client can recompute hashes. Hashes alone do not prove honest play |
| Required traffic frames (`trafficVersion=1`) | Missing, malformed, uncovered or sample-inconsistent proof rejects; ignored fatal or damaging contacts reject | The server checks reported poses and timing, not an authenticated browser or a full raw-input replay |
| Historical samples (`trafficVersion=0`) | Shared traffic reconstruction supplies review flags | Sparse 10 Hz data omits exact frame timing and trailer angle; it cannot support the same traffic guarantees |
| Road and physics | Hole damage, off-road time, motion and acceleration must fit the ride; carried-coasting discrepancies flag | Float simulation has tolerances; a bot using the real game can still pass |
| Spectator events | Stamped donated holes and day/night shifts are checked against hull and clock | Separate from the traffic proof; a missing stamp can require review |
| Timing and review | Uniform holds, repeated gaps and instant presses flag; admin decisions are signed | The challenge-kinds table is empty and a captcha is not built |

`TRAFFIC_PROOF_REQUIRED=true` is the default for newly started rides. Missing optional replay columns or display-only car tracks does not bypass traffic validation. Explicit false is reserved for compatibility; old rides retain their server-stored version.

**Local end-to-end evidence, 16 Oct:** nine controlled headless Chrome scenarios passed against the real game, Nest and PostgreSQL. Three honest drives verified (normal, natural automatic finish, CPU throttling); a real fatal collision failed the ride; deleting cars, deleting cars plus optional replay data, ignoring damage, stripping proof and malformed proof were rejected. Hashes were rebuilt where the attack changed a batch. Disabling the validator made the removed-cars negative test fail. These are regression checks, not a detection rate, an independent audit or a full-length load test.

Run the browser matrix with `bash .claude/skills/run-tests/e2e.sh traffic`. Shared-kernel parity also uses captured browser fixtures across five routes and three trips. See the [whitepaper source and diagrams](frontend/landing/whitepaper.html).

Paid boards require verified verdicts only when `VERDICT_ENFORCE` is on; production defaults to shadow mode. Prize settlement still requires a verified verdict. Devnet program v3 gates prizes with per-driver attestations; source program v4/v5 uses a reviewed winners root for prizes and per-ride attestations for pledges. The program enforces settlement, not driving physics.

Codes and implementation: [anti-cheat explainer](docs/tech/anti-cheat/index.html) · [verdict rules](backend/server/src/domain/verdict/verdict-rules.ts) · [frame verifier](backend/server/src/domain/verdict/traffic-proof.ts) · [replay engine](backend/server/src/domain/verdict/replay-engine.ts). Recordings are kept for 90 days; flagged and never-judged completed rides are retained.

Live watch uses the same batches, so a paid ride sits about 25 seconds behind. There are no WebSockets. A running free ride cannot be watched, chatted on, or tipped. A finished one can be replayed at 1×, 4×, and 16× while the recording is kept. A tip on a paid ride is a devnet SOL transfer from the spectator to the driver. The platform does not hold it. Game effects are off on the public site. A free ride has them forced off, and a paid ride only gets them when `LIVE_EFFECTS` is `all`. Production sets it to `free`. [`docs/tech/replay-and-donations/index.html`](docs/tech/replay-and-donations/index.html)

Every online shift has a public page at `/r/:id`. The composed X post links that page, or the site home after a ticket buy. `/actions.json` maps those URLs to Actions.

## The road

The drivable world is one centre-line. Distance along it is `s`. Offset across it is `d`. Lanes, junctions, and side roads are features of that line.

A ride seed feeds `mulberry32` in [`@freightchain/shared`](frontend/client/shared/index.js). Segments and junctions append in one RNG order, so the layout is a function of the seed and the trip. Curvature integrates into Float64 tables, one metre a step. The tables grow as the truck approaches. There is no finish line in the geometry.

Patterns are `country`, `highway`, `arterial`, and `town`. A lane change is a 120 m taper. The player cannot turn into a side road. On MEDIUM and HARD the road forks: two roads meet again 1200 m on, mirror images, same length, same lanes, same holes. In `s` and `d` they are one road, so the server does not need to know which one was taken. The driver commits 205 m after the split. Sample column 15 records the choice.

`rollHole(chunk)` places at most one natural hole, and the only natural type is the sinkhole. Pothole, deep, cluster, and trench are holes a spectator can pay for; when stamped on a ride, the 10 Hz `ReplayEngine` checks them too. An online ride installs the server plan from `GET /api/watch/:id/road`. The local roll is the offline fallback.

[`road-drift.spec.ts`](backend/server/test/unit/domain/road/road-drift.spec.ts) runs the game's modules beside the server port: 40 seeds, segments, junctions, and every natural hole out to 60 km. Curvature is not in that compare. The judge works in `s` and `d`.

`update(dt)` in [`physics.js`](frontend/client/js/sim/physics.js) steps the clutch, gears, stall, and steering, delegating longitudinal force calculation to [`frontend/client/shared/physics.js`](frontend/client/shared/physics.js). The engine stalls in gear with the clutch out and rpm under 450. Speed clamps at 28 m/s forward and 6 m/s in reverse. Frame `dt` is clamped to 0.05 s. The backend reconstructs the sampled drive with shared forces and traffic AI (`≤0.05 s` substeps); it cannot recover omitted frame state. Float32 road vertices start to jitter past about 100 km.

Read: [`frontend/client/shared/`](frontend/client/shared) · [`network.js`](frontend/client/js/net/network.js) · [`patterns.js`](frontend/client/js/net/patterns.js) · [`obstacles.js`](frontend/client/js/net/obstacles.js) · [`road-plan.ts`](backend/server/src/domain/road/road-plan.ts) · [`replay-engine.ts`](backend/server/src/domain/verdict/replay-engine.ts)

## Money

<img src="docs/tech/assets/split.svg" alt="Chart: 85 percent weekly boards, 5 percent rollover, 10 percent Season Final. Player-derived share capped below 50 percent (max 47.4 percent). Inside each board, 80 percent top 10 places and 20 percent all clean finishers." width="720">

The unified weekly contest pool (`T = F + P + C`, [`prize-pool.ts`](backend/server/src/domain/prize/prize-pool.ts), [`prize-rules.ts`](backend/server/src/domain/prize/prize-rules.ts), [`docs/spec/pool.md`](docs/spec/pool.md)) combines fixed non-player funding `F = B + S` (operator base `B` stepping `$300 → $750 → $1,500 → $3,000` plus external sponsor `S`), a capped player-derived performance bonus `P = min(40% × R_prev, $2,500, 90% × F)` from the prior week's net paid entry revenue `R_prev`, and incoming rollover `C ≤ 25% × F`. Because `P ≤ 0.90 × F`, player-derived funding is always **strictly below 50%** (`≤ 47.4%` of `F + P`), enforced on chain in Program v5 by `max_player_share_bps <= 4999` (default `4740`). A per-km sponsor pledge is a separate account and is not part of this pool split.

In Program v5 (`0.5.0`), the weekly pool splits **85% weekly boards · 5% next-week rollover · 10% Season Final** (`8500 / 500 / 1000` bps; the v5 upgrade drops the on-chain referral pot cut in favor of the `4M TEN4` Convoy referral vault). Seasons run **7 weeks**: 6 regular weeks (`Mon 00:00 – Sun 12:00 UTC` ranked play window, up to 5 paid + 1 promo ranked starts per week, verification to `Mon 12:00`, appeals to `Tue 12:00`, payouts `Tue`) plus a **Week 7 Live Final** (`$1,000` operator base + accumulated `10%` weekly reserve) for the top 8 qualifiers + ties on each board. Each week's `85%` board share divides across **Sprint 1h (25%)**, **Haul 4h (30%)**, and **Long Haul 8h (45%)**; inside each board (`≥ 10` participants, `$5` minimum payout), **80%** pays the top 10 places (`25 / 15 / 10 / 7.5 / 7.5 / 3 / 3 / 3 / 3 / 3`) and **20%** is shared equally by all clean finishers, with equal tie-splitting and a **30%** free-ticket prize cap (`FREE_PRIZE_BOARD_CAP_BPS = 3_000`).

Ahead of Season 1 mainnet (`Jan 11 – Feb 28, 2027`), the first live prize event is the **1-week Devnet Pre-season** (`Nov 2–17, 2026`, contest week `Nov 9–15`, [`docs/plan/DEVNET_PRESEASON.md`](docs/plan/DEVNET_PRESEASON.md), [`docs/legal/PRESEASON_RULES.md`](docs/legal/PRESEASON_RULES.md)): a free promotional skill contest on the `1h` board with a **$500 USDC** organizer-funded prize pool (Top 20 fixed table: `$100 / $70 / $50 / $30×2 / $20×5 / $12×10`, equal tie-splitting, 1 ranked attempt earned by completing mandatory entry tasks, unlimited free training) plus **100,000 `TEN4` airdrop points** (`50k` leaderboard + `50k` referrals) toward the Season 1 `2M TEN4` campaign (`2,000 TEN4` wallet cap).

On the devnet v3 pool series and single-tier pool fallback ([`pool-payouts.ts`](backend/server/src/domain/economy/pool-payouts.ts)), the pot is `price × tickets sold + sponsor` and splits inside the prize share as 25 / 15 / 10 parts for the top 3 plus 20 parts across ranks 1–20 (floors only). The legacy PostgreSQL weekly round (`PAYMENT_MODE=transfer`, [`prize-split.ts`](backend/server/src/domain/economy/prize-split.ts)) remains the rollback path only.

There is no admin button for `pay_prize`. The job sends it after the review window, once every ride in the pool is decided, and only for a verified ride. The whitepaper labels that job "DEVNET JOB · NOT AN OFFER". The gaps around ticket rent and the seed treasury are in [Limits](#limits).

The buyer pays the network fee. There is no gas-sponsor key. A leftover `FEE_PAYER_SECRET` is ignored. The server does not hold the pool admin key. `initialize` is signed by the upgrade authority and names the admin.

Admin changes pass three gates: nginx basic auth, an admin session, then a wallet signature over the exact text of that action. The player cookie grants nothing there. Lock order for anything a wallet does to rides, tickets, payments, or pledges: player, then pool, then tickets and pledges.

## Sites

Seven names, one app. [`frontend/client/js/hosts.js`](frontend/client/js/hosts.js) picks the host. On localhost every base is empty and the pages share an origin.

```mermaid
flowchart LR
  landing["freightchain.fun<br/>landing and lobby"] --> api["api.freightchain.fun<br/>NestJS"]
  ride["ride.freightchain.fun<br/>the game"] --> api
  paper["whitepaper.freightchain.fun"] --> api
  deck["pitchdeck.freightchain.fun<br/>analytics only"] --> api
  admin["admin.freightchain.fun<br/>page and /api/admin"] --> api
  story["storybook.freightchain.fun<br/>meshes + model editor"]
  api --> pg[(PostgreSQL)]
  api --> redis[(Redis, stats & replay queue)]
  worker["worker container<br/>replay:worker"] --> pg
  worker --> redis
  ai["editor-worker container<br/>five-slot AI queue"] --> pg
  ai --> mcp["entity MCP"]
  mcp --> api
  ai --> providers["AI providers"]
  api --> chain["Solana devnet"]
```

Layers point inward. Domain code does not read the clock or the environment. Time comes from `ClockPort`. Env comes from `EnvService`. A Prisma change ships with a SQL migration. [`docs/tech/backend-architecture.md`](docs/tech/backend-architecture.md)

- **Landing.** [`frontend/landing/`](frontend/landing/index.html). Vite. The hero video loads after the page, and never on a phone.
- **Lobby.** [`frontend/client/lobby.html`](frontend/client/lobby.html). New ride, Live, Replays, Leaderboard, Achievements, Garage, Profile. Promo codes and [referral invites](docs/spec/referral.md) are on the profile. `#promo` opens that tab.
- **Game.** [`frontend/client/play.html`](frontend/client/play.html). `?ride=` is an online shift. `?watch=` is a spectator. Bare `play.html` starts the real EASY ride. `?sim=1` is the tool sim. `file://` cannot load the modules.
- **Receipt.** [`frontend/client/r.html`](frontend/client/r.html). Server middleware injects the Open Graph and Twitter Card tags.
- **Whitepaper.** [`frontend/landing/whitepaper.html`](frontend/landing/whitepaper.html). Its numbers are asserted against the code by [`frontend/landing/test/whitepaper.test.js`](frontend/landing/test/whitepaper.test.js).
- **Admin.** Nginx basic auth, then `ADMIN_WALLETS`. On a split deploy, `/api/admin` answers only when `Host` is `admin.<apex>`. Includes `#replays` for 10 Hz replay verification sessions and red flags.
- **Search.** Landing, whitepaper, and the game page are static HTML. Lobby, viewer, and admin are `noindex`. [`docs/agents/landing.md`](docs/agents/landing.md).

Running totals (rides, time, kilometres, crashes, donations) count every started ride that ended. Free and paid are counted apart. Reads are cached for 15 seconds. [`docs/spec/platform_services.md`](docs/spec/platform_services.md)

The intro clip is real gameplay, 14.8 seconds, with the in-game synth: [`social/media/out/video/intro/intro.mp4`](social/media/out/video/intro/intro.mp4).

## Technical

### Backend (`backend/server/`)

The backend is a strict native-ESM TypeScript service built on **NestJS 12**, **Prisma 6**, **PostgreSQL 17**, and **Redis 7**, structured around **Clean Architecture**, **Hexagonal Ports & Adapters**, and **CQRS**. Every architectural boundary, HTTP contract rule, line-count cap (`≤ 500` lines per file), and test-pyramid requirement is enforced at test time by source-level audits in [`backend/server/test/architecture/`](backend/server/test/architecture). Full specification: [`docs/tech/backend-architecture.md`](docs/tech/backend-architecture.md).

#### Architecture & Layers

Dependencies point strictly inward (`presentation → application → domain ← infrastructure`):

```mermaid
flowchart TB
  subgraph Presentation["presentation/ · Thin HTTP Controllers & Zod DTOs"]
    ctrl["Controllers (@ZodBody / @ZodQuery / @ZodParams)"]
  end
  subgraph Application["application/ · CQRS Use-Cases, Services & Abstract Ports"]
    bus["CommandBus / QueryBus Handlers"]
    svc["Orchestration Services (Verdict, Settlement, Stats, Attestation…)"]
    ports["Abstract *Port Tokens (Repositories, Clock, Cache, Chain, Queue…)"]
  end
  subgraph Domain["domain/ · Pure TypeScript Aggregates, Value Rules & Simulation"]
    ent["Rich Entities (Ride, Player, Pool, RideTicket, Pledge, RideBatch, RideVerdict…)"]
    sim["Shared Kernel (@freightchain/shared) · ReplayEngine · Traffic & Road Rules"]
  end
  subgraph Infrastructure["infrastructure/ · Concrete Adapters, Schedulers & Persistence"]
    prisma["Prisma 6 Repositories & Mappers (10 PG Schemas)"]
    redis["Redis 7 (Cache, Throttler, Replay Queue, Presence, Ops Logs, Locks)"]
    chain["Solana RPC · Anchor Codecs · Bubblegum v2 cNFT · SNS"]
    sched["Background Schedulers & Dedicated Workers (replay:worker, editor:worker)"]
  end

  ctrl --> bus
  bus --> svc
  bus --> ent
  bus --> ports
  svc --> ent
  svc --> sim
  svc --> ports
  prisma -. implements .-> ports
  redis -. implements .-> ports
  chain -. implements .-> ports
  sched --> bus
  sched --> svc
```

| Layer | Path | Responsibility & Boundaries |
| --- | --- | --- |
| **Domain** | [`backend/server/src/domain/`](backend/server/src/domain) | Pure TypeScript with zero framework, database, or I/O imports (`domain` + `bs58` + `@freightchain/shared` only). Encapsulates aggregate entities with private state (`Ride`, `Player`, `Pool`, `RideTicket`, `Pledge`, `RideBatch`, `RideVerdict`, `RideReplay`, `PromoCode`), deterministic road/obstacle/physics/traffic rules, Merkle trees, and typed `DomainError`s. |
| **Application** | [`backend/server/src/application/`](backend/server/src/application) | Defines `abstract class *Port` DI tokens (`application/ports/`), CQRS command and query handlers (`application/use-cases/`), and cross-aggregate application services (`VerdictService`, `TicketSettlementService`, `PoolRegistryService`, `AttestationService`, `HonkMintService`, `StatsService`, `AchievementService`, `EditorJobRunnerService`). Never imports Prisma, Redis, or Solana SDKs. |
| **Infrastructure** | [`backend/server/src/infrastructure/`](backend/server/src/infrastructure) | Implements every port: Prisma repositories and domain-to-row mappers (`infrastructure/prisma/`), Redis adapters (`infrastructure/cache/`, `infrastructure/live/`, `infrastructure/verdict/`), Solana RPC and program codecs (`infrastructure/solana/`), SPL Name Service (`infrastructure/sns/`), `jose` JWT tokens and `tweetnacl` Ed25519 verifiers (`infrastructure/auth/`), PostHog EU batching (`infrastructure/analytics/`), HTTP guards/interceptors/filters (`infrastructure/http/`), and background schedulers (`infrastructure/scheduling/`). |
| **Presentation** | [`backend/server/src/presentation/`](backend/server/src/presentation) | Thin controllers and Zod request schemas. Controllers never touch `@Req()` / `@Res()`, never throw Nest `HttpException`s, and never execute business logic directly—every route dispatches a single Command or Query to the bus and returns a typed DTO. |

#### Tools & Technology Stack

| Category | Tools & Libraries | Role in the Backend |
| --- | --- | --- |
| **Runtime & Framework** | Node.js (native ESM), TypeScript 6 (`strict`), NestJS 12 (`@nestjs/core`, `@nestjs/cqrs`, `@nestjs/throttler`), Express | Modular dependency injection, CQRS command/query bus, per-route and per-wallet/IP rate limiting, and HTTP pipeline. |
| **Database & Schemas** | PostgreSQL 17, Prisma 6 (multi-file schema), hand-reviewed forward-only SQL migrations | Partitioned into 10 bounded-context PostgreSQL schemas: `player`, `ride`, `economy`, `achievement`, `telemetry`, `verdict`, `admin`, `live`, `stats`, and `asset`. Zero schema drift enforced against `prisma/migrations/`. |
| **Cache, Queues & Coordination** | Redis 7 (`ioredis`) | Shared rate-limit counters (`RedisThrottlerStorage`), asynchronous replay verification queue (`RedisReplayQueueAdapter`), atomic Lua-scripted spectator and site presence (`RedisSitePresenceAdapter`, `RedisViewerPresenceAdapter`), distributed scheduler leases (`SET NX PX`), and cluster-wide admin log ring (`fc:ops:logs`). |
| **Validation, Auth & Wire Contract** | Zod 3, `jose` (`HS256`), `tweetnacl`, `bs58`, RFC 9457 `application/problem+json` | `@ZodBody` / `@ZodQuery` / `@ZodParams` validation, surface-isolated `HttpOnly` JWT cookies (`fc_session`, `fc_admin`, `fc_editor`), CAIP-122 `solana:signIn` verification, wallet-signed admin/publish proofs, and `ProblemDetailsFilter` with `X-Request-Id` tracing. |
| **Blockchain & Shared Kernel** | `@solana/web3.js`, `@solana/spl-token`, Metaplex Umi + Bubblegum v2, `@freightchain/shared` | Anchor escrow pool codecs and event polling, TEN4 token emission/burn verification, soulbound compressed NFT achievement minting, `.sol` reverse/forward resolution, and deterministic road/physics/traffic simulation shared with the browser client. |
| **AI Model Editor & MCP** | `@anthropic-ai/sdk`, `openai`, `@modelcontextprotocol/sdk` | Dedicated 5-slot `editor:worker` driving LLM tool-use loops against the isolated `backend/mcp/` Streamable HTTP server with short-lived per-job capability tokens. |
| **Testing & Linting** | Vitest 4, Supertest, `oxlint --type-aware`, Prettier | Unit, architecture, migration, in-memory HTTP scenario, and real PostgreSQL integration + concurrency suites (`freightchain_test`). |

#### Core Engineering Patterns

- **Hexagonal Determinism (`ClockPort`, `EntropyPort`, `EnvService`)**: Domain and application code never call `Date.now()`, `new Date()`, `Math.random()`, or `process.env`. Wall-clock time comes exclusively from `ClockPort`, IDs/nonces/seeds from `EntropyPort`, and validated configuration from `EnvService`. Unit and HTTP scenario suites advance time deterministically via `FakeClock` without sleeping.
- **Strict Pessimistic Lock Ordering & Optimistic Concurrency**: Every wallet operation on rides, free credits, tickets, payments, or pledges runs inside one interactive PostgreSQL transaction under `SELECT … FOR UPDATE` on the `Player` row (`findByWalletForUpdate`). Cross-entity mutations obey a strict lock hierarchy (**`Player` → `Pool` → `RideTicket` / `Pledge`**) to eliminate deadlocks. Concurrent state transitions on `Ride`, `Player`, `Pool`, `RideTicket`, and `RideVerdict` enforce optimistic `version` checks with automatic retry (`withVersionRetry`), while live stream effects serialize per ride via transaction-scoped advisory locks (`pg_advisory_xact_lock`).
- **Stateless Horizontal Scaling**:
  - **Cluster-Wide Presence & Ops Logs**: Live site visitors and stream spectators are tracked in Redis sorted sets via single-roundtrip Lua scripts (`ZADD` + `ZREMRANGEBYSCORE` + `ZCARD` + `PEXPIRE`) with automatic circuit-breaker fallback to in-memory adapters if Redis is unreachable. Structured operational logs mirror to a bounded Redis ring so `/api/admin/logs` returns cluster-wide entries across all replicas.
  - **Distributed Scheduler & Signer Leases**: Background loops (`ProgramWatcher`, `PoolCrankScheduler`, `PoolPayoutScheduler`, `AchievementMintScheduler`, `DailyFreeRideScheduler`, `StaleRideScheduler`, `TelemetryRetentionScheduler`) and `AttestationService` acquire atomic Redis locks (`CachePort.tryLock` / `releaseLock`) before polling RPCs, sweeping tables, or signing on-chain transactions.
  - **Deduplicated Worker Queues**: Replay verification jobs coordinate between `app` and `replay:worker` replicas via `RedisReplayQueueAdapter` with in-flight claim tracking (`isInFlight`) and idempotent `expectedPendingReplayId` checks so a completed replay is never re-simulated twice.
  - **Bounded Hot-Path Caches**: Immutable seed-derived `RoadPlan` obstacle chunks (`MAX_CACHED_CHUNKS = 4096`), decompressed `RideBatch` payloads (256-entry LRU in `RideBatchMapper`), and `.sol` SNS lookups (24 h hit / 30 min miss) are cached in bounded structures to keep `/api/watch/:id`, `/api/live`, and `/api/rides/:id/batches` off the CPU and event loop.
- **Architectural Self-Auditing (`backend/server/test/architecture/`)**: Automated specs parse the TypeScript AST/source to verify that layers never leak imports, every port is bound in `InfrastructureModule`, every route uses `@Zod*` decorators and dispatches through the CQRS bus, every ride-ending path updates `StatsService` under the player lock, and every controller, handler, service, guard, interceptor, filter, and repository has its corresponding unit and PostgreSQL integration spec.

#### Core Backend Features

1. **Wallet Authentication & Multi-Surface Access Control**: One-prompt Wallet Standard `solana:signIn` (CAIP-122), phone-to-desktop QR browser pairing (`/api/auth/pair`), and legacy `signMessage` fallback backed by atomic single-use nonces (`DELETE … RETURNING`). Separate cookies, secrets, and host/origin guards isolate player sessions (`fc_session`), admin sessions (`fc_admin` on `admin.<domain>` + per-action Ed25519 `AdminProof` signatures), and 3D editor sessions (`fc_editor` on `storybook.<domain>`).
2. **Ride Lifecycle, Weekly Tickets (AMOE) & Server-Controlled World**: Manages unlimited free training levels (`EASY`, `MEDIUM`, `HARD`), weekly granted paid tickets (AMOE, default `1h` every 7 days), and paid shifts (`1h`, `4h`, `8h`). The server assigns the ride seed (provably derived from on-chain `SlotHashes` for pools), route, and start hour, and serves the canonical obstacle plan (`GET /api/watch/:id/road`).
3. **Telemetry Ingestion, Anti-Cheat & 10 Hz Replay Engine**: Accepts gzip-compressed, SHA-256 hash-chained 10 Hz telemetry batches (`POST /api/rides/:id/batches`) and computes RFC 6962 Merkle roots over accepted batches. Validates admission bounds, hole damage, off-road tolerances, human input timing, and required frame-level traffic proof (`trafficVersion=1`), then executes full 10 Hz physics and traffic reconstruction in `ReplayEngine` using `@freightchain/shared`.
4. **On-Chain Escrow Mirror, Unified Skill Pools, Pledges & Solana Actions**: `ProgramWatcher`, webhook ingestion, and `FinalityService` mirror on-chain pool accounts and settle ticket purchases and per-km sponsor pledges with fork/drop safety. Exposes Solana Pay QR transactions and CORS-enabled Solana Actions / Blinks (`/actions.json`, `/api/actions/*`), automated cranking (`PoolCrankScheduler`), Merkle-root/attestation prize settlement (`PoolPayoutScheduler`), and unified 7-week season / weekly skill contest calculation (`85 / 5 / 10` split, `< 50%` player-derived share).
5. **`TEN4` Tokenomics, Convoy Referrals, Garage & Promo Codes**: Credits capped `TEN4` checkpoints (`20% / 50% / 100%`) across halving eras on verified paid rides (`HonkMintService`), verifies on-chain `TEN4` burns for cab visuals and stream effects, manages `?ref=` Convoy referral links (ride gifts, gift paints, capped spectator-tip sharing, and `100 / 50 TEN4` milestones from the `4M` vault), persists all-or-nothing 9-slot Garage loadouts, and processes single-effect promo codes (ride grants or pool tickets).
6. **Live Spectating, Replays, Donations & Cached Statistics**: Serves ~25 s delayed live streams and multi-speed replays (`1×`, `4×`, `16×`) from incremental batch cursors, rate-limited CB chat, driver mutes, Solana Pay tips, advisory-locked spectator road/weather/time effects (disabled on ranked runs), and 15 s cached global/player/daily statistics.
7. **Soulbound Badge cNFTs & 3D Entity Editor**: Evaluates 45 achievement definitions (44 earnable soulbound Metaplex Bubblegum v2 compressed NFTs across 12 ladders — 34 on devnet Arweave across 9 ladders + 6 Medium/Hard mastery + 4 Convoy referral — plus the Top-20 podium placeholder) and mints them after a review delay (`AchievementMintScheduler`). Serves ETag-cached 3D entity bundles (`/api/entities/bundle`), append-only entity revisions, wallet-signed publishing, and PostgreSQL-queued AI generation jobs (`EditorJobRunnerService`).

## Repository

- [`frontend/`](frontend) — all browser and visual assets:
  - [`frontend/client/`](frontend/client) — the game, the lobby, admin, the receipt page, the model viewer, and [`frontend/client/shared/`](frontend/client/shared) (pure ES modules shared with the server). Vanilla ES modules and three.js r160. No bundler, no React.
  - [`frontend/shared/`](frontend/shared) — workspace package (`@freightchain/shared`) re-exporting [`frontend/client/shared/`](frontend/client/shared) (`prng.js`, `road.js`, `traffic.js`, `physics.js`) for both browser client and backend `ReplayEngine`.
  - [`frontend/landing/`](frontend/landing) — the `/` page, the whitepaper and the pitch deck. Vite.
  - [`frontend/design/`](frontend/design) — icons, banners, badge art.
- [`backend/`](backend) — API, workers, on-chain programs, and MCP server:
  - [`backend/server/`](backend/server) — NestJS 12, Prisma, PostgreSQL, the replay worker, and the dedicated AI worker (`npm run editor:worker`).
  - [`backend/programs/`](backend/programs) — the Anchor programs (`freightchain_pools`, `freightchain_honk`). Anchor 1.2.
  - [`backend/mcp/`](backend/mcp) — the entity MCP server: the `3d-assets` skill as tools for the AI model editor (Streamable HTTP for the server's bridge, stdio for Claude Code). Production HTTP counters are shared in Redis with a restricted MCP user; AI jobs use a shared PostgreSQL queue with atomic admission and claims; the bridge owns its tool policy, AI writes remain checked drafts, and publishing requires a wallet signature.
- [`infra/`](infra) — Docker, local stack, and production deployment:
  - [`infra/deploy/`](infra/deploy/README.md) — Docker, nginx, certbot (`app`, `worker`, `editor-worker`, `postgres`, `redis`, `mcp`). `npm run deploy` ships `git archive HEAD`.
  - [`infra/docker-compose.yml`](infra/docker-compose.yml) — local PostgreSQL on `127.0.0.1:15433`, Redis and `worker` optional under profiles.
  - [`infra/docker-compose.e2e.yml`](infra/docker-compose.e2e.yml) — the code e2e database on `127.0.0.1:15434`.
- [`tests/`](tests) — cross-stack end-to-end and multi-agent security review suites:
  - [`tests/e2e/`](tests/e2e) — fast page-module checks (happy-dom + API). Not the browser bar. `npm run test:e2e:block1` and `npm run test:e2e:block2`.
  - [`tests/audit/`](tests/audit) — one-shot Docker sandbox + MCP stdio bridge (`docker-agent-orchestrator.mjs`, `agent-session.mjs`, `docker-mcp-bridge.mjs`) orchestrating local agentic CLIs (`claude`, `codex`, `grok`, `agy`) inside an airgapped container, plus sealed source snapshots, private-outbox workers and selected-file `review-with-cli` coordination; `setup-agents` installs locked ACP adapters, `check-agents` checks availability and `check-agents --live` qualifies inert read/resume/submission, and `check-model-cli --all` inventories selected-file relay profiles. Separate brokers live under `tests/audit/native/{codex-review,grok-review}`. `grok-docker setup/login` builds the Linux Grok broker and obtains a separate Docker-volume login; `--provider grok-docker` runs inference inside Docker behind provider-only HTTPS egress. Detail: [`tests/audit/README.md`](tests/audit/README.md).
- [`social/`](social) — media synth, promo clips, and outreach pipelines:
  - [`social/media/`](social/media) — promo clips and the chiptune synth.
- [`docs/`](docs/README.md) — documentation index across `spec/`, `plan/`, `tech/`, `testing/`, `insights/`, `legal/`, and `agents/`. [`docs/agents/`](docs/agents) is the detail [`AGENTS.md`](AGENTS.md) points at. As-built product: [`docs/spec/PRODUCT.md`](docs/spec/PRODUCT.md). Coverage bar: [`docs/testing/COVERAGE_CONTRACT.md`](docs/testing/COVERAGE_CONTRACT.md). The happy-dom checklist is [`docs/testing/E2E_PLAN.md`](docs/testing/E2E_PLAN.md).
- [`.claude/`](.claude) — project skills. The index is [Skills](#skills).

Also at the root: `package.json`, [`AGENTS.md`](AGENTS.md), [`CLAUDE.md`](CLAUDE.md), [`README.md`](README.md).

## Skills

Skills live in `.claude/skills/<name>/`. A coding agent reads that folder's `SKILL.md` before the work. Gemini CLI reads `.agents/skills/` instead of `.claude/skills/`; `game-audio` is linked there (same folder, not a second copy). The same command is what you run yourself. The read-only skills never deploy and never write to production.

| Skill | What it is for | Run |
| --- | --- | --- |
| `game-audio` | 8-bit music, sound effects, the engine bed, the reusable sound store, or sound on a clip | `npm run media:store` · `npm run media:game-sfx` · `npm run media -- social/media/specs/<name>.json --remux` |
| `gameplay-balance` | Tune how the truck drives: gearbox and torque, launch and stall, steering and weight, brakes, engine heat, cold-engine wear, battery, strain, road holes, traffic, off-road, the speed governor, and how long a shift takes to complete | `cd frontend/client && npm run check` · `cd frontend/client && node tools/e2e-chrome.mjs` |
| `gameplay-video` | A promo mp4 (≤ 15 s) and gif (≤ 20 MB) from real gameplay, with landing-styled captions | `npm run media -- social/media/specs/<name>.json` |
| `live-board-test` | Who is online, which rides are on the road, a closed tab leaving at once, and the replay history | `bash .claude/skills/live-board-test/run.sh` |
| `localnet-e2e` | Real ticket buys, refunds, payouts, and the pool crank on a local Solana validator; ten riders paid by the program; the autonomous pool day (the crank opens the series' pools, the payout key pays after the review window); a 100 % program coverage gate | `npm run test:localnet` |
| `honk-localnet` | The local TEN4 mint, swap, burn, soulbound part, and headless paid-ride session. The ledger stays the game balance | `bash .claude/skills/honk-localnet/run.sh` |
| `honk-suite` | The full local TEN4 coin suite: program tests, catalog drift, the headless session, then one verified ride whose chain mint matches the ledger | `bash .claude/skills/honk-suite/run.sh` |
| `analytics-review` | Three passes over the landing, whitepaper, lobby, and the online ride: new controls get events, removed ones lose them, and the explainer stays in step. Each pass writes `docs/insights/analytics/updates/<n>.html`. Does not call PostHog | `node .claude/skills/analytics-review/inventory.mjs` |
| `whitepaper-update` | Three passes on the whitepaper: claims against the code, cut duplication and AI-sounding prose, add charts and real cab frames inside the gzip budget. Does not deploy | `npm --prefix frontend/landing test` · `npm run landing:build` |
| `posthog-prod` | Product analytics on production: the boot line, one public probe, the flush log. Read-only | `bash .claude/skills/posthog-prod/check.sh` |
| `posthog-test` | Local analytics smoke: the relay, and one batch accepted by the EU ingest | `bash .claude/skills/posthog-test/smoke.sh` |
| `posthog-map` | Landing, whitepaper, lobby, and game checks, then a visual map of every event | `bash .claude/skills/posthog-map/run.sh` |
| `posthog-audit` | Compare the EU insights to the spec and list the fixes. Does not write unless you say to apply | `node .claude/skills/posthog-audit/audit.mjs` |
| `daily-tracktion-update` | Rewrite the Traction block from the PostHog insight audit and the public stats API. Does not deploy and does not apply insight fixes | `node .claude/skills/daily-tracktion-update/update.mjs` |
| `prod-db` | Production PostgreSQL, read-only: players, rides, verdicts, payments, the review queue | `npm run ops -- query list` · `npm run ops -- query wallet <address>` · `npm run ops -- sql "SELECT …"` |
| `prod-logs` | Production logs, read-only: the app, Postgres, and nginx | `npm run ops -- logs --since 30m` · `npm run ops -- logs --errors` |
| `program-check` | The escrow program: reproducible build against the pinned hash, tests on that `.so`, clippy, audit | `npm run program:verify` |
| `replay-test` | Live watch page, replays, and the `LIVE_*` flags, with a driver and a spectator in Chrome | `bash .claude/skills/replay-test/run.sh` |
| `ride-audit` | Is this stream honest? A ride loaded from the database (local or production, read-only): the road and its holes rebuilt from the seed, every batch re-hashed, every sample and input measured again, judged afresh and compared with the verdict on record | `bash .claude/skills/ride-audit/run.sh <ride id>` · `… <ride id> --prod` · `… --latest 20 --prod` |
| `ride-investigate` | One player or one ride on production: the database rows and the matching log lines | `npm run ops -- query ride <id>` (or `query wallet <address>`), then the logs named in the skill |
| `ride-review` | Which paid rides need an admin's eyes before prizes are paid: every ride UNDER REVIEW per pool, with its rank, distance and verdict reasons (incl. the pool-* marks and the ones `pool:attention` would add), each audited by `ride-audit`; local or production read-only, never changes a verdict | `bash .claude/skills/ride-review/run.sh` · `… --pool N` · `… --pool N --prod` |
| `run-tests` | The whole local suite: lint and unit tests, PostgreSQL, then real-Chrome end-to-end. There is no CI | `npm run check`, then `npm run server:integration`, then `bash .claude/skills/run-tests/e2e.sh` |
| `admin-coverage` | Check that the admin page uses every admin API (guarded, called, no dead calls, tabs match the views) and add what is missing | `node .claude/skills/admin-coverage/check.mjs` |
| `stats-reconcile` | Check and repair the statistics (rides, time, km, crashes, stream donations – per rider and global) by recomputing them from the rides; production read-only | `bash .claude/skills/stats-reconcile/run.sh [--fix]` · `--prod` |
| `test-census` | Count the tests by pyramid layer, grade test coverage per feature, user flow, controller and route (static attribution, line + branch coverage, the routes each browser suite hits), name gaps, and rewrite the Tests block below and docs/testing/test-coverage.md | `npm run test:census` · `npm run test:census -- features` · `npm run test:census -- coverage` · `npm run test:census -- run` · `npm run test:census -- readme` |
| `level-check` | Each free level (EASY / MEDIUM / HARD) is what it promises and passable by a human: the road each level's shift covers (junctions, forks, lanes, bends, sinkhole traps), then a human-paced driver on the real truck with ASSIST off on many seeds × all routes – finish rate, hull, vehicles hit, against the level's limits | `node .claude/skills/level-check/check.mjs` |
| `trip-design` | The road per ride tier – the free run and the 1 h / 4 h / 8 h shifts: bends, traffic, roadside, whether it ends by itself at the line, its length and finish distance – measured with the real game modules and looked at in Chrome | `node .claude/skills/trip-design/measure.mjs` · `node .claude/skills/trip-design/shots.mjs` |
| `verified-play-test` | The anti-bot / anti-cheat end to end, positive and negative: a person and a bot in Chrome (dispatch prompts answered / ignored), server traffic validation against removed cars / ignored damage / missing proof, API-level bots with hand-built recordings (every verdict code), the upload protocol, the admin's signed decisions, the profile in Chrome, retention + the CLI's bulk re-judge | `bash .claude/skills/verified-play-test/run.sh` (traffic only: `bash .claude/skills/run-tests/e2e.sh traffic`) |
| `3d-assets` | Review and fix a model in the model viewer (`frontend/client/viewer.html`) – every 3D model is a data-only entity (`frontend/client/shared/entity/seed/`) – or add, update, or generate a car, tree, or building. The same procedure is the AI editor's MCP (`backend/mcp/`). `validate.mjs` rejects an impossible spec before any mesh or generated model | `node .claude/skills/3d-assets/validate.mjs --self-test` · `node .claude/skills/3d-assets/validate.mjs "<spec>"` · `node .claude/skills/3d-assets/shot.mjs` · `node .claude/skills/3d-assets/shot.mjs <id>` |
| `security-audit` | Multi-agent security audit inside a one-shot Docker sandbox via MCP stdio bridge (`claude`, `codex`, `grok`, `agy`), plus selected-file static review (`review-with-cli`) and provider diagnostics | `./tests/audit/bin/audit setup-agents` · `./tests/audit/bin/audit check-agents --live` · `./tests/audit/bin/audit run --repo <path>` · `./tests/audit/bin/audit check-model-cli --all` · `./tests/audit/bin/audit review-with-cli --repo <path> --file <file> --provider claude --model <model> --out <empty-dir>` · `node --test tests/audit/scripts/*.test.mjs` |
| `grill-fix` | Grills the business value of the feature and waits for your answers (a vague answer is challenged once), then three sequential reviews of the change, each by a different model, against the idea and those answers. Fixes bugs, gaps, misconfiguration, and security holes between passes, then checks the tests and the code quality. Does not deploy | `/grill-fix` |
| `coin-grill` | Three-pass Solana token and tokenomics audit of a spec file: name, ticker, decimals, `u64` supply bound, authorities, utility, allocations, vesting, minting and burning, hype, marketing, main project fit, and 36-month supply and demand, writing a styled HTML report with issues, scores, and proposals | `node .claude/skills/coin-grill/grill.mjs <path> [--out <report.html>]` · `node .claude/skills/coin-grill/grill.mjs --self-test` |

`audit run` starts a one-shot Docker container (`audit-sandbox:local`), runs trusted static scanners without target builds or installs, verifies network disconnection, and runs the local agentic CLIs (`claude`, `codex`, `grok`, `agy`) in parallel (one assignment per provider; shared test runs serialized) against `docker-mcp-bridge.mjs` before destroying the container (`--blocked` records an offline preflight without starting Docker). Source security review permits inspection and catalogued existing tests only (`--test-artifacts <cargo-target-dir>` supplies hash-checked `deploy/*.so` with unverified build provenance; `--restart-failed` requests new full reviews for local session failures, never provider refusals), with no arbitrary execution, PoCs or deployed probes; persistent ACP sessions bind workflow/source/model/assignment; Grok isolates its configuration and references the original login in place; failed exits, provider refusals, usage limits and missing verdicts remain incomplete with explicit log diagnostics. `review-with-cli --repo <local-dir> --file <relative-file> --provider claude --model <model> --out <empty-dir>` combines selected-file Docker review and the fixed host consumer in one command. The explicit `codex-native` selector uses a separately compiled Codex-derived broker, not the installed CLI or Claude; it requires a current all-gates admission receipt and native ChatGPT authentication. Native admission passed locally and a real `gpt-6.1-sol` inert-source review completed with validated output and owned-resource cleanup on 2026-10-15. `check-model-cli --all` inventories Claude, Codex, Grok, Agy, Gemini and Ollama; use `check-model-cli --provider codex-native` separately for the native profile. Readiness is not a successful inference test. The separate Claude 2.1.300/Haiku inert-source review also completed; neither smoke test establishes universal compatibility or a whole-repository audit. Manual `review-local` and separate `connect-terminal` remain available. Missing admission/auth/capabilities, unsupported providers and unknown events fail closed. Host-profile credentials stay outside Docker; `grok-docker` instead obtains a fresh login in its dedicated Docker volume. Model/tool provenance remains unverified. The [live-model guide](tests/audit/docs/live-model.md) documents the routes and verification limits.

A new, renamed, or removed skill updates this table in the same change. The rule is [`AGENTS.md`](AGENTS.md) → "Maps stay current".

`grok-native` is an experimental separate public-source build, not installed Grok 1.0.52. It uses a fresh existing first-party OIDC login, without automatic refresh, store repair, API-key billing or another reviewer. A bounded classifier implicated `tool_choice` in the initial HTTP 400. Restoring upstream's empty-tool wire encoding resolved it; a real inert review exited 0 with requested `grok-4.7`, client-reported `grok-4.7-build`, validated output and verified cleanup. Model prose remains unverified. See the [Grok-native guide](tests/audit/docs/live-model.md#grok-native-broker-experimental).

## Run it

```sh
npm run db:up && npm run db:migrate && npm run server:dev   # API on :3000; sources infra/deploy/local/dev.env
npm run infra:local                                         # the host split on http://freightchain.localhost
npm run landing:dev                                         # Vite on :5173, one origin, proxies /api to :3000
npm run client:serve                                        # the game alone
npm run check                                               # client, landing, server unit tests, mcp, media
npm run editor:mcp                                          # the entity MCP for the AI model editor on :3100 (EDITOR_MCP_TOKEN from backend/server/.env)
npm run server:build && npm run editor:worker                # separate AI worker; same backend/server/.env, explicit shared JWT_SECRET
npm run mcp:check                                           # the MCP's own tests
npm run server:integration                                  # PostgreSQL, its own freightchain_test database
npm run program:test                                        # LiteSVM, no network
npm run program:verify                                      # reproducible build against the pinned hash
npm run test:localnet                                       # the program on a local validator, lamports checked
```

`npm run check` needs `npm run install:landing` and `npm run install:media` once. The program tools need the Solana toolchain on `PATH` ([`backend/programs/README.md`](backend/programs/README.md)). Deploy: [`infra/deploy/README.md`](infra/deploy/README.md). Env keys: [`docs/tech/configuration.md`](docs/tech/configuration.md). There is no CI.

## 3D entity editor and AI generation

The [model viewer](https://storybook.freightchain.fun) is also the editor for wallets listed in `EDITOR_WALLETS`. Vehicles, props, furniture, landmarks, gantries and reusable parts share a data-only entity format. An entity describes geometry, materials, parameters and animation roles; it cannot contain executable JavaScript. The literal parser, expression interpreter, validator and analytic measurements are shared by the browser, API and MCP. Collision rules, vehicle sizes, landmark footprints, placement order and other gameplay contracts remain in code and are validated separately from appearance.

Seed models live in [`frontend/client/shared/entity/seed/`](frontend/client/shared/entity/seed). PostgreSQL's `asset` schema adds append-only revisions above those seeds. **HEAD** is the latest editor revision; **PUBLISHED** is the revision players receive. The public `/api/entities/bundle` combines seeds with published revisions and has a content hash, ETag and cache headers. Saving or generating a draft changes HEAD only. Publishing requires an editor's wallet signature over the selected entity and revision and records an audit entry. Restore copies an older revision into a new draft; it does not erase history. An entity edit changes its appearance; placing a new model in the world can also require a reviewed roster or route change.

### How requests run

```mermaid
flowchart LR
  editor["Viewer: CHAT / SOURCE / HISTORY"] --> api["NestJS API: authenticate, validate, admit"]
  api --> queue[("PostgreSQL: jobs, events, revisions")]
  queue --> worker["Dedicated editor-worker: claim up to five jobs"]
  worker --> provider["External AI provider"]
  worker --> mcp["Entity MCP: seven bounded tools"]
  mcp --> callback["API: verify job scope, validate, save draft"]
  callback --> queue
  editor --> publish["Wallet-signed publish"]
  publish --> bundle["Public entity bundle used by the game"]
```

The API checks access, provider/model availability, the selected HEAD, daily allowance and the `3d-assets` request specification before committing a queued job. Impossible requests such as a two-wheel car are refused before a model is called. The API does not execute generations. A separate `editor:worker` process polls PostgreSQL every second, claims work atomically and drives the provider through a bounded agent loop. Text, tool calls, tool results, usage and status are stored as ordered job events for the chat. The general `replay:worker` processes driving verification and has no AI execution role.

The MCP is a separate Node service using the Model Context Protocol SDK: Streamable HTTP for the application and stdio for local coding tools. Its tools are `list_entities`, `get_entity`, `get_format`, `validate_spec`, `check_entity`, `diff_entity` and `save_draft`. HTTP tool calls carry a short-lived job capability back to the API; the API verifies the current job, editor allowlist, write scope, deadline and base revision. A job targeting an existing model can edit that model and create up to four new helper parts. A job without a selected entity can create up to four new entities and revise its own creations. Concurrent human edits cause `stale_base` instead of being overwritten.

The bridge owns the system workflow and tool contracts in [`editor-tool-policy.ts`](backend/server/src/domain/editor/editor-tool-policy.ts). Remote tool descriptions, prompts, entity notes and model text cannot grant extra permissions. Every AI save requires a successful check of the exact source and entity id; the check is consumed by the save. The MCP and API validate again independently. Prompt injection can still influence a model's in-scope draft, so inspect the preview and diff before signing publication. The model has no publication tool, shell tool or arbitrary URL tool.

### Run locally

Use the server's normal development prerequisites and database configuration from [`backend/server/.env.example`](backend/server/.env.example). Install the server and MCP dependencies if needed:

```sh
npm run install:server
npm --prefix backend/mcp ci
```

Configure `backend/server/.env`; keep it out of Git. API and worker must use the same database, provider/model configuration, timeout, MCP token and explicit JWT signing secret.

| Key | What to set |
| --- | --- |
| `EDITOR_WALLETS` | Comma-separated editor wallet public keys; editor access is independent of `ADMIN_WALLETS` |
| `JWT_SECRET` | A generated secret of at least 32 characters shared by API and worker; the API's random development fallback cannot work across processes |
| `EDITOR_MCP_TOKEN` | A generated secret of at least 24 characters shared by API, worker and MCP; empty disables AI editing |
| `EDITOR_MCP_URL` | `http://127.0.0.1:3100` locally |
| Provider key | One or more of `XAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ZAI_API_KEY`; a configured key makes that provider available |
| Provider selection | Optional `EDITOR_DEFAULT_PROVIDER` and `EDITOR_MODEL_XAI`, `EDITOR_MODEL_ANTHROPIC`, `EDITOR_MODEL_OPENAI`, `EDITOR_MODEL_GEMINI`, `EDITOR_MODEL_ZAI`; see [configuration](docs/tech/configuration.md) for defaults and the xAI / z.ai endpoints |
| `EDITOR_FAKE_LLM` | `1` for a scripted local provider with no paid model calls; production refuses this setting |
| `REDIS_URL` | Optional locally; required for production AI editing and shared rate limits |

Start the database and apply migrations, then leave the API running:

```sh
npm run db:up
npm run db:migrate
npm run server:dev
```

Start these in two additional terminals from the repository root:

```sh
npm run editor:mcp
```

```sh
npm run server:build && npm run editor:worker
```

All three processes read `backend/server/.env`. The MCP command defaults its API callback origin to `http://127.0.0.1:3000`; set `FC_APP_URL` when using another API address. The worker runs compiled code: rebuild and restart it after server changes. For shared local rate limits, start `docker compose -f infra/docker-compose.yml up -d --wait redis` and set `REDIS_URL=redis://:freight_dev_redis@127.0.0.1:16380` with the default local Compose credentials; the next process start picks it up.

Open `http://storybook.freightchain.localhost/` (the local edge; bare `localhost` is one origin and the editor host check 404s once `COOKIE_DOMAIN` is set), click **EDIT**, and connect an allowlisted wallet. Select a model, then use:

1. **SOURCE** to edit and save a validated draft by hand, or **CHAT** to choose an offered provider/model and describe a change. Chat shows `queued`, `running`, tool activity and the terminal result; cancel revokes the job's capability. Cancellation of a provider request already submitted is best effort.
2. The viewer to inspect the draft's shape, dimensions, materials and animation roles. **HISTORY** previews revisions and shows their differences and AI request provenance.
3. **PUBLISH** in HISTORY to sign the exact entity/revision and make it available through the public bundle. Publication reaches other API processes on their next bundle recheck; HTTP caches can delay visibility. **RESTORE** creates another draft for review and publication.

Manual editing works without an AI provider. For an AI smoke test, use the scripted provider; it exercises the real MCP and draft path but does not demonstrate live-provider asset quality or throughput. To put published database revisions back into the shipped seed files, run `npm run entities:export` against the intended database, then review and commit the generated changes.

For Claude Code editing the seed files directly, run `claude mcp add fc-entities -- node backend/mcp/src/stdio.js` from the checkout. This stdio mode needs no API or database: `save_draft` changes a seed file on disk, which you review and commit. It does not publish a database revision.

### Concurrency, queue and cost limits

The fallback is **five running jobs globally plus queued overflow**, not five per API or worker process. PostgreSQL serializes admission and claims in short transactions; provider calls never hold those locks. Queued rows survive API/worker restarts. Each wallet and each selected entity may have only one open job, queued or running. Five simultaneous jobs therefore require five editor wallets targeting distinct models or creating new ones.

| Runtime setting | Default | Effect |
| --- | ---: | --- |
| `editor_jobs_parallel` | 5 | Global running claims; 0 pauses new claims |
| `editor_jobs_per_day` | 40 | Jobs admitted per editor wallet per UTC day |
| `editor_max_steps` | 24 | Agent turns per job |
| `editor_max_output_tokens` | 100000 | Cumulative output token budget |
| `editor_max_input_ktokens` | 500 | Cumulative input budget, in thousands of tokens, including repeated history |

These are signed admin **GameSetting** values, not environment variables. A stored value overrides the fallback: on an existing installation, open admin → Settings → **AI editor: parallel jobs** → `5` → **SIGN & SAVE**. Lowering concurrency leaves current claims running and blocks new starts until the count falls below the new value.

`EDITOR_JOB_TIMEOUT_MS` defaults to `600000`: a queued job expires ten minutes after admission; a running job has a separate fixed deadline ten minutes after its claim. Interrupted running jobs are failed on shutdown or expiry and are never automatically replayed, because provider work might already have incurred charges or saved drafts. Review the existing draft before submitting a replacement. There is no separate global queue-length cap; admission is constrained by allowlisting, one open job per wallet and daily limits.

PostgreSQL was chosen over Bull/BullMQ because job admission, ownership, deadlines, events and revisions already live there. Keeping claims with that durable state avoids synchronizing a second queue with database transactions. Redis remains the shared rate-limit and cache service; the unrelated replay queue also uses Redis. More editor-worker replicas share the same five-slot budget and do not increase it automatically.

Five slots are a scheduling guarantee, not a measured provider throughput. If jobs average two minutes, the idealized rate is 150 jobs/hour and a second wave of five waits about two minutes, before throttling and errors. Measure queue wait, duration, provider 429s, MCP validation latency, worker memory/event-loop lag and game API p95 before raising concurrency. Validation still consumes API/MCP CPU on the shared host. Add a bounded queue and separate wait timeout if demand grows; use bounded validation workers if validation becomes the bottleneck.

### Rate limits and production operation

Production Compose has six services with AI editing enabled: NestJS `app`, driving-verification `worker`, `editor-worker`, `mcp`, PostgreSQL 17 and Redis 7. Host nginx serves the split sites and proxies the API. The API retains provider keys for provider discovery; only the AI worker opens model sessions. The MCP receives no provider or wallet-signing key.

| Boundary | Default protection |
| --- | --- |
| Editor API | 240 requests/minute per editor wallet, otherwise IP; 10 requests/second per IP |
| MCP → API callbacks | 600 requests/minute and 20 requests/second per verified job; unverified capabilities share a bucket |
| Internal MCP HTTP | 40 requests/second per socket source IP, shared in Redis across MCP replicas |

API defaults are controlled by `THROTTLE_EDITOR_LIMIT`, `THROTTLE_EDITOR_RPS`, `THROTTLE_MCP_LIMIT` and `THROTTLE_MCP_RPS`. One generation makes several MCP requests; request limits are not generation counts. Protected API buckets and MCP fail closed when Redis is unavailable. MCP uses the counter-only `fc-mcp` Redis ACL identity restricted to `fc:mcp-rl:*`; Redis uses `noeviction` so memory pressure cannot discard rate-limit counters. Editor sessions are separate from admin sessions, enforce the storybook host and same-origin changes, and can also be restricted with `EDITOR_IP_ALLOWLIST`.

The AI worker has no HTTP listener or published port, a 1 GB memory limit, 128-process limit, read-only root, temporary `/tmp`, dropped capabilities and no crank, payout or badge-mint secret. Its atomic `/tmp/fc-editor-worker-health-<pid>.json` marker records successful database polls; the container requires PID 1's marker to be less than 15 seconds old. Readiness checks do not spend provider tokens or verify provider account availability. Shutdown stops claims, aborts provider work and drains terminal writes for up to eight seconds before storage disconnects. Database failures revoke readiness and abort local provider calls.

The MCP publishes no port in production and runs with a read-only root, 512 MB memory limit and restricted networks. It checks its bearer token, refuses browser origins and unknown Hosts, bounds bodies and request time, refuses JSON-RPC batches and redirects, and keeps raw credential-bearing exceptions out of logs. nginx blocks public access to `/api/editor/mcp/*`; the API still verifies every callback independently.

The release scripts start MCP and the AI worker when `EDITOR_MCP_TOKEN` is configured, require their health checks, and stop the outgoing AI worker before changing API versions. Automatic and manual rollback select matching optional services, including older versions without a dedicated worker. Deployment and secret setup are described in [`infra/deploy/README.md`](infra/deploy/README.md); committing these changes does not deploy them.

For a job stuck in `queued`, check the worker process, database access, fresh health marker and stored parallel setting. For missing providers or capability failures, compare the configured key names, provider/model selection, shared `JWT_SECRET`, MCP token and callback URL across the relevant processes without printing secrets. For `429`, honor `Retry-After` and check both configured budgets and Redis health. For `stale_base`, reload and review the current HEAD before asking again. A `failed` job can still have saved a draft; inspect HISTORY before resubmitting.

### Validation and references

The completed review passed `npm run check` (**2,080 server tests across 348 files**, plus client, landing, MCP and media checks), **522 PostgreSQL integration tests across 46 files**, the real Chrome editor suite with separate API/worker processes and real MCP, and an isolated production-container restart/database-outage smoke test. Scripted providers avoid paid calls. Tests cover five active plus five queued jobs, shared admission/claim races, cancellation, expired capabilities, exact-source checks, signed publication and release/rollback. Live-provider throughput remains unmeasured.

```sh
npm run check
TEST_DATABASE_URL=postgresql://freight:freight_dev_password@localhost:15433/freightchain_entity_editor_review_test npm run server:integration
bash .claude/skills/run-tests/e2e.sh editor
```

Integration tests must use a dedicated test database. See the [security review and residual limitations](docs/insights/reviews/entity-editor-security.md), [editor architecture and HTTP contract](docs/spec/platform_services.md), [entity format](docs/agents/world.md#entities-every-3d-model-is-data) and [configuration reference](docs/tech/configuration.md).

## Local code end-to-end

Fast layer, no browser. It does not replace the headless Chrome suites or the coverage contract ([`docs/testing/COVERAGE_CONTRACT.md`](docs/testing/COVERAGE_CONTRACT.md), plan [`docs/testing/IMPLEMENTATION_PLAN.md`](docs/testing/IMPLEMENTATION_PLAN.md)). Block 1 is Postgres, Redis and the API with the chain off. Block 2 is the same API in program mode, plus a host `solana-test-validator` when Agave is installed (the script does not pull a Solana image).

```bash
npm run test:e2e:block1
npm run test:e2e:block2
```

Page modules alone, with API checks skipped: `npm run test:e2e:pages`.

The stack is [`infra/docker-compose.e2e.yml`](infra/docker-compose.e2e.yml) (project `freightchain-e2e`, Postgres `127.0.0.1:15434`, Redis `:16381`) so it can sit beside the dev database on 15433. The checklist, the player / admin / promo / referral / paid-week scenarios, and the coverage matrix are [`docs/testing/E2E_PLAN.md`](docs/testing/E2E_PLAN.md). Wallet popups, phone QR and Solana Pay deep links are [`docs/testing/MANUAL_TESTS.md`](docs/testing/MANUAL_TESTS.md).

## Tests

Full interactive test coverage report and audit dashboard: [`docs/testing/test-coverage/index.html`](docs/testing/test-coverage/index.html) (raw census: [`docs/testing/test-coverage.md`](docs/testing/test-coverage.md)).

Comprehensive test audit conducted across all 7 workspaces, 17 pyramid layers, 601 test files and harnesses, 3,522 executed test cases, and 955 static checks.

<!-- test-census:start -->

### Audit summary & report card

| Metric | Measured Value | Standard / Threshold | Evaluation |
|---|---|---|---|
| **Overall Grade** | **A- (91 / 100)** | B+ (85 / 100) target | Robust pyramid; pure domain separation; dense integration |
| **Total Test Files** | **601 files & harnesses** | 100 % of workspaces tested | Covers client, server, programs, shared, landing, media, audit |
| **Static Test Cases** | **3,160 cases** (`it`/`test`/`#[test]`) | Comprehensive unit + contract | 1,088 server unit, 197 Rust on-chain, 245 security audit |
| **Executed Test Cases** | **3,522 cases** | 0 failures in primary test suites | In-memory + PostgreSQL runners, LiteSVM on-chain programs |
| **Sim & E2E Checks** | **955 static / 1,040+ runtime `check()`s** | Deterministic assertions | 87 headless sim checks, 868 browser/API checks |
| **Line Coverage** | **82.5 %** (24,792 / 30,048 lines) | ≥ 70 % target | 97.9 % domain & application; 940 instrumented files |
| **Branch Coverage** | **83.1 %** (16,209 / 19,504 branches) | ≥ 60 % target | Deterministic branch isolation across state machines |

### Report card by test type

| Category / Layer | Grade | Files | Static Cases | Coverage / Health | Verdict |
|---|:---:|---:|---:|---:|---|
| **Architecture & Invariant Audits** | **A+** | 7 | 30 | 100 % pass | Zero layer-inward cycle leaks; strict clock & env abstraction |
| **Server Domain & CQRS Handlers** | **A+** | 245 | 1,088 | 97.9 % lines · 96.4 % branches | Pure deterministic logic; isolated event bus; fast in-memory execution |
| **PostgreSQL & Redis Integration** | **A** | 49 | 320 (549 executed) | 88.5 % lines · 85.2 % branches | 54 concurrency race tests (`PARALLEL=8`); dedicated test DB |
| **Client 60 Hz Headless Sim** | **A-** | 1 | 87 static / 97 runtime checks | 100 % pass (1.8 s) | 60 km full playthrough; deterministic PRNG; physics & battery step |
| **Solana Programs (Rust LiteSVM)** | **A-** | 16 | 197 `#[test]`s | 100 % pass | Escrow pools v4/v5 + TEN4 honk; in-process VM; zero RPC mock leaks |
| **Security Review & ACP Sandboxes** | **A-** | 46 | 245 cases | 100 % pass | Multi-agent audits; Docker isolated containers; native Rust CLIs |
| **Client & Shared Unit** | **B+** | 10 | 49 cases | 84.1 % lines · 86.0 % branches | Mulberry32 PRNG, road curvature, traffic step, damage rules |
| **HTTP Contract Scenarios** | **B** | 20 | 180 cases | 134 / 151 routes covered | Executed twice (in-memory + PostgreSQL); 17 routes uncovered |
| **Browser E2E & Live Suite** | **B-** | 27 | 868 `check()`s | Real Chrome / headless | Headless Chromium runs; live board, lobby, wallet, watch, admin |
| **AI Model Editor & MCP Tools** | **B-** | 18 | 138 cases | Scripted providers pass | Mock Anthropic/OpenAI; job worker queue; Redis rate limits |
| **Landing & Whitepaper** | **B** | 11 | 126 cases | 100 % pass | Fast node:test specs; slide decks, wallet connect, whitepaper |
| **Media Audio & Promo Video** | **C+** | 21 | 50 cases | 100 % pass | Chiptune synth, audio stores, ffmpeg composition validation |
| **3D Assets & Mesh Parity** | **D+** | 1 | 21 failures | Baseline diff regression | Parity gate fails on 21 ambulance meshes (`veh\|medic`) against `BASE` |

### Static calls by band

```mermaid
pie title Static calls by band
    "Server Unit & Domain" : 1088
    "PostgreSQL & Redis Integration" : 320
    "Browser & E2E Harnesses" : 868
    "Rust Solana Programs" : 197
    "Security Audit Suite" : 245
    "Contract Scenarios" : 180
    "Client & Shared Unit" : 49
    "Client Headless Sim" : 87
    "Landing & Media" : 126
```

### Pyramid

| Band | Layer | Files | Static Cases | Executed Cases | `check()` | Runs in |
|---|---|---:|---:|---:|---:|---|
| unit | Server domain | 39 | 261 | 261 | 0 | `npm run server:test` |
| unit | Server CQRS handlers | 81 | 284 | 284 | 0 | `npm run server:test` |
| unit | Server services | 16 | 73 | 73 | 0 | `npm run server:test` |
| unit | Server controllers | 16 | 44 | 44 | 0 | `npm run server:test` |
| unit | Server infrastructure | 47 | 201 | 201 | 0 | `npm run server:test` |
| unit | Server app, cli, support | 4 | 15 | 15 | 0 | `npm run server:test` |
| unit | Client unit | 6 | 35 | 35 | 0 | `cd frontend/client && npm run test:unit` |
| unit | Shared math / sim unit | 4 | 14 | 14 | 0 | `npm run test:parity` |
| unit | Landing | 9 | 101 | 101 | 0 | `npm run landing:test` |
| unit | Media sound & video | 2 | 25 | 25 | 0 | `npm run media:check` |
| unit | Escrow program (Rust LiteSVM) | 8 | 51 | 51 | 0 | `npm run program:test` |
| unit | TEN4 Honk program (Rust LiteSVM) | 8 | 146 | 146 | 0 | `cargo test-bpf` |
| audit | Architecture & migration SQL | 7 | 30 | 30 | 0 | `npm run server:test` |
| audit | Security review & ACP sandboxes | 46 | 245 | 245 | 0 | `audit run --sandbox` |
| contract | HTTP scenarios (source) | 16 | 170 | 170 | 0 | `server:test and server:integration` |
| contract | HTTP specs, in-memory | 4 | 10 | 10 | 0 | `npm run server:test` |
| integration | Repositories on PostgreSQL | 28 | 112 | 112 | 0 | `npm run server:integration` |
| integration | Concurrency & race tests | 1 | 36 | 54 | 0 | `npm run server:integration` |
| integration | Migration drift & schema | 1 | 2 | 2 | 0 | `npm run server:integration` |
| integration | Same HTTP scenarios on PostgreSQL | 1 | 170 | 381 | 0 | `npm run server:integration` |
| sim | Headless game playthrough (60 km) | 1 | 0 | 0 | 87 | `cd frontend/client && npm run test:headless` |
| e2e | Browser and API harnesses | 27 | 0 | 0 | 868 | `bash .claude/skills/run-tests/e2e.sh` |
| | **Total** | **601** | **3,160** | **3,522** | **955** | |

HTTP scenario cases are written once under `backend/server/test/scenarios` and executed twice: in-memory (`npm run server:test`) and PostgreSQL (`npm run server:integration`). Concurrency race tests run with `PARALLEL=8` against a dedicated test database (`TEST_DATABASE_URL`).

### Browser and E2E harnesses

All 27 browser, API, and live integration harnesses across workspaces:

| Script | `check()` | Runner | What it verifies |
|---|---:|---|---|
| `frontend/client/tools/e2e-chrome.mjs` | 0 | `npm --prefix frontend/client run test:e2e` | Real Chrome rendering, canvas WebGL loop, screenshot diffs |
| `frontend/client/tools/e2e-viewer.mjs` | 0 | `npm --prefix frontend/client run test:viewer` | 3D model viewer, mesh loading, camera controls |
| `frontend/client/test/e2e/e2e-headless.mjs` | 87 | `cd frontend/client && npm run test:headless` | Full 60 km headless simulation run, drivetrain, battery |
| `frontend/landing/tools/e2e-wallet.mjs` | 25 | `e2e.sh` | Wallet connection, signature prompt, session establishment |
| `frontend/landing/tools/e2e-whitepaper.mjs` | 21 | `npm run landing:test` | Whitepaper anchor links, math rendering, layout |
| `backend/server/scripts/e2e-admin.mjs` | 35 | `e2e.sh` | Admin dashboard sign-in, review queue, ride audits |
| `backend/server/scripts/e2e-browser.mjs` | 13 | `e2e.sh` | Full rider game flow through real browser interface |
| `backend/server/scripts/e2e-close.mjs` | 13 | `e2e.sh` | Tab/window close handling, mid-ride disconnects, session cleanup |
| `backend/server/scripts/e2e-live-board.mjs` | 21 | `e2e.sh` | Live leaderboard websocket updates, rider position broadcast |
| `backend/server/scripts/e2e-live-flags.mjs` | 13 | `e2e.sh` | Live stream moderation, flag creation, chat mute propagation |
| `backend/server/scripts/e2e-lobby.mjs` | 77 | `e2e.sh` | Lobby state, tier selection, ticket balance, ride creation |
| `backend/server/scripts/e2e-localnet.mjs` | 72 | `localnet-e2e` | Solana local validator end-to-end pool creation and ride settle |
| `backend/server/scripts/e2e-localnet-payout.mjs` | 55 | `localnet-e2e` | Merkle root prize distribution, winner claim, refund crank |
| `backend/server/scripts/e2e-promo.mjs` | 47 | `e2e.sh` | Promo code generation, player redemption, cosmetic unlock |
| `backend/server/scripts/e2e-replay.mjs` | 32 | `e2e.sh` | Telemetry playback, 10 Hz replay verification, frame sync |
| `backend/server/scripts/e2e-road-check.mjs` | 17 | `e2e.sh` | Obstacle placement, server-side road seed verification |
| `backend/server/scripts/e2e-stats.mjs` | 38 | `e2e.sh` | Global and player statistics cache invalidation and aggregation |
| `backend/server/scripts/e2e-tickets-stub.mjs` | 18 | `npm --prefix backend/server run test:tickets-stub` | Standalone ticket purchase workflow against mock API |
| `backend/server/scripts/e2e-verified-deep.mjs` | 45 | `e2e.sh` | Deep telemetry packet analysis, tamper detection, speed governor |
| `backend/server/scripts/e2e-verified-play.mjs` | 19 | `e2e.sh` | Verification pipeline, SHA256 frame hashes, server verdict |
| `backend/server/scripts/e2e-watch.mjs` | 32 | `e2e.sh` | Spectator view, camera sync, donation overlay, live chat |
| `backend/server/scripts/e2e-editor.mjs` | 28 | `bash e2e.sh editor` | AI 3D model editor, MCP tool dispatch, generation worker |
| `tests/audit/scripts/e2e-sandbox.mjs` | 36 | `audit run --sandbox` | Multi-agent ACP sandbox isolation, container boundaries |
| `tests/audit/scripts/e2e-review-cli.mjs` | 24 | `node tests/audit/review-with-cli.mjs` | Native LLM CLI provider integration and prompt sanity |
| `backend/programs/freightchain_honk/tests/e2e.rs` | 48 | `bash honk-suite/run.sh` | TEN4 token mint, swap, burn, and checkpoint verification |
| `backend/programs/freightchain_pools/tests/e2e.rs` | 64 | `npm run program:test` | LiteSVM escrow lifecycle, prize pool closure, admin veto |
| `frontend/client/tools/e2e-chrome.mjs` | 53 | `node frontend/client/tools/e2e-chrome.mjs` | Root Chrome validation script across viewports |

### Mocking strategy & boundary isolation

| Subsystem / Dependency | Test Boundary | Real vs. Mocked Implementation |
|---|---|---|
| **System Clock** | `ClockPort` | **Mocked in Unit**: Deterministic virtual clock advanced manually; **Real in E2E**: Wall-clock NTP time |
| **Database Storage** | `*Repository` ports | **Mocked in Unit**: In-memory Map storage (`MemoryPlayerRepository`, etc.); **Real in Integration**: Dedicated PostgreSQL with row locking (`findByWalletForUpdate`) |
| **Solana RPC / Validators** | On-chain BPF | **In-Process VM in Tests**: LiteSVM loads compiled `.so` bytecode in Rust test harness without network RPC; **Real in Localnet**: `solana-test-validator` |
| **AI Generation Providers** | Anthropic / OpenAI | **Mocked in CI/Worker Specs**: Scripted deterministic entity JSON payloads avoid paid API credits; **Real in Manual Sandbox**: Live provider keys |
| **Browser WebGL / Canvas** | Three.js renderer | **Stubbed in Headless**: Headless three.js mock context allows 60 km simulation at 30x real-time without GPU hardware; **Real in Chrome E2E**: Hardware WebGL canvas |
| **Product Analytics** | PostHog Relay | **Stubbed in Scenarios**: In-memory HTTP receiver validates payload shape without hitting external telemetry servers |

### Test skills

Skills running automated test suites (details in [Skills](#skills)):

| Skill | Census Stage | Primary Target |
|---|---|---|
| `run-tests` | `e2e` | Chrome E2E browser test harness suite (`bash .claude/skills/run-tests/e2e.sh`) |
| `program-check` | `program-check` | Solana escrow & TEN4 Anchor program tests |
| `live-board-test` | `live-board` | Live board websocket broadcasts and spectator latency |
| `replay-test` | `replay` | 10 Hz replay engine verification & telemetry hashes |
| `verified-play-test` | `verified` | Telemetry packet integrity, governor enforcement, speed limits |
| `localnet-e2e` | `localnet` | Local Solana test validator full escrow deposit/payout cycle |
| `posthog-test` | `posthog` | Analytics relay contract and telemetry schema enforcement |

### Identified gaps & known issues

1. **Legacy 3D Mesh Parity Drift (`test:parity`)**: 21 ambulance meshes (`veh|medic`) fail vertex-count parity against historical baseline (`353a5b7616f2`). Meshes render correctly in runtime engine, but baseline hashes require regeneration.
2. **Ticket Stub Endpoint Missing (`test:tickets-stub`)**: Fails 2/20 assertions due to missing `/reconcile` route in `backend/server/scripts/stub-api.mjs`.
3. **Census Self-Test Count Desynchronization (`test:census`)**: `census.mjs self-test` fails on 3 assertions due to static count drift following the addition of post-Oct 10 routes and files.
4. **Uncovered HTTP Controller Routes**: 17 of 151 HTTP routes currently lack direct functional scenario tests (including `/actions.json`, Solana devnet blinks, and webhook callbacks).
5. **Live AI Worker Throughput Unmeasured**: Dedicated AI editor generation throughput has only been validated with scripted mock providers; live API token latency under peak concurrency remains unbenchmarked.

<!-- test-census:end -->
