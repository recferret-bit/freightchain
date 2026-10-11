# Freight Chain – Solana feature plan

What the chain can do for the game beyond "pay in SOL". Written **Tue Oct 7, 2026**, next to `hackathon-plan-v2.md`, which stays the plan for the submission (deadline Oct 12). This file does not change that schedule: only tier 0 may touch the five remaining days, and every item there is cuttable without harming the submission. Tiers 1–3 are the weeks after.

The sorting rule: the game's defining trait is a shift that is **long, slow and watchable** (1h / 4h / 8h, Desert Bus). A feature is a **strong fit** when it feeds on that – spectators with hours to act, a drive worth bragging about, money that rewards finishing rather than entering. A **medium fit** is useful for any leaderboard game. A **weak fit** only "uses Solana" and would look the same in any app; those stay in the catalogue so the cut is visible, but they ship last or not at all.

## What is Solana-specific today

| Piece | Where | Note |
|---|---|---|
| Sign-In With Solana (challenge + ed25519 `signMessage`) | `client/site/wallet.js`, `server/src/domain/auth`, `infrastructure/auth/nacl.signature-verifier.ts` | Phantom → `window.solana` → Solflare. Hand-rolled SIWS text, not the wallet-standard `signIn` call. |
| Paid shift = `SystemProgram.transfer` + Memo (ride UUID) to the treasury pubkey | `client/site/pay.js`, `infrastructure/solana/solana-chain.adapter.ts`, `domain/economy/payment-verification.ts` | Unsigned tx built by the server, signed in the wallet, confirmed by polling `getParsedTransaction`. `reconcile` sees only the wallet's last 25 signatures. |
| SOL/USD price | `infrastructure/solana/http-price-quote.adapter.ts` | Coinbase → CoinGecko, not a Solana oracle. |
| Weekly pool in integer lamports, split 50/20/20/10 (→ top-3 25/15/10 on Thursday) | `domain/economy/prize-split.ts`, `round.entity.ts` | Accounting only, no payout code; payouts manual, admin-signed (Q8). |
| Devnet guard | `deploy/scripts/validate-env.mjs` | Genesis-hash check; mainnet refused. |
| Achievements persisted, "become NFTs soon" | `domain/achievements/achievements.ts`, lobby Profile tab | 7 unlock rules, nothing minted. |
| Socials | `landing/src/main.js` `SOCIALS` | All `null`, buttons hidden; waits on the X account (Q11). |

## Principles (inherit the hackathon ground rules)

- **Devnet only** until verified play and the admin payout flow exist; mainnet is tier 3.
- **The server holds no spending key.** Anything that needs a signature from "us" (payouts, pledge settlements, trophy mints) is a *queue the admin signs in Phantom*, or a key whose only power is low-value (a cNFT tree delegate). Say which, per feature.
- **Skill prizes, no wagers.** Spectators may *sponsor a pool*, *pledge per kilometre* or *tip a driver* (money flows to the pool, to the driver, or is a donation settled on recorded distance); nobody bets on a ride's outcome against someone else. Keeps the product out of gambling framing.
- **No overclaiming.** A badge in a wallet or a hash in a memo is a *record*, not proof of human play. Copy says "server-recorded", never "verified" or "replayable", until the verdict engine exists.
- **Vanilla front end, one NestJS backend, Clean Architecture.** A chain feature = a port in `application/ports` + an adapter in `infrastructure/solana` + a use-case + the pyramid's specs (unit, integration if it touches PostgreSQL, HTTP scenario, concurrency test if it adds a critical section). New env only through `EnvService`; schema change ⇒ migration.
- **Every tx we build gets a memo and (from tier 1) a reference key**, so anyone can find it on an explorer and the server can find it without scanning a wallet's history.

Effort below = focused days for one person, excluding external waits (registry approval, X API access).

## Strong fit – built on the long shift

