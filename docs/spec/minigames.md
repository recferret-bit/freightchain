# Minigames — spec and test plan

> Normative rules are the phone build on branch `phone-minigames`, not Appendix A. Appendix A is a retired catalog. Do not build it.

## Part 1. Spec

### 1.1 Where the code is

The playable minigames are in this checkout, ported from branch `phone-minigames`. `MINIGAMES` is `off` | `shadow` | `enforce` and defaults to `off`. `MG_SECRET` is required only when the mode is not `off`, and is at least 32 bytes. `MG_SALT_VERSION` defaults to `mg:v1`. With the default, a ride stamps a null commit and no event is issued.

GULP (a gas-bay stop) and PIKE (a toll arm) are local cab-phone tasks in that same tree. Their four digits are generated on the client and shown in Messages. They are not server minigames and they do not score a ride.

### 1.2 What is issued

`client/shared/minigame-kinds.js` is the catalog. Rules version `mg:1`.

| Id | Issued on a live ride |
|---|---|
| `phone-sms` | Yes. The only accepted kind. |
| `seed-words`, `buy-shitcoin`, `address-check`, `sign-or-reject`, `fuel-rugpull`, `gas-priority` | No. Generators and phone screens exist. `issuedKinds` drops anything that is not accepted. |

`fuel-station`, `weigh-station`, `toll-gate`, `cargo-seal`, `trailer-3d`, `dispatch-radio`, `exit`, `tachograph`, `reverse-park`, and `police-check` are not in this catalog.

### 1.3 Rules

- **MGM-M-01** MUST: a ride is eligible only when `tier === '1h'` and it is not `tutorial` and not `assist`. Anything else, and `MINIGAMES=off`, stamps a null commit and creates no events.
- **MGM-M-02** MUST: the schedule is 2, 3, or 4 `phone-sms` arms, with weights 0.25 / 0.5 / 0.25. The first arm is after `300 / timeScale` drive-seconds. Nothing is armed in the last `180 / timeScale` seconds. The gap is `480 / timeScale` seconds. A shift too short for two arms gets zero events. `slotS` stays null. There is no parking pocket and no road read. `shiftPastForbidden` (300 m) exists and is not called by the scheduler.
- **MGM-M-03** MUST: `mgSalt` is HMAC-SHA256 of `MG_SECRET` over the concatenation `mg:v1` + `rideId` + `wallet`, with no extra separators. `mgCommit` is the hex SHA-256 of those raw salt bytes, not of the hex string. The salt is not stored. `GET` of the ride reveals the salt hex only after a verdict exists.
- **MGM-M-04** MUST: only `phone-sms` is scheduled. A known kind that is not accepted is never armed.
- **MGM-M-05** MUST: an armed event that is still unopened in the last `180 / timeScale` seconds becomes `cancelled`. That is not a score and not a penalty. Opening records the client's safe-stop claim. Pocket geometry is not built. The client may defer once by rolling away before the first touch.
- **MGM-M-06** MUST: a code has 3 tries. A correct try passes with penalty 0, including a later try. Penalty `+20` seconds is stored only when all 3 tries are wrong. A revealed window that elapses with no answer becomes `missed` and does not add 45 seconds. Two misses do not flag `mg-missed`. Decision kinds, which are not issued, would be one try and penalty 0. A minigame never fails the ride. `MINIGAMES=enforce` may add verdict reason `mg-unsafe-open` when the client reported an unsafe stop. `off` and `shadow` add no verdict reasons.
- **MGM-M-07** MUST: the open body is a layout of opaque asset ids. The expected code is not a JSON field. Pictures are SVG, not PNG, fetched at `GET /api/rides/:id/minigames/:eventId/assets/:assetId` (`image/svg+xml`, `no-store`). The dispatch picture is a mark with no digits. One of 5–7 cab slips repeats that mark beside the code. The other slips and any decoy threads use other marks and other codes. The code is 4, 5, or 6 digits. `more-time` paints no decoy threads. The yard-desk sentences in the source are not painted into the pictures.
- **MGM-M-08** MUST: the window is 30 seconds in `normal` and 60 seconds in `more-time`. The mode and the language (`en` or `ru`) are stamped when the ride starts.
- **MGM-M-09** MUST: the stored answer is `sha256(eventId + ":" + normalized)`, hex. The raw code is not stored. A repeated attempt with the same hash returns the stored outcome. A different answer at the same attempt number conflicts.
- **MGM-M-10** MUST: open, answer, and asset reads are limited to 10 requests per ride per minute in process memory (`429`, code `mg_rate_limited`). The cap is not shared across replicas.
- **MGM-M-11** MUST: the routes are `POST /api/rides/:id/minigames/:eventId/open`, `POST /api/rides/:id/minigames/:eventId/answer`, and the SVG GET above. A late answer on a missed or expired event is `410` `mg_expired`. A session mac is checked only for shape: 43 base64url characters. HMAC of that mac is not verified yet.
- **MGM-M-12** MUST NOT: GULP and PIKE are not this system. Donations do not change a minigame row. The other six kinds stay unissued until their own change.

## Part 2. Test plan

Lock the rules above against the phone-minigames tree. Appendix B is not this suite.

| id | Rule | Scenario | Expected |
|---|---|---|---|
| MGM-T-01 | M-01 | a free, tutorial, or assist ride, or `MINIGAMES=off` | null commit, no events |
| MGM-T-02 | M-02 | many salts, including a short demo `timeScale` | count is 2–4 when the shift can hold two arms, else 0; gaps are `480 / timeScale`; `slotS` is null |
| MGM-T-03 | M-03 | `GET` the ride after a verdict | revealed salt hashes to the commit; before the verdict the salt is absent |
| MGM-T-04 | M-04 | schedule with the full known list | every event is `phone-sms` |
| MGM-T-05 | M-05 | still armed inside the end pad | status `cancelled`, penalty 0 |
| MGM-T-06 | M-06 | three wrong codes; then a miss with no answer | `+20` only on the third wrong try; a miss stores no extra seconds and does not fail the ride |
| MGM-T-07 | M-07 | open JSON and each SVG | the expected digit string is absent from the JSON; the dispatch SVG has no digit cells; one cab SVG shows the code |
| MGM-T-08 | M-08 | start in `more-time` | window is 60_000 ms and there are no decoy threads |
| MGM-T-09 | M-09 | the same attempt posted twice, then a different answer | the first outcome is returned; the second is a conflict |
| MGM-T-10 | M-10 | 11 opens inside one minute | the 11th is `429` `mg_rate_limited` |
| MGM-T-11 | M-11 | answer after `missed` | `410` `mg_expired` |
| MGM-T-12 | M-12 | a GULP or PIKE stop, and a tip | no `RideMiniGame` row, and the tip does not change `mgDetail` |

An id is not a written test until it runs on the phone-minigames tree. The executable bar is [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).

---

## Appendix A. Retired catalog (former §13)

> Not the game. The phone build does not implement parking pockets, noisy PNGs, a +45 s skip, or the 15-id list below. Part 1 wins. This appendix stays so the old decisions can be read. Do not schedule a task from it.

