# Owner decisions — full texts
> Carried over unchanged from `anticheat_test_plan.md` (superseded, merged into docs/spec) §8, §12, §19, §23 and `backend_test_plan.md` (superseded, merged into docs/spec) §7 (17.10.2026). The status log is [`README.md`](README.md). Decisions 45–66 and 67–68 are in this file, not in [`OPEN.md`](OPEN.md).

---

## Decisions 1–10
> Carried over unchanged from `anticheat_test_plan.md §8` (superseded, merged into docs/spec) (17.10.2026); heading levels shifted by one. Part 1 of this file is normative; where they differ, the spec wins.

### 8. Owner decisions 1–10 — ✅ accepted 17.10.2026 with changes

The owner's general changes: (a) **plan only**, no implementation; (b) **no dependency on PR #3**, the base is main; (c) strengthen the anti-cheat itself (§9).

1. ✅ Block 3 in PR #5, as separate commits. **Changed:** it rests only on main. In main, HARD is `free-3b` at 15 min, and that is what we use. The 30-min `free-3c`, ranked, and `cleanMetres` go "later (PR #3)" as a separate step. The `mistake@N` bot variants in main check the hull, contacts, and the verdict, not `cleanMetres`.
2. ✅ Engine: the main game (the client in Node), a kernel for precise attacks, the driver extracted from `level-check`. **Added:** after v2 the bot must emit raw input events (§9.2), because the server recomputes the ride from exactly those.
3. ✅ A human-like bot counts as a cheat. **Changed:** instead of `known-gap`, this is now part of v2: a humanness score (§9.4) + server challenges (§9.5) + a manual check of the top 20.
4. ✅ CI: in-process, fake clocks, golden. Overnight: long rides at a real pace, and concurrency.
5. ✅ Tolerances: 30 m + 1%, hull ± 1%. **Added:** in v2 the goal is a bitwise match of the recompute (§9.3); tolerances remain only for v1 poses.
6. ✅ Slow-mo and pause are limited. In main this is for paid rides; for ranked, later (PR #3). The implementation is in §9.3 (a lower bound of game/wall).
7. ✅ Going off the road for > X s counts as an error; a red light is decided separately. In main this affects the verdict and the hull. Applying it to `cleanMetres` is later (PR #3). After v2 the recompute itself sees the traffic lights (§9.6, #32).
8. ✅ Replay budget: 15 min ≤ 3 s CPU, ≤ 300 MB. **Added:** incremental replay in batches + a background final verdict (§9.7, §11).
9. ✅ In the harness, `TRAFFIC_PROOF_REQUIRED=true` by default; old scenarios are marked `legacy`.
10. ✅ Golden: gzip or LFS; a rebuild only with a `RULES_VERSION` bump. **Added:** golden v2 is raw events + a seed + an event seed. They are 20–30 times smaller than v1 poses (§9.2).

---


---

## Decisions 11–18
> Carried over unchanged from `anticheat_test_plan.md §12` (superseded, merged into docs/spec) (17.10.2026); heading levels shifted by one. Part 1 of this file is normative; where they differ, the spec wins.

### 12. Owner decisions 11–18 — answers of 17.10.2026
> Outcome: **13, 15, 16 accepted; 11, 12, 14, 17, 18 changed.** How they relate to §19: 11 **replaces** 30 and 32(b); 14 extends the minigame catalog (the radio from `fork-instruction`); 15 is made concrete by decision 27; 16 is extended by decision 31; 18 produces the new decisions 33–34.

11. ❌→✏️ **v2 timeline — the recommendation is rejected.** Owner: "we do it properly at once; I will get it all done in time". We do not run a shadow Pre-season on v1; we build v2 + minigames at full scope. This **replaces decisions 30 (the Pre-season minimum) and 32(b) (cutting scope)**. Risk: an estimate of 70–105 person-days (§18); with the whole expanded catalog of §13.9, up to 103–151. Recorded as a risk, with no objection.
12. ✏️ **Determinism — changed:** a fixed step of **30 Hz** instead of 60 (the owner considers 60 too heavy). The "bitwise match" goal remains; the fallback when browsers diverge is a tolerance without pulling toward the poses, and `resim-divergence` (flag). 1h = 108,000 steps; the server is ≈ 2–7 s of CPU per ride (§9.3). The fallback rate is 20 Hz.
13. ✅ **Traffic in the pool — accepted:** a shared `roadSeed` + a personal `trafficSalt` with commit–reveal (§9.6). Explain it in the rules.
14. ✏️ **Challenges — changed:** for 1h, the road challenges (`surprise-hazard`, `fork-instruction`, `lane-closure`, `signal-retime`, `crosswind-gust`) as a separate class **are not built; minigames replace them** (§13). What is useful is carried into the catalog: `fork-instruction` → `dispatch-radio/exit` (§13.9.8). "Press H" is still not built.
15. ✅ **Thresholds and FP — accepted** (made concrete by decision 27, §16.4).
16. ✅ **Privacy — accepted** (extended by decision 31: mouse and key traces).
17. ✏️ **4h and 8h are removed** — only 1h and the free ones remain (as they are). The question "speed up 8h for the player" is dropped. Time acceleration remains **only a technique for testing 1h** (fake clocks, `DEMO_SCALE`), §11.
18. ✏️ **Public replay — changed:** what is publicly visible is **only the player's previous completed ride, never the current one** (no live viewing of rides in progress). As before: poses from the server recompute, with no per-frame input. Consequences:
    - `GET /api/watch/:id` (`server/src/presentation/live/live.http.controller.ts:37`) — for a ride in the "en route" status it answers `404`/`403` to everyone except the owner; it opens after completion and the verdict (for pools, see decision 34).
    - `GET /api/watch/:id/road` (`:44`, currently **public**: "PUBLIC like the watch page") — during the ride, the current ride's road plan **must not be given to third parties**. Only the driver's client receives it (`PlayerAuthGuard` + the ride owner + `sessionKey`); a spectator receives it after completion. The client `client/js/road-plan.js` (`followRoadPlan`) requests it with a cookie and does not change. The replay (`watch.js`) requests the plan only for completed rides.
    - Stream features on a live ride lose their point: chat `POST watch/:id/messages` (`:49`), donations and effects `POST watch/:id/donations` (`:55`), paid donations `donation-orders*` (`:61–73`, `LIVE_FREE_DONATIONS`), `rides/:id/inbox`, `mutes`, `effects/:eventId/applied` (`:78–89`), and the client files `ui/live-feed.js`, `ui/watch-panel.js`, `ui/watch-pledges.js`, `live-effects.js`. **Conflict:** holes gifted by spectators on a live ride (`donated-obstacle-ignored`, `replay-engine.ts:277`; `event-unapplied`, `:144`; day and night effects `event-clock-mismatch`) are incompatible with "no live". In a pool they also make the difficulty **unequal** between players. → **decision 33 (accepted: delete in full)**.
    - A plus for anti-cheat: the channel "I am watching someone else's ride in real time" disappears (#35/36/49 — copying), and `/api/watch` returns only server poses.

---


---

## Decisions 19–37
> Carried over unchanged from `anticheat_test_plan.md §19` (superseded, merged into docs/spec) (17.10.2026); heading levels shifted by one. Part 1 of this file is normative; where they differ, the spec wins.

### 19. Owner decisions 19–37 — ✅ 19–29, 31, 33–37 accepted 17.10.2026; 30 and 32 are replaced by decision 11
> Seasons are not planned yet (owner decision of 17.10): the first launch is a **devnet launch**; everything else in §13–20 is "later".

> The 1h-pool metric (23) was closed on 17.10: the components separately, the owner's formula (§21). ~~For 32, option (b) "cut scope" was chosen~~ — **replaced by decision 11** (full scope; the owner takes it on).
Decisions 11–18 were answered on 17.10 (§12): 13, 15, 16 accepted; 11, 12, 14, 17, 18 changed. The link: 11 **replaces** 30 and 32(b); 14 — road challenges are replaced by minigames; 15 is made concrete by 27; 16 is extended by 31; 18 → 33, 34. Decision 25, "in the first launch, alongside the chain", is read under decision 11 as "from the first queue, mandatory for v2 at once".

19. **Minigame scope.** Only 1h (paid and pool). Free, 4h, 8h — not now. *I recommend yes.*
20. **Count and intervals.** 3 events per 1h (2–4), ≥ 8 min between them, not in the first 5 or the last 3 min, and no closer than 300 m to hazards. *I recommend this.*
21. **Catalog.** The main set: `phone-sms`, `fuel-station`, `toll-gate`, `weigh-station`; `cargo-seal` — as the scope allows; `dispatch-radio` — as a road challenge (§9.5). The first wave: only `phone-sms` in shadow (clarified by decision 11: full scope). *I recommend this.* **Clarification (decision 14):** `dispatch-radio` is now a minigame; the `exit` variant replaces the road challenge `fork-instruction`.
22. **A safe state for the phone.** Only while stopped (a red light, a toll stretch, a station; if there is no stop for 5 min — a server lay-by for parking). Do not introduce cruise control for this. *I recommend this.*
23. **Penalties.** A wrong answer +20 s, a miss +45 s, never a ride failure; ≥ 2 misses → flag. ✅ **Clarified 17.10 (owner):** minigame penalties and outcomes are written in **separate fields** of the ride (`mgWrong`, `mgMissed`, `mgPenaltySeconds`, `mgDetail`, §21.2); what weight they get in the ranking is decided by the **owner's formula** (§21.4; the default proposal is decision 42). The "1h-pool metric" question is closed: the main criterion is reaching the finish, then time, damage, rules, and minigames.
24. **Values as a picture.** Codes, masses, and numbers arrive as an image with noise; the client has no correct answer. *I recommend yes (cheap; it cuts off reading the DOM and memory).*
25. **HMAC with the session key** instead of an unkeyed SHA-256: in the devnet launch, alongside the chain, and mandatory later (under decision 11 — mandatory for v2 at once). *I recommend yes.*
26. **`isTrusted=false`.** A flag and a manual check, not a reject (a modified client can forge it, and assistive technologies can produce synthetic input). *I recommend flag.*
27. **A reject for mechanics only on "physically impossible"** — the five conditions of §16.4 (a–e); the rest is review. *I recommend this (it makes 15 concrete).*
28. **"More time" mode.** The window ×2, the choice before the start, a separate feature base. *I recommend yes.*
29. **Publish `mgSalt` after the verdict** (a commit at the start, a reveal after) — an audit that the tasks were not fitted to the player. *I recommend yes.*
30. ~~**Scope of the first launch.** The §18.1 minimum …~~ ⛔ **Replaced by decision 11** (17.10): full scope at once; §18.1 is now the first queue of work.
31. **Privacy (an extension of 16).** In PRIVACY.md and the devnet-launch rules, state explicitly the mouse and key traces in minigames, the purpose (contest fairness only), 90 days of retention, and cross-wallet clustering only for the top 20. *I recommend yes.*
32. ~~**Resources.** (a) a second developer, or (b) cut scope~~ ⛔ **Replaced by decision 11** (17.10): the owner takes the whole scope alone. The estimate of 70–105 person-days (103–151 with all of §13.9) remains as a risk.
33. ✅ **Accepted 17.10 (the owner's wording): money never affects a ride.** Donations, tips, and any paid actions by spectators **never** create holes or obstacles and do not affect the ride in any other way. Holes gifted by spectators are deleted **in full**: they are not turned into server events. On the replay of the previous ride, only cosmetics and chat may remain. What to delete in the code later is §20.1.
34. ✅ **Accepted 17.10 (with the weekly pool format, §20):** replays and the road plan of pool rides become public **no earlier than the pool closes**. By default — after the review ends (`payout_at`); this is a parameter. The driver always sees their own current ride and its plan. Free rides — after the verdict.
35. ✅ **Accepted 17.10. One shared road over a 5-day window.** With a shared `roadSeed`, a player with several qualifying attempts learns the holes from their own past attempts (their own replay), and whoever has more attempts gets more "training" on the qualifying road. Options: (a) a shared `roadSeed` + `trafficSalt` (as in decision 13); (b) a fully personal road per attempt; (c) a **shared skeleton** (route, intersections, forks, length) + a **personal hole layout per attempt** (`holeSalt = HMAC(serverSecret, poolId‖wallet‖attemptNo)`, the same number and mix of holes per km, positions shifted within the segment) + `trafficSalt` + commit–reveal.
    **Applied to the devnet launch:** if there is **one** qualifying attempt (as it is now in [`PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md) §5–6) — (a); decision 34 closes the leak through other people's replays. **If there is more than one attempt** — (c). For (c), `roadPlanFor(seed, trip)` → `roadPlanFor(seed, trip, holeSalt)` in the server check (`world-facts.ts`, `world-checks.ts`, `replay-engine.ts`) and in the client (`road-plan.js`); clarify the wording "Every ranked attempt drives the same Event route" ([`PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md) §7) to: "the same route; each attempt has its own holes and traffic, equal in number and in types".
36. ✅ **Accepted 17.10. The last allowed start of a ride.** A 1h ride started less than an hour before close cannot finish in time. Proposal: `last_start_at = play_close_at − ride length (3600 s) − margin`; the margin is 15 min (pauses under decision 6, a reconnect up to `HB_TIMEOUT_MS` of 150 s, a recording window of 60 s). By default this is close − 1 h 15 min. Sales close 2 h before close, so someone who bought in the last minute has 45 min to start; this must be shown directly in the purchase UI. Behavior:
    - a start after `last_start_at` → `409 pool_last_start_passed`;
    - a ride started on time keeps being recorded until `play_close_at` + a recording window of 60 s;
    - one not finished by that moment is `abandoned` (distance covered counts under the board rules).

    The margin is a pool-schedule parameter.
37. ✅ **Accepted 17.10. Pool-contract changes (a plan, v6) for the weekly format.** Deadlines already exist in the pool account, but there is no weekly cadence and no `last_start_at`, and the `min_finish_secs` floor blocks the 2 h window (§20.3). Proposal: (a) now — set `Config.min_finish_secs ≤ 7 200` via `set_config` and use the existing `prep_deadline`/`play_deadline`/`payout_at`; (b) in v6 — `opens_at`, `last_start_at` (or `start_buffer_secs`), and a separate `period_secs` on the series. (a) now, (b) together with the next program change.

---


---

## Decisions 38–44
> Carried over unchanged from `anticheat_test_plan.md §23` (superseded, merged into docs/spec) (17.10.2026); heading levels shifted by one. Part 1 of this file is normative; where they differ, the spec wins.

### 23. Decisions 38–44 — ✅ accepted 17.10.2026 (every recommendation)
38. **What "65 km/h" means.** (a) Speed on an open straight; turns, traffic lights, and minigames add time on top (the average over the ride comes out ≈ 50–55 km/h). (b) The average over the whole ride, that is, the finish = 65 km. *I recommend (a)*: that is how the wording "take turns, traffic lights, and stops into account" is read. Calibrate AC-F2.
39. **The finish does not depend on personal salts.** The finish point depends only on `roadSeed` + `trip` + the rules version. Minigames, traffic, and personal holes are accounted for by a fixed expectation. One point per pool. *I recommend yes*: a fair comparison of times; the minigame schedule is not revealed. The alternative "the attempt salt moves the finish" is needed only if the road will be fully personal (decision 35 b).
40. **Map boundary.** The road is endless; the plan limit is 1,000 km. At 90 min × 100 km/h ≈ 150 km, a margin of ×6. *I recommend:* the check `finishS ≤ ROAD_PLAN_MAX_S − 5 km` as a configuration error (the pool is not created). If the map ever becomes finite and the length is not enough, do not "wrap" the finish at the edge; take another `roadSeed`.
41. **The governor and an early finish.** Do not touch `MAX_SPEED`. An early finish is a good time, with no minimum time. Violations that cannot be measured (a stop line with no traffic light, speeding) are `null` fields until there is a rule. *I recommend this.* If the owner wants speed limits, that is a new game rule (signs and `speedingSeconds`), by a separate decision.
42. **The ranking formula.** It is published with its weights in the pool rules before the pool opens, and it does not change until close. Recomputing the formula after close happens only with a public announcement. *I recommend yes.* The default weights are those of §21.4 (30/25/20/25). The minigame penalty is only in the tie-break.
43. **The 90 min limit.** `T_cap = 90 min` of game time. A late start is bounded by `play_close_at + 60 s`, that is ≥ 75 min. Do not change decision 36 (close − 1 h 15 min). *I recommend this.* A stricter option: `T_cap = 75 min` for everyone — equal conditions, but less margin for slow drivers.
44. **The finish line in 1h.** Draw the finish (`finish: true` on `'1h'`) and the remaining km, but not the expected time. Otherwise the "lag behind the model" is visible, and the driver pushes. *I recommend yes.*


---

## Backend decisions 1–10
> Carried over unchanged from `backend_test_plan.md §7` (superseded, merged into docs/spec) (17.10.2026); heading levels shifted by one. Part 1 of this file is normative; where they differ, the spec wins.

### 7. Owner decisions — ✅ ACCEPTED 17.10.2026

All recommendations 1–10 were accepted by the owner **as written** (2026-10-17). Implementation is a **new PR from main after PR #3 merges**; PR #5 receives only the generated `API-*` section from the spec.

1. ✅ **Source of the schemas: zod; generate OpenAPI from it.** Zod response schemas sit next to the DTOs, and `openapi.json` is a derived artifact. Hand-written OpenAPI, and `@nestjs/swagger` + class-validator, are out: the input is already entirely on zod.
2. ✅ **A response-schema violation.** In test/dev — a 500 and the test fails; in production — a warn log only (the flag `RESPONSE_SCHEMA_CHECK=off|warn|strict`).
3. ✅ **Extra fields on input.** `.strict()` (400) for admin, editor, and money routes (`tickets`, `rides`, `promo`, `referrals`, `pledges`, `donations`, `chain/*`); for `telemetry`/`client-error`, drop them silently (old clients). The API behavior changes on purpose.
4. ✅ **The gate threshold.** ≥ 1 positive and ≥ 2 negatives per route (at least one of them a business case); for money and admin, ≥ 4 negatives and ≥ 1 race or retry test. For the first 2 weeks the gate only reports; then it is mandatory.
5. ✅ **schemathesis** — overnight and by hand, not in the CI required for a PR. **fast-check** — at once, for the money domain and for windows.
6. ✅ **Where the tests live.** The contract, the matrix, and the scenarios live in `server/test/contract` + `server/test/scenarios`. Docker smoke and block 2 live in `e2e/` from PR #5. Implementation is a **new PR from main after PR #3 merges**; PR #5 only pulls in the generated `API-*` section.
7. ✅ **Geo with no `CF-IPCountry` is fail-closed.** No header → a ranked refusal (`ranked_ineligible` / the equivalent). For local development and tests, a flag (for example `PRIZE_DEV_DEFAULT_COUNTRY=XX`) fills in a default country; with no flag, behavior is as in prod (a refusal).
8. ✅ **An admin route for `set_pool_rules` (pool v5).** HTTP with a signed challenge → action pair (like the rest of admin), so the route lands in the matrix.
9. ✅ **Someone else's resource is 404 everywhere** (not 403), so existence cannot be probed; lock this into matrix B.
10. ✅ **Code coverage in CI.** We do not add a separate line threshold on top of `test:census` (70% of lines, 60% of branches per feature). The main metric is the gate over routes and cases.

---

## Decisions 45–58 (replays and streams) — ✅ accepted 17.10.2026
> The owner accepted every recommendation 45–58 on 17.10.2026; the final wording = the recommendation (carried over from [`OPEN.md`](OPEN.md) section A). Decision 58 was clarified by the owner: lobby texts in EN and RU from day one (the devnet launch is also aimed at an RU/CIS audience). The norms are in [`replays_streams.md`](replays_streams.md), [`rides.md`](rides.md), [`legal.md`](legal.md).

45. ✅ **"A donation reaches the person playing" — when?** The code can currently take a donation **during** the current ride (`watch/:id/donations`, the driver's inbox, the CB radio). This contradicts decision 18 (nobody sees the current ride) and decision 33. *Decision:* a donation only while watching a **replay**. The money arrives in the driver's wallet at once, and the driver sees it after the ride (a "Donations received" list, a notification; RPL-M-18). There are no donations and no chat during play.
46. ✅ **The LIVE tab and the counters.** *Decision:* keep only "N on the road", with no cards that have links, no progress, and no "WATCH A RANDOM ONE". "Watching now" on a replay is shown (an honest `VIEWERS_PER_SOURCE` counter).
47. ✅ **New player controls.**
    - Speeds 0.5× / 1× / 2× / 4× / 16×.
    - Steps of ±5 / ±30 s, and space.
    - Markers and jumps to events (crashes, a red light, minigames, the finish).
    - Camera `C`, full screen `F`, hide the HUD `H`.
    - A link with `&t=`.
    
    *Decision:* all of them; the first queue is steps, events, `&t=`, and 0.5×/2×.
48. ✅ **Input highlighting in the public replay** (`input-bits.js`, the `SAMPLE_INPUT_COL` column, per 100 ms). *Decision:* remove it from the public response and the UI; leave it to the admin. It is raw material for copying a style, and part of the features F1–F10.
49. ✅ **An HONK burn into the chat on a replay.** *Decision:* keep it as cosmetics (a line in the chat, with no effect). HONK time/weather — delete (decision 33). After PR #3 merges — TEN4 (points, with no value until TGE).
50. ✅ **A referral share of donations** (`referral_donation_share_bps = 1000`, 10%). It contradicts TERMS 14.3 and [`MASTER_PLAN.md`](../plan/MASTER_PLAN.md) §3 ("100% to the driver; the referral does not touch them"). *Decision:* remove the share (set it to 0 and delete the `also` branch).
51. ✅ **"Per km" pledges** (`watch-pledges.js`, `pledge.rs`). The spectator's money depends on the driver's result (verified km), and it is placed on the current ticket ride. *Decision:* turn it off for the devnet launch (there are no paid tickets). Later, a separate decision: a pledge only **before the start**, settlement after the pool review, and `[LAWYER]` (it looks like a bet on the outcome).
52. ✅ **Donation amounts and order expiry.** *I recommend:*
    - fixed tips of 0.01 / 0.05 / 0.1 SOL;
    - a minimum of 0.001 SOL and a maximum of 1 SOL per donation (parameters);
    - an order expires after 15 min (`expired`); there is no lock;
    - ≤ 3 unclosed orders per wallet.
53. ✅ **A chat filter.** *Decision:* in the first queue, links are forbidden (except the explorer link on a paid donation); an EN/RU banned-word list is a parameter. An admin "hide" button, and a wallet ban for chat.
54. ✅ **Chat bound to replay time** (`replayT`). *Decision:* yes. On send, a message gets the replay's current second; it is shown when that second plays, and in the shared feed.
55. ✅ **Which rides count as "completed" for a replay.** *Decision:* `completed`, `abandoned`, and `failed` (a crash is also interesting to watch) whose final verdict is not `rejected`. `rejected` is for the admin only.
56. ✅ **What counts as training.** *Decision:* `tier = free` (every level), guest offline, and any ride with `tutorial` / `assist`. A free devnet-launch attempt for tasks, and a promo 1h ride, are **not** training: they are ranked and enter replays after the verdict (pool rides, after `payout_at`).
57. ✅ **One's own pool replay before `payout_at`.** *Decision:* for the driver, yes (only for them, with a session). There is one attempt, so there is nothing to memorize. If there come to be more attempts, the holes differ by `holeSalt` (decision 35).
58. ✅ **RU lobby texts.** The interface is English only right now. The RU texts are prepared (RPL-M-10). *Decision:* EN and RU at once — the devnet launch also goes to a Russian-speaking and CIS audience (the decision of 17.10.2026), so the label "TRAINING · DOES NOT ENTER REPLAYS" is needed in Russian from day one.

---

## Decisions 59–66 (admin security) — ✅ accepted 17.10.2026
> The owner accepted every recommendation 59–66 on 17.10.2026; the final wording = the recommendation (carried over from [`OPEN.md`](OPEN.md) section B). The notification channel of decision 64 is Telegram. The norms are [`admin_security.md`](admin_security.md).

59. ✅ **Roles.** There is one allowlist now, `ADMIN_WALLETS`: any admin changes money and sees IP addresses. *Decision:* three roles — `admin` (everything), `moderator` (the review queue, replays, players without personal data, and hide and ban in chat under decision 53), `editor` (storybook only). The lists are `ADMIN_WALLETS` / `MODERATOR_WALLETS` / `EDITOR_WALLETS`. An editor's publish of an entity waits for a review by a second editor or an admin (mandatory before mainnet; on devnet, one editor signature + a notification).
60. ✅ **Money and the chain are two steps.** Today, an override/rejudge of a paid ride, a pool hold, promo `tickets`, and money settings are done with one signature of one admin. *Decision:* on the devnet launch, one signature + a mandatory notification; for paid pools and mainnet, confirmation by a second admin within 30 min; on-chain `set_config` / `set_pool_rules` only through Squads (tied to the `team_recipient` address).
61. ✅ **Default-deny.** *Decision:* a global `PrivilegedSurfaceGuard` on the prefixes `/api/admin`, `/api/editor`, `/api/editor/mcp`, plus a meta-test of guard coverage; the guard on the class stays.
62. ✅ **Strict startup.** Checks run only when `NODE_ENV === 'production'` today; `DEMO_WALLETS` (including `*`) is not forbidden in production; `ADMIN_JWT_SECRET` is derived from `JWT_SECRET`. *Decision:* strict mode for any `NODE_ENV` except `development`/`test`; startup fails on `DEMO_WALLETS`, on `EDITOR_FAKE_LLM=1`, on `LIVE_FREE_DONATIONS=on`, on `LIVE_EFFECTS≠off`, and when `ADMIN_JWT_SECRET`/`EDITOR_JWT_SECRET` are not separate.
63. ✅ **The admin session.** It is 120 min now (maximum 1440); logout does not revoke the token. *Decision:* ≤ 60 min with no renewal, a `jti` + a revocation list (Redis), and revocation on logout.
64. ✅ **Audit and notifications.** *Decision:* forbid `UPDATE`/`DELETE` for the application role, plus a trigger; "before/after" on every row; audit failed logins, logout, reads of personal data, and the CLI; keep them for ≥ 2 years; notifications go to the owner's **Telegram** chat (a login, any change, 5 failed logins in 10 min, `pending_approval`). The bot token and the chat id go only through env (`ADMIN_ALERT_TELEGRAM_BOT_TOKEN`, `ADMIN_ALERT_TELEGRAM_CHAT_ID` in `deploy/.env` on the server); the repository holds no secrets. If Telegram is unavailable, the notification is not lost: an `admin.AlertOutbox` queue retries for up to 24 h, an `error` log `admin-alert.undelivered` is written, and a banner is shown on the admin page; the change is not blocked (the owner chose the channel on 17.10.2026).
65. ✅ **Login limits and admin brute force.** *Decision:* an `auth` budget (30/min + 5/s) for `/api/admin/auth/*`, `limit_req` on the admin nginx site, and ≤ 30 changes/min per admin; `auth/nonce` is always `200` (a dummy nonce for outsiders), and the nonce is keyed by (wallet + client).
66. ✅ **An IP allowlist for the admin.** *Decision:* `ADMIN_IP_ALLOWLIST` (as for the editor) is required for mainnet and optional on devnet (basic auth + a signature is enough).

---

## Decisions 67–68 (process and coverage) — ✅ 18.10.2026

> Owner: build from the specification, with no holes per feature; the tests are full coverage in a real headless browser, positive and negative, backend and blockchain. The texts are [`PROCESS.md`](PROCESS.md), [`PRODUCT.md`](PRODUCT.md), [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md), [`../testing/IMPLEMENTATION_PLAN.md`](../testing/IMPLEMENTATION_PLAN.md).

67. ✅ **The specification in two layers.** *Decision:* `PRODUCT.md` is what the code does now. The MUST rules and decisions 1–66 are the target, until the code matches them. Tests lock the current behavior. The target enters the code only together with an edit of `PRODUCT.md` and of the tests. A conflict between two decisions is not settled in the course of a test: it is recorded in `PRODUCT.md`, and the choice is the owner's. The `*-T-*` catalog is a test plan, not tests already written.

68. ✅ **The coverage bar.** *Decision:* a user path is checked in real headless Chrome, positive and negative, against a live server. Every HTTP route has a scenario in memory and on PostgreSQL: success and refusals (no session, someone else's id → 404, a conflict). A database write is an integration test; a new critical section is a race test. A program instruction is LiteSVM on the built `.so`. A flow that moves SOL or TEN4 also runs on `solana-test-validator`, with no devnet. happy-dom (`test:e2e:block1/2/pages`) stays a fast check of the modules and does not close the Chrome cell. E2E-M-01 and E2E-M-06 do not apply. The line threshold from backend decision 10 is not replaced by this bar, and this bar does not count as that threshold.

---

## Decisions 69–70 — ✅ 24.10.2026

69. ✅ **The live replay stays at 10 Hz.** *Decision:* `ReplayEngine` keeps judging recorded samples at `REPLAY_SIM_HZ` 10, with two physics substeps. `stepAt30Hz` is not the live judge and will not become it. Decision 12's 30 Hz re-sim from raw input is not adopted for the pipeline. `TELEMETRY_V21` and `MINIGAMES` stay `off`. `RULES_VERSION` stays 7. Rides already recorded stay on the 10 Hz sample stream.

70. ✅ **`set_pool_rules` stays off HTTP.** *Decision:* Decision 60 wins the conflict with backend decision 8 and `POOL-M-12`. There is no admin HTTP route. The path is `pool-admin.mjs set-pool-rules`, which the admin signs and sends. On mainnet the same instruction goes through Squads. Do not add `POST /api/admin/pools/:id/rules`.