**F1 · Live tab with tips and sponsors.** A 1h–8h drive is a stream. While a shift is live, a spectator on the Live tab (no sign-in needed to watch) can **tip the driver** – a wallet-to-wallet SOL transfer with memo `tip:<ride>`, the platform touches no money and only counts what it sees – or **sponsor the pool** – SOL to the treasury with memo `sponsor:<round>`, credited to the round's prize side with no fee, landing shows "sponsored by … +0.5 SOL". Both are one built tx each, signed in the wallet. Needs the treasury watcher (F8) to see sponsorships and the drivers' addresses to see tips. Effort 1.5 d after F8. The boring middle of a shift becomes the product; the pool grows without players, which is the strongest landing number.

**F2 · Pledge per kilometre.** A sponsor pledges `X` lamports per km for a live driver (or for the whole round), capped at an amount they sign upfront; the pledge is **settled at the end against the server-recorded distance** – so it pays for finishing the long drive, not for entering. Implementation without a program: the pledge is an SOL transfer of the cap to the treasury with memo `pledge:<ride>:<lamports/km>`; at ride end the server computes the owed part, which goes to the driver (via the admin payout batch, memo `pledge-settle:<ride>`) and the unused remainder is refunded in the same batch. Later, with the escrow program (F15), settlement becomes trustless. Effort 2 d (pledge intake + accounting + the batch rows) + the admin batch. This is the charity-marathon mechanic Desert Bus was built on, and no other crypto game has it.

**F3 · Convoys.** Three to five wallets buy shifts together within the same round and share one **side pot** by combined distance: each member's entry adds a convoy fee (say 10 %) to the pot, the pot splits by each member's share of the convoy's km. Convoy page = one `/c/:id` with the members' live bars; one X post per convoy start. Long solo drives are lonely; a convoy gives people a reason to be online at the same hours and to post about it. Server: `Convoy` aggregate (members, pot in lamports, settled at round close), the pot is part of the admin payout batch. Effort 3 d. Deliberately simple: no chat, no voice.

**F4 · Blink in the X post: "enter / sponsor this week's pool".** A Solana Action on the API host: `GET /api/actions/shift` → metadata (icon = `icons/icon-512.png`, title, description, `links.actions` = the three tiers + "sponsor 0.1 / 0.5 / 1 SOL"); `POST /api/actions/shift?tier=1h` with `{account}` → the same unsigned transfer+memo the lobby builds, plus `links.next` → `lobby.html` to start the ride. `/.well-known/actions.json` on the apex maps `/`, `/r/*` and `/c/*` to it, so a ride page pasted into X becomes a button in Phantom. The long shift gives the post hours to travel while the ride is still live, which is why it fits here and not under "any game". Needs: a ride created for a wallet *without a session* (`touch` creates the player; one-ride-in-hand applies), Action CORS (`*` origin + `X-Action-Version` / `X-Blockchain-Ids` on `/api/actions/*` only), and registration in the Dialect Actions registry (Phantom unfurls only registered actions; `https://dial.to/?action=solana-action:<url>` renders anything meanwhile). Effort 1–1.5 d + registry wait. Caveat: a Blink buyer skips the lobby's conditions text; the Action description carries the min-time and devnet wording.

**F5 · Ride page `/r/:id` with explorer links and "post on X".** **Built (2026-10-11):** Public, no session: route, km, tier, server verdict (completed / abandoned / failed with the reason), round rank, payment signature as explorer link (`?cluster=devnet`), seed, tips and pledges. In-game dashboard button near the parking brake and end-screen button trigger X web intent (`https://x.com/intent/post?text=…&url=…`) with Solana-styled UI – zero API cost, driver posts from own account. Dynamic OG/Twitter Card SSR tags rendered by server middleware. Plus explorer links to Anchor pool vault transactions.

