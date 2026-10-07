# Freight Chain → Colosseum "Crypto World's Fair" – plan

The one plan file (the v1 plan is gone; its day-by-day record is condensed in [What is built](#what-is-built-and-how-it-was-checked)). Status as of **Tue Oct 7, 2026, end of day**. Built on the [Colosseum hackathon FAQ](https://colosseum.com/hackathon#faqs) (19 questions) and the prize figures on [colosseum.com/worldsfair](https://colosseum.com/worldsfair).

Deadline: **11:59pm PT, Oct 12, 2026** (runs Sep 14 – Oct 12). Working deadline stays **noon PT Oct 12**, so a broken demo can still be fixed. Five days left (Oct 8–12).

`docs/day-1.md` is a stale Day 1 note (says Day 1 was uncommitted). Ignore it; this file is the source of truth.

## Where we are

| Area | State |
|---|---|
| Game (`client/js`) | Pre-existing prototype, unchanged in behaviour. Online mode (`play.html?ride=<id>`) takes seed + shift from the server and heartbeats it. |
| Server (`server/`) | **Finished rewrite on `main`**: NestJS 12 + Prisma + PostgreSQL, Clean Architecture + CQRS. 307 Docker-free tests + 108 integration tests on real PostgreSQL, architecture and test-pyramid audits, forward-only migrations, rate limiting, request ids, RFC 9457 errors. `docs/backend-architecture.md`. |
| Money | Plan A: memo-checked SOL transfer to a treasury **public key**, one global UTC-week pool 50/20/20/10 in integer lamports. Proven against a fake chain and against the shape of real devnet transactions. **No payment to this treasury has ever been made.** `settled: false` – no draw, no payout. |
| Lobby (`client/site/`) | New ride · Live · Leaderboard · Profile, persisted achievements. Free loop click-tested (`server/scripts/e2e-lobby.mjs`, 32 checks). Paid purchase never done with a real wallet. |
| Landing (`landing/`) | **Built, on `main` once this lands**: Vite 7, seven chapters, live ticker and boards from the public API, dash cards rendered by the game's own cockpit code, WebP media, async hero video slot, wallet sign-in + session + redirect (verified with `landing/tools/e2e-wallet.mjs`, single origin and split hosts), 44 tests incl. a size budget. Needs the gameplay video, socials, a deploy. |
| Deploy (`deploy/`) | **Tooling exists**, never run against a host: `npm run deploy` (checks → plan → confirm → upload → Docker build incl. the landing → backup → migrate → swap → health + smoke). Three hosts: apex = landing + lobby, `ride.<apex>` = game, `api.<apex>` = API, one cert, session cookie scoped to the apex. |
| Colosseum | Not registered, no project page, no weekly update, no videos, no form drafted. |

The critical path is unchanged: **a public URL, one real devnet payment, two videos, the form.** Everything else is optional.

## Prizes (World's Fair page, not the FAQ)

| Award | Amount | Who decides |
|---|---|---|
| Grand prize | $30,000 | Colosseum, across every track |
| Next 20 projects | $15,000 each ($300,000) | Colosseum |
| Public good / University | $5,000 each | Colosseum |
| Solana track | $100,000, ten projects at $10,000 | Track judges, on top of the awards above |
| Accelerator, if offered and accepted | $250,000 pre-seed, 12 weeks in San Francisco | Optional. Winning does not require joining |

Headline on the fair page: $840,000 in prizes and $2.5 million in seed funding. Any chain can win the overall awards. The Solana track is the realistic prize for this product. The overall awards favor a company story with a market and some demand.

## What the FAQ requires (and the first plan never scheduled)

- Judges score seven startup factors, not "the video, the demo URL, the economy slide." The form is a venture application.
- Two videos: a 2–3 min presentation, and a separate product demo of at most 3 min.
- Registration, a logo, a founder bio, location, chains/tools, go-to-market, demand validation, and a distribution plan are form fields.
- Weekly updates are strongly recommended (one-minute video). None have been posted. The window is in week 4.
- Pre-existing game code must be disclosed in prose. Git dates will not show the split: the first commit is Oct 6 and the game lands Oct 7, inside the window.
- The economy slide must say **one global weekly round**, weighted by tier – not "one round per tier."

## Ground rules

- **Devnet only.** Judges will not pay mainnet SOL. Prices are "$5 / $15 / $50 in SOL" at the live SOL/USD rate, paid in devnet SOL.
- **Demo-time multiplier.** A 1 h / 4 h / 8 h ride cannot be shown in a 3-min video. Server-side `demoScale` (only on a flagged `DEMO_WALLETS` account) runs the paid ride clock ×60. Say "demo clock ×60" out loud in the demo video.
- **Keep the front end vanilla.** The game and lobby are plain ES modules; the landing is a small Vite project with no framework (~36 kB gzipped JS, no three.js). One NestJS backend does auth, rides, pool. No React, no Next. The FAQ does not score language or framework.
- **Plan A is the chain story.** Memo-checked SOL transfer to a treasury pubkey. Anchor was cut because the toolchain was not installed and the Day 1 gate said to stop. Name that cut in the form and the repo ("prioritized on purpose" is what the GitHub FAQ asks for).
- **Pitch matches the build.** Server-timed driving shift, entry fee in, weekly pool accounted in integer lamports, finish decided by the server, prizes accounted and not yet paid. Achievements are badges. Night, hull, and route are client-reported.
- **One product.** Replay, Telegram, and spectator sabotage stay on the roadmap slide.
- **Cut order if behind** (last → first to go): one manual devnet payout → click-to-mint badges → `/r/:id` share page → truck upgrades (already cut) → Anchor (already cut). Deploy, the real devnet payment, both videos and the form do not get cut.

## Submission portal

Hackathon builders should treat the form as a pitch to the venture fund. Every submission is reviewed. Written feedback goes only to the shortlist, who get a 15-minute Zoom about a month later. The form has to stand alone.

- [ ] Colosseum account, joined to Crypto World's Fair (every teammate too, if one is added). [Q2](#open-questions)
- [ ] Product name and one-line description.
- [ ] Logo or graphic. [Q9](#open-questions)
- [ ] Chains and tools: Solana devnet, Phantom / Solflare, Sign-In With Solana (`tweetnacl`), SPL-less System transfer + Memo, Coinbase then CoinGecko for SOL/USD, NestJS, Prisma, PostgreSQL, Docker. Anchor, Metaplex, Pyth, and VRF are not integrated.
- [ ] Team: solo unless [Q2](#open-questions) says otherwise. Background and location are required fields and are not in the repo. [Q4](#open-questions)
- [ ] GitHub: <https://github.com/recferret-bit/freightchain>. Public, or private with read access for `hackathon@colosseum.com`. [Q3](#open-questions). Submit `main`.
- [ ] Disclosure of pre-existing work, in the form, in the same words as the README:
  - Before this hackathon: the driving sim (`client/js`, `client/play.html`, themes, cockpit, traffic, climate). It is a prototype, not a funded company.
  - During the window: `server/` (auth, rides, payments, pool, leaderboard, achievements), `client/site/` (lobby, wallet, pay), `client/js/online.js`, `landing/`, `deploy/`, these docs.
  - Commits: `2640f87` Oct 6 initial, `0e85441` + `9476a4c` Oct 7 game, `9378439` Day 0, `843f71e` Day 1, `d1b710b` Day 2, `634c617` server rewrite, `5a6cbb2` deploy, landing commits on top.
  - Not built: settlement, payouts, NFT mint, replay, mainnet.
- [ ] Presentation video, 2–3 minutes. Script in [Day 4](#day-4--sat-oct-11--form-deck-both-videos).
- [ ] Product-demo video, ≤ 3 minutes. Separate file from the presentation.
- [ ] Go-to-market, demand validation, distribution. Draft answers in [Proposals](#proposals); the landing's "Go to market" load board is the same content. The playtest count is the only demand number still reachable. [Q14](#open-questions)
- [ ] Live demo URL on the deployed host. A stranger can open it and finish a free ride.
- [ ] One weekly-update video, about one minute: server rewrite + landing + deploy tooling shipped, paid path proven against a fake chain, next is deploy and a real devnet payment.

## Architecture (as built)

```
apex            landing (/)  ·  lobby (/lobby.html)         ← landing/dist in front of client/
ride.<apex>     the game (/play.html?ride=ID), locked to a server-issued ride
api.<apex>      NestJS /api: auth/nonce auth/verify auth/logout me · rides (create, start,
                heartbeat, end, payment, confirm, reconcile, pending) · tiers · pool ·
                leaderboard · live · profile · health
postgres        Prisma, one PG schema per context (player · ride · economy · achievement)
chain           not a program: SystemProgram.transfer + Memo, checked by the server
/r/:id          public ride page — only if time allows
```

On localhost, an IP or `file://` the hosts (apex, `ride.`, `api.`, `storybook.`) collapse into one origin (`client/js/hosts.js`), and `npm run server:dev` serves everything on :3000.

- **Auth** — done. Sign-In With Solana: server-built challenge (5 min, single use) → wallet `signMessage` → ed25519 verified over the stored message → httpOnly `fc_session` cookie (Domain = apex in production). Verified end to end from the landing with a fake wallet that signs with WebCrypto ed25519, including a forged signature being refused. **Never run with a real Phantom or Solflare.**
- **Ride lifecycle** — done. Server owns `seed`, `minSeconds`, `completeDist`, and the verdict `completed / abandoned / failed`. Heartbeat every 10 s. A gap > 150 s fails the ride. Distance may grow at ≤ 28 m/s · 1.2. This is server-timed telemetry; a modified client can still lie inside the speed bound. Fixed-point replay (`technical_design_document.html`) is roadmap.
- **Payments** — Plan A. Quote from Coinbase, then CoinGecko, locked onto the order for 10 min. Unsigned transaction built per click; the server checks a System transfer wallet→treasury of ≥ the quote, memo = ride id, `meta.err` null, fee payer = wallet; the signature is a unique key. Reconcile recovers a payment whose confirm call never arrived. Treasury is a public key only – the server holds no payout secret.
- **Pool** — one global UTC-week round. Every paid entry counts, whatever the outcome. 50% grand (+ carried seed) · 20% top-20 · 20% next round's seed · 10% fees. Floors, remainder to fees. `settled: false`.
- **Free rides** — 180 s, no pool entry, 5 at signup, +1 per UTC day. Own leaderboard. Achievements count.
- **demoScale** — `DEMO_WALLETS` divides paid-shift length by 60. The free tier and the speed bound stay put.
- **Race safety** — everything a wallet does to rides, credits and payments runs in one transaction under the player row lock; rounds are locked when paid into or closed (`docs/backend-architecture.md`, race table + concurrency tests).
- **Grand prize draw** — not built. Options: ORAO / Switchboard VRF, or a server commit-and-reveal. Default for the submission: "accounted, not drawn, not paid," unless [Q8](#open-questions) asks for one manual devnet payout.

## What is built, and how it was checked

### Days 0–2 (the first plan's record, condensed)

- **Day 0 – foundations.** Repo split `client/` + `server/`; SIWS auth; ride lifecycle API + opt-in game hooks (`client/js/online.js`). *Checked by:* the server suite (valid sign-in; wrong key, replay, expiry, never-issued message all rejected; complete / pause / idle / teleport / dead heartbeat verdicts), `server/scripts/e2e-browser.mjs` in real Chrome (sign-in → free ride → server's seed/shift → heartbeats → END SHIFT → COMPLETED), client `check` with `trace:diff` identical. Stand-ins: a 6 s test shift, injected distance, a keypair instead of a wallet.
- **Day 1 – money.** SOL/USD quote (Coinbase → CoinGecko, cached, bounded, stale fallback), order with locked lamports and a 10 min expiry, on-chain payment check, signature uniqueness, reconcile, one global weekly pool, `demoScale`, leaderboard. *Checked by:* 23 payment scenarios against a fake chain (underpaid, wrong memo / destination / source, paid by someone else, failed on chain, extra instructions accepted, pending → paid, signature reuse, paid-after-expiry, owner isolation), a property test (2000 random splits sum exactly), week-boundary tests, and `server/scripts/check-rpc-shape.mjs` on real devnet transactions. **Plan B (Anchor escrow) was not attempted** – no toolchain.
- **Day 2 – lobby.** Four tabs, live feed (no ids, seeds or free-text reasons), profile, persisted achievements (First Mile · Shift Complete · Night Owl · Century · Clean Run · Cold Start; Top 20 not awarded until a round closes), free-ride vs paid purchase rules. *Checked by:* `server/scripts/e2e-lobby.mjs` (32 checks, 0 page errors) and screenshots of every tab at desktop and phone width.

### Server rewrite and deploy (Oct 7, after Day 2)

- `634c617` / PR #1: SQLite server replaced by Prisma + PostgreSQL, Clean Architecture + CQRS, Zod at every boundary, problem+json errors, rate limits (`THROTTLE_LIMIT`, `THROTTLE_AUTH_LIMIT`; per-IP counts need `TRUST_PROXY`), request ids, architecture and test-pyramid audits. All earlier behaviour kept; the old suite became HTTP scenarios that run on in-memory repositories **and** on real PostgreSQL.
- `5a6cbb2` / `17f75cd`: semi-automatic deploy (`deploy/`, README inside), split hosts, `client/js/hosts.js`. **Not run against a host yet.**

### Landing (`landing/`, merged onto the rewrite)

Own Vite 7 project; Nest serves `landing/dist` at `/` in front of `client/` (immutable hashed assets, `no-cache` pages, gzip). Palette lifted from the cab; public API only; server text via `textContent`. Seven chapters: **01 ride** (hero with live counters, WebP slideshow, optional gameplay loop) · **02 loop** (flow, six mechanics, four-phase realtime daytime collage, six dash cards that animate live on hover) · **03 your freighter** (garage catalogue, clearly *not in this build*) · **04 economy & what the server checks** (pool card, tier table at the live price, live / next-up / top-10 boards) · **05 roadmap** (trip sheet) · **06 go to market** (load board, live fill) · **07 about** (Desert Bus, built / cut / next, stack, disclosure, socials when set). Plus a live ticker and a sticky top bar with the wallet chip once signed in.

- `GET /api/live` also carries `upcoming` (paid, unstarted), `recent` (last 12 ended) and `totals`; same privacy rule as before (no ids, seeds, reasons). Ported onto the new server with unit, PostgreSQL integration and HTTP-scenario tests.
- **Sign-in from the landing:** CONNECT → wallet signs → backend verifies → cookie → redirect to the lobby; back on `/`, `GET /api/me` shows the wallet chip and OPEN THE LOBBY. Links to the game go through `GAME_BASE`, API calls through `API_BASE`.
- **Hero video** is off the critical path: `data-src` on `#hero-video` (empty = none), fetched after `load` when idle, skipped on phones / data-saver / reduced motion.
- **Dash cards** run the game's cockpit code (`client/js/cockpit`, no three.js) into one hidden canvas; per-card scripts in `landing/src/dash-scenes.js`.
- Media is WebP (2.7 MB → 0.48 MB), `og.jpg` for link previews; no unused images (a test guards it).
- *Checked by:* `npm run check` (client `errors=0`; landing lint, build, 44 tests incl. a size budget; server build, typecheck, 307 tests); server integration 108 tests; `docker build` of the production image; `e2e-lobby.mjs` 32/32 against the built server; **`landing/tools/e2e-wallet.mjs`** (no wallet, rejected, forged signature refused with no session, success → redirect → httpOnly cookie, session recognised on return) on one origin **and** on simulated split hosts (`*.localhost`, cookie Domain = apex, CORS, game link on `ride.<apex>`); headless-Chrome tour of all chapters against the real API.
- **Needs a human eye:** a real phone, Safari, a non-zero pot, the live dash cards on a real GPU, copy.
- **Still to do by you:** record the gameplay loop → `landing/public/media/hero.mp4` and set `data-src`; the ≤ 3 min demo → `DEMO_VIDEO` in `landing/src/main.js`; fill `SOCIALS` ([Q11](#open-questions)); deploy.

## Remaining schedule

### Wed Oct 8 – decisions, account, deploy, one real payment

- [ ] Answer [Q1](#open-questions)–[Q5](#open-questions), [Q7](#open-questions). The deploy waits on the server and the domain.
- [ ] Register on Colosseum and join World's Fair. The project page has to exist before the weekly update.
- [ ] `npm run deploy:init`, fill `deploy/.env` (`DEPLOY_DOMAIN`, Let's Encrypt email), three DNS A records (`@`, `ride`, `api`), then `npm run deploy` (commit first: it ships `git archive HEAD`). Use `--dry-run` first. Set a non-public `SOLANA_RPC`.
- [ ] Fund a devnet wallet at <https://faucet.solana.com>; put that pubkey in `DEMO_WALLETS`. [Q7](#open-questions)
- [ ] Run the paid loop for real with Phantom on Devnet: lobby → `1H · $5` → pool lamports increase → ×60 shift → server verdict → leaderboard row. `server/scripts/devnet-pay.mjs` is the scripted version of the same loop.
- [ ] By hand with the same wallet: landing → CONNECT → lobby → START FREE RIDE → drive a real 3 min. This is the check headless Chrome cannot do, and the first time a real Phantom/Solflare signs in.
- [ ] Post the one-minute weekly update: what shipped Oct 7, paid path proven on devnet or still blocked (name the blocker).
- Done when: a URL you can send a stranger loads the landing, sign-in works with a real wallet, and one devnet signature is a row in `payments` and in `GET /api/pool`.

### Thu Oct 9 – gameplay video, landing polish, README

- [ ] Record the gameplay loop (real Chrome, clean profile); drop it in `landing/public/media/`, set `data-src`; rebuild and redeploy.
- [ ] README on `main`: the disclosure paragraph above, how to run, what is mocked, what was cut. (The README already has run / landing sections.)
- [ ] Eyeball the landing on a real phone and Safari, with a non-zero pot (pay once, or seed one).

### Fri Oct 10 – words, playtests, only then extras

- [ ] Draft the form answers: one-line description, tools list, bio, location, go-to-market, distribution. Use [Proposals](#proposals) P4–P6 as the draft.
- [ ] Five playtests on the deployed URL by people other than you. Record how many finished a free ride and how many tried a paid tier. That number is the demand-validation answer; the landing's playtest row stays "–" until then.
- [ ] Logo. [Q9](#open-questions)
- [ ] Fix only blockers found by those playtests (wallet sign-in, paid banner, deploy crash). Mid-ride reload burning a credit is a known gap from the first build; re-check it on the new server and fix it only if a playtester hits it.
- [ ] If the day is still open, in this order:
  1. `/r/:id` — server-rendered page, static image per route, the URL the demo's share beat can open.
  2. Click-to-mint for wallets with at least one paid ride, daily cap, server pays ~0.003 SOL. Skip Top 20 (the round has not closed). Skip mint-on-unlock: free throwaway wallets and client-asserted facts would drain the mint wallet.
  3. One devnet payout of a tiny round only if [Q8](#open-questions) is yes and the treasury secret has a home that is not the repo.

### Day 4 – Sat Oct 11 – form, deck, both videos

Record on real Chrome, clean profile, deployed URL. Headless SwiftShader is too slow. The standalone file is the offline fallback, not the demo URL.

**Presentation, 2–3 min.** Talk to the seven factors. No UI tour.

1. Insight. Desert Bus showed that people will watch a boring drive. The scarce thing is proven time on the road.
2. Product in one sentence. Freight Chain sells a shift. The server keeps the clock. Finishers share one weekly pool. This truck game is the first title.
3. Why you. [Q4](#open-questions). You shipped the sim and, this week, the money loop, the server, the deploy and the landing.
4. Market. One number, labeled as a wedge: skill-prize and spectator gaming, with Solana consumer wallets as the way in. The company is a proof-of-attention pool. The game is the first market.
5. How it makes money. 10% of each weekly pool. 20% seeds the next week so the number on the landing page is never zero. 50% is a draw among finishers, weight = tier. 20% is a skill prize by distance.
6. What a judge can do today. Devnet. Connect, free ride, pay, watch the pool move, get a server verdict. Prizes are accounted. Draw and payout are the next milestone. Anti-cheat today is server time plus a speed bound. Replay is next, on purpose.
7. Distribution. Free rides, a public live board, a share URL, X. The playtest count from Friday.

**Demo, ≤ 3 min.** Separate recording. Landing pool → connect → free ride (long enough to see the road; skip ahead only if you say you are skipping) → pay the $5 tier → say "demo clock ×60" → lobby live row and leaderboard → end the shift → server verdict on screen → pool higher than in the opening shot. If mint or `/r/:id` exists, one shot of it; if not, leave it out.

**Deck, 10 slides.** Same spine as the presentation, plus an economy slide with the numbers below, a "built / cut / next" slide (Plan A, no Anchor, no NFT unless Friday produced one, no replay), and a team slide of one. The Ask slide: Solana-track and overall prizes. Accelerator only if [Q5](#open-questions) says you would go to San Francisco.

- [ ] Export the deck to PDF.

### Day 5 – Sun Oct 12 – submit by noon PT

- [ ] Fresh wallet, deployed URL, whole loop. Fix only blockers.
- [ ] Submit the form with both video links, the demo URL, the repo, the deck PDF, and the disclosure.
- [ ] Post on X with the live pool number, if [Q11](#open-questions) names the account.
- [ ] Leave the afternoon for a rejected upload or a down host. Official close is 11:59pm PT.

## Economy (slide text)

**One round per UTC week, all tiers together.** Weight the grand-prize draw by tier. Do not say there is a round per tier.

Each weekly round collects entry fees:

- **50% Grand prize** — among riders who finished, weight = tier. Not drawn in this build. Commit-and-reveal or a VRF is the next step. [Q8](#open-questions)
- **20% Seeds the next round** — an empty week passes the carry on. The landing number has a floor.
- **20% Top 20** — distance in the round. Ties: more rides, then earlier finish (that is what the API does). The governor is 28 m/s, so distance is time-on-road under the cap.
- **10% Platform.**

Example: 200 riders/week × avg $12 = $2,400 → $1,200 jackpot, $480 seed, $480 top-20, $240 fees.

Say on the slide, in this order:

- The 20% is a skill prize. The 50% is a draw. Gambling rules may apply. The submission names that, and the product is not offered as a licensed gambling service.
- Client trust: server-timed telemetry now, deterministic replay next. Badges are client-reported and pay nothing.
- The tab pauses when hidden, so backgrounding does not finish a shift. A slow machine (< 20 fps) also runs game time slower than the wall clock. The server caps reported distance by wall time.
- Devnet demo. The ×60 clock is labeled.

## Proposals

Ranked by the FAQ. The schedule above already places them. This is the reasoning, plus the form language to reuse.

**P1. Deploy and take one real devnet payment before any new feature.** Product-and-execution is the factor this build can win, and it is unproven on a public URL. A judge who cannot click the demo scores the rest from the video alone.

**P2. Disclose the game in prose and submit `main`.** Eligibility. "Pre-existing code" is allowed. Hiding it is grounds to disqualify and to claw a prize back. Commit dates all sit inside Sep 14–Oct 12, so the log does not disclose anything. The README section is the disclosure. (The half-migrated server tree that worried the first plan is finished and green.)

**P3. Two videos with different jobs.** The presentation is founder, insight, market, money. The demo is the loop, with "demo clock ×60" spoken.

**P4. Company sentence.** "Freight Chain sells proven time-on-road. Riders pay for a shift, the server keeps the clock, finishers share a weekly pool. Desert Run is the first title." That is the insight factor and the market-size factor. "A Desert Bus clone with a jackpot" is a smaller company, and the overall $30k / $15k awards are judged as startups.

**P5. Go-to-market draft, until Friday's playtests replace the blanks.** (Same content as the landing's load board.)

- Who first: Solana users who already sit through long on-chain spectacles and streams, plus people who will do a 3-minute free ride for a leaderboard.
- Loop: 5 free rides, then 1 a day, then a $5 / $15 / $50 shift. The free board is the habit. The paid board is the pool.
- Distribution: public live feed and leaderboard (no account needed to watch), share URL `/r/:id` when it exists, one X post per finished paid ride, the landing pool as the number worth posting.
- Why this spreads: the pool is one global number, so every new paid ride changes a page that other people are looking at.
- What is missing on purpose this week: paid acquisition, a mobile wallet flow beyond Phantom/Solflare, regions, KYC.

**P6. Demand validation = the Friday count.** The honest sentence if five people play: "N people outside the team finished a free ride on the public URL on Oct 10. M paid a devnet shift. No revenue, devnet only." The honest sentence if nobody plays: "No users yet. The demo is the validation we can offer before Oct 12." Do not invent a waitlist.

**P7. Viability, said plainly.** Sustainable business if the 10% fee covers hosts and, later, the replay and payout operations. This week the pool does not pay winners, so the fee is not a business yet. The path is: devnet payout of one round → mainnet with a published set of rules → replay so a paid finish is not a client report. Naming the gambling question on the slide is part of viability, not a footnote.

**P8. Keep the cuts visible.** The cut list is Anchor, truck upgrades, mint-on-unlock, Telegram, replay, mainnet. Shipping Plan A and a lobby instead of a program is the choice. The landing's roadmap and "built / cut / next" already say so.

**P9. Solana track, not a multi-chain demo.** Cheap entries, a wallet people already have, a memo the server can check without a program. Track prize is 10 × $10,000 on top of the overall awards.

**P10. Badges stay off the prize path.** If Friday allows a mint: click-to-mint, paid-ride wallets only, daily cap. Night / hull / route must not move lamports.

**P11. One weekly update beats a third feature.** Post one on Wednesday, and a second after the playtests if the first exists.

**P12. Skip travel, Discord-as-strategy, and Copilot-as-strategy.** Discord only for a concrete RPC or faucet failure. A half hour in Copilot is worth it only to see which consumer or pool projects reached the accelerator and what proof they had — after the deploy, not before.

## Open questions

Defaults in the schedule assume the answer marked "assumed." A different answer changes the day it points at. Q6 is closed.

| # | Question | Changes | Assumed until you say otherwise |
|---|---|---|---|
| Q1 | Which server and domain? `deploy/` targets one Linux box (Docker + nginx + certbot) and its docs use `freightchain.fun`. | Wed deploy | You provide an ssh-reachable server and own the domain; DNS A records `@`, `ride`, `api`. Nothing is deployed until then. |
| Q2 | Register the Colosseum account yourself this week, and are you solo? | Eligibility, team fields, weekly update | Solo. You register. No teammate is added after Wednesday. |
| Q3 | Public GitHub, or private with `hackathon@colosseum.com` invited? | The repo field | Private until you say public; the invite is part of submit day. Confirm the remote is the repo you want judged. |
| Q4 | What goes in the background and location fields? | Founder–market fit, team slide | Blank until you write it. Do not invent a bio in the deck. |
| Q5 | Solana track, overall awards, accelerator, or all three? The accelerator is 12 weeks in San Francisco and optional even if you win. | Ask slide, how wide the market story is | Solana track and overall awards. Mention the accelerator as something you would consider, not as the ask. |
| Q6 | ~~Finish the server rewrite or freeze `d1b710b`?~~ | — | **Closed:** the rewrite is finished, merged to `main`, `npm run check` + 108 integration tests green. `main` is the submission. |
| Q7 | Which devnet wallet is the demo payer, who funds it, and is that pubkey in `DEMO_WALLETS`? | Wed payment, both videos | You fund it from faucet.solana.com. The same pubkey is the demo account. |
| Q8 | Leave prizes as "accounted, not paid," or one manual devnet payout of a tiny round on camera? There is no payout key in the server. | Viability score, Friday extra, economy slide | Leave them unpaid and say so in the UI, the slide, and the video. |
| Q9 | Is there a logo, or do you want a wordmark made? | Portal graphic | A wordmark plus the truck mark (the landing's favicon and header already use it), made Friday if you have no file. |
| Q10 | Which domain do the share URL and the footer use – `freightchain.fun` (the deploy docs) or `freightchain.xyz` (the first plan's share copy)? | Landing footer, `/r/:id`, the video | The deploy host's URL everywhere until you confirm. |
| Q11 | Which X account posts the pool number and sits in the footer? | Distribution field, Sunday post, `SOCIALS` in the landing | No post, no social buttons until you name the account. |
| Q12 | Gambling and region: a sentence in the form only, or a real gate on who can pay? | Viability, code of conduct, time | A sentence only. No geo gate this week. The draw is described as not yet live. |
| Q13 | Company frame in the video: one game, or a proof-of-attention pool whose first title is this game? | Market size, insight | The pool is the company. Desert Run is the first title. The demo still shows the game. |
| Q14 | Who are the five playtesters on Friday, and can they use Phantom on devnet? | The only demand number | You name them Thursday. If they cannot pay, their free-ride finishes still count, and paid demand stays "the team only." |
| Q15 | Where would a mint-authority or payout secret live if Q8 or the Friday mint happens? | Whether those extras are safe to build | Do not build either until there is an answer that is not "in the repo" and not "in chat." |

## What not to do this week

Mainnet · a Wallet-adapter or React rewrite · Telegram Mini App · the deterministic replay core · trailer collisions · Anchor · truck upgrades · mint-on-unlock · a second chain · anything in `AGENTS.md` "Not implemented" that is not on the "built / cut / next" slide · a single video that tries to be both the pitch and the demo · claiming the pool pays winners · running `npm run deploy` against a live server without `--dry-run` first.

## Known gaps to mention if asked (do not pretend they are fixed)

- Completion is server-timed telemetry, not a replay; a modified client can lie inside the speed bound.
- Achievements for night, hull, and route trust the client.
- **Phantom and Solflare have never been run** (sign-in or payment); the wallet code is written against their documented shapes and tested with a keypair / WebCrypto stand-in.
- **No payment to this treasury has been made;** the paid "waiting" banner has not been seen in a browser; landing → lobby has not been done with a real wallet.
- Nothing is deployed from the new tooling yet.
- Mid-ride reload is refused and the credit stays spent for up to 150 s (from the first build; not re-checked on the new server).
- A second payment for one ride may not be credited and there is no refund; unknown transaction versions make `confirm` return 503; `reconcile` sees only the wallet's latest 25 transactions (first-build behaviour, re-check before claiming otherwise).
- Public devnet RPC without `SOLANA_RPC` will rate-limit the demo.
- Settlement, draw and payouts do not exist; the pool is accounted only.
- Landing: a signed-out visit logs a 401 for `/api/me` (that is how the page learns you are signed out); the hero gameplay loop and demo video do not exist yet, so the slideshow and the explanatory dialog are what visitors see.
