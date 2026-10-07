# Freight Chain → Colosseum "Crypto World's Fair" – 6-day plan

Deadline: **Oct 12, 2026** (hackathon runs Sep 14 – Oct 12; Solana track). Today is Oct 7, ~5 d 22 h left.
Submission = Colosseum account + product form (disclose the pre-existing game code), pitch video, live demo URL, GitHub.

## Ground rules (read first)

- **Judges see 3 things: the video, the demo URL, the economy slide.** Everything below is ordered by how much it adds to those three.
- **Devnet only.** Judges will not pay mainnet SOL. Prices are "$5 / $15 / $50 in SOL" at the live SOL/USD rate, paid in devnet SOL.
- **Demo-time multiplier.** A 1 h / 4 h / 8 h ride cannot be shown in a 3-min video. Server-side `demoScale` (only on a flagged demo account) runs the ride clock ×60. Say so in the video – don't fake it.
- **Keep the stack vanilla.** The game has no bundler; the landing and lobby are plain HTML + ES modules too. One small Node backend (NestJS + SQLite) does auth, rides, pool, NFT mint. No React, no Next.
- **Cut order if behind** (last → first to go): social OG images → truck upgrades → on-chain NFT mint (keep off-chain badges + "mint" button) → Anchor program (fall back to SOL transfer to treasury + tx verification).

## Architecture (decide today)

```
/              landing (static)
/lobby         lobby: Leaderboard · Live rides · Profile · New ride
/play?ride=ID  the existing game (index.html → play.html), locked to a server-issued ride
/r/ID          public ride page (share target, OG image)
server/        NestJS: /auth/nonce /auth/verify  /rides /rides/:id/heartbeat /rides/:id/end
               /pool  /leaderboard  /profile  /achievements/mint  /upgrades
chain/         (optional) Anchor program `freight_pool`: enter(tier), settle(round)
```

- **Auth** = Sign-In-With-Solana: client `window.solana.signMessage(nonce)` (Phantom/Solflare injected provider; add Wallet Standard discovery if time), server verifies with `tweetnacl` + `bs58`, issues an httpOnly JWT. ~2 h.
- **Ride lifecycle (this is the anti-cheat for the hackathon)**: server creates the ride `{id, tier, minSeconds, completeDist, seed, startedAt}` and signs it; the client loads `/play?ride=ID`, `CFG.RIDE_MIN_SECONDS` / `COMPLETE_DIST` / `roads.seed` come from the server, not `config.js`. Client posts a heartbeat every 10 s `{s, v, hull, t}`; server rejects gaps > 30 s, `s` jumps > MAX_SPEED·dt, and marks `complete` only when **server** time ≥ minSeconds and reported `s` ≥ completeDist. `/end` → server writes the result; the client never decides payout.
  Note for the deck: the full deterministic replay (fixed-point core, input ratchet) from `technical_design_document.html` is "next"; this is server-timed telemetry.
- **Payments**: tier price in lamports from a cached SOL/USD quote (Pyth Hermes or CoinGecko, 60 s cache).
  - **Plan A (fast, ~3 h)**: client sends `SystemProgram.transfer` to the treasury wallet with a Memo = rideId; server `getTransaction`, checks amount + memo → ride goes `paid`. Pool split is accounting in the DB, payouts by a server keypair.
  - **Plan B (Solana-track points, ~1 day if you know Anchor)**: `freight_pool` program – `Round` PDA holds lamports; `enter(tier)` transfers + records the entrant; `settle(round, winners[])` (admin-signed, winners computed off-chain from the leaderboard + the draw) pays 50/20/20/10. Decide by **end of Day 1 morning**: if the program isn't compiling + entering by then, go Plan A and describe B in the deck.
- **Free rides**: tier `free` = 180 s, small `completeDist`; `freeRides` counter: 5 at registration, +1 per UTC day (lazy-granted on login), no pool entry, counts for achievements + its own leaderboard.
- **Grand prize draw**: among finishers of the round, weighted by tier. Use ORAO VRF or Switchboard randomness if Plan B; otherwise server draw with a published commit (hash) before the round closes and the seed revealed after – say which one in the deck.

## Day-by-day

### Day 0 – Tue Oct 7 (rest of today) – foundations  ·  status: 4 of 5 done, deploy blocked on an account
- [~] Register on Colosseum – **skipped on request** (do it before submitting; disclose the existing game code).
- [x] Repo split: `client/` (the game, untouched behaviour) + `server/` (**NestJS 12 + TypeScript, ESM, `node:sqlite`** – changed from the Fastify/better-sqlite3 sketch: no native addon to build). `index.html` → `play.html`; new `index.html` (landing placeholder) and `lobby.html` (placeholder: wallet, free rides, START FREE RIDE). Nest serves `client/` and `/api` from one origin. Root `package.json` delegates (`npm run server:dev`, `server:test`, `client:check`, `check`).
  *Verified by:* `npm run check` in `client/` (lint + bundle + headless, errors=0) and `trace:diff` = **trace identical** after the move and again after the online-mode hooks; `e2e-chrome.mjs` offline run, 0 problems; the standalone build still builds (`client/dist/freightchain.html`).