**F6 · Chain-anchored seed and payout receipts.** (a) Ride seed = `H(rideId, serverSecret, blockhash@start)` with the slot recorded; `/r/:id` shows slot and hash, so anyone can check the seed was fixed when the ride started, not picked afterwards. (b) The admin's payout tx (top 3, top-20, pledge settlements, convoy pots) carries a memo `round:<n> rank:<k> ride:<id> telemetry:<sha256 of the ride's batch hash-chain root>` – the prize payment itself becomes the public record of the result, at zero extra transactions. Long shifts with real money attract cheating claims; this answers them with public facts, said honestly ("recorded", not "verified"). (a) is standalone, (b) waits for the verified-play batches. Effort 0.5 d + 0.5 d.

**F7 · Solana Pay transaction request + reference key.** **Built.** A fresh `reference` (32 random bytes, base58, private key discarded) per pay-per-ride order, ticket order and paid donation, attached as a read-only account on the memo instruction (`buy_ticket` accounts stay fixed). Confirmation uses `getSignaturesForAddress(reference)`. The lobby QR is a transaction request, `solana:` + the URL-encoded `https://<api>/api/solana-pay/{rides|orders|donations}/:id`: the phone POSTs `{ account }` and signs the same transaction the desktop signs. A transfer-request URL (`solana:<treasury>?amount=`) is not used – it cannot buy a ticket, and a mainnet wallet could send real SOL. Schema: `paymentReference` on `Ride`, `TicketOrder` and `DonationOrder`.

**F8 · Treasury watcher.** Subscribe to the treasury address and the live drivers' addresses (`onLogs` over the RPC WebSocket, or a Helius/QuickNode webhook with a shared secret from `EnvService`) → one `ChainEventReceived` path that settles payments, sponsorships, pledges and tips idempotently (payments are already keyed by signature). Replaces client polling as the primary confirm path; polling stays as fallback. Effort 1 d. Infrastructure for F1/F2; "paid" becomes instant.

## Medium fit – good for any leaderboard game

**M1 · The project X account posts by itself.** `SocialPostPort` with an `XApiAdapter` (OAuth user context, write-only) and a `NullSocialPostAdapter`; posts: Monday 00:00 UTC "round N closed: top 3 … pool … SOL" with the winner's `/r/:id` (so the post carries a Blink – the community "raid" post), a new pool record, and optionally "a driver finished a 1h shift, 94 km" per finished paid ride (the hackathon plan's P2 promise). Needs a **round-close job** – today the round closes lazily on the first request of the week; add a scheduler next to `daily-free-ride.scheduler.ts` dispatching `CloseRoundCommand`, then the post. X API: the free tier is write-only with a low monthly post cap and paid tiers cost money – check the current limits before relying on per-ride posts; start with the weekly post. Effort 1 d + app approval.

**M2 · Wallet-standard `signIn` (native SIWS).** Phantom and Solflare render a proper sign-in sheet (domain, statement, nonce) instead of a raw message; fall back to `signMessage`. Effort 0.5 d. Less phishing-looking, one sentence for the judges.

**M3 · Pyth for SOL/USD.** Primary quote from Pyth (Hermes HTTP, SOL/USD feed id), Coinbase/CoinGecko as fallback; same cache and sanity bounds. Effort 0.5 d. Solana-native oracle; a judge nods, a player does not notice.

**M4 · USDC entries.** Tiers are USD-priced, so devnet USDC removes the quote-TTL problem: `transferChecked` from the buyer's ATA to the treasury ATA (created once), `verifyPayment` learns `spl-token` transfers, lobby offers SOL | USDC. Effort 1.5 d. Later Jupiter swap so any token pays (tier 3, mainnet only).

**M5 · Compute-budget price on every built tx.** `setComputeUnitPrice` with a modest priority fee so mainnet confirms under load; invisible on devnet. 1 h, with F7.

## Weak fit – only "uses Solana"; ship last or not at all

