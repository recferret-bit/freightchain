# Freight Chain → Colosseum "Crypto World's Fair" – final 36 hours

Written Sat Oct 11, 2026, 18:30 UTC (11:30 PT). Supersedes the schedule in [`hackathon-plan-v2.md`](hackathon-plan-v2.md); its decisions, ground rules and the submission-portal checklist still stand. Hard close **Sun Oct 12, 11:59 pm PT** (`2026-10-13T06:59Z`). Working deadline for the form: **Sun noon PT**.

## Where we are (verified Oct 11, 18:00 UTC)

| Area | State |
|---|---|
| Live site | landing, whitepaper, game, `/r/:id` all 200. `api/health` 404 (the route is `/api/health/ready` – the README links the wrong path). |
| Chain | program v2 on devnet, `PAYMENT_MODE=program` in production; pool 0 sold 2 tickets (0.004 SOL in the vault). |
| Whitepaper (live) | still says: Anchor program `WRITTEN, TESTED · NOT DEPLOYED` (×3), anti-cheat `BUILT · NEXT DEPLOY`, "paid shifts are soon", 1 H "Soon". Contradicts the README and the explorer. |
| Traction | `/api/stats`: 25 rides, 24 free, 1 paid, 5 completed, 2 drivers – both test wallets. PostHog 24 h: 85 landing views, 3 wallet clicks, 1 lobby view. |
| Socials | X account linked. YouTube: one 59 s clip, 2 views. TikTok `@freightchain`: 0 videos (five `tiktok-*` specs + `design/tiktok/` captions exist locally). TikTok not in the landing `SOCIALS`. |
| Repo | **private** (`gh repo view` → PRIVATE). The submission links it. |
| Colosseum project | status **draft**, `tracks: []` (not in the Solana track), no presentation / demo / pitch links, `marketValidation` / `traction` / `competition` / `monetization` / `teamCommitment` / `additionalInfo` empty, description says "weekly jackpot", technologies list AI tools only, chain-usage text ends mid-word ("Sp"), says gas can be sponsored (removed Oct 10). Two build logs + one hackathon update posted. |

Judge's score today (the seven factors of the hackathon FAQ): fit 6 · insight 7 · product 8 built / 5 visible · market 4 · communication 4 · viability 5 · traction 2 → **≈ 4.5 / 10 overall, 6 / 10 Solana track**.

## Order of work

Dependencies: the deploy (A) comes before playtests (C) and the videos (E); the repo goes public (B) before the verified-build badge (B3); social posts (D) and playtests (C) feed the traction field (F5); the form (F) is last and closes at noon PT Sunday.

### A · Sat afternoon – one story on every surface (me, ~2 h, then ONE deploy on your word)

- [ ] A1 `landing/whitepaper.html`: line 63 lede ("shifts are soon"), line 77 anti-cheat pill → `LIVE · SHADOW MODE`, line 79 escrow pill → `LIVE · DEVNET`, lines 211–216 price table (1 H is on sale on the devnet test schedule; 4 H / 8 H soon), lines 263–264 pool prizes / sponsorship → `ON DEVNET`. Keep ch. 05 inside the 27 kB gzip budget; `landing/test/whitepaper.test.js` must stay green.
- [ ] A2 README: top paragraph "still takes the legacy weekly transfer" → program mode is live; "Ten minutes" step 2 (pills) and step 6 (legacy memo transfer) rewritten; status row "The whitepaper still says next deploy" dropped; health link → `/api/health/ready`; worksheet link → this file. `docs/escrow-open-items.md` "Not done → Deploy and keys" first two bullets struck (they say nothing is deployed).
- [ ] A3 `landing/src/main.js` `SOCIALS`: add `tiktok` once D1 has posted (second deploy, or fold into A4 if D1 is done first).
- [ ] A4 **You say "deploy"** → `npm run deploy` → smoke → open the live whitepaper and check the pills by eye.
- Done when: README, whitepaper, landing footer and the explorer agree.

### B · Sat afternoon – repo public, verified badge (you 15 min, me ~1 h)

- [ ] B1 Me: scan the whole history for secrets before the flip (every `.env`, `deploy/secrets/`, `treasury.json`, the QuickNode URL with its key, `PAYOUT_SECRET` / `CRANK_SECRET`, Phantom exports). Report by file name only.
- [ ] B2 You: GitHub → Settings → Danger zone → public (or `gh repo edit recferret-bit/freightchain --visibility public`). The submission's `repoLink` already points there.
- [ ] B3 Me, optional but cheap for the track judges: `solana-verify verify-from-repo` + `remote submit-job` for `8No42h…GCA1p` on devnet (`program-deploy.md` line 82), so the explorer shows the "verified" badge the README says is still open. Needs the devnet deploy key; devnet only; no program deploy.

### C · Sat evening → Sun morning – real people on the site (you 30 min to invite, me on watch)

- [ ] C1 You: send the link to the five playtesters from Q14 plus anyone else (10–20 wallets is the goal). One message: Phantom on devnet, the faucet, "finish the EASY free ride (no SOL needed), then buy one 1 H ticket (0.002 SOL)". The free ride is the number that counts; the ticket is the bonus.
- [ ] C2 Me: watch `prod-logs` / `prod-db` read-only; fix only a blocker (sign-in, buy, mid-ride reload). No features.
- [ ] C3 Sun 09:00 PT, me: count from the production DB excluding your wallets – distinct wallets, completed free rides, tickets bought, pool 1 sold – and refresh the three PostHog screenshots in `docs/analytics/img/`. These numbers go into F5, as they are. No invented waitlist.

### D · Sat evening – post what is already made (you, ~1 h)