> Moved unchanged from `anticheat_test_plan.md §13` (17.10.2026).

### 13. Minigame captchas (1h rides only)

**Scope: paid and pool 1h rides only** (`RIDE_TIER_IDS` → `'1h'`, `seconds: HOUR`, `server/src/domain/rides/ride-tier.ts:26`). Free, 4h, and 8h are not in this plan. For tests, 1h may legally be shortened through the demo wallet (`minSeconds = tier.seconds / DEMO_SCALE`). On a short run the event-count rule from §13.3 scales (2–4 events per ride at any length).

The goal: a second defense against bots, on top of the driving. Short (5–15 s) everyday long-haul situations that barely interrupt the game. Each one checks three things: that the player **sees** the scene (reads a value in one place, enters it in another), that they have **human hands** (a mouse and key trace, §16), and that the **client is honest** (the station and the barrier are physical objects of the server world, §15).

#### 13.1 What is already in the code, and what we build on
- **The challenges channel** is ready but switched off: `RideChallenge {id, action, issuedMs, deadlineMs, codes}` and `CHALLENGE_WINDOW_MS = 20_000`, `CHALLENGE_PER_SHIFT_MAX = 4`, `challengeInterval()` (`server/src/domain/rides/ride-challenge.ts`); issuing `Ride.issueChallenge(now, intervalSeconds, draw, kinds)` (`ride.entity.ts:309`) in the heartbeat response (`heartbeat-ride.handler.ts`); display `showPrompt`/`answerPrompt` (`client/js/prompt.js`); the check `checkChallenges` (`server/src/domain/verdict/challenge-checks.ts`: `challenge-reflex` when the median is < `CHALLENGE_MIN_REACTION_MS = 80`, skips from `CHALLENGE_IGNORED_SHARE = 0.5`); config `CHALLENGE_INTERVAL_SECONDS` (240) and `CHALLENGE_FREE_RIDES` (`env.schema.ts:139–140`). Right now the answer is **one key** from `codes`. That is too little for a minigame, so we extend the channel (§13.6) rather than replace it.
- **The cab phone** already exists: `client/js/phone.js` (`power` 0–3, the Maps app, `bootAt/homeAt/readyAt`), the large map `ui/map.js`, the bit `FLAGS.phone = 4096`, events `recordPhone('phone:<what>')` (`client/js/telemetry.js`). The server **ignores** them as input (`PHONE_PREFIX`, `isPhoneInput` in `telemetry-rules.ts`). For a minigame the phone becomes a judged channel, but separate from the driving (§14.2, the `mg` stream).
- **Input:** keyboard only, and dash buttons `btn:*` via `pointerdown` (`client/js/ui/input.js:82`). On mobile, input is blocked (`isMobileDevice()`); `pointermove` currently only changes the cursor and is not recorded. The parking brake is `KeyB` / `btn:park` (`toggleParkingBrake`). **There is no cruise control in the game**, and that matters for the "safe state" (§13.3).

#### 13.2 Catalog
> The extended catalog (11 candidates, the merges, the rules for crypto games, a summary table of 15 ids) is **§13.9**.

Common to all: an interaction length of 5–15 s (from the moment the task is on screen until the answer); the answer window is set separately (§13.3). A wrong answer or a skip is a **penalty to the ride metric (time or points); the ride does not fail**. A skip or mechanical input also raises a **flag**. Every value that has to be read (codes, weight, numbers, amounts) is sent by the server as an **image** (a raster, or SVG contours with noise and a random font), not as text. The correct answer is not on the client; only the server knows it (§13.5).

| ID | Minigame | Play | What is randomized (personal to the player, from `mgSalt`) | Safe state |
|---|---|---|---|---|
| `phone-sms` | **Cab phone** | The phone vibrates → minimize Maps (the "home" button on the screen, or `Esc`) → open "Messages" (an icon on the home screen) → read the dispatcher's SMS ("Confirm the trailer number" / "ramp code" / "last 4 digits of the odometer") → find the value **somewhere else in the cab** (a sticker on the dash, the waybill on the visor, the HUD odometer, the radio frequency, a trailer plate in the mirror) → type it on the phone keypad → "Send" | the home-screen icon grid (positions out of 3×4), the digit order on the keypad (a permutation, sometimes the "normal" one), the SMS wording (≥ 12 templates), code length 4–6, where the value sits (5–7 places), 1–2 distractor SMS, the position of the "Send" button | **only while stopped:** v < 0.5 m/s for ≥ 2 s and the parking brake on (a red light, a queue on a toll road, a station). If there is no natural stop for 5 min, the server places a **parking pocket** (§13.3) |
| `fuel-station` | **Fuel station** | A sign "Fuel 2 km" + a dispatcher message "refuel at the next one" → the pull-off → stop at the **assigned** pump (the number from the message) → the brake → on the terminal, pick the fuel (diesel / AdBlue / gasoline — color + label + shape) → enter the liters from the waybill → hold the "nozzle" (a hold; its length and its variation are a signal) → pay with the PIN from the SMS | the pump number and the pump layout, the order and the colors of the fuel types, the liters (80–400), the PIN, button positions on the terminal, the side of the pull-off | stopped at the pump (the resim sees that the truck is standing in the pump zone) |
| `weigh-station` | **Weigh station** | A sign "WEIGH STATION — trucks to the right" → drive onto the platform and **stop inside the markings** (a skill; the resim checks it) → the inspector's terminal asks for 2 of 4 fields: gross mass (the scale board), trailer number (a plate, visible in the mirror), plate number (the waybill), cargo type (a choice of 3) | which 2 fields to ask, their order, where the board sits, the digit fonts, tare or gross (a distractor board), the key order, the mass values | stopped on the platform; drove off the platform before the answer → the answer is void, a retry |
| `toll-gate` | **Toll stretch** | A sign "Toll road 1 km, trucks — lanes N" → pick the truck lane (the lane numbers are random) → stop at the **barrier** → pick the class by axles (on the board, the tariff "2 axles … / 5 axles …") → enter or confirm the amount → the barrier opens. **Driving through a closed barrier = contact in the server world** (damage + `toll-barrier-breach`) | the truck-lane numbers, the tariff table (the amounts, the row order), the truck class (from the waybill: 3–5 axles), button positions, the currency and the format | stopped at the barrier; also a natural stop for `phone-sms` |
| `cargo-seal` | **Cargo seal** (extra) | Dispatcher: "check the seal" → the rear-view camera or a mirror → from 3 seal numbers, pick the one that matches the waybill | 3 similar numbers (they differ in 1–2 characters), their order, where the sheet lies | while stopped (together with `phone-sms`, or at a station) |
| `dispatch-radio` | **Dispatcher radio** (extra) | By voice and by subtitles: "at the nearest exit — exit N, ramp K" → at the next fork, take the required road; at the station, name the ramp | the wording, the number, the voice, the delay | the `exit` variant is while moving (this is the former road challenge `fork-instruction`, moved here by decision 14, §13.9.8); the `ramp` variant is the answer "ramp K" while stopped |