- [ ] **Deploy skeleton to Railway/Fly – NOT done**: needs your account/credentials. The server is ready for it (`npm run build` → `node dist/main.js`, `NODE_ENV=production`, **`JWT_SECRET` required**, `APP_DOMAIN`/`APP_ORIGIN` = the public host, a persistent volume for `DB_PATH`; see `server/.env.example`). Tell me which host and I'll add the config.
- [x] SIWS auth end-to-end: `POST /api/auth/nonce` (server-built message, 5 min, single use, burnt on the first attempt) → wallet `signMessage` → `POST /api/auth/verify` (ed25519 over the *stored* message via tweetnacl) → httpOnly `fc_session` JWT cookie → `GET /api/me`. Free rides: 5 at signup, +1 per UTC day (lazy, no backlog).
  *Verified by:* `npm run server:test` – 10 vitest/supertest cases (valid sign-in; wrong key, replay, expired, never-issued message, non-address all rejected; credits, daily grant, owner isolation). **Not verified with a real Phantom/Solflare** – `client/site/wallet.js` (connect → signMessage → base58) is written against their documented API but only ever ran with a keypair standing in.
- [x] Ride lifecycle API + game hooks: `POST /api/rides {tier:'free'}` → `{id, seed, minSeconds: 180, completeDist}`; `/start`, `/heartbeat` (10 s, carries `paused`), `/end {outcome}`. Server decides `completed / abandoned / failed`: driven time (honest pauses excluded) ≥ min AND reported distance ≥ `completeDist`, distance may only grow at ≤ 28 m/s·1.2, heartbeat gap > 150 s fails the ride. Game side is **opt-in** (`client/js/online.js`, only with `play.html?ride=<id>`): seed + `RIDE_MIN_SECONDS` + `COMPLETE_DIST` come from the server, no mock wallet, START → server `/start`, END SHIFT / crash → `/end`, the server's verdict is shown on the result screen.
  *Verified by:* the same vitest suite (complete, pause earns no time, idling = abandoned, teleport = failed, dead heartbeat = failed) **and** `server/scripts/e2e-browser.mjs` in real headless Chrome against a running server: sign-in → free ride → game loads the server's 6 s / 84 m / seed → START → heartbeats → P → END SHIFT → verdict **COMPLETED**, 0 page errors.
- Done when: connect wallet → start a free ride → drive 3 min → "complete" comes from the server.
  **Status: proven, with two stand-ins.** The browser run used a test shift of 6 s (`FREE_RIDE_SECONDS=6`, default is 180) and the distance was injected (`__game.st.s = 90`) because headless Chrome can't really drive; the wallet was a keypair. **Still to do by hand:** open `localhost:3000` in a browser with Phantom → connect → lobby → START FREE RIDE → drive the real 3 min.