- [ ] D1 TikTok `@freightchain`: post 3–5 of the rendered `tiktok-*` clips with `design/tiktok/captions.txt`. Today the account is empty, so "tiktok" cannot be claimed in the form until this is done.
- [ ] D2 X: one pinned thread – what is live, the devnet pool on the explorer, the 59 s clip, "play a free ride tonight". Mention the live stream angle.
- [ ] D3 YouTube: channel description + links; the two videos from E go here.
- [ ] D4 Me: `SOCIALS.tiktok` (A3).

### E · Sun morning – the two required videos (me 30 min prep, you ~2 h)

Record on real Chrome, a clean profile, the live URL, 1080p. Say "Solana devnet" and "demo clock ×60" out loud. Check first that your Phantom is in `DEMO_WALLETS` in `deploy/.env` (key name only).

- [ ] E1 Me: a shot list with every URL open in tabs, in order:
  1. landing hero → ECONOMY chapter (the escrow sentence)
  2. CONNECT → Phantom signs the SIWS message ("this is not a transaction")
  3. lobby → free EASY ride with TUTORIAL on → 20 s of the cab, one tutorial step, finish line, the green stamp
  4. lobby → `1H · pool` card → BUY → Phantom signs and sends (buyer pays its own fee) → ticket toast
  5. explorer: the pool's vault PDA with the lamports in it, then the program id
  6. START the 1 h shift on the ×60 clock → finish → the end dialog → POST ON X
  7. `/r/:id` receipt: telemetry, seed, the explorer link, the X card preview
  8. profile → VERDICT (verified / flagged, the reasons)
  9. LIVE / REPLAYS → the watch page replaying the ride 25 s behind
  10. one sentence on what the payout job does after the 48 h review (do not show a payout that has not happened)
- [ ] E2 You: **demo ≤ 3 min** = the shot list, no slides. **Presentation 2–3 min** = the seven-factor spine from `hackathon-plan-v2.md` → "Sat Oct 11", in your words: insight (Desert Bus, verified human performance) · product · you · market · money (10 % of every pool, 20 % seeds the next) · built vs next · distribution. Say why the game is off-chain and the money is on-chain, and name the Solana-native next steps.
- [ ] E3 Upload both to YouTube (public), paste the links into the form (F6).

### F · Sun by noon PT – the submission form (you, ~1.5 h). I do not write these texts; judges read them as yours. Outline per field:

- [ ] F1 **Track**: Solana Ecosystem. Today `tracks: []` – without this you are not in the $100k track pool.
- [ ] F2 **Description**: drop "weekly jackpot" (your own ground rule). One pool per shift length, a ticket priced in dollars paid in SOL, verified finishers share the pool.
- [ ] F3 **Technologies**: Anchor, @solana/web3.js, Phantom, Solflare, Sign-In With Solana, QuickNode devnet RPC, NestJS, Prisma, PostgreSQL, three.js, Docker, nginx, PostHog. AI tools after the stack, if at all.
- [ ] F4 **Chain usage**: re-paste the full text (it ends in "Sp"); remove "gas can be sponsored" (every wallet pays its own fee since Oct 10); add: program-owned vault per pool, permissionless refunds after a missed goal, prizes capped on chain, a payout key that can only pay after the review window, verifiable build hash, not audited, devnet.
- [ ] F5 **Empty fields**: traction (the C3 numbers + PostHog, labelled devnet) · market validation (what players did, what they said) · competition (Supersize and Lana Roads on Solana – fully on-chain games; Desert Bus for Hope and web2 skill-prize platforms – why a recorded, server-judged shift is different) · monetization (10 % fee of every pool, 20 % seed, platform cut 0 on devnet) · team commitment (solo, hours per week, the four-seat crew on the landing roadmap) · legal entity / fundraising / token (honest answers; no token).
- [ ] F6 **Links**: presentation, demo, pitch video (E3), live product access instructions (Phantom on devnet, faucet, the free ride needs no SOL, the demo-wallet clock).
- [ ] F7 **Disclosure in the form** (FAQ "who is eligible": pre-existing code must be disclosed in the submission form, the README alone is not the form): `additionalInfo` or `repoContext` = the README "Disclosure" paragraph – the truck, routes, cockpit, traffic and climate predate the hackathon; everything else is from the window.
- [ ] F8 Logo uploaded (`client/icons/icon-512.png`), then **Submit** – not "save draft". Then one last build log: the devnet pool link, the ticket count, both videos.

### G · Sun afternoon – buffer (both)

- [ ] G1 Fresh wallet, live URL, the whole loop once more. Fix only blockers.
- [ ] G2 Nothing new. No deploy without a smoke test. Official close 11:59 pm PT.

## Target score after all of the above

| Factor | Today | Target | What moves it |
|---|---|---|---|
| Founder + market fit | 6 | 6.5 | team commitment stated, hiring plan named |
| Insight | 7 | 7.5 | the off-chain game / on-chain money argument made against the fully on-chain winners |
| Product + execution | 5 visible | 8 | public repo, consistent whitepaper / README / explorer, verified badge, the demo |
| Market size | 4 | 5–6 | 6 only with a sourced number for skill-prize gaming; 5 without |
| Founder communication | 4 | 7.5 | both videos, a complete form, the X thread |
| Viability | 5 | 6.5 | monetization field, the fee path, mainnet gates |
| Traction | 2 | 4 | 10–20 outside wallets, a few tickets; devnet, labelled |

**Overall ≈ 6.5 / 10. Solana track ≈ 7.5–8 / 10.** The track shortlist is realistic; the grand prize is not, with devnet-only traction. Most of the gain is in A, B, E and F – none of them is new code.