**W1 · Achievement badges as compressed NFTs.** As a plain badge list this is the feature every game has. It only becomes ours if the badge **encodes the shift**: "8 hours on the Trans-Siberian at night", a per-route odometer that counts up in the wallet, the weekly trophy as a Metaplex Core asset minted in the admin's payout batch. Mechanics if done: one Bubblegum v2 tree (~0.00001 SOL per leaf), non-transferable; badges minted by a dedicated tree-delegate key on the server (worthless to steal) or admin-signed weekly; wallets see them through a DAS API (Helius / QuickNode). Effort 2 d. Decision: build the **weekly trophy** with the payout batch (3 per week, zero server keys), leave the badge list until the odometer design exists.

**W2 · `.sol` names on the boards.** Reverse-lookup via SNS (a **read-only mainnet RPC call** – note it in the devnet rule), cached in `Player.displayName`. Nice on the board, zero relation to trucks. Effort 0.5–1 d. Only if a board screenshot is going into a post and the wallets look bad.

**W3 · Solana Mobile (Seeker / dApp Store).** Blocked on touch controls in the game; roadmap row only.

## Tier 3 – gated on verified play + admin panel

**F15 · Anchor round-escrow program + Squads multisig payouts.** A PDA vault per round, `enter(tier)` moves the lamports and records the entry on-chain, `pledge` / `sponsor` / `convoy` as instructions, `close_round` / `payout` only by the admin authority (a Squads multisig). Then "the funds are where the rules say" is checkable on-chain, pledges settle trustlessly and refunds are programmatic. 1–2 weeks with program tests (LiteSVM / bankrun), audit before mainnet. **Explicitly cut for the hackathon; keep saying so.** Then Jupiter "pay with anything" → mainnet (published rules, audit, `validate-env.mjs` gains a mainnet allow path) → W3.

## Sequencing

### Tier 0 – Oct 8–12, free slots only, in cut order (first to go → last)

Nothing here is on the critical path (payment, economy change, videos, form).

1. **F5 explorer links** (2 h; Wed, after the first real payment exists – it is what the link points at).
2. **F5 ride page `/r/:id` + X intent** (Fri, the slot already marked optional). Feeds the demo video ("here is my ride, here is the payment on the explorer").
3. **Deck + landing roadmap row**: one slide "what Solana does next" = F1 tips/sponsors, F2 pledges, F3 convoys, F4 Blinks, F6 proof, F15 escrow. Said as roadmap, no code.
4. **F4 endpoint only** if Saturday is open: `GET/POST /api/actions/shift`, rendered through dial.to in the demo. No registry submission before submit.

Not in tier 0: anything with a key on the server, any new vendor (Helius, X API), any schema change beyond F5's public DTO.

### Tier 1 – Oct 13–19 (the week after submit)

**F7** reference key (everything later builds the same tx) → **F8** treasury watcher → **F1** tips + sponsors → **F6a** seed commitment → **F4** Blink + Dialect registry submission (the external wait starts early) → **M1** round-close job + weekly X post. ≈ 6 d.

### Tier 2 – Oct 20 – Nov 8

**F2** pledges → **F3** convoys → **M2** native SIWS → **M3** Pyth → **M5** priority fee → **W1** weekly trophy only (with the admin payout batch, once the admin panel exists) → **F6b** payout memos (with verified-play batches). ≈ 8 d, beside the verified-play build (`hackathon-plan-v2.md` → "Verified play").

### Tier 3

**F15** escrow + Squads → **M4** USDC / Jupiter → mainnet → **W2**, **W3** if ever.

## Mini-specs (tier 0 + tier 1)

**F5 `/r/:id` + 𝕏 sharing.**
- **Built (2026-10-11):**
  - API: `GET /api/rides/:id/public` → `PublicRideDto` via `GetPublicRideQuery`.
  - Page: `client/r.html` + `client/site/ride.js|css` displaying live/finished telemetry, route seed, driver wallet, and devnet Solana explorer transaction link.
  - SSR: `ridePageMiddleware` intercepts `/r/:id` to inject dynamic Twitter Card / OG meta tags for 𝕏 scrapers.
  - In-game sharing: Dashboard button near the parking brake in `client/js/cockpit/rig.js` (Solana gradient styling, active during online rides) opens 𝕏 Web Intent with current km, route, and public link.
  - End-of-ride sharing: Modal button on ride completion/failure pre-fills outcome, distance, and receipt link.

