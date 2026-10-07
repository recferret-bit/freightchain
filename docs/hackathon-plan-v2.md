# Freight Chain → Colosseum "Crypto World's Fair" – plan v2

Supersedes [`hackathon-plan.md`](hackathon-plan.md). Progress in [Days 0–2](#progress-copied-from-v1) is copied from v1, status as of **Tue Oct 7, 2026**. v2 adds what the [Colosseum hackathon FAQ](https://colosseum.com/hackathon#faqs) requires and v1 never scheduled. Reviewed the same day: 19 questions on that page, plus prize figures from [colosseum.com/worldsfair](https://colosseum.com/worldsfair).

Deadline: **11:59pm PT, Oct 12, 2026** (runs Sep 14 – Oct 12). Working deadline stays **noon PT Oct 12**, so a broken demo can still be fixed. About five days left.

v1 submission line was: account + form + one pitch video + demo URL + GitHub. The FAQ asks for more than that. See [Submission](#submission-portal).

`docs/day-1.md` is stale. It says Day 1 was uncommitted and Day 2 was still ahead. Day 1 and Day 2 are committed (`843f71e`, `d1b710b`). Use this file.

## What v2 changes

- Judges score seven startup factors, not "the video, the demo URL, the economy slide." The form is a venture application.
- Two videos, not one: a 2–3 min presentation, and a separate product demo of at most 3 min.
- Registration, a logo, a founder bio, location, chains/tools, go-to-market, demand validation, and a distribution plan are form fields. v1 had none of them as tasks.
- Weekly updates are strongly recommended (one-minute video). None have been posted. The window is in week 4.
- Pre-existing game code must be disclosed in prose. Git dates will not show the split: the first commit is Oct 6 and the game lands Oct 7, inside the window.
- Economy slide text in v1 still says "one round per tier." The code is **one global weekly round**, weighted by tier. The slide has to match.
- Next build work is deploy, one real devnet payment, and the landing page. NFTs, the share page, and truck upgrades move behind those.
- Do not submit the dirty working tree on `refactor/server-clean-arch` until that rewrite is finished and `npm run check` is green. Open question [Q6](#open-questions).

## Prizes (World's Fair page, not the FAQ)

| Award | Amount | Who decides |
|---|---|---|
| Grand prize | $30,000 | Colosseum, across every track |
| Next 20 projects | $15,000 each ($300,000) | Colosseum |
| Public good / University | $5,000 each | Colosseum |
| Solana track | $100,000, ten projects at $10,000 | Track judges, on top of the awards above |
| Accelerator, if offered and accepted | $250,000 pre-seed, 12 weeks in San Francisco | Optional. Winning does not require joining |

Headline on the fair page: $840,000 in prizes and $2.5 million in seed funding. Any chain can win the overall awards. The Solana track is the realistic prize for this product. The overall awards favor a company story with a market and some demand.

## Ground rules

- **Devnet only.** Judges will not pay mainnet SOL. Prices are "$5 / $15 / $50 in SOL" at the live SOL/USD rate, paid in devnet SOL.
- **Demo-time multiplier.** A 1 h / 4 h / 8 h ride cannot be shown in a 3-min video. Server-side `demoScale` (only on a flagged demo account) runs the ride clock ×60. Say "demo clock ×60" out loud in the demo video.
- **Keep the stack vanilla.** The game has no bundler. Landing and lobby are plain HTML + ES modules. One Node backend (NestJS + SQLite) does auth, rides, pool. No React, no Next. The FAQ does not score language or framework.
- **Plan A is the chain story.** Memo-checked SOL transfer to a treasury pubkey. Anchor was cut because the toolchain was not installed and the Day 1 gate said to stop. Name that cut in the form and the repo. It is the "prioritized on purpose" sentence the GitHub FAQ asks for.
- **Pitch matches the build.** Server-timed driving shift, entry fee in, weekly pool accounted in integer lamports, finish decided by the server, prizes accounted and not yet paid. Achievements are badges. Night, hull, and route are client-reported.
- **One product.** Replay, Telegram, and spectator sabotage stay on the roadmap slide.
- **Cut order if behind** (last → first to go): one manual devnet payout → click-to-mint badges → `/r/:id` share page → truck upgrades (already cut) → Anchor (already cut). Deploy, the real devnet payment, the landing page, both videos, and the form do not get cut.

## Submission portal

Hackathon builders should treat the form as a pitch to the venture fund. Every submission is reviewed. Written feedback goes only to the shortlist, who get a 15-minute Zoom about a month later. The form has to stand alone.

- [ ] Colosseum account, joined to Crypto World's Fair. v1 skipped this on request. Still required, including every teammate if one is added. [Q2](#open-questions)
- [ ] Product name and one-line description.
- [ ] Logo or graphic. [Q9](#open-questions)
- [ ] Chains and tools: Solana devnet, Phantom / Solflare, Sign-In With Solana (`tweetnacl`), SPL-less System transfer + Memo, Coinbase then CoinGecko for SOL/USD, NestJS, SQLite. Anchor, Metaplex, Pyth, and VRF are not integrated.
- [ ] Team: solo unless [Q2](#open-questions) says otherwise. Background and location are required fields and are not in the repo. [Q4](#open-questions)
- [ ] GitHub: <https://github.com/recferret-bit/freightchain>. Public, or private with read access for `hackathon@colosseum.com`. [Q3](#open-questions). Point it at a clean branch. [Q6](#open-questions)
- [ ] Disclosure of pre-existing work, in the form, in the same words as the README:
  - Before this hackathon: the driving sim (`client/js`, `client/play.html`, themes, cockpit, traffic, climate). It is a prototype, not a funded company.
  - During the window: `server/` (auth, rides, payments, pool, leaderboard, achievements), `client/site/` (lobby, wallet, pay), `client/js/online.js`, landing placeholder, this plan.
  - Commits: `2640f87` Oct 6 initial, `0e85441` + `9476a4c` Oct 7 game, `9378439` Day 0, `843f71e` Day 1, `d1b710b` Day 2.
  - Not built: settlement, payouts, NFT mint, replay, mainnet.
- [ ] Presentation video, 2–3 minutes. Script in [Day 4](#day-4--sat-oct-11--form-deck-both-videos).
- [ ] Product-demo video, ≤ 3 minutes. Separate file from the presentation.
- [ ] Go-to-market, demand validation, distribution. Draft answers in [Proposals](#proposals). Playtest count is the only demand number still reachable. [Q14](#open-questions)
- [ ] Live demo URL on the deployed host. A stranger can open it and finish a free ride.
- [ ] One weekly-update video, about one minute, on the Colosseum project: Days 0–2 shipped, paid path proven against a fake chain, next is deploy and a real devnet payment.

## Architecture (decided)

```
/              landing (placeholder today; Day 3 replaces it)
/lobby         lobby: New ride · Live · Leaderboard · Profile
/play?ride=ID  the game, locked to a server-issued ride
/r/:id         public ride page — only if Days 1–4 are done
server/        NestJS: /auth/nonce /auth/verify  /rides /heartbeat /end
               /pool  /leaderboard  /live  /profile
chain/         not in this build. Plan A: SystemProgram.transfer + Memo
```

- **Auth** — done. Sign-In With Solana, httpOnly `fc_session` JWT. Phantom and Solflare shapes are coded. A real wallet has never signed in.
- **Ride lifecycle** — done. Server owns `seed`, `minSeconds`, `completeDist`, and the verdict `completed / abandoned / failed`. Heartbeat every 10 s. Gap > 150 s fails the ride. Distance may grow at ≤ 28 m/s · 1.2. This is server-timed telemetry. A modified client can still lie inside the speed bound. The fixed-point replay in `technical_design_document.html` is roadmap.
- **Payments** — Plan A done against a fake chain and against the shape of real devnet transactions. Not yet a payment that this treasury received. Quote from Coinbase, then CoinGecko, locked on the order for 10 min. Reconcile recovers a signature whose confirm call never arrived.
- **Pool** — one global UTC-week round. Every paid entry counts, whatever the outcome. 50% grand (+ carried seed) · 20% top-20 · 20% next round's seed · 10% fees. Integer lamports, floors, remainder to fees. `settled: false`. No draw, no payout.
- **Free rides** — 180 s, no pool entry, 5 at signup, +1 per UTC day. Own leaderboard. Achievements count.
- **demoScale** — `DEMO_WALLETS` divides paid-shift length by 60. Free tier and the speed bound stay put.
- **Grand prize draw** — not built. v1 options were ORAO / Switchboard, or a server commit-and-reveal. Default for the submission: say "accounted, not drawn, not paid," unless [Q8](#open-questions) asks for one manual devnet payout.

## Progress copied from v1

Unchanged status text from [`hackathon-plan.md`](hackathon-plan.md). Dates in the headings are the original plan's dates. The work itself landed in git on Oct 7.

### Day 0 – Tue Oct 7 – foundations  ·  status: 4 of 5 done, deploy blocked on an account

- [~] Register on Colosseum – **skipped on request** (do it before submitting; disclose the existing game code). Still open. Moved to [Day 1 of v2](#day-1--wed-oct-8--account-deploy-one-real-payment).
- [x] Repo split: `client/` (the game, untouched behaviour) + `server/` (**NestJS 12 + TypeScript, ESM, `node:sqlite`** – changed from the Fastify/better-sqlite3 sketch: no native addon to build). `index.html` → `play.html`; new `index.html` (landing placeholder) and `lobby.html`. Nest serves `client/` and `/api` from one origin. Root `package.json` delegates (`npm run server:dev`, `server:test`, `client:check`, `check`).
  *Verified by:* `npm run check` in `client/` (lint + bundle + headless, errors=0) and `trace:diff` = **trace identical** after the move and again after the online-mode hooks; `e2e-chrome.mjs` offline run, 0 problems; the standalone build still builds (`client/dist/freightchain.html`).
- [ ] **Deploy skeleton to Railway/Fly – NOT done**: needs your account/credentials. The server is ready for it (`npm run build` → `node dist/main.js`, `NODE_ENV=production`, **`JWT_SECRET` required**, `APP_DOMAIN`/`APP_ORIGIN` = the public host, a persistent volume for `DB_PATH`; see `server/.env.example`). Host is [Q1](#open-questions).
- [x] SIWS auth end-to-end: `POST /api/auth/nonce` (server-built message, 5 min, single use, burnt on the first attempt) → wallet `signMessage` → `POST /api/auth/verify` (ed25519 over the *stored* message via tweetnacl) → httpOnly `fc_session` JWT cookie → `GET /api/me`. Free rides: 5 at signup, +1 per UTC day (lazy, no backlog).
  *Verified by:* `npm run server:test` – 10 vitest/supertest cases (valid sign-in; wrong key, replay, expired, never-issued message, non-address all rejected; credits, daily grant, owner isolation). **Not verified with a real Phantom/Solflare** – `client/site/wallet.js` (connect → signMessage → base58) is written against their documented API but only ever ran with a keypair standing in.
- [x] Ride lifecycle API + game hooks: `POST /api/rides {tier:'free'}` → `{id, seed, minSeconds: 180, completeDist}`; `/start`, `/heartbeat` (10 s, carries `paused`), `/end {outcome}`. Server decides `completed / abandoned / failed`: driven time (honest pauses excluded) ≥ min AND reported distance ≥ `completeDist`, distance may only grow at ≤ 28 m/s·1.2, heartbeat gap > 150 s fails the ride. Game side is **opt-in** (`client/js/online.js`, only with `play.html?ride=<id>`): seed + `RIDE_MIN_SECONDS` + `COMPLETE_DIST` come from the server, no mock wallet, START → server `/start`, END SHIFT / crash → `/end`, the server's verdict is shown on the result screen.
  *Verified by:* the same vitest suite (complete, pause earns no time, idling = abandoned, teleport = failed, dead heartbeat = failed) **and** `server/scripts/e2e-browser.mjs` in real headless Chrome against a running server: sign-in → free ride → game loads the server's 6 s / 84 m / seed → START → heartbeats → P → END SHIFT → verdict **COMPLETED**, 0 page errors.
- Done when: connect wallet → start a free ride → drive 3 min → "complete" comes from the server.
  **Status: proven, with two stand-ins.** The browser run used a test shift of 6 s (`FREE_RIDE_SECONDS=6`, default is 180) and the distance was injected (`__game.st.s = 90`) because headless Chrome can't really drive; the wallet was a keypair. **Still to do by hand:** open the deployed URL with Phantom → connect → lobby → START FREE RIDE → drive the real 3 min.
- Review fixes applied after the first pass: the final `/end` report no longer loses drive time (the server credits the game's own clock `t`, capped by wall time); a hull below 0 or a garbled final report can no longer leave a ride stuck `running`; Solflare/Phantom return shapes normalised in `site/wallet.js`; `.env` is read at start; `CLIENT_DIR` resolves from the module path; `npm test` no longer fails with no specs. *Solflare path: written from its documented shape, never run.*
- Known gaps carried forward: reloading `play.html` mid-ride is refused (ride is `running`) and the lobby answers 409 for up to 150 s — the credit is spent; no rate limiting on `/api/auth/*`; completion is server-timed telemetry, not a replay; landing is still a placeholder; `/api/me` on the landing page logs a 401 when signed out.

### Day 1 – Wed Oct 8 in v1 – money  ·  status: server side done against a FAKE chain; real devnet payment blocked by the faucet

- [x] **SOL/USD quote + tier table** `{free 180 s · 1h $5 · 4h $15 · 8h $50}`. Source = **Coinbase, then CoinGecko** (Pyth Hermes answers 401 without a key), cached 60 s, sanity-bounded to $1–$10 000, a stale price is used up to 15 min if both are down, `SOL_USD` pins it. The price is **locked onto the order** with lamports (rounded up to 1000) and a 10 min expiry. `GET /api/tiers` lists live lamports.
  *Verified by:* unit tests (cache, fallback, absurd values rejected, stale → 503, rounding) and a live run: the server quoted $117.86 from Coinbase → 1h = 42 424 000 lamports.
- [~] **Plan B (Anchor escrow) – not attempted: the toolchain isn't installed.** v1's gate applies. **Plan A is the submission.** Anchor stays a cut, described in the deck.
- [x] **Payments (Plan A).** Order → `GET /rides/:id/payment` (unsigned transaction built per click) → wallet signs → `POST /rides/:id/confirm`. The server scans all instructions for: a System transfer wallet→treasury of ≥ the quoted amount, a memo = ride id, `meta.err` null, fee payer = the wallet. The signature is a primary key. Not on chain yet → `202 pending`. A matching payment is honoured after the quote expires. `POST /rides/:id/reconcile` + `GET /rides/pending` recover a payment whose confirm call never arrived. Treasury = **public key only** (`TREASURY_PUBKEY`). The server holds no payout secret.
  *Verified by:* 23 vitest e2e cases (+ 6 unit) against a fake chain: underpaid, wrong memo, no memo, wrong destination, paid by someone else, wrong source, failed on chain → all 400; extra instructions + overpayment accepted; pending → paid; signature reuse → 409; paid-after-expiry honoured; owner isolation; reconcile finds / ignores. **Plus** `server/scripts/check-rpc-shape.mjs` on real devnet transactions that carry a memo and a System transfer. **A payment to this treasury has still not been made.**
- [x] **Pool accounting – ONE global weekly round** (v1's "per tier" line is void). 50 / 20 / 20 / 10, integer lamports. A new UTC week closes the old round and seeds the new one with its 20%. `GET /api/pool` returns lamports + approximate USD. **`settled: false`.**
  *Verified by:* property test (2000 random splits always sum exactly), week-boundary tests, an e2e test: two entries (1h + 8h) → 550 000 000 lamports, shares add up, next week's round starts with `carry = nextSeed`.
- [x] **`demoScale`**: `DEMO_WALLETS` → paid shifts ÷ 60. Returned as `timeScale`. Menu shows "DEMO ×60". Speed bound and free tier are never scaled.
- [x] **Leaderboard** `GET /api/leaderboard?board=round|free|all`. Completed rides by distance.
- [x] **Schema**: additive migration, so a Day 0 `server/data/` database keeps working.
- [~] **Client pay path**: `site/pay.js` loads web3.js 1.99.0 from jsdelivr when buying. Lobby shows the three tier buttons and the pool. Headless Chrome rendered `1H · $5 (0.042 SOL)`. **`signAndSendTransaction` has never run with Phantom or Solflare.**
- Done when: pay a $5 ride on devnet, pool number goes up, ride completes (×60 demo), shows on a leaderboard.
  **Status: proven against a fake chain, not on devnet.** `server/scripts/devnet-pay.mjs` does the loop. Last run: public faucet returned 429 on both airdrops. Fund a wallet at <https://faucet.solana.com> and run `WALLET_SECRET=<base58> BASE=… node scripts/devnet-pay.mjs`, or use the lobby with Phantom on Devnet. For the video: `DEMO_WALLETS=<pubkey> npm run server:dev`.
- Known gaps carried forward: a second payment for the same ride is taken and not credited (no refund); unknown transaction versions answer 503; `reconcile` looks at the wallet's latest 25 transactions; public devnet RPC is rate-limited (`SOLANA_RPC` for the demo); settlement and refunds are absent; a paid ride can only be started from the lobby (reload mid-ride still burns it).

### Day 2 – Thu Oct 9 in v1 – lobby  ·  status: done; free loop click-tested; paid click-through needs a real wallet

- [x] **`lobby.html` + `site/lobby.js` + `site/lobby.css`** — four tabs (`#new` `#live` `#board` `#profile`), amber-on-black, responsive to ~390 px. Server text goes in via `textContent`. Header: wallet, free rides, trucks on the road, `DEMO ×60` for demo wallets.
  - **New ride**: weekly pool (grand prize, SOL + ≈USD, 50/20/20/10 bar, entries, countdown), tier cards, conditions that change with the tier, one START button. Copy already says prizes are accrued and not paid in this build. A paid ride you are owed shows as a banner.
  - **Live**: `GET /api/live` every 5 s while visible. Rows update in place. PAUSED / NO SIGNAL. Empty state.
  - **Leaderboard**: THIS ROUND (top 20 highlighted, pot so far) · ALL TIME · FREE RIDES. Your row highlighted.
  - **Profile**: stats, achievements (locked ones greyed), upgrades teaser, last 10 rides.
- [x] **Server**: `GET /api/live` (public; running rides with a heartbeat < 150 s; no ride ids, seeds, or free-text reasons), `GET /api/profile`, leaderboard `board=all` + round end + prize ranks, `/api/me` includes `demo`. Heartbeats carry `route` (whitelist of the five theme ids) and `night`.
- [x] **Achievements persisted**, not computed on read. Table `achievements(wallet, id, earned_at, ride_id)`, `INSERT OR IGNORE` at `/end`, catch-up when the profile is read. Rules: First Mile · Shift Complete · Night Owl (most of the drive time reported as night) · Century (100 km) · Clean Run (hull 100%) · Cold Start (finished on Trans-Siberian). **Top 20 is not awarded** until a round closes. Trust: night, hull, and route are client-asserted. Fine for badges. Not fine for anything that pays money.
- [x] **Free ride vs paid purchase**: buying while holding an unstarted free ride cancels it and refunds the credit once. A paid unstarted ride is never cancelled.
- [x] Route picker and day/night stay in the game menu. The lobby only picks the tier.
- [x] Lint covers `client/site/`.
  *Verified by:*
  - vitest: **12 unit + 48 e2e**. Live feed, profile unlocks, free-credit refund once, paid ride never cancelled, boards, `demo`.
  - **`server/scripts/e2e-lobby.mjs`** — three headless Chromes, 27 checks, all ok. Stand-ins: a keypair signs in, the shift is 3 s (`FREE_RIDE_SECONDS=3`), distance is injected (`__game.st.s = 60`). Covered: four tier cards, pool, PAY with no wallet creates no order, START FREE RIDE → live tab shows the truck → END SHIFT → COMPLETED → free rides 5→4 → profile unlocks → free board rank 1 → reload keeps `#board` → 0 page errors. Unpaid `1h` order: reconcile against real devnet RPC finishes with nothing to credit. **The "your paid ride is waiting" banner was not reachable without a chain.**
  - That run found a boot crash (code ran before later `const`s). Fixed. Screenshots of 4 tabs × desktop/phone were read; three visual bugs fixed (legend swatches over labels, squashed avatars, truck glyph off the road at 0%).
  - Client `check` + `trace:diff` identical after the heartbeat-extras baseline was re-saved. Offline `e2e-chrome` 0 problems.
- **Needs a human eye:** phone, Safari, live bars with more than one rider, copy, DEMO wording.
- **Not verified:** a paid purchase with Phantom; landing → lobby with a real wallet.
- Known gaps carried forward: live and leaderboard show shortened pubkeys (no chosen names); `/api/live` and `/api/leaderboard` have no rate limit; hull shows `–` until the first heartbeat; 5 s poll, no websockets; round countdown can skew a few seconds; second payment still not credited; settlement still absent.

### Also true on Oct 7, not in v1's checklist

- Repo remote: `https://github.com/recferret-bit/freightchain.git`. Branch checked out: `refactor/server-clean-arch`. Committed tip of the tested work: `d1b710b`.
- Working tree is a large uncommitted server rewrite: old `server/src/**` deleted in the index, new `server/src/`, `server/prisma/`, and `docker-compose.yml` untracked. Not verified. Not the submission branch unless [Q6](#open-questions) says to finish it first.
- `README.md` is the single line `# freightchain`. `client/index.html` is the 29-line placeholder.
- No Colosseum project page, so no weekly update can be posted until registration is done.

## Remaining schedule

Days 0–2 of v1 shipped on Oct 7. The old "Friday = NFTs" day is gone. Dates below are the days still ahead.

### Rest of Tue Oct 7 — decisions, no new features

- [ ] Answer [Q1](#open-questions)–[Q6](#open-questions). The Wednesday deploy waits on the host and on which tree is canonical.
- [ ] Register on Colosseum and join World's Fair if [Q2](#open-questions) is "do it." The project page has to exist before the weekly update.
- [ ] Write the disclosure paragraph (three bullets in [Submission](#submission-portal)) into a README section on the submission branch. Do not rewrite the game.

### Day 1 – Wed Oct 8 – account, deploy, one real payment

- [ ] Deploy the **submission branch** with `JWT_SECRET`, `APP_ORIGIN`, `TREASURY_PUBKEY`, persistent `DB_PATH`, and a non-public `SOLANA_RPC`.
- [ ] Fund a devnet wallet at <https://faucet.solana.com>. Put that pubkey in `DEMO_WALLETS`. [Q7](#open-questions)
- [ ] Run the paid loop for real: lobby → `1H · $5` → Phantom on Devnet → pool lamports increase → ×60 shift → server verdict → leaderboard row. `server/scripts/devnet-pay.mjs` is the scripted version of the same loop.
- [ ] Same wallet, by hand: connect on the landing placeholder → START FREE RIDE → drive a real 3 min (or the test override only if you are debugging). This is the Day 0 "done when" that headless Chrome could not do.
- [ ] Post the one-minute weekly update on the project: what shipped Oct 7, paid path now either proven on devnet or still blocked, with the blocker named.
- Done when: a URL you can send a stranger loads the lobby, and one devnet signature is a row in `payments` and in `GET /api/pool`.

### Day 2 – Thu Oct 9 – landing  ·  status: built and reworked on `feat/landing` (worktree off `d1b710b`); needs the gameplay video, socials and a deploy

**Own project: `landing/`** (Vite 7; `index.html`, `src/main.js`, `src/style.css`, `public/media/`; sign-in imported from `client/site/wallet.js`). `npm run landing:build` → `landing/dist`, served by Nest at `/` in front of `client/` (`config.landingDir`, `renderPath: '/'`; a missing build logs a warning and `/` 404s). `npm run landing:dev` = Vite on :5173 proxying `/api` and the other pages to Nest. Root `npm run build` = landing + server; `npm run check` now lints and builds the landing too. `client/index.html` is gone. Chapter dividers are a road: asphalt, two solid white edge lines, white dashed centre line driving. (Palette lifted from the cab: dash blacks, amber gear digit `#ffcf5a`, needle orange `#ff7a2e`, cream numerals, LCD green for live numbers). Public API only, no session needed to look; server text via `textContent`. Seven chapters (01 ride · 02 loop · 03 freighter · 04 economy · 05 roadmap · 06 market · 07 about) with road dividers and scroll-reveal (all off under `prefers-reduced-motion`):

- [x] **Ticker** above the nav (Megapot-style marquee): last finishes / wrecks, pot + entries, trucks on the road, all-time km, paid shifts waiting. Sticky top bar with numbered section nav, live chip, PLAY.
- [x] **01 · RIDE** – full-viewport hero: gameplay background (`data-src` on `#hero-video` in `landing/index.html`; **empty until your clip is in `landing/public/media/hero.mp4`** → Ken Burns crossfade of three WebP screenshots meanwhile; the loop loads after the page, when idle, never on phones / data-saver), one-line pitch, CTA "Connect wallet → 5 free rides", "▶ Watch the demo" (dialog; `DEMO_VIDEO` null → explains + links offline play), "try it offline", and four LCD counters: pot (SOL + ≈USD, tweened), round countdown (server-skew corrected), trucks on the road, all-time km / shifts.
- [x] **02 · LOOP** – Buy → Drive → Server calls it → Share the pool, six mechanic cards (gearbox, hull/traffic, weather/engine, day/night, holes/strain, five routes with swatches), the six real badges + a dashed "Top 20 after the first round".
  - **REALTIME DAYTIME**: the same Route 66 spot at dawn / day / dusk / night, four slices cut at an angle that overlap and widen on hover (2×2 grid on phones).
  - **THE DASH · HOVER A CARD**: six 3D tilt cards (70 % in-game crop / 30 % footer), footer gradient sampled from the image at runtime (canvas, most-saturated colour + top/bottom averages), perspective tilt + glare follow the pointer, resting angle alternates ±4–5°. Cards: ignition key (OFF/ON/START), gearbox, warning lamps (COLD/STRAIN/BRAKES lit), lights & heat, park/wipers/wash, trip & radio – all text is the real control scheme.
  - Media come from the game itself: `landing/tools/capture-media.mjs` (`npm run media` in `landing/`, server on :3111) drives headless Chrome through `window.__game` and clips the dash at 2× + the four windscreens → `public/media/cards|sky`. Re-run it after cockpit changes, then `npm run build`.
- [x] **03 · YOUR FREIGHTER** – the garage, labelled *not in this build*: spec sheet of the one truck that exists (FC-01) + a 12-item parts catalogue with IN THE GAME / PLANNED / CONCEPT chips (NFT trucks: cabover, road train; upgrades: splitter 8th gear, radiator, battery, headlights; interior: golden wheel, gauge faces, trim & dice; paint shop; badges → click-to-mint) and the rules: cosmetics/comfort only, never the clock or the governor, physics parts only after the replay core. Pure-CSS part glyphs.
- [x] **05 · ROADMAP** – a driver's trip sheet on a clipboard (cream paper, ruled lines, ink): LEG 1 DEPOT (done, struck through, DONE stamp) · LEG 2 ON THE ROAD Oct 8–12 (ROLLING) · LEG 3 NEXT FUEL STOP (draw + payouts, replay core, share page, click-to-mint) · LEG 4 LONG HAUL (garage, mainnet, spectator sabotage, Telegram) · LEFT AT THE DEPOT (cuts, CUT stamp). Footer odometer = live all-time km.
- [x] **06 · GO TO MARKET** – an LCD dispatch load board: LANE · CARGO · RATE · FILL · STATUS, FILL live where the server knows it (drivers, paid entries, pot, trucks on the road), BID for planned lanes, NOT LISTED for the deliberate omissions (ads, mobile wallets, regions, KYC); footer: commission 10 %, seed 20 %, thesis. Lanes = P5 from this plan; the playtest row is the P6 demand number and stays "–" until Oct 10. Rows stack as cards on phones.
- [x] **04 · ECONOMY & TECH** – grand prize card (50/20/20/10 bar, legend, entries, countdown, carry), tier table at the live SOL price, three boards: **LIVE NOW** (running rides with progress), **NEXT UP** (paid shifts bought but not started), **THIS ROUND · TOP 10**; "What the server checks" (clock / speed / payment / verdict) + a red-edged "said plainly" paragraph (telemetry not proof, badges never move lamports, draw not live, replay next).
- [x] **07 · ABOUT** – Desert Bus origin, built / cut / next, the stack + Colosseum disclosure line, "Join the convoy" (GitHub, live count; **X / Discord / Telegram appear only when `SOCIALS` in `landing.js` is filled – Q11**).
- [x] **Server**: `GET /api/live` now also returns `upcoming` (paid, unstarted: wallet, tier, paidAt), `recent` (last 12 ended rides: wallet, tier, route, status, distance, endedAt) and `totals` (completed shifts, metres, drivers). Same privacy rule – no ids, seeds or reasons. Test extended in `test/lobby.e2e-spec.ts`.
- [x] `server/scripts/seed-landing.mjs` – seeds a running server with one running + two finished free rides so the boards/ticker have rows for screenshots and the video. `e2e-lobby.mjs` has 7 landing checks (stays on `/`, pool shown, 4 shifts + 3 boards, ticker carries the finished ride + pot, all-time km > 0, signed-in CTA → lobby, pool text = `/api/pool`).
- [x] Research behind the layout: 10 hyped web3 game / prize-pool landings (Off The Grid, Star Atlas, Shrapnel, Megapot, PoolTogether, Pixels, Big Time, Pudgy World, Parallel, Guild of Guardians). Took: live ticker + one giant number + countdown, sticky play CTA, mono stat strip, numbered chapters, fairness as 4 plain cards, chain named once, social proof at the bottom. Avoided: investor wall, token-first CTA, several autoplay videos.
  *Verified by:* client `npm run lint` clean (added `IntersectionObserver` to the eslint globals); landing lint + `vite build` (10 kB JS / 13 kB CSS gzip 4+4); Nest serves `/` from the build, `/lobby.html`, `/play.html`, `/site/wallet.js` still from `client/`, unknown → 404; Vite dev proxy smoke-tested; `e2e-lobby.mjs` all ok, 0 page errors; server unit 12 + e2e 48 green; desktop 1280 and phone 390 full-page screenshots read with seeded rows – no horizontal scroll (fixed two: ticker strip and top-bar chip); the collage and the dash cards (with a simulated hover) read at both widths.
- **Still to do by you:** record the gameplay loop → `landing/public/media/hero.mp4`, set `data-src` on `#hero-video` in `landing/index.html`; the ≤ 3 min demo → `DEMO_VIDEO`; fill `SOCIALS` (Q11); then eyeball on a real phone + Safari and with a non-zero pot.
- **Not verified:** real Phantom/Solflare sign-in from the landing; `<video>` path (no clip exists yet – the Ken Burns fallback is what was seen); copy.
- Known: a signed-out visit still logs a 401 for `/api/me` (how the page learns you are signed in); the free tier shows "0 min" when `FREE_RIDE_SECONDS` is a test value under 60 s.
- Built on the frozen `d1b710b` tree (SQLite server). Client is portable to the Prisma rewrite; the `/api/live` additions are three SQL queries to port.

### Day 3 – Fri Oct 10 – words, playtests, only then extras

- [ ] Draft the form answers: one-line description, tools list, bio, location, go-to-market, distribution. Use [Proposals](#proposals) P4–P6 as the draft.
- [ ] Five playtests on the deployed URL by people other than you. Record how many finished a free ride and how many tried a paid tier. That number is the demand-validation answer. Zero stays zero if this is skipped.
- [ ] Logo. [Q9](#open-questions)
- [ ] Fix only blockers found by those playtests (wallet sign-in, paid banner, deploy crash). Mid-ride reload burning a credit is a known gap; fix it if a playtester hits it, otherwise document it.
- [ ] If the day is still open, in this order:
  1. `/r/:id` — server-rendered page, static image per route, the URL the demo's share beat can open. Dash button can wait.
  2. Click-to-mint for wallets with at least one paid ride, daily cap, server pays ~0.003 SOL. Profile links the mint tx. Skip Top 20 (the round has not closed). Skip mint-on-unlock: free throwaway wallets and client-asserted facts would drain the mint wallet.
  3. One devnet payout of a tiny round only if [Q8](#open-questions) is yes and the treasury secret has a home that is not the repo.

### Day 4 – Sat Oct 11 – form, deck, both videos

Record on real Chrome, clean profile, deployed URL. Headless SwiftShader is too slow. The standalone file is the offline fallback, not the demo URL.

**Presentation, 2–3 min.** Talk to the seven factors. No UI tour.

1. Insight. Desert Bus showed that people will watch a boring drive. The scarce thing is proven time on the road.
2. Product in one sentence. Freight Chain sells a shift. The server keeps the clock. Finishers share one weekly pool. This truck game is the first title.
3. Why you. [Q4](#open-questions). You shipped the sim and, this week, the money loop.
4. Market. One number, labeled as a wedge: skill-prize and spectator gaming, with Solana consumer wallets as the way in. The company is a proof-of-attention pool. The game is the first market.
5. How it makes money. 10% of each weekly pool. 20% seeds the next week so the number on the landing page is never zero. 50% is a draw among finishers, weight = tier. 20% is a skill prize by distance.
6. What a judge can do today. Devnet. Connect, free ride, pay, watch the pool move, get a server verdict. Prizes are accounted. Draw and payout are the next milestone. Anti-cheat today is server time plus a speed bound. Replay is next, on purpose.
7. Distribution. Free rides, a public live board, a share URL, X. The playtest count from Friday.

**Demo, ≤ 3 min.** Separate recording.

Landing pool → connect → free ride (long enough to see the road, then skip ahead only if you say you are skipping) → pay the $5 tier → say "demo clock ×60" → lobby live row and leaderboard → end the shift → server verdict on screen → pool higher than in the opening shot. If mint or `/r/:id` exists, one shot of it. If it does not, leave it out.

**Deck, 10 slides.** Same spine as the presentation, plus an economy slide with the corrected numbers below, a "built / cut / next" slide (Plan A, no Anchor, no NFT unless Friday produced one, no replay), and a team slide of one. The Ask slide: Solana-track and overall prizes. Accelerator only if [Q5](#open-questions) says you would go to San Francisco.

- [ ] README on the submission branch: pre-existing game, built during the hackathon, how to run, what is mocked, what was cut.
- [ ] Export the deck to PDF.

### Day 5 – Sun Oct 12 – submit by noon PT

- [ ] Fresh wallet, deployed URL, whole loop. Fix only blockers.
- [ ] Submit the form with both video links, the demo URL, the repo, the deck PDF, and the disclosure.
- [ ] Post on X with the live pool number, if [Q11](#open-questions) names the account.
- [ ] Leave the afternoon for a rejected upload or a down host. Official close is 11:59pm PT.

## Economy (slide text — corrected)

v1's slide said "each round, per tier." The implementation is **one round per UTC week, all tiers together.** Weight the grand-prize draw by tier. Do not say there is a round per tier.

Each weekly round collects entry fees:

- **50% Grand prize** — among riders who finished, weight = tier. Not drawn in this build. Commit-and-reveal or a VRF is the next step. [Q8](#open-questions)
- **20% Seeds the next round** — an empty week passes the carry on. The landing number has a floor.
- **20% Top 20** — distance in the round. Ties: more rides, then earlier finish (that is what the API does). The governor is 28 m/s, so distance is time-on-road under the cap.
- **10% Platform.**

Example, unchanged arithmetic: 200 riders/week × avg $12 = $2,400 → $1,200 jackpot, $480 seed, $480 top-20, $240 fees.

Say on the slide, in this order:

- The 20% is a skill prize. The 50% is a draw. Gambling rules may apply. The submission names that, and the product is not offered as a licensed gambling service.
- Client trust: server-timed telemetry now, deterministic replay next. Badges are client-reported and pay nothing.
- The tab pauses when hidden, so backgrounding does not finish a shift. A slow machine (< 20 fps) also runs game time slower than the wall clock. The server caps reported distance by wall time.
- Devnet demo. The ×60 clock is labeled.

## Proposals

Ranked by the FAQ. The schedule above already places them. This is the reasoning, plus the form language to reuse.

**P1. Register, deploy, and take one real devnet payment before any new feature.** Product-and-execution is the factor this build can win, and it is unproven on a public URL. A judge who cannot click the demo scores the rest from the video alone.

**P2. Disclose the game in prose and submit a clean tree.** Eligibility. "Pre-existing code" is allowed. Hiding it is grounds to disqualify and to claw a prize back. Commit dates all sit inside Sep 14–Oct 12, so the log does not disclose anything. The README section in the portal checklist is the disclosure. The half-migrated `refactor/server-clean-arch` tree, if submitted broken, fails "how well does the product work."

**P3. Two videos with different jobs.** The presentation is founder, insight, market, money. The demo is the loop, with "demo clock ×60" spoken. v1's single tour tried to do both and ran out of room at the economy slide.

**P4. Company sentence.** "Freight Chain sells proven time-on-road. Riders pay for a shift, the server keeps the clock, finishers share a weekly pool. Desert Run is the first title." That is the insight factor and the market-size factor. "A Desert Bus clone with a jackpot" is a smaller company, and the overall $30k / $15k awards are judged as startups.

**P5. Go-to-market draft, until Friday's playtests replace the blanks.**

- Who first: Solana users who already sit through long on-chain spectacles and streams, plus people who will do a 3-minute free ride for a leaderboard.
- Loop: 5 free rides, then 1 a day, then a $5 / $15 / $50 shift. The free board is the habit. The paid board is the pool.
- Distribution: public live feed and leaderboard (no account needed to watch), share URL `/r/:id` when it exists, one X post per finished paid ride, the landing pool as the number worth posting.
- Why this spreads: the pool is one global number, so every new paid ride changes a page that other people are looking at.
- What is missing on purpose this week: paid acquisition, a mobile wallet flow beyond Phantom/Solflare, regions, KYC.

**P6. Demand validation = the Friday count.** The honest sentence if five people play: "N people outside the team finished a free ride on the public URL on Oct 10. M paid a devnet shift. No revenue, devnet only." The honest sentence if nobody plays: "No users yet. The demo is the validation we can offer before Oct 12." Do not invent a waitlist.

**P7. Viability, said plainly.** Sustainable business if the 10% fee covers hosts and, later, the replay and payout operations. This week the pool does not pay winners, so the fee is not a business yet. The path is: devnet payout of one round → mainnet with a published set of rules → replay so a paid finish is not a client report. Naming the gambling question on the slide is part of viability, not a footnote.

**P8. Keep the cuts visible.** GitHub FAQ: they want to see that you chose what to build. The cut list is Anchor, truck upgrades, mint-on-unlock, Telegram, replay, mainnet. Shipping Plan A and a lobby instead of a program is the choice.

**P9. Solana track, not a multi-chain demo.** Cheap entries, a wallet people already have, a memo the server can check without a program. Track prize is 10 × $10,000 on top of the overall awards. Building a second chain this week lowers the execution score.

**P10. Badges stay off the prize path.** If Friday allows a mint, click-to-mint, paid-ride wallets only, daily cap. The server keypair pays about 0.003 SOL per mint. Night / hull / route must not move lamports.

**P11. One weekly update beats a third feature.** Judges who open the project page early see progress. The FAQ says updates are not required and strongly recommended. Post one on Wednesday, and a second after the playtests if the first exists.

**P12. Skip travel, Discord-as-strategy, and Copilot-as-strategy.** In-person events do not change the form. Discord is for a concrete RPC or faucet failure. A half hour in Copilot is worth it only to see which consumer or pool projects reached the accelerator and what proof they had. Do it after the deploy, not before.

## Open questions

Defaults in the schedule assume the answer marked "assumed." A different answer changes the day it points at.

| # | Question | Changes | Assumed until you say otherwise |
|---|---|---|---|
| Q1 | Which host, and will you create the account (Railway, Fly, a VPS)? | Wed deploy | You pick the host and provide credentials. No host is wired in the repo. |
| Q2 | Register the Colosseum account yourself this week, and are you solo? | Eligibility, team fields, weekly update | Solo. You register. No teammate is added after Wednesday, because they would also need an account and a bio. |
| Q3 | Public GitHub, or private with `hackathon@colosseum.com` invited? | The repo field | Private until you say public, and the invite is part of submit day. Confirm the remote is the repo you want judged. |
| Q4 | What goes in the background and location fields? | Founder–market fit, team slide | Blank until you write it. Do not invent a bio in the deck. |
| Q5 | Are you competing for the Solana track, the overall awards, the accelerator, or all three? Accelerator means 12 weeks in San Francisco and is optional even if you win. | Ask slide, how wide the market story is | Submit for the Solana track and the overall awards. Mention the accelerator as something you would consider, not as the ask. |
| Q6 | Finish `refactor/server-clean-arch` before anything else, or freeze `d1b710b` as the submission tree? The rewrite is uncommitted and unverified. | Everything after Tuesday | Freeze `d1b710b` unless you explicitly say the rewrite is the product. Then it needs `npm run check` and the server tests green before deploy. |
| Q7 | Which devnet wallet is the demo payer, who funds it, and is that pubkey `DEMO_WALLETS`? | Wed payment, both videos | You fund it from faucet.solana.com. The same pubkey is the demo account. |
| Q8 | Leave prizes as "accounted, not paid," or do one manual devnet payout of a tiny round on camera? There is no payout key in the server today. | Viability score, Day 3 extra, economy slide | Leave them unpaid and say so in the UI, the slide, and the video. A payout needs a key that is not committed. |
| Q9 | Is there a logo already, or do you want a wordmark made? | Portal graphic | A wordmark plus the truck mark, made on Friday if you have no file. |
| Q10 | Is `freightchain.xyz` (used in v1's share copy) a domain you control? | Landing footer, `/r/:id`, the share URL in the video | Use the deploy host's URL everywhere until you confirm the domain. |
| Q11 | Which X account posts the pool number and sits in the footer? | Distribution field, Sunday post | No post until you name the account. |
| Q12 | Gambling and region: a sentence in the form only, or a real gate on who can pay? | Viability, code of conduct, time | A sentence only. No geo gate this week. The draw is described as not yet live. |
| Q13 | Company frame in the video: one game, or a proof-of-attention pool whose first title is this game? | Market size, insight | The pool is the company. Desert Run is the first title. The demo still shows the game, because that is what works. |
| Q14 | Who are the five playtesters on Friday, and can they use Phantom on devnet? | The only demand number | You name them Thursday. If they cannot pay, their free-ride finishes still count, and paid demand stays "the team only." |
| Q15 | Where would a mint-authority or payout secret live if Q8 or the Friday mint happens? | Whether those extras are safe to build | Do not build either until there is an answer that is not "in the repo" and not "in chat." |

## What not to do this week

Mainnet · a Wallet-adapter or React rewrite · Telegram Mini App · the deterministic replay core · trailer collisions · Anchor · truck upgrades · mint-on-unlock · a second chain · anything in `AGENTS.md` "Not implemented" that is not on the "built / cut / next" slide · submitting the dirty `refactor/server-clean-arch` tree · a single video that tries to be both the pitch and the demo · claiming the pool pays winners.

## Known gaps to mention if asked (do not pretend they are fixed)

- Mid-ride reload is refused. The credit stays spent for up to 150 s.
- A second payment for one ride is not credited and there is no refund.
- Unknown transaction versions make `confirm` return 503.
- `reconcile` sees only the latest 25 transactions.
- No rate limits on auth, live, leaderboard, or payment routes.
- Achievements for night, hull, and route trust the client.
- Solflare has not been run. Phantom has not been run.
- The paid "waiting" banner has not been seen in a browser.
- Landing → lobby with a real wallet has not been done.
- Public devnet RPC without `SOLANA_RPC` will rate-limit the demo.
