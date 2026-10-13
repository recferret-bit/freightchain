# Freight Chain – pitch scenario for the Crypto World's Fair

Written Oct 12, 2026, ~22:30 UTC. Hard close **2026-10-13T06:59Z** (Oct 12, 11:59 pm PT). Companion to [`hackathon-plan-v3.md`](hackathon-plan-v3.md) items E and F.

Sources read for this: the hackathon FAQ "How will submissions be judged?" (<https://colosseum.com/hackathon#h-faq-12>), the World's Fair page (<https://colosseum.com/worldsfair>), Colosseum's workshop recap "Perfecting Your Hackathon Submission" (<https://blog.colosseum.com/perfecting-your-hackathon-submission/>), the Copilot record of this project, and the live site.

## 0 · Blockers in the Colosseum form (checked at 22:24 UTC)

These are not pitch quality, they are eligibility. Fix before anything below.

| Field | State now | Why it matters |
|---|---|---|
| Status | **draft** | A draft is not a submission. Press Submit. |
| Track | Solana ticked in "which chains" | The chains list is the ecosystem track list and the form has no separate track step, so this is the entry into the $100k Solana Ecosystem pool (10 × $10k). Copilot shows `tracks: []` only because it has not indexed this hackathon's tracks yet. Scroll the form once for a field called "track" to be sure. |
| Presentation / demo / pitch links | empty | The blog says the pitch video is "the most important element" and the first thing judges open. |
| Description | "weekly pool" | Your own ground rule bans lottery or draw framing; the live product has one pool per shift length, not a week. |
| Chain usage | ends mid-word ("Sp"), says gas "can be sponsored" | Sponsored gas was removed Oct 10; a judge who buys a ticket will see the buyer pay. |
| Technologies | AI tools only | Track judges look for the Solana stack: Anchor, web3.js, Phantom, Solflare, SIWS, QuickNode, Solana Pay, Blinks, Bubblegum. |
| Traction / market / competition / monetization / team commitment | empty | The blog warns against ignoring optional fields. v3 F5 has the outline. |
| Live product access instructions | empty | Judges need: Phantom on devnet, faucet, free ride needs no SOL. |
| Live whitepaper lede | still says "the 1 hour, 4 hour and 8 hour shifts are soon" | Contradicts the README and the explorer (1 H is on sale). v3 A1 was not fully applied. Fix only if a deploy fits before the videos; otherwise do not point the demo at that line. |

Form texts are yours to write (judges read them as the founder's words); the outline per field is in v3 → F.

## 1 · What the judges are told to score

Seven factors from the FAQ: founder + market fit · insight · product + execution · market size · founder communication · viability · traction. Then: Colosseum shortlists, judges score individually, a smaller group gets a 15-minute Zoom interview, winners about a month later. Every winner is considered for the accelerator ($250k).

From the workshop recap, the rules that decide a shortlist:

- Pitch ≤ 3 min, in this order: **team background → problem → who it's for → validation (even informal) → vision**. "A brief startup pitch, not a product demo." Structure beats polish; voice over slides is fine.
- Demo 2–3 min, new this year, "the how": core features, stack, why you prioritised what you did. Judges look at **Solana integration, on-chain logic, architecture**. Gameplay footage and architecture diagrams are welcome.
- Listed mistakes: over time · flashy visuals, little substance · buzzwords · vague or over-technical · no team background · core idea and impact unclear · Solana integration unexplained · incomplete videos · materials judges cannot open.
- Solo founder: say why you are the one to build it.
- After submitting: keep posting updates; shortlisted teams get asked what changed since.

## 2 · Pitch video – 2:50, ~420 words, read off a second screen

This is a draft spine, not a script to read verbatim: judges score founder communication, so rewrite each block in your own words and keep the facts. Record once, straight through, 1080p; your face in the corner is a plus. Slides optional: one still per block is enough. Every claim below is true on the live site today; do not upgrade a word.

**0:00–0:25 · Who (founder + market fit)**
> I'm Andrey, solo founder, Belgrade. I was tech lead at Latoken, where I built the mobile apps from scratch and integrated BTC-like chains into the exchange. I won the Moralis × Cronos GameFi hackathon. I have shipped games and I have shipped exchange money code. The truck sim was a prototype I already had. In the four weeks of this hackathon I built everything that makes it a product: the Solana money loop, the server that keeps the clock and judges the drive, the streams, the site.

**0:25–0:55 · The insight (problem)**
> In 1995 Desert Bus asked people to drive a bus eight hours at 45 miles an hour. Nothing happens. Strangers finished it, and thousands watched them do it. That is the insight: a dull, long, honest performance is content, if you can prove it was real and someone could win.
>
> Crypto games have the opposite problem. They are fast, fully on-chain, and nobody watches. A fee and a dashboard lose to a stream people already love.

**0:55–1:30 · The product**
> Freight Chain is a truck cab over an endless road. You buy a shift with SOL: one hour today, four and eight next. You cannot skip the clock. A server keeps the time, records every input, and judges the drive. Every finished shift is a stream anyone can watch with no wallet, and a replay afterwards.
>
> The game stays off-chain, because physics at 60 frames a second does not belong on a chain. The money is on-chain: each pool is a program-owned vault on Solana. Tickets go into it, refunds are permissionless if a pool misses its goal, prizes are capped on chain, and the payout key can only pay a driver whose ride has a verified attestation on chain, after a review window. The server never holds the money.

**1:30–1:55 · Who it is for, and why Solana (market)**
> Two audiences. People who already sit through long streams and want a hard, slow sport with a scoreboard. And Solana users who want something to do with a wallet that is not trading. The seat costs a few dollars, the wallet signs once, and a ticket is also a Blink, so a stream link on X is a buy button. That is the wedge: skill prizes for watchable performances, with Solana as the ticket desk.

**1:55–2:20 · Validation and traction (honest)**
> Live on devnet since October 10. Program v3 is deployed and the site sells into it: I bought the first tickets myself to prove the loop end to end. The program supports prize attestations and per-km pledges from spectators; the repo is public with the localnet money test that asserts every lamport. Traction is honest: [N] outside wallets finished a free ride, [M] bought a devnet ticket. [One sentence a playtester actually said.] No revenue, no token, not audited.
>
> If N and M are zero (production shows 2 drivers, both yours): "No outside users yet. The live site, the public repo and this demo are the validation I can offer today; the first playtest invites go out this week." Do not invent a waitlist.

**2:20–2:50 · Business, vision, ask**
> Ten percent of every pool is the fee, twenty percent seeds the next pool so the number never starts at zero. The path is: review window and payouts on devnet, an audit, mainnet with published rules. After that, more shift lengths, more titles on the same verified-play rails.
>
> I am applying to the Solana Ecosystem track. Play a free ride tonight at freightchain dot fun. Thank you.

Timing check: 420 words at 150 wpm = 2:48. If you overrun, cut the second sentence of 0:25 and the Blink sentence first.

## 3 · Demo video – 2:45, shot list in tab order

Open every tab beforehand, in order. Real Chrome, clean profile, live URLs, a wallet that is in `DEMO_WALLETS` (key name only, check `deploy/.env`). Say the quoted lines aloud; they are the words judges grep for.

**Pool timing (live at 22:30 UTC):** pool 28 (1H) is open with 0 sold, its sale closes **23:00 UTC** and play closes 01:00 UTC. Buy the demo ticket before 23:00 or record the buy on the next pool the crank opens from the series; check `/api/pools` first. Pool 0 settled with 2 tickets and no verified ride, so there is no payout to show.

| Time | Tab / action | Say |
|---|---|---|
| 0:00–0:15 | One architecture slide: browser game → NestJS API → PostgreSQL; the Anchor program with vault PDAs; the server's road port; the payout key | "Game off-chain, money on-chain. The server rebuilds the road from a seed the program committed and judges the recording against it." |
| 0:15–0:30 | Landing → CONNECT → Phantom signs the SIWS message | "Sign-In With Solana. A message, not a transaction. Solana devnet." |
| 0:30–0:55 | Lobby → 1H pool card → BUY → Phantom signs and sends → ticket toast | "The buyer pays its own fee. Ticket rent comes back on close." |
| 0:55–1:10 | Explorer: the pool's vault PDA with the lamports, then the program id | "Program-owned vault. If the pool misses its goal anyone can trigger the refund." |
| 1:10–1:40 | START the 1 h shift on the demo clock → 20 s of cab: clutch, gears, a hole sign, traffic → finish line → end dialog | "Demo clock times sixty. The governor stays at 28 metres per second. Every 15 seconds a hash-chained batch of inputs and telemetry goes to the server." |
| 1:40–1:55 | `/r/:id` receipt: seed, telemetry, explorer link, X card | "Public receipt for every ride." |
| 1:55–2:10 | Profile → VERDICT with reasons. No attestation exists on devnet yet (pool 0 settled with no verified ride), so show the `Attestation` account in the program's IDL / contract spec instead of the explorer | "The verdict is server-side: bounds, holes, timing. After the review window the payout key writes an attestation with the telemetry Merkle root; pay_prize refuses without it." |
| 2:10–2:30 | LIVE → the watch page replaying ~25 s behind; the pledge box; the Blink / Solana Pay QR | "No wallet to watch. A spectator can pledge SOL per verified kilometre, settled after review." |
| 2:30–2:45 | Profile → ACHIEVEMENTS flip cards, one badge on the explorer | "Badges are soulbound cNFTs via Bubblegum. Transfer is refused on chain." Then: "Payouts run after the 48-hour review window; not shown because none is due yet." |

Cut order if over 3 min: achievements → Blink QR → receipt. Never cut the buy, the vault, or the verdict.

## 4 · Say / never say

Say aloud at least once: "Solana devnet" · "demo clock ×60" · "not audited" · "one-hour shifts on sale today, four and eight next" · "the server never holds the money" · "no token".

Never: "lottery" · "draw" · "lucky" · "proven human" · "sponsored gas" · a payout that has not happened · "mainnet soon" without the gates (review, audit).

## 5 · The 15-minute interview (if shortlisted)

Expect the seven factors as questions. Prepare one honest answer each, 30 seconds:

- **Why you alone?** Exchange money code + game dev; the four-seat crew on the landing roadmap is the first hire plan.
- **Why not fully on-chain like Supersize (Radar, 1st Gaming)?** Physics and 10 Hz telemetry are cheaper and more honest off-chain; the chain holds what needs trust: money, the seed, the attestation. Scrim (Breakout, 3rd Gaming) escrows 1v1 wagers between players; here the escrow is a pool and the judge is a server-rebuilt road, not two players' word. Both: <https://colosseum.com/projects/explore/supersize>, <https://colosseum.com/projects/explore/scrim>.
- **How do you stop a bot?** Hash-chained recordings, physics bounds, hole checks on the server's road, input statistics, prompts in the cab, review window, admin decision. What it does not do today: re-simulate; a modified client that fakes a consistent human recording is the open risk, and the audit comes before mainnet.
- **Market size?** Give it as a wedge, not a TAM: streamed endurance play plus Solana wallets. If you quote a number, open the source on screen.
- **Regulatory?** Skill prize, no draw, no token; jurisdiction review is a mainnet gate.
- **What changed since submission?** Keep one build log per week; judges may ask.

## 6 · Upload checklist

- [ ] Both videos public on YouTube, titles "Freight Chain – pitch" / "Freight Chain – technical demo", links pasted in `presentationLink` / `pitchVideoLink` and `technicalDemoLink` / `demoVideoLink`.
- [ ] Solana ticked under "which chains" (the track). Logo uploaded. Repo public (it is, checked 22:30 UTC).
- [ ] Disclosure in the form (FAQ "who is eligible"): the truck, routes, cockpit, traffic, climate predate the window; everything else is from Sep 14 → Oct 12.
- [ ] **Submit**, not save. Then one build log with both links and the pool on the explorer.
