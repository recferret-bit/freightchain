# Freight Chain → Colosseum "Crypto World's Fair" – plan

The one plan file. Status as of **Tue Oct 7, 2026, end of day**, after a review of the whole app (code, tests, the live deploy, the production database) and a round of decisions with you (see [Decisions](#decisions-oct-7)). Built on the [Colosseum hackathon FAQ](https://colosseum.com/hackathon#faqs) and the prize figures on [colosseum.com/worldsfair](https://colosseum.com/worldsfair).

Deadline: **11:59pm PT, Oct 12, 2026** (runs Sep 14 – Oct 12). Working deadline stays **noon PT Oct 12**, so a broken demo can still be fixed. Five days left (Oct 8–12).

## Where we are

| Area | State |
|---|---|
| Live site | **Deployed** at <https://freightchain.fun> (landing + lobby), `ride.` (game), `api.` (API only), `storybook.` (model viewer). One Let's Encrypt certificate (expires 2027-01-05, auto-renew on). Several releases shipped; smoke test passes (pages, CORS, sign-in, Secure cookie shared across subdomains). |
| Production data | 4 players, **all throwaway smoke-test sign-ins**. 0 rides, **0 payments**. Pool round 1, 0 entries. |
| Production env | `SOLANA_RPC` = a dedicated **QuickNode devnet** endpoint (genesis checked; the URL holds an API key and lives only in `deploy/.env`) – live after the next deploy. `DEMO_WALLETS` = your Phantom `GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn` (5 devnet SOL) in `deploy/.env` + `server/.env` – live after the next deploy. The deploy now refuses any non-devnet RPC (genesis-hash check). Treasury pubkey set; its key is in `deploy/secrets/treasury.json` on your Mac only. |
| Game (`client/js`) | Pre-existing prototype, unchanged in behaviour. Online mode (`play.html?ride=<id>`) takes seed + shift from the server and heartbeats it. |
| Server (`server/`) | NestJS 12 + Prisma + PostgreSQL, Clean Architecture + CQRS. 308 Docker-free tests + 108 integration tests, architecture and test-pyramid audits, CORS + cookie domain for split hosts. `docs/backend-architecture.md`. |
| Money | Memo-checked SOL transfer to the treasury **public key**; one global UTC-week pool in integer lamports. Split in code today: 50% grand · 20% top-20 · 20% next seed · 10% fees, and the copy says the 50% is a **draw** – both change Thursday (see [Economy](#economy-slide-text)). No payment ever made. No settlement or payout code. |
| Lobby (`client/site/`) | New ride · Live · Leaderboard · Profile, achievements. Free loop click-tested headless (32 checks). Never used with a real wallet. |
| Landing (`landing/`) | Seven chapters, live boards, dash cards, wallet sign-in. Needs the gameplay loop, the demo video, socials, and the draw → top-3 copy change. |
| Icon | **Solana Road** shipped as favicon, apple-touch, manifest and the Phantom connect logo (Phantom shows the site's favicon). Horizon + 8 other candidates kept in `design/icons/`. |
| Verified play | **Live in shadow mode since Oct 7, merged into `main` Oct 8** (scope changed Oct 7: build now, no server-side simulation): recording upload, verdict (recording validation + human-timing flags), shadow mode, review queue on `admin.<apex>` (basic auth; the admin wallet sign-in + signed decisions are on `main`, not deployed yet), sign-in log, JSON logs, read-only ops tooling; explainer page `docs/verified-play/index.html`. Not built: replay, challenge prompts, captcha, payouts. Status, the owner's checklist and the next steps: [`verified-play-next-steps.md`](verified-play-next-steps.md). |
| Repo | <https://github.com/recferret-bit/freightchain>, **private**; goes public on submit day after a history secret scan. README has no disclosure section yet. |
| Colosseum | Not registered, no project page, no weekly update, no videos, no form. |

The critical path: **one real devnet payment, the economy change, two videos, the form.** The public URL is done.

## Decisions (Oct 7)

| # | Decision | Effect on the plan |
|---|---|---|
| Q1 / Q10 | Server 45.91.236.144, domain **freightchain.fun** everywhere. | Closed. Deployed. |
| Q2 | **Solo**, you register. | Wednesday task. |
| Q3 | Repo goes **public**, on **submit day**, after I scan the git history for secrets. You flip it (or say "go"). | Sunday task. |
| Q4 | I draft the bio from what the repo proves; you correct it and add background + location. | Draft below, `[FILL]` marks what only you know. |
| Q5 | Solana track + overall awards; accelerator "would consider", not the ask. | Ask slide. |
| Q7 | Your Phantom on devnet is the demo payer: **`GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn`, funded with 5 devnet SOL** (checked on devnet). | In `DEMO_WALLETS`; needs a redeploy. |
| Q8 | **All payouts are manual from an admin panel**; the admin signs the payout transactions in Phantom, the server holds no secret. Panel = design only. **One filmed manual transfer** from the treasury key in your Phantom before submit, as a preview of that flow. | Saturday shot; economy slide; viability answer. |
| Q9 | Icon done (Solana Road). A wordmark is optional. | Closed for the portal logo. |
| Q11 | You create an X account and send the URL. | `SOCIALS` in `landing/src/main.js` waits on it. |
| Q12 | **Drop the draw.** The 50% becomes skill prizes: **top 3 by verified distance, 25 / 15 / 10%**; the 20% top-20 pool stays. | Thursday code + copy change, before recording. |
| Q13 | Company frame: **verified-play prize pools** – every paid result is a recorded, checked human performance; Desert Run is the first title. | Presentation, deck, form. Must not overclaim (see ground rules). |
| Q14 | You name 5 playtesters by Thursday. | Friday playtests. |
| RPC | QuickNode **devnet** endpoint (the first URL was mainnet and was refused). In `deploy/.env` only – never commit it, it holds the API key. | Needs a redeploy. |
| Scope | Verified play / replay / admin / human checks = **design only** by Oct 12; telemetry playback (not deterministic re-sim). | New design section; roadmap + deck slides. |

## Prizes (World's Fair page)

| Award | Amount | Who decides |
|---|---|---|
| Grand prize | $30,000 | Colosseum, across every track |
| Next 20 projects | $15,000 each | Colosseum |
| Public good / University | $5,000 each | Colosseum |
| Solana track | $100,000, ten projects at $10,000 | Track judges, on top of the awards above |
| Accelerator | $250,000 pre-seed, 12 weeks in San Francisco | Optional; not our ask |

The overall awards are judged as startups (seven factors: the form is a venture application). The Solana track is the realistic prize.

## What the FAQ requires

- Two videos: a 2–3 min presentation and a separate product demo of at most 3 min.
- Registration, a logo, founder bio, location, chains/tools, go-to-market, demand validation and distribution are form fields.
- Weekly updates are strongly recommended (one-minute video). None posted yet.
- Pre-existing game code must be disclosed in prose. Git dates do not show the split (first commit Oct 6, the game Oct 7).

## Ground rules

- **Devnet only.** Prices are "$5 / $15 / $50 in SOL" at the live SOL/USD rate, paid in devnet SOL.
- **Demo-time multiplier.** `DEMO_WALLETS` runs a paid shift ×60 shorter. Say "demo clock ×60" out loud in the demo video.
- **Pitch matches the build – stricter now.** *(Oct 7 update: once the verified-play branch is deployed, "every completed shift is checked – the recording must be complete, consistent with the ride and human-timed" is true; "proven human" and "replayable" still are not.)* The frame is "verified play", so every sentence has to say which checks exist **today** (server clock, heartbeat gap ≤ 150 s, distance ≤ 28 m/s · 1.2 of wall time, server-issued seed) and which are **designed next** (input/telemetry batches, bot and human scoring, replay viewer, admin payouts). Never say a ride is "proven human" or "replayable" in this build.
- **Keep the front end vanilla.** No React / Next. One NestJS backend.
- **Plan A is the chain story.** Memo-checked SOL transfer to a treasury pubkey; no Anchor program (cut on purpose, said so).
- **One product.** Telegram, spectator sabotage, mainnet stay on the roadmap.
- **Cut order if behind** (first to go → last): wordmark → hero gameplay loop → `/r/:id` → the filmed manual payout → the weekly update. The economy change, the real devnet payment, both videos and the form do not get cut.

## Verified play (design, next milestone)

Your spec, written down so the deck, the form and the code later agree. **Nothing here is built this week.** It supersedes the deterministic fixed-point replay in `technical_design_document.html`: the replay is a *telemetry playback*, the verdict is a *statistical check*, and the sim keeps its float physics.

**Ride start.** The server generates the ride's seed (today) and, on top of it, **server-issued event batches**: the obstacles, holes, traffic waves and challenge events for the next stretch, sent as the truck approaches it (so a client cannot precompute the whole ride). Each batch is signed / numbered; the client acks it.

**During the ride – batched uploads.** The client sends, every N seconds, a batch of:
- **inputs**: every key/pointer event with a monotonic timestamp (steer, gas, brake, clutch, gear, lights, wipers…);
- **telemetry** sampled at ~10 Hz: `s`, `d`, heading, speed, rpm, gear, hull, which event batch it is in;
- **challenge responses**: reaction to server events (reaction time, correct action).
Batches are sequence-numbered and hash-chained, so a missing or replayed batch shows.

**After the ride – the verdict engine (server).**
1. **Physics bounds**: speed ≤ governor, acceleration / braking / steering within what the truck can do, no teleports, distance vs wall time.
2. **Checkpoints**: positions pass server-defined checkpoints in order; segment times compared with the **best time possible** for that distance and road (curves, junctions, signals from the seed).
3. **Events**: every server event was met (an obstacle avoided or hit, a red light stopped at), consistent with the telemetry.
4. **Bot / input statistics**: key-press and release intervals, reaction-time distribution, steering micro-corrections and jitter entropy, periodicity (scripts are too regular), input–telemetry consistency.
5. **Human checks** (all four, as you chose): input timing statistics (above) · **challenge events** with reaction time + correctness · a **periodic human prompt** in-game on long shifts (e.g. "flash the headlights now") · a **captcha** (hCaptcha / Turnstile) at ride start and at prize claim. Note: the captcha means a third-party script on the lobby page.
6. Result: `verified / flagged / rejected` with the reasons; only `verified` rides rank for prizes. Flagged ones go to the admin queue.

**Replay app (new web app).** Per round: the **top winner and the rest of the winners**, then every ride. Any player opens their recorded ride: the road is rebuilt from the seed + event batches and the truck moves along the recorded telemetry (~10 Hz, interpolated), with the inputs shown as an overlay (pedals, wheel, gear). Not a deterministic re-simulation – that would need a fixed tick and fixed-point physics, weeks of work.

**Admin panel (new web app, wallet allowlist).** Round close → ranked verified rides → flagged queue (watch the replay, accept / reject) → **build the payout transactions** (top 3: 25/15/10%, top-20 pool) → the admin **signs them in Phantom** with the treasury key → the server records and verifies the signatures. The server never holds a key. All payouts are manual.

**Data cost** (estimate, to check when built): 10 Hz × ~40 bytes × 1800 s ≈ 0.7 MB per 30-min ride before compression – fine for PostgreSQL + object storage later.

## Economy (slide text)

**One round per UTC week, all tiers together.** Each paid entry is split:

- **50% Top 3 by verified distance** – 25% / 15% / 10%. *Today the ranking is the server-checked distance of finished paid rides; "verified" scoring is the next milestone.* Ties: more rides, then earlier finish.
- **20% Top 20** – ranks 1–20 by the same distance.
- **20% Seeds the next round** – the landing number never starts at zero.
- **10% Platform.**

No draw, no lottery element: every prize is a skill prize. Example: 200 riders/week × avg $12 = $2,400 → $600 / $360 / $240 to the top 3, $480 top-20, $480 seed, $240 fees.

Payouts are manual from an admin panel (designed), signed in the admin's wallet; this build accounts prizes and shows one hand-made devnet payout. Devnet demo; the ×60 clock is labelled. Client trust today: server time + speed bound; verified play next.

## Architecture (as built)

```
freightchain.fun        landing (/) · lobby (/lobby.html)      ← landing/dist in front of client/
ride.freightchain.fun   the game (/play.html?ride=ID), locked to a server-issued ride
api.freightchain.fun    NestJS /api only (auth, rides, payments, tiers, pool, leaderboard, live, profile, health)
storybook.freightchain.fun  the model viewer
postgres                Prisma, one PG schema per context (player · ride · economy · achievement)
chain                   SystemProgram.transfer + Memo to the treasury pubkey, checked by the server
```

Auth = Sign-In With Solana, httpOnly cookie shared by the subdomains (Domain = apex), exact-origin CORS. Ride lifecycle, payments, pool and race safety as in `docs/backend-architecture.md`. Deploy = `npm run deploy` (`deploy/README.md`): checks → plan → upload → Docker build → DB backup → migrate → swap → health → auto-rollback → smoke.

## Remaining schedule

### Wed Oct 8 – account, wallet, RPC, the first real payment

- [ ] **You:** register on Colosseum, join World's Fair, create the project page.
- [x] **You:** Phantom → devnet, funded (5 SOL), pubkey sent. **Me:** `DEMO_WALLETS` set in `deploy/.env` and `server/.env`.
- [x] **You:** QuickNode devnet RPC URL. **Me:** in `deploy/.env` `SOLANA_RPC` (genesis = devnet, your wallet's 5 SOL visible through it).
- [ ] **Me:** `npm run deploy` → smoke, so `DEMO_WALLETS` + the RPC go live.
- [ ] **You (I watch the logs):** landing → CONNECT with the real Phantom → lobby → START FREE RIDE → drive the 3 min → COMPLETED. First real-wallet sign-in.
- [ ] **You:** lobby → `1H · $5` → approve in Phantom → pool entries 0 → 1 (`GET /api/pool`) → ×60 shift → verdict → leaderboard row. Then the paid "waiting" banner once (pay, don't start, reload).
- [ ] **Me:** fix whatever those two runs break (Phantom/Solflare shapes have never been run).
- [ ] **You:** one-minute weekly update: live site, real payment (or the named blocker), next = verified play design.
- Done when: one devnet signature is a row in `economy.Payment` and in the pool on the live site.

### Thu Oct 9 – economy change, README, gameplay loop

- [ ] **Me:** prize split 50% grand → **top 3 25/15/10%** in `server/src/domain/economy/prize-split.ts` + DTOs, pool / leaderboard API, tests (property test still sums exactly). Copy: `landing/src/main.js` (pool legend + note), `landing/index.html` (loop step 4, roadmap row, "next" line), `client/site/lobby.js` (rules list), server comments. No more "draw" anywhere. Redeploy before any recording.
- [ ] **Me:** README disclosure section (text in [Submission](#submission-portal)), how to run, what is mocked, what was cut.
- [ ] **Me:** delete the stale `docs/day-1.md`.
- [ ] **Me:** stop the smoke test from polluting production players (mark or clean throwaway players) so Friday's count is real.
- [ ] **You:** record the gameplay loop (real Chrome, clean profile) → `landing/public/media/hero.mp4`; I wire `data-src`, rebuild, redeploy.
- [ ] **You:** name the five playtesters; send the X account URL (→ `SOCIALS`).
- [ ] **You:** eyeball the landing on a real phone + Safari with a non-zero pot (Wednesday's payment).

### Fri Oct 10 – playtests, words, the design write-up

- [ ] **Playtesters:** five people play on the public URL. Count from the DB (excluding smoke/test wallets): finished free rides, paid devnet shifts.
- [ ] **Me:** fix only blockers they hit (sign-in, paid banner, mid-ride reload – re-check the known gap).
- [ ] **Me:** draft the form answers (one-liner, tools, go-to-market, distribution, demand validation with the real count, viability) + the bio draft below polished; **you** correct and fill `[FILL]`.
- [ ] **Me:** turn [Verified play](#verified-play-design-next-milestone) into two deck slides (data flow; verdict + admin payout flow) and a landing roadmap row.
- [ ] Optional, only if the day is open: `/r/:id` share page.

### Sat Oct 11 – videos, deck, the manual payout shot

Record on real Chrome, clean profile, the live URL.

- [ ] **The manual payout preview:** you import `deploy/secrets/treasury.json` into a separate Phantom account, send a small devnet prize to the demo wallet with memo `round 1 prize`; I show the signature on the explorer. Said as: "this is what the admin panel will build and you will sign".
- [ ] **Presentation, 2–3 min** (seven factors, no UI tour):
  1. Insight – Desert Bus: people watch a boring drive; the scarce thing is a proven human performance.
  2. Product – verified-play prize pools; Desert Run is the first title. Pay a shift, the server keeps the clock, the best verified drivers of the week share the pool.
  3. Why you – bio.
  4. Market – skill-prize gaming with Solana wallets as the way in; one number, labelled a wedge.
  5. Money – 10% of every weekly pool; 20% seeds the next week.
  6. What works today vs next – server clock + speed bound today; batched inputs, bot/human checks, replay app, admin payouts next.
  7. Distribution – free rides, public live board, playtest count.
- [ ] **Demo, ≤ 3 min:** landing pool → connect → free ride → pay $5 → "demo clock ×60" → lobby live row + leaderboard → end shift → server verdict → pool higher → the manual payout signature.
- [ ] **Deck, ~10 slides → PDF:** the presentation spine + economy (top 3, no draw) + verified play (2 slides) + built / cut / next + team of one + Ask (Solana track + overall).

### Sun Oct 12 – submit by noon PT

- [ ] Fresh wallet, live URL, whole loop. Fix only blockers.
- [ ] **Me:** scan the full git history for secrets (`.env`, keys, `treasury.json`); report. **You:** make the repo public (or tell me "go").
- [ ] Submit: both video links, the live URL, the repo, the deck PDF, the disclosure.
- [ ] Post on X with the live pool number.
- [ ] Afternoon free for a failed upload or a down host. Official close 11:59pm PT.

## Submission portal

- [ ] Colosseum account + World's Fair (solo).
- [ ] Name + one line: "Freight Chain – verified-play prize pools on Solana. Desert Run is the first title: pay for a driving shift, the server keeps the clock, the best drivers of the week share the pool."
- [ ] Logo: `client/icons/icon-512.png` (Solana Road).
- [ ] Chains and tools: Solana devnet, Phantom / Solflare, Sign-In With Solana (`tweetnacl`), System transfer + Memo, Coinbase → CoinGecko for SOL/USD, NestJS, Prisma, PostgreSQL, Docker, nginx + Let's Encrypt. Not integrated: Anchor, Metaplex, Pyth, VRF.
- [ ] GitHub <https://github.com/recferret-bit/freightchain>, public on submit day, `main`.
- [ ] Disclosure (same words as the README):
  - Before this hackathon: the driving sim (`client/js`, `client/play.html`, themes, cockpit, traffic, climate) – a prototype, not a funded company.
  - During the window: `server/`, `client/site/` (lobby, wallet, pay), `client/js/online.js`, `client/js/hosts.js`, `landing/`, `deploy/`, `design/`, the docs.
  - Commits: `2640f87` Oct 6 initial, `0e85441` + `9476a4c` Oct 7 game, `9378439` Day 0, `843f71e` Day 1, `d1b710b` Day 2, `634c617` server rewrite, `5a6cbb2` deploy, landing + icon commits on top.
  - Not built: verified-play scoring, replay app, admin panel / automated payouts, NFT, mainnet.
- [ ] Both videos, the live URL <https://freightchain.fun>, the deck PDF.
- [ ] Go-to-market / distribution / demand validation / viability – Friday drafts.
- [ ] Founder bio + location (draft below).

**Bio draft (you correct; `[FILL]` = only you know):**
> Solo founder, `[FILL: location]`. `[FILL: background – role, years, domain]`. Built the Desert Run driving sim before the hackathon; during it, shipped the Solana money loop (Sign-In With Solana, memo-checked SOL entries, a weekly prize pool in integer lamports), a NestJS + PostgreSQL backend with 400+ tests, the lobby, the landing and a one-command deploy to a live HTTPS site.

## Proposals (form language)

- **P1 Company sentence.** "Freight Chain runs prize pools where every paid result is a recorded, checked human performance. Desert Run is the first title." Today's checks are server-side timing and bounds; the full verification is the next milestone – say both.
- **P2 Go-to-market.** Solana users who sit through on-chain spectacles and streams, plus anyone who will do a 3-minute free ride for a leaderboard. Loop: 5 free rides → 1 a day → $5 / $15 / $50 shifts. Distribution: the public live board (no account to watch), one X post per finished paid ride, the pool number. Missing on purpose: paid acquisition, mobile wallet flows beyond Phantom/Solflare, KYC.
- **P3 Demand validation = Friday's count.** "N people outside the team finished a free ride on the public URL on Oct 10; M paid a devnet shift. No revenue, devnet only." If nobody plays: "No users yet; the live demo is the validation we can offer." No invented waitlist.
- **P4 Viability.** The 10% fee has to cover hosting and, later, the verification and payout operations. Path: manual admin payouts on devnet → verified-play scoring → mainnet with published rules. Skill prizes only (no draw) is part of viability.
- **P5 Keep the cuts visible.** Anchor, truck upgrades, NFT badges, Telegram, deterministic re-sim, mainnet – cut or later, on purpose.
- **P6 Solana track.** Cheap entries, wallets people have, a memo the server checks without a program.

## What not to do this week

Building the verified-play system (design only) · mainnet · a React rewrite · Telegram · Anchor · a second chain · NFT mint · claiming rides are "verified" or "replayable" in this build · any sentence with "draw" or "jackpot" · a single video that is both pitch and demo · putting the treasury key on the server · `npm run deploy` without the smoke test.

## Known gaps to mention if asked

- Completion is server-timed telemetry; the verified-play recording check (on its branch, see `verified-play-next-steps.md`) validates and scores the recording but does not re-simulate it – a modified client that fakes a consistent, human-timed recording still passes. Night / hull / route achievements trust the client.
- **Phantom and Solflare have never been run** (sign-in or payment) – Wednesday fixes that.
- **No payment has been made to this treasury yet.**
- Every smoke run creates a throwaway player in production (4 now) – excluded from any user count; Thursday task to stop it.
- Mid-ride reload is refused and the credit stays spent for up to 150 s (first-build behaviour, re-check Friday).
- A second payment for one ride may not be credited (no refund); unknown transaction versions make `confirm` return 503; `reconcile` sees only the wallet's latest 25 transactions.
- No settlement or payout code; the pool is accounted only. The one filmed payout is made by hand.
- Landing: a signed-out visit logs a 401 for `/api/me` (by design); the hero loop and demo video do not exist yet.