**F7 reference key.** **Built** as a transaction request, not a transfer URL.
- Schema: `paymentReference TEXT UNIQUE NULL` on `ride.Ride`, `economy.TicketOrder` and `live.DonationOrder`.
- The reference is a read-only account on the memo. `verifyPayment` / `verifyDonation` require it when the row has one. Reconcile uses `getSignaturesForAddress(reference, 10)` and keeps the 25-signature wallet scan only for rows that have no reference.
- Public `GET/POST /api/solana-pay/{rides|orders|donations}/:id`. The lobby and the watch panel show a QR, "or scan with a phone wallet · same account · devnet".
- Session polls: the existing ride reconcile, `POST /api/tickets/orders/:id/reconcile`, `POST /api/watch/:id/donation-orders/:orderId/reconcile`.

**F8 treasury watcher.**
- `ChainEventsPort` (`subscribe(addresses, onSignature)`) with `RpcLogsAdapter` (WebSocket `onLogs`) and `WebhookAdapter` (`POST /api/chain/events`, `CHAIN_WEBHOOK_SECRET`); both feed `IngestChainSignatureCommand` → fetch, classify by memo prefix (`<rideId>` payment · `sponsor:` · `pledge:` · `tip:`), dispatch to the matching settlement under the usual locks. Reconnect with backoff; a boot catch-up scans the treasury's recent signatures.
- Tests: unit (classifier, backoff), scenario (a webhook with a bad secret → 401 problem+json; a replayed signature settles once), concurrency (webhook and client `confirm` racing on one signature).

**F1 tips + sponsors.**
- **Built – live streams, 2026-10-08:** `play.html?watch=<id>` replays any ride from its verified-play recording (~25 s behind live; finished rides as replays, with the recorded traffic), linked from the landing ticker / LIVE NOW board and the lobby's Live tab; signed-in spectators chat with the driver (CB panel; the driver mutes / folds it) and donate – a tip, or an effect the driver's game applies (night, day, potholes / trench / sinkhole ahead; one per ride per 20 s). Feature flags `LIVE_CHAT` / `LIVE_DONATIONS` / `LIVE_FREE_DONATIONS` / `LIVE_EFFECTS`. With `LIVE_FREE_DONATIONS=off` (production) a donation is a real devnet SOL transfer FROM THE SPECTATOR TO THE DRIVER, built by the server (memo `fc-donation:<order>`), signed in the wallet and verified on chain before it exists – the wallet-to-wallet tip of F1. What is left: a chain watcher that credits a paid donation whose page closed before confirming (F8), and sponsorships of the pool. Note for F6: the watch API hands out a running ride's seed (spectators need it to rebuild the road) – a seed commitment would have to reveal at start, not at the end.
- Schema: `economy.Contribution { id, kind tip|sponsor, signature UNIQUE, fromWallet, rideId?, roundId, lamports, memo, at }` + migration. Round prize side += sponsor lamports (no fee); `Ride.tipsLamports` denormalised for the live feed.
- Tx builders: `GET /api/rides/:id/tip?lamports=` and `GET /api/pool/sponsor?lamports=` → unsigned tx (transfer + memo), same shape as F7. Lobby Live tab: TIP buttons on each live row (0.01 / 0.05 SOL), SPONSOR on the pool card; both signed in the wallet, confirmed by F8.
- Public DTOs: `/api/live` rows gain `tipsLamports`; `/api/pool` gains `sponsoredLamports` + the last three sponsors (short wallet). Landing legend: "+ sponsors" bar segment.
- Tests: unit (builders, accounting – sponsor money never touches the fee line), integration (repository), scenario (sponsor → pool grows; tip → live row), concurrency (two sponsorships into one round).