- Review fixes applied after the first pass: the final `/end` report no longer loses drive time (it always says `paused` because the game is already in `done` mode – the server now credits the game's own clock `t`, capped by wall time, instead of trusting the flag); a hull below 0 or a garbled final report can no longer leave a ride stuck `running` (which blocked the wallet and burnt the credit for 150 s); Solflare/Phantom return shapes normalised in `site/wallet.js`; `.env` is read at start; `CLIENT_DIR` resolves from the module path; `npm test` no longer fails with no specs. New vitest cases cover each. *Not verified: the Solflare path (written from its documented shape, never run).*
- Known gaps (not Day 0): reloading `play.html` mid-ride is refused (ride is `running`) and the lobby answers 409 for up to 150 s – the free credit is spent; no rate limiting on `/api/auth/*`; completion is server-timed telemetry, not a replay (a modified client can lie within the speed bound); landing/lobby are placeholders; `/api/me` probe on the landing page logs a 401 when signed out.

### Day 1 – Wed Oct 8 – money
- [ ] SOL/USD quote + tier table `{free: 180 s, 1h: $5, 4h: $15, 8h: $50}` on the server.
- [ ] Plan B spike until noon (Anchor init, `enter`, devnet deploy). Gate at 13:00: B works → continue (`settle` + client tx); else Plan A.
- [ ] Pool accounting: `rounds` table, `pool = Σ entries`, split 50/20/20/10 computed live; `/pool` endpoint for landing + lobby.
- [ ] `demoScale` for the demo account.
- Done when: pay a $5 ride on devnet, pool number goes up, ride completes (×60 demo), shows on a leaderboard endpoint.

### Day 2 – Thu Oct 9 – lobby
- [ ] `lobby.html`: 4 tabs, same cockpit-ish style as the game menu (reuse `css/style.css`, MONO font).
  - **New ride**: tier cards (free rides left · $5 · $15 · $50 with the SOL amount), current pool + split, conditions (min time, distance, "no payout if abandoned"), big START.
  - **Live rides**: polling `/rides/live` every 5 s – wallet (short), route, tier, elapsed, km, hull; animate a tiny road progress bar. This is the "hype" surface – make it look alive.
  - **Leaderboard**: this round by distance (top 20 = prize share, highlight), all-time; the free-ride board separately.
  - **Profile**: wallet, free rides left, rides/km/best, achievements grid (locked/unlocked), upgrades.
- [ ] Route picker + Day/Night move into New ride (or stay in the game's menu – fewer changes: keep them in game, lobby just picks the tier).
- Done when: the whole loop runs from the lobby without touching the URL by hand.

### Day 3 – Fri Oct 10 – NFTs, social, upgrades
- [ ] **Achievements as Metaplex Core NFTs (devnet)**: server keypair mints into one collection, `owner = user wallet` (no user tx, no gas for them, ~0.003 SOL each). Metadata JSON hosted on the server (Irys later). Achievements: First Ride · Finisher · Night Owl · 100 km · Clean Run (hull 100 %) · Top-20 · Cold Start (Siberia). Unlock check at `/end`; profile shows the mint tx link. ~4 h.
- [ ] **Social posts while riding**: dash button + key (J) → opens `https://x.com/intent/post?text=…&url=/r/ID` with "⛟ 47 km into a 4 h Trans-Siberian run, hull 82 %, pool 12.4 SOL – freightchain.xyz/r/…". `/r/ID` = server-rendered page with OG tags; OG image = a static PNG per route + text overlay via `canvas` (node-canvas) – or a static image per route if short on time. ~3 h. (The game pauses when the tab is hidden – opening the intent in a new tab is fine.)
- [ ] **Truck upgrades (minimal)**: 3 functional + 2 cosmetic, bought with devnet SOL (or free-ride credit): Engine tune (+8 % power → `CFG.TRUCK` multiplier), Winter pack (heater ×2, cold wear ×.5), Reinforced bumper (hull dmg ×.8), Livery colour, Horn. Stored in the profile; `play.html` applies them after loading the ride. The F2 tuning panel already exposes the constants – reuse. ~3 h. First thing to cut.

### Day 4 – Sat Oct 11 – landing, deck, video
- [ ] **Landing** (`index.html`): hero = live **prize pool** number (polled), countdown to round close, "N trucks on the road now", CTA "Connect wallet → 5 free rides". Then: How it works (Pay → Drive the full time → Finish → Share the pool), the tier table, the 50/20/20/10 split as a bar, live leaderboard top 5, achievements strip (NFT art), Desert Bus origin story line, FAQ (why real time? why can't I cheat?), footer with GitHub/X.
  Reference patterns: PoolTogether (deposit → weekly chance, "can't lose" framing), Megapot (one huge jackpot number + countdown + odds), Pump.fun (live feed of activity = hype), Hamster Kombat/Notcoin (daily free action + streaks + share). Steal the structure, not the copy.
- [ ] **Deck (10 slides)**: Problem/insight (attention is the asset; Desert Bus proved people watch boredom) · Product (30-s gameplay gif) · Loop (free → paid → pool → NFT) · Economy (below) · Anti-cheat (server-timed now → deterministic replay next) · Why Solana (cheap entries, Core NFTs, VRF, mobile wallets) · Traction/demo numbers · Roadmap (Telegram Mini App, spectator sabotage, streams) · Team · Ask.
- [ ] **Video (≤3 min)**: 20 s hook on the landing → connect → free ride → pay $5 → lobby live rides + leaderboard → share post → finish (×60 demo, say it) → NFT in Phantom → economy slide. Record with the standalone build on a clean profile; headless swiftshader is too slow, use real Chrome.
- [ ] README: what's real, what's mocked, how to run.

### Day 5 – Sun Oct 12 – submit (by noon, not 23:59)
- [ ] Fresh-eyes run of the whole loop on the deployed URL from a new wallet. Fix only blockers.
- [ ] Submit: form, video link, demo URL, repo, deck PDF. Post on X with the pool number.
- [ ] Buffer for the rest of the day.

## Economy (slide text)

Each **round** (per tier, closes weekly or when 100 entries – pick one, weekly is simpler) collects the entry fees into the pool:
- **50 % Grand prize** – drawn among riders who *finished* the round (VRF / committed seed), weight = tier.
- **20 % Seeds the next round** – the pool is never 0, which is what the landing's number needs.
- **20 % Top-20 skill prizes** – by distance driven in the round (ties: hull %, then time). Governor = 28 m/s, so distance is time-on-road × consistency.
- **10 % Platform**.
Example: 200 riders/week × avg $12 = $2,400 → $1,200 jackpot, $480 seed, $480 top-20 ($120 for #1 down to $8 for #20), $240 fees.
Risks to name on the slide: lottery/gambling regulation (skill-prize share, geo-blocking, KYC thresholds), client trust (replay roadmap), tab-hidden pause vs. "real time".

## What NOT to do this week
Mainnet · Wallet-adapter/React rewrite · Telegram Mini App · deterministic replay core · trailer collisions · anything in AGENTS.md "Not implemented" that isn't on a slide.