Why these: they are **everyday** (they fit the long-haul fantasy), they **read in one place and enter in another** (a bot has to understand the scene, not one button), three of them are **physical objects of the world** (a bot that threw out the station or the barrier is caught as "removed the obstacles", §15), and they produce **mouse traces** (§16).

#### 13.3 Schedule for a 1h
- **2–4 events per ride** (a base of 3, ±1), only from the catalog of §13.2. Not before the 5th minute and not later than 3 min before the finish, with ≥ 8 min of play between events.
- **Never on dangerous stretches:** not closer than 300 m to a fork, an intersection, a traffic light, a hole (`HOLE_WARN = 110` m + margin), a fork with an active `dispatch-radio/exit` (the road challenges of §9.5 are removed by decision 14), and not during an active contact with traffic. The server picks the slot from the **allowed slots**, which it computes itself along the road `roadPlanFor(seed, trip)`: straight stretches ≥ 600 m, with room for a pull-off.
- **Stations** (`fuel`, `weigh`, `toll`) are world objects. The server inserts them into the chosen slot, and the client receives the station description 60–90 s before it (a sign at 2 km ≈ 90 s at the governor). So the reveal comes "in time", not at the start.
- **`phone-sms`** is "armed" ahead of time (in the heartbeat response) and fires on the next natural stop. If there is none for 5 min, the server places a **parking pocket** (a world object, a "P" sign 500 m out) where the player must stop. The pocket does not count as leaving the road (otherwise `OFFROAD_FAIL_SECONDS = 20` fires, `client/shared/road.js:15`).
- **Answer window:** 30 s after the task has become visible (for stations, after the stop), ×2 in the accessibility mode (§13.7). The interaction itself takes a person 5–15 s; the margin is for reading and for finding the value.
- **Penalty** (decision 23): wrong — +20 s of penalty (written in its own field `mgPenaltySeconds`; the weight in the rating is by the owner's formula, §21.4), up to 2 input retries in one window; a skip, or driving past a station — +45 s; ≥ 2 skips in a ride → `flag mg-missed`. The ride **never fails**, except on physical contact (the barrier is damage, as with a vehicle).

#### 13.4 Not from `roadSeed`: a personal salt and commit–reveal
- `mgSalt = HMAC-SHA256(MG_SECRET, "mg:v1" ‖ rideId ‖ wallet)`. `MG_SECRET` is a server secret (env, rotated by the `mg:v1` version). Derived deterministically from `mgSalt`: the event count, their types, the slots, every randomization of §13.2, the correct answers. **This does not change the road, the holes, or the pool's overall difficulty** (`roadSeed` is shared, as in §9.6), so the difficulty is the same for everyone, while the concrete codes and layouts are each player's own.
- **Commit:** `POST /api/rides/:id/start` returns `mgCommit = SHA-256(mgSalt)` and stores it on the ride. Before the reveal the client can precompute nothing: it does not have the salt, and the correct answers are not sent to the client even at the reveal (only the images of the values, and the layouts).
- **Event reveal:** arrives in the heartbeat response (or in a stream event, §13.6) no earlier than 90 s before the station; for `phone-sms`, when it is "armed". In the event: `{id, kind, nonce, slot (s or trigger), layout (permutations), assets (images of the values), expiresAtMs}`.
- **Salt reveal:** after the verdict, `mgSalt` is published in the ride audit (`GET /api/rides/:id`, the verdict section). Anyone can check that the schedule and the codes were derived from the salt that was committed at the start, so the server did not fit the tasks to one particular player (decision 29).
- **Nonce:** `nonce = HMAC(mgSalt, eventId ‖ "nonce")[:16]`, single-use, bound to `rideId + eventId`, lives until `expiresAtMs`.

#### 13.5 Checking the answer on the server
1. **Correctness:** the server compares the answer with the expected one (`expected = f(mgSalt, eventId)`); case and spaces are normalized. Only `answerHash` is stored, not the answer itself.
2. **Timing by the server clock:** `revealDeliveredAt` (when the heartbeat response carrying the event went out) → `answerReceivedAt` (`POST …/answer`). The RTT correction is taken from clock sync (§14.4). Plus timing by the client clock from the trace (`shownAtStep/µs`, the first touch, every character). If the two clocks disagree by more than the tolerance → `mg-timer-tamper`.
3. **A minimum human time:** ≥ 250 ms after the show before the first touch; reading and typing a code of N characters ≥ 400 + 150·N ms (starting values, calibrated in shadow). Faster → `mg-too-fast` (a flag; reject only for the "impossible", §16.4).
4. **World state at the moment of the answer** (from the resim, §15): for stations, the truck is standing in the station zone, v ≈ 0, the brake is on (from the input events `KeyB`/`btn:park`). Otherwise → `mg-unsafe-state` (the answer is void and counts as a skip).
5. **The trace:** mouse and keyboard features (§16.2, F6–F7) → a contribution to `humanScore`. A mechanical trace → `mg-mechanical` (a flag).
6. **Integrity:** the answer is signed with the session key (§14.3), the nonce has not been used, the event exists, the window is open, the answer is not before the reveal (`mg-answer-before-reveal` → reject).

#### 13.6 API, data model, limits
- **Issuing: on the stream.** The existing heartbeat response (`challenge`) is extended with the field `minigames: MiniGameDto[]` (events that are "armed" or visible). The heartbeat goes out once every 10 s, so stations are revealed with 60–90 s to spare. For `phone-sms` a delay of 0–10 s does not matter: it fires at a stop, and the timer is counted from the moment it is shown.
- **The answer: a separate endpoint**, for the sake of server timing. `POST /api/rides/:id/minigames/:eventId/answer` with the body `{nonce, answer, shownAtStep, firstTouchStep, submitStep, clientMs, mac}`. Responses: `200 {correct, penaltyS, attemptsLeft}`, `409 mg_already_answered`, `410 mg_expired`, `404 mg_unknown`, `400 mg_bad_mac`, `429` on the limit. The full trace (the `mg` stream) goes in the nearest batch under the MAC; the endpoint receives only the outcome.
- **Model (Prisma):** `RideMiniGame { id, rideId, ordinal, kind, slotS, triggerJson, layoutJson, answerHash, nonce, issuedAt, revealedAt, shownAtStep, answeredAt, attempts, correct, penaltyS, status: armed|revealed|answered|missed|expired|invalid, features Json, reasons Json, rulesVersion }`. On `Ride`: `mgCommit`, `mgSaltRevealedAt` (the salt itself does not need to be stored: it is derived from `MG_SECRET`). Retention is `TELEMETRY_RETENTION_DAYS` (90 days); for the top-20 and for disputes, until payout plus the appeal period (§9.9).
- **Limits and replay protection:** 1 final answer per event, up to 3 input attempts in the window, ≤ 10 requests a minute per ride, ≤ 4 events per ride (as `CHALLENGE_PER_SHIFT_MAX`). The nonce is single-use and bound to `rideId`; a repeat → `409` and `flag mg-nonce-replay`; a foreign nonce → `400` and `reject mg-nonce-foreign`. Idempotency on `(eventId, attempt)`.
- **Verdict:** a new module `server/src/domain/verdict/minigame-checks.ts`, next to `challenge-checks.ts`, called from `RideVerdict.judge`. Codes: `mg-wrong`, `mg-missed`, `mg-too-fast`, `mg-mechanical`, `mg-unsafe-state`, `mg-timer-tamper`, `mg-answer-before-reveal`, `mg-nonce-replay`, `mg-nonce-foreign`, `mg-station-skipped`, `toll-barrier-breach`, `mg-trace-replay`. Penalties into the ride metric stand apart from severity.

#### 13.7 Accessibility
- **Color is never the only signal:** fuel types are color + label + shape, contrast per WCAG AA, the palette checked for deuteranopia and protanopia.
- **Fully from the keyboard:** `Tab`/arrows/digits/`Enter`/`Esc` (and with the mouse). No touch yet: mobiles are blocked in `ui/input.js`; when they open, touch traces are counted as a separate baseline (`pointerType = touch`).
- **"More time" mode** (decision 28): the window ×2, large digits, no distractor SMS. Chosen **before the start**, not changed during the ride, written onto the ride. Timing signals in this mode are compared with **a separate baseline** for this mode, so "slow" by itself is not a flag, while mechanicalness (even intervals, straight traces) is still visible.
- Voice prompts (`dispatch-radio`) always have subtitles. A dyslexia font is an option.

#### 13.8 Honestly about automation
- An **OCR and multimodal bot** (screenshot → model → actions) solves every task in §13.2. Randomizing the layouts breaks only scripts with fixed coordinates, and those that read the DOM or memory (the values are images; the answer is not on the client).
- The goal is not "impossible". It is: (1) **raise the cost** (a vision pipeline is required, and each player has their own layout); (2) **produce a signal** (an agent bot has delays of 2–6 s per step with little variation, straight or "teleporting" traces, no micro-movements and no overshoot, no Fitts's law — §16); (3) **a manual check of the top-20**, watching the minigame traces (§16.6).
- Minigames never reject on their own, except for integrity violations (the nonce, the MAC, an answer before the reveal, driving through the barrier) and the "physically impossible" (§16.4).

#### 13.9 Extended catalog (candidates, 17.10.2026)
There are 11 candidates; the base is the 6 from §13.2. After the merges the unique ids are **15**:
- `radio-exit` is merged with `dispatch-radio`: it is the same radio, now with a road variant "exit and lane".
- `waybill` is merged with `cargo-seal`: it is the same seal check, now with a variant "find it on the 3D model of the trailer at the scales".
- Three further candidates are **built into** existing games, but stay separate ids:
  - `fuel-rugpull` is the payment step inside `fuel-station`;
  - `gas-priority` is the payment step inside `toll-gate`;
  - `seed-words` is the phone unlock screen before `phone-sms` and the other crypto games.
- Each game goes through its own owner review. The status of every new one is **⏳ pending owner review**. Decisions 19–32 are accepted, so everything below is subject to them:
  - 1h only (19);
  - 2–4 events per ride (20), so the extended catalog is a **pool** from which `mgSalt` picks 2–4 games, not "all of them in one ride";
  - the phone only while stopped (22);
  - penalties (23): wrong +20 s, skip +45 s, the ride does not fail, ≥ 2 skips → flag;
  - values as an image (24);
  - ~~only `phone-sms` in the first wave (30)~~ — decision 30 is replaced by decision 11: the full scope; the phases in the table of §13.9.12 mean **ordering**: "devnet launch" (the first launch) or "later". Seasons are not planned yet (owner decision of 17.10).

Shared notation:
- **Resistance** against three classes of bot (§17.1): **S** — a script with fixed actions, **O** — a rules-based OCR bot, **L** — a multimodal LLM agent. Scale: low / medium / high.
- **Image / data.** "Image" — the server renders with noise; the client does not know the value. "Data" — permutations, layouts, animation parameters, without the correct answer.
- **Phase:** devnet launch (the first launch; seasons are not planned yet) / later. The estimate is person-days **on top of** the P3 frame and the P4 phone UI (§18.1).

##### 13.9.0 Mandatory rules for crypto minigames (`buy-shitcoin`, `address-check`, `sign-or-reject`, `seed-words`, `fuel-rugpull`, `gas-priority`)
1. **Only explicitly fictional coins, tickers, addresses, and networks.** The ticker pool is game names (`$DIESEL`, `$GRAVEL`, `$AXLE`, `$FUELCOIN`, the stablecoin `$FRD` "FreightDollar" instead of real stablecoins). Every ticker is checked, before release and once a month, against the CoinGecko / CoinMarketCap lists and the token lists of Solana DEX aggregators. If a ticker exists in reality, remove it (in the owner's examples `$DIESEL` and `USDC` must be checked, and `USDC` replaced by `$FRD`). Addresses are generated in a game format with a visible prefix `FC…` and **are not valid Solana addresses** (wrong length or checksum); they cannot be used in reality.
2. **Never real tickers, and never `$TEN4` as something one "buys".** `$TEN4` does not appear in minigames at all: until TGE it is points only, with no advertising of the token and no wording about "investment" or "return".
3. **The fake DEX and the wallet do not copy real brands one for one** (Phantom, Solflare, Backpack, Jupiter, Raydium, Pump.fun, MetaMask, and others): names of their own ("CabSwap", "Rig Wallet"), colors, icons, and layout of their own, no logos and no recognizable identity.
4. **An in-game disclaimer** on every crypto screen: "SIMULATION. Game coins, not real money or addresses". On the first show of a ride, a short banner. In the rules of the devnet launch (and of later launches), a paragraph about the minigames.
5. **Safety as education.** The games teach the player to recognize fraud: ticker lookalikes, an address swap in the clipboard, a drainer with an unlimited approve, a phishing request for the seed phrase, "buy it now" from a "friend". The correct answer is **always the safe behavior**: in some events the right action is to "refuse". After the answer, one line of the lesson is shown ("A match of the first and last 4 characters is no guarantee — check the whole address", and the like). No game rewards an unsafe habit.
6. No real connections: minigames do not touch the player's real wallet, do not call the wallet adapter, and make no network requests except the minigame API.
7. Legally (Serbia, an individual organizer): this is game mechanics with no real value. Note in TERMS that game coins are not a financial product (this is part of decision 31 and phase F7).

##### 13.9.1 `buy-shitcoin` — "a friend recommends a coin" (crypto, phone) — ⏳ pending owner review
- **Scenario:** while stopped, a message arrives from a "friend": "grab $DIESEL now, 150 FRD". Open the fake DEX "CabSwap", find the **exact** ticker among the lookalikes (`$DlESEL` with a Latin l, `$DIESEL2`, `$DIESEI`, `$D1ESEL`), check the contract address from the message (the first and last 4 characters), and buy exactly the stated amount. The **"education" variant** (≈ 30%): the coin shows signs of a trap (a fresh pool, "selling disabled" in the description) — the correct answer is "do not buy".
- **Safe state:** stopped (decision 22).
- **Duration:** 10–15 s (searching the list and entering the amount).
- **Random:** the target ticker and 3–5 lookalikes (homoglyphs, suffixes), the list order, the amount (50–500), the price and the chart, the position of the amount field and of the "Buy" button, whether a trap is present.
- **Image:** the message text, the list rows (ticker, address, price). **Data:** the row order, the screen layout.
- **Server check:** the chosen row = the target (by row id, not by the text), the amount exact, "do not buy" when there is a trap; timing of §13.5 (reading ≥ 400 + 150·N ms); features F2 (time to the first touch), F6 (scrolling and picking in the list, Fitts), F7 (entering the amount), F10.
- **Resistance:** S high (the list and the layout are personal), O medium (the homoglyphs `l/I/1` confuse OCR), L low–medium (an LLM reads well, but the "trap" variant requires understanding, and the timing gives a signal).
- **Accessibility:** homoglyphs are a problem for low vision and for dyslexia. In the accessibility mode: a large monospace font with distinguishable `l/I/1/0/O`, fewer lookalikes (2), no color hints.
- **Penalty:** the wrong coin or the wrong amount — +20 s; a skip — +45 s; "bought the trap" — +20 s and a lesson.
- **Estimate:** 3–4 (the DEX UI and the list) + a shared crypto UI kit of 2–3 (once for every crypto game, see §13.9.13).
- **Phase:** later (the second queue).
- **Tests:** AC-M1, M2, M3, M4, M7, **M11** (naive homoglyph normalization), **M12** (a bot with one policy, "always buy").

##### 13.9.2 `address-check` — an address swap in the clipboard (crypto, phone) — ⏳ pending owner review
- **Scenario:** the dispatcher sends an address to pay for the cargo. On paste into Rig Wallet a "virus" has swapped the address: the pasted one differs. Compare the first and last 4 characters with the message, pick the correct one of 3 variants (or "cancel", if the correct one is not there), and confirm.
- **Safe state:** stopped.
- **Duration:** 6–10 s.
- **Random:** the addresses (game format `FC…`), which characters differ (in the middle, or at the edges: in the "education" variant the swap matches on 4+4 characters but differs in the middle; the correct answer is to check the whole address or to cancel), the positions of the variants, the button order.
- **Image:** every address. **Data:** the order of the variants.
- **Check:** the chosen variant, or "cancel", against the expected one; timing (comparing 8+ characters ≥ 1.2 s); F2, F6, F10; F4 — a bot spends the same time on every variant.
- **Resistance:** S high, O low–medium (comparing strings is trivial after OCR), L low. The value of the game is the timing signal and the lesson, not the resistance.
- **Accessibility:** characters in groups of 4 with spaces, a monospace font, zoom on click.
- **Penalty:** +20 s / +45 s.
- **Estimate:** 2.
- **Phase:** later (the second queue).
- **Tests:** AC-M1, M3, M4, M7, M12.

##### 13.9.3 `sign-or-reject` — sign or reject (crypto, phone) — ⏳ pending owner review
- **Scenario:** Rig Wallet shows a signature request. Read what the transaction does: an ordinary one ("Pay for parking 12 FRD → FC…PARK") — sign; a drainer ("Approve unlimited FRD to FC7xK…", "SetAuthority", "close all token accounts") — reject.
- **Safe state:** stopped.
- **Duration:** 5–10 s.
- **Random:** the wordings (≥ 20 normal templates and ≥ 20 harmful ones; harmful ones sometimes look harmless, for example "Claim 500 FRD airdrop"), the order of the "Sign/Reject" buttons (it changes), the amount, the recipient, whether the wallet shows a warning.
- **Image:** the request text. **Data:** the button order.
- **Check:** the decision against the expected one; reading time ∝ the length of the text (a bot answers equally fast on a short text and a long one → F2); F6 (picking the button when the order is permuted); F10.
- **Resistance:** S high (the buttons are permuted, 50/50 → a bot with one policy is wrong half the time), O medium (it needs rules over the text), L low.
- **Accessibility:** the keywords ("unlimited", "authority") are highlighted in the accessibility mode too, a large font; color is not the only signal.
- **Penalty:** signed a drainer — +20 s and a banner "wallet drained (simulation)", with no game effect on the cargo; rejected a normal one — +20 s; a skip — +45 s.
- **Estimate:** 2–3 (the template texts are the main work).
- **Phase:** later (the second queue).
- **Tests:** AC-M1, M3, M4, M7, M12.

##### 13.9.4 `seed-words` — unlock by words from a phrase (crypto, phone) — ⏳ pending owner review
- **Scenario:** at the start of the ride (at the depot) the phone shows a "phone recovery phrase" of 12 words. On the event (while stopped) the phone is locked; enter words #3, #7, and #11 (the numbers are random). It checks memory, or finding the value somewhere else (the phrase is written on a "slip" in the cab).
- **Risk to the lesson:** "enter a seed phrase on a screen" is exactly the habit to unlearn. Therefore: (a) the words are not from BIP39 but game words ("driveshaft", "semi", "tractor"…), and this is called a "phone PIN phrase", not a "seed"; (b) in the "education" variant (≈ 40%) the request comes from a "site" or from "support" ("confirm the wallet, enter the words") — the correct answer is to **refuse**; (c) a lesson after the answer: "a real seed phrase is never entered on request". I recommend accepting it only in this form.
- **Where it sits:** the unlock screen before `phone-sms` or the crypto games; a separate id.
- **Safe state:** stopped.
- **Duration:** 8–15 s.
- **Random:** the phrase for the ride (from `mgSalt`), the word numbers, where the slip sits in the cab, the keyboard layout or the hint layout (entry with autocomplete from 4 options), the share of phishing.
- **Image:** the phrase, the slip, the request. **Data:** the layout.
- **Check:** the words and the decision to "refuse"; the time from showing the request to the entry (a person looks for the slip or remembers; an instant entry → `mg-too-fast`); F7 (the dynamics of typing the words), F2, F10.
- **Resistance:** S high, O medium (the phrase has to be remembered from the start of the ride, or the slip found in the 3D cab), L medium (it needs memory between events; a stateless agent will not manage).
- **Accessibility:** autocomplete from 4 options instead of free entry (the default in the accessibility mode); the slip is always reachable by a button.
- **Penalty:** +20 s / +45 s; entered the words on a phishing request — +20 s and a lesson.
- **Estimate:** 2.
- **Phase:** later (the second queue).
- **Tests:** AC-M2, M3, M7, M12, **M18** (an agent with no memory between events).

##### 13.9.5 `fuel-rugpull` — paying in a falling coin (crypto + fuel station) — ⏳ pending owner review
- **Scenario (the payment step of `fuel-station`):** the fuel-station terminal accepts "FuelCoin"; the rate falls in real time. The limit from the dispatcher's SMS: "pay only if 1 FUEL ≥ 0.80 FRD". Pay while the rate is inside the limit, or cancel once it has left it.
- **Safe state:** stopped at the pump.
- **Duration:** 5–12 s.
- **Random:** the limit, the starting rate, the shape of the curve (a smooth fall, steps, a bounce), the moment it crosses the limit (2–8 s), the positions of the "Pay/Cancel" buttons.
- **Image:** the limit (in the SMS), the current rate (the ticker is drawn as image frames). **Data:** the animation parameters of the curve (without the limit, a bot that reads the data does not know where the boundary is).
- **Check:** from the click's step the server computes the rate at that moment (the curve comes from `mgSalt`) → right or wrong. **Reaction signal:** the RT from the crossing of the limit until "Cancel", and the distribution of the moment of payment — F2 (ex-Gaussian; a bot has a fixed delay, or reacts exactly on the threshold), F5 (locked to frames), F6.
- **Resistance:** S high, O medium (OCR of the ticker every frame plus a comparison is realistic, but the reaction becomes mechanical → F2), L low–medium (an agent has a delay of 2–6 s — it does not make the short windows).
- **Accessibility:** in ×2 mode the curve falls more slowly, the limit is marked by a line on the chart (shape + text), and there is a sound when it is crossed.
- **Penalty:** paid past the limit, or cancelled while still inside it — +20 s; a skip — +45 s.
- **Estimate:** 2–3 (requires `fuel-station`).
- **Phase:** later, together with the fuel station (the second queue).
- **Tests:** AC-M3, M4, M7, **M15** (a fixed reaction delay).

##### 13.9.6 `gas-priority` — fee priority in front of the barrier (crypto + toll stretch) — ⏳ pending owner review
- **Scenario (the payment step of `toll-gate`, a "pay on the way in" variant on the approach):** the network is congested. On the phone, a table of "priority → confirmation time" at the current load. Pick the **cheapest** fee at which the transaction confirms before the barrier: confirmation time ≤ distance to the barrier / speed. An error on the low side is a stop at a closed barrier (and a penalty); on the high side, an overpayment.
- **Safe state:** an exception to decision 22 — the game runs **on the approach**, not while stopped. Therefore only on a straight stretch with no traffic ahead, at a speed ≤ 60 km/h, inside the "Toll road 1 km" zone, and with a single choice button (3–4 options). If the owner is against the exception — a variant "while stopped, in front of the zone, the distance given as a number".
- **Duration:** 5–10 s.
- **Random:** the network load, the table (the values and the row order), the priority prices, the moment it is shown (at what distance from the barrier).
- **Image:** the load table, the prices. **Data:** the button order. The player sees the distance and the speed for themselves (the speedometer, the sign) — the correct answer depends on the **server** state of the truck at the moment of the click.
- **Check:** from the resim the server knows s and v on the click's step → it computes the lowest priority that is enough → it compares. F2, F6. Plus the driving: did the player slow down in order to make it (F3).
- **Resistance:** S high, O medium (the formula and the speedometer are required), L medium (the table, the speed, and the distance have to be combined while moving, and the agent's delay changes the correct answer).
- **Accessibility:** in the accessibility mode the distance to the barrier is shown as a number and the table is larger; the safe variant is "while stopped".
- **Penalty:** did not make it — a stop at the barrier + 20 s (contact with the barrier is physics, `toll-barrier-breach`); an overpayment — +20 s; a skip — +45 s.
- **Estimate:** 2–3 (requires `toll-gate`).
- **Phase:** later, together with the toll stretch (the second queue); if the exception to 22 is refused — the "while stopped" variant.
- **Tests:** AC-M3, M7, **M16** (a solver of the formula from the data, with no image), M9 (an answer in an unsafe state: above 60 km/h the answer is void).

##### 13.9.7 `waybill` → **merged with `cargo-seal`** (road, scales) — ⏳ pending owner review
- **Overlap:** `cargo-seal` (§13.2) is picking the seal number that matches the waybill. `waybill` adds a **visual search**: at the weigh station, the number on the bill of lading has to be found on the **3D model of the trailer** (a seal on one of the doors or leaves; it may be partly hidden; the camera goes around the trailer by mouse or by keys) and the match confirmed, or "does not match".
- **Result of the merge:** one id, `cargo-seal`, with two variants: `list` (a choice of 3, as before) and `trailer-3d` (a search on the model). `mgSalt` picks the variant.
- **Safe state:** stopped on the scale platform (together with `weigh-station`), or at a stop.
- **Duration:** 8–15 s.
- **Random:** the seal number and the bill-of-lading number, whether they match (≈ 25% "does not match" — the correct answer is "report it"), where the seal sits on the model, the camera angle at the start, similar numbers nearby (container markings).
- **Image:** the bill of lading; the number on the model is an image texture. **Data:** the geometry of the model (the number is not in the data).
- **Check:** the answer; the **camera trace** — how far and which way the player turned, and whether they found the seal (by the direction of view at the moment of the answer: the seal must be in frame); F6 (camera rotation as a pointer trajectory), F2.
- **Resistance:** S high, O medium (the camera has to be driven to find the number), L medium (a search in 3D needs a "turn → look" loop — slow, and with a characteristic step).
- **Accessibility:** a "show the next side" button instead of free rotation; the doors are highlighted in the accessibility mode.
- **Penalty:** +20 s / +45 s.
- **Estimate:** +2–3 on top of `cargo-seal`.
- **Phase:** later (the second queue): `list` first, then `trailer-3d`.
- **Tests:** AC-M1, M3, M7, **M19** (a bot that does not drive the camera: it answers without having turned the camera).

##### 13.9.8 `radio-exit` → **merged with `dispatch-radio`** (road) — ⏳ pending owner review
- **Overlap:** `dispatch-radio` (§13.2) already contains "at the nearest exit — exit N" and rests on the road challenge `fork-instruction` (§9.5). **By decision 14 that challenge is removed as its own class, and `dispatch-radio/exit` is now its only carrier.** `radio-exit` pins the mechanic down: the dispatcher names the exit number by voice **and** by text, and the player moves into the required lane and takes the required exit (the fork).
- **Result of the merge:** one id, `dispatch-radio`, with variants `exit` (the exit and the lane — the former `radio-exit`) and `ramp` (the ramp number at the station).
- **Safe state:** moving, but this is **driving**, not a menu: not closer than 300 m to hazards, the message 20–40 s before the fork (§9.5), no input on the phone.
- **Duration:** a reaction of 5–15 s (the lane change); 20–40 s in all until the fork.
- **Random:** the exit number (out of 2–3 on the stretch), the moment of the message, the voice and the wording, distractor numbers on the air ("…do not confuse with exit 12").
- **Image:** the subtitles. **Data:** the audio — clips generated ahead of time, the files carrying neutral names; the number is assembled from digit clips. Honestly: the number can still be extracted from the audio by ASR, but that costs more than OCR.
- **Check:** the **resim** — which road of the fork the truck took (the server computes it itself, `fork` in the core), when the lane change began (RT from the end of the phrase), F2, F3 (micro-corrections during the lane change), F8.
- **Resistance:** S high, O medium (the subtitles are read by OCR; in a "voice only" mode — high), L medium (ASR and real-time driving are required).
- **Accessibility:** subtitles are mandatory (the decision in §13.7), a repeat of the prompt by button; for deaf and hard-of-hearing players, text only (resistance against O is then lower, and that is accounted for in a separate baseline).
- **Penalty:** the wrong exit — +20 s (the route is recomputed, the ride continues); a skip — +45 s.
- **Estimate:** 3–4 (the audio clips, the fork check in the resim) — partly in phase F4 of §9.12.
- **Phase:** later (the second queue).
- **Tests:** **AC-M13** (a bot with no audio and no subtitles), M7, **M17** (a perfectly exact lane change).

##### 13.9.9 `tachograph` — driving time is running out (road, map) — ⏳ pending owner review
- **Scenario:** the tachograph on the dash warns: "the driving limit runs out in 6 min" (a game convention for the 1h, not the real EU rules). Open the map on the phone (`ui/map.js`), find the **nearest suitable** truck parking (3–5 icons on the map; some are "cars only" or "closed"), drive there, stop, set the parking brake, and "rest" for 15 s (a short tachograph screen that switches mode).
- **Safe state:** choosing on the map is only while stopped, or in the "map over the driving" mode: the game already allows the map to be opened on the move, as it does now. The rest itself is a stop.
- **Duration:** an interaction of 5–15 s (the choice on the map) + 15 s of rest; the drive to the parking is ordinary driving of 1–3 min. This is an **exception on total time**: the rest is counted in the ride metric the same way for everyone, so the difficulty stays equal.
- **Random:** where the parkings are placed (world objects from `mgSalt`, like the pockets of §13.3), which of them qualify (a truck icon, the opening hours, "no spaces"), the moment of the warning, the layout of the tachograph screen.
- **Image:** the parking captions on the map, the tachograph screen. **Data:** the positions of the parkings (needed to render and to navigate).
- **Check:** the **resim** — the truck really did enter a suitable parking and stood ≥ 15 s with the brake on; the map — F6 (panning and the choice), the time to the decision; the drive to the parking — F2/F3.
- **Resistance:** S medium–high (the parkings are personal), O medium (the icons on the map), L medium (navigation and driving are required), but the driving features give a strong signal.
- **Accessibility:** the icons are shape + text, map zoom, and in the accessibility mode a text list of the parkings.
- **Penalty:** the wrong parking, or no rest before the time ran out — +45 s (as a skip); the ride does not fail.
- **Estimate:** 4–6 (the parking objects, integration with the map, a tachograph on the dash).
- **Phase:** later (at the end of the second queue).
- **Tests:** M7, M10, M9 (a rest with no brake, or on the move), **M20** (a bot that always drives to the nearest icon without reading the captions).

##### 13.9.10 `reverse-park` — reversing into a pocket (road, control) — ⏳ pending owner review
- **Scenario:** at a warehouse, at a station, or at a stop, the trailer has to be reversed into a pocket (a short maneuver, 1 corner, 10–20 m). This is a control task, not a reading task: a person shows micro-corrections of the wheel and corrections after mistakes.
- **Safe state:** a low speed (≤ 10 km/h), a pad with no traffic, the pocket's markings. This is the driving itself.
- **Duration:** 10–25 s (longer than the 5–15 s norm — an exception: the maneuver cannot be shortened without losing the point; in the accessibility mode the pocket is wider).
- **Random:** the side and the angle of the pocket, the width (within the difficulty), the obstacles (cones), the truck's starting position.
- **Image:** none (this is the world). **Data:** the geometry of the pocket (a world object).
- **Check:** a **resim of the trailer's reversing kinematics** in the deterministic core (`tyaw` is already in the v1 frames — `traffic-proof.ts`; in v2 the trailer kinematics must be in `client/shared`, phase F1 §9.12). The outcome (inside the pocket, angle ≤ X, no contact with the cones) is computed by the server. Features: F3 (the frequency and the amplitude of the steering corrections, a "sawtooth" while reversing, in people), F1, F5; a bot with a PID controller gives corrections that are too smooth, or periodic.
- **Resistance:** S high (a script with no feedback will miss under a random geometry), O high (vision helps little here), L high (an agent with screenshots every 2–6 s will not manage). The strongest game in the catalog, and also the most expensive.
- **Accessibility:** a rear-view camera with guides, a wider pocket and ×2 time in the accessibility mode; the controls are the standard ones (keys).
- **Penalty:** did not fit — +20 s (one retry is allowed inside the window); did not attempt it — +45 s; touching a cone is physics (damage, as in the core).
- **Estimate:** 6–9 (reversing trailer kinematics in the shared core, and its determinism; the pocket object; scoring the result; a retune of `level-check`).
- **Phase:** later, after trailer determinism in phase F1; it depends on trailer determinism.
- **Tests:** **AC-M14** (a script with no feedback, and a PID bot), M6, M10.

##### 13.9.11 `police-check` — a document check at a post (road) — ⏳ pending owner review
- **Scenario:** a police or customs post; an inspector stops the truck. From a stack of 6–8 documents, pick the 3 that the inspector's description asks for ("the cargo document, the transport permit, the driver's document") — the titles on the documents do not match the wording literally (CMR ↔ "cargo bill of lading", waybill ↔ "route document").
- **Overlap:** close to `cargo-seal` (documents) and to `weigh-station` (a post), but the mechanic is different (picking several by meaning), so it is a separate id.
- **Safe state:** stopped at the post (a world object, a barrier or cones — as with `toll-gate`).
- **Duration:** 8–15 s.
- **Random:** which documents are in the stack and in what order, the inspector's wordings (synonyms), 1–2 "expired" documents (the correct action is not to hand them over), the layout of the stack.
- **Image:** the documents, the inspector's speech (subtitles). **Data:** the layout.
- **Check:** the chosen set = the expected set (with none of the expired ones); time ∝ the number of documents looked through; F6 (going through the stack, Fitts), F2.
- **Resistance:** S high, O medium (synonyms are required), L low (an LLM matches meaning very well) — the only signal is the timing and the trace.
- **Accessibility:** large document titles, a "list" mode instead of the stack, synonyms with a hint behind a button in the accessibility mode.
- **Penalty:** an incomplete or wrong set — +20 s; a skip — +45 s.
- **Estimate:** 3–4 (the post as a world object + the stack UI).
- **Phase:** later (at the end of the second queue).
- **Tests:** M1, M3, M7, M12.

##### 13.9.12 Summary table (15 ids after the merges)
| # | id | Type | Phase | Resistance S / O / L | Estimate, person-days | Status |
|---|---|---|---|---|---|---|
| 1 | `phone-sms` (+ `seed-words` as the unlock, see 10) | phone | devnet launch (first queue) | high / med / low–med | 3–4 (P4) | ✅ accepted (decision 21) |
| 2 | `fuel-station` (+ the `fuel-rugpull` step, see 11) | road, station | later | high / med / med | ≈ 4–6 (part of B1+B2) | ✅ accepted (21) |
| 3 | `weigh-station` | road, station | later | high / med / med | ≈ 4–5 (part of B1+B2) | ✅ accepted (21); the cut under 32(b) is lifted by decision 11 |
| 4 | `toll-gate` (+ the `gas-priority` step, see 12) | road, station | later | high / med / med | ≈ 4–6 (part of B1+B2) | ✅ accepted (21) |
| 5 | `cargo-seal` (**+ `waybill`** as the `trailer-3d` variant) | road, documents | later (`list` → `trailer-3d`) | high / med / med | 1–2 + **2–3** | ✅ `list` accepted (21); ⏳ `trailer-3d` |
| 6 | `dispatch-radio` (**+ `radio-exit`** as the `exit` variant; `fork-instruction` is moved here as well, by decision 14) | road, radio | later | high / med / med | 1–2 (phase F4) + **3–4** | ✅ base (21, 14); ⏳ the `exit` variant |
| 7 | `buy-shitcoin` | crypto, phone | later | high / med / low–med | 3–4 | ⏳ pending owner review |
| 8 | `address-check` | crypto, phone | later | high / low–med / low | 2 | ⏳ pending owner review |
| 9 | `sign-or-reject` | crypto, phone | later | high / med / low | 2–3 | ⏳ pending owner review |
| 10 | `seed-words` | crypto, phone (unlock) | later | high / med / med | 2 | ⏳ pending owner review (only in the "PIN phrase + phishing" form) |
| 11 | `fuel-rugpull` | crypto + fuel station | later (with the fuel station) | high / med / low–med | 2–3 | ⏳ pending owner review |
| 12 | `gas-priority` | crypto + toll stretch | later (an exception to 22) | high / med / med | 2–3 | ⏳ pending owner review |
| 13 | `tachograph` | road, map | later | med–high / med / med | 4–6 | ⏳ pending owner review |
| 14 | `reverse-park` | road, control | later (after phase F1) | **high / high / high** | 6–9 | ⏳ pending owner review |
| 15 | `police-check` | road, documents | later | high / med / low | 3–4 | ⏳ pending owner review |

- Rows 1–6 are the base of §13.2 (already inside the §18 estimate). The **bold** extra estimates in rows 5 and 6, and rows 7–15, are new.
- The shared **crypto UI kit** (Rig Wallet, CabSwap, the disclaimer, the pool of fictional tickers and the check of them against the lists, the lessons after an answer): **2–3**, once, for rows 7–12.
- **If all 11 candidates are approved — +33–46 person-days** (2–3 for the kit + 3–4 + 2 + 2–3 + 2 + 2–3 + 2–3 + 2–3 for `waybill` + 3–4 for `radio-exit` + 4–6 + 6–9 + 3–4).
- Recommended order inside the full scope (decision 11): `sign-or-reject`, `address-check`, and `buy-shitcoin` (cheap, a strong timing signal, and a lesson) → `fuel-rugpull` with the fuel station → `dispatch-radio/exit` → the rest later; `reverse-park` is the most resistant, but only after trailer determinism.

##### 13.9.13 Safe state and exceptions (summary)
Every phone game and every crypto game, except `gas-priority`, is only while stopped (decision 22). Exceptions that need the owner's agreement when each game is reviewed:
- `gas-priority` — on the approach, ≤ 60 km/h, one button;
- `dispatch-radio/exit` and `reverse-park` — are the driving itself;
- `tachograph` and `reverse-park` — a duration longer than 15 s.


---


---

## Appendix B. Bots for minigames (former §17.1)
> Moved unchanged from `anticheat_test_plan.md §17.1` (superseded, merged into docs/spec) (17.10.2026); heading levels shifted by one. Part 1 of this file is normative; if they diverge, the spec wins.

#### 17.1 Bots for minigames
| ID | Bot | How it is built | Expected (enforce) |
|---|---|---|---|
| AC-M1 | `mg-fixed-coords` | clicks the fixed coordinates of the "normal" layout | `mg-wrong` on every event (the layouts are personal) → penalties + `flag mg-mechanical` |
| AC-M2 | `mg-dom-reader` | reads the answer out of JS/DOM | the answer is not on the client, the values are images → it does not solve it, `mg-missed` + flag |
| AC-M3 | `mg-ocr-instant` | OCR of the canvas, the input instant, the cursor by teleport | correct, but `mg-too-fast` + an F6 teleport ≥ 3 → **rejected** (§16.4 e) |
| AC-M4 | `mg-ocr-random-delay` | OCR + uniform delays of 200–800 ms, a linear cursor with noise | `review` (F1 — a uniform distribution, F6 — no Fitts and no overshoot) |
| AC-M5 | `mg-replayed-trace` | a recorded human trace, carried onto a new layout (scale and shift) | `review` (`mg-trace-replay`: similarity to traces in the baseline; the targets do not match) |
| AC-M6 | `mg-ml-mimic` | minimum jerk + Fitts + log-normal dwell + typos | `verified` or `review` — **the honest limit**, the metric of detector strength |
| AC-M7 | `mg-llm-agent` | screenshot → model → action, 2–6 s per step | `review` (F1 a low variation of the delays, F6 no micro-movements); TPR into the report |
| AC-M8 | `mg-synthetic-events` | `dispatchEvent` from the page | `untrusted-input` → `review` |
| AC-M9 | `mg-answer-moving` | answers at the fuel station without having stopped | `mg-unsafe-state` → the answer is void, the skip penalty |
| AC-M10 | `mg-skip-all` | ignores every event | 2–4 × +45 s, `flag mg-missed`, the ride is **not** failed |
| AC-M11 | `mg-homoglyph-naive` | OCR + Unicode normalization, or "similar characters are equal" (`buy-shitcoin`) | picks the lookalike (`$DlESEL`) → `mg-wrong`; if the pick is right — timing F2/F7 → `review` |
| AC-M12 | `mg-single-policy` | always "sign", "buy", "enter", or always "reject" (`sign-or-reject`, `address-check`, `seed-words`, `buy-shitcoin`, `police-check`) | ≈ 50% `mg-wrong` + `flag mg-mechanical` (the decision does not depend on the content) |
| AC-M13 | `mg-audio-blind` | ignores the audio and the subtitles (`dispatch-radio/exit`) | the wrong exit → `mg-wrong`; in "voice only" mode — always |
| AC-M14 | `mg-reverse-bot` | (a) a reversing script with no feedback; (b) a PID controller on the pose (`reverse-park`) | (a) not in the pocket → a penalty; (b) in the pocket, but F3/F5 (smooth or periodic corrections) → `review` |
| AC-M15 | `mg-fixed-reaction` | reacts a fixed N ms after the limit is crossed (`fuel-rugpull`) | F2 — zero variation of RT across events → `review`; at N < 100 ms on ≥ 10 stimuli → rejected (§16.4 a) |
| AC-M16 | `mg-formula-solver` | computes the answer from the protocol data, with no image (`gas-priority`) | the table is an image only → it gets it wrong; with OCR — the timing → `review` |
| AC-M17 | `mg-lane-snap` | a perfectly exact lane change, with no corrections (`dispatch-radio/exit`) | F3 → `review` |
| AC-M18 | `mg-stateless-agent` | an agent with no memory between events (`seed-words`) | does not remember the phrase, does not find the slip → `mg-wrong`/`mg-missed` |
| AC-M19 | `mg-no-camera` | answers without turning the camera toward the seal (`cargo-seal/trailer-3d`) | the seal was not in frame at the moment of the answer → the answer is void + `flag mg-mechanical` |
| AC-M20 | `mg-nearest-icon` | always drives to the nearest parking icon (`tachograph`) | an unsuitable parking → the skip penalty |