**F6a seed commitment.**
- `start-ride` fetches `getLatestBlockhash` (slot + hash) through `ChainPort`, stores `Ride.seedSlot`, `Ride.seedBlockhash` (migration), derives `seed = sha256(rideId ‖ SEED_SECRET ‖ blockhash)` – `SEED_SECRET` via `EnvService` so a client cannot pre-compute the seed from a public blockhash before start. `/r/:id` shows slot, blockhash and the seed; the explanation text says "fixed at start, server-recorded".
- Tests: unit (derivation, determinism), scenario (`start` without RPC → 503 problem+json, the existing chain-error path).

**F4 Blink.**
- Routes `GET/POST /api/actions/shift`, `GET /.well-known/actions.json` (apex). Separate CORS rule for `/api/actions/*` (`*`), headers `X-Action-Version: 2.x`, `X-Blockchain-Ids: solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` (devnet genesis). Handler reuses `CreateRide` + `GetPaymentInstructions` for the given `account`, or the F1 sponsor builder; errors → Action error JSON (the one explicit exception to problem+json, listed in `api-contract-audit.spec.ts`).
- `links.next` → `${SITE_BASE}/lobby.html` (the ride is "paid, waiting", the existing banner).
- Tests: unit + scenario for GET/POST, a spec that the action's tx equals the lobby's tx for the same order.
- External: Dialect registry form; until approved, demo through dial.to.

**M1 round close + X post.**
- `CloseRoundCommand` (extracted from `round.service.ts ensureRound`), `RoundCloseScheduler` (00:00 UTC Monday, boot catch-up like the free-ride scheduler), `SocialPostPort` + `XApiAdapter` (`X_API_KEY/SECRET/ACCESS_TOKEN/ACCESS_SECRET` via `EnvService`, all optional → Null adapter when unset), `PostRoundSummaryHandler`. Post text from a pure formatter with a unit test; the adapter is never called in tests.
- Idempotency: `Round.postedAt` (migration) so a restart does not post twice.

## Risks and what not to do

- **No wagers.** Tips go wallet-to-wallet; sponsorships go to the prize side with no fee; pledges are donations settled on recorded distance and refunded above it; convoy pots are split among the convoy's own entrants by their own km. Nobody can stake on another driver's outcome. Reject any "bet on the driver" feature, however good it looks on X.
- **Key custody.** Only W1's optional tree delegate would put a key on the server, and only after a written decision; everything else is admin-signed or player-signed. Pledge settlements and convoy pots ride in the same admin batch as prizes.
- **Overclaiming.** Trophies, memos and seed commitments are *records*. Deck and posts say "server-recorded"; "verified" waits for the verdict engine.
- **Dialect registry and X API are external gates** with unknown lead time; start both in tier 1 and never make a demo depend on them (dial.to and web intents are the fallbacks).
- **Vendor lock.** Helius/QuickNode DAS and webhooks are conveniences; keep the RPC WebSocket path and plain `getParsedTransaction` working so a public RPC still runs the product.
- **Mainnet names on a devnet product** (W2) is a read; say so rather than hide it, if it is ever built.
- **Anchor is tier 3** on purpose (audit cost, deadline). Every mention of F15 before then is "designed, not built".
- **Test pyramid.** Each adapter/handler/scheduler above ships with its spec or the audit fails; budget ~30 % of each estimate for tests.

## Open questions for you

1. **X account**: one project account (M1 posts) or also a founder account? Who pays for the X API tier if per-ride posts are wanted?
2. **Sponsorships (F1)**: 0 % fee on sponsor money, or the same 10 %? The copy differs.
3. **Pledges (F2)**: cap per pledge (e.g. 1 SOL on devnet) and whether the driver or the pool receives the per-km money – the plan says the driver.
4. **Convoys (F3)**: convoy fee 10 % of each entry into the side pot, or a fixed extra buy-in?
5. **W1**: build the weekly trophy with the payout batch, and drop the badge list until an "odometer" design exists?
6. **Tier 0 scope**: F5 only, or also the F4 endpoint for the demo if Saturday is open?
