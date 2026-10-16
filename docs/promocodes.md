# Promo codes

A promo code is **one effect, one window, one counter**. A player types it (lobby → PROMO, or the invite block on the landing), the server applies the effect in a single transaction under the player's row lock, and every use is logged. Admins make and stop codes on the admin page; every change is signed by their wallet and audited.

Status: built on branch `promocodes`, server + lobby + admin + landing + cockpit. Not deployed – nothing reaches production until the owner asks for it (docs/agents/deploy.md "Deploying to production"). Migration `20261011000000_promo_effects` is forward-only and rewrites no data.

## What a code can do

Truck-part promo codes are not a feature. A code gives tickets or extra free rides. Creating or redeeming `kind: cosmetic` is refused (409 `visuals_are_honk`). An unlock a cosmetic code already wrote stays wearable. The cosmetic columns stay so an old row still loads.

| kind | effect of ONE redemption | notes |
|---|---|---|
| `free_rides` | `+count` free rides (1–20; the admin form has **1** and **3** presets) | added **on top of** the daily ones and **may exceed the daily cap** (default 5, `free_rides_daily_max` in `player.GameSetting`). The cap only limits the daily refill (`Player.applyDailyGrant`, the midnight SQL): it adds below the cap and never takes anything away, and the lobby countdown shows "full" at or above it. A refund of an unstarted free ride adds one unless the wallet is exactly at the cap. Rule chosen with the owner's brief in mind ("+3 rides" must be worth 3). |
| `tickets` | `credits` free paid-ride tickets of a tier (`1h` / `4h` / `8h`), into the live pool of that tier or a pinned pool | the old promo. An off-chain grant (a sponsored entry): it does **not** count towards the pool's on-chain minimum. Clamped at the pool's per-wallet cap; a wallet already at the cap is refused (409 `ticket_cap`) **before** a redemption is used. Free tickets "per type of ride" = one code per tier. |
| `cosmetic` | **refused.** Creating or redeeming one returns 409 `visuals_are_honk`. Cab colours are minted by burning TEN4 (`docs/honk/SPEC.md`). A row already stored still loads; an unlock it already granted stays wearable. | not a way to get a new part |

Common fields: `code` (3–32 of `A–Z 0–9 - _`, stored upper-case, typed case- and space-insensitively), `description` (player-facing, ≤ 200), `maxRedemptions` (empty = unlimited), `perWallet` (default 1), `startsAt` (default now) → `expiresAt` (empty = no end), `note` (private, ≤ 500).

A code is **immutable** once created apart from being disabled (so the redemption log always reads against what was actually granted). Disabling keeps everything already granted.

State of a code at an instant (`PromoCode.stateAt`): `disabled` › `ended` › `scheduled` (not started) › `exhausted` (every redemption taken) › `active`.

## The cosmetics catalog

A cosmetic is a **colour** for one part of the cab you look at. Visuals only – no item changes handling, shifting or any rule – and **for now only colours differ**: the shapes are fixed in `cockpit/rig.js`. Five slots. A new part is minted by burning TEN4 (`docs/honk/SPEC.md`), not by a promo code. The Garage (docs/garage.md) shows the catalog, the collection progress and the save. The slot model stays so more slots can be added later without touching the plumbing.

Server: `server/src/domain/economy/cosmetics.ts`. Client mirror: `client/js/cosmetics.js` (a leaf module – the landing's dash cards run the cockpit without three.js) with the palettes in `LOOKS`. `server/test/unit/domain/economy/cosmetics.spec.ts` reads the client file and fails on drift (the lists AND a palette per item); `landing/test/promos.test.js` checks every palette has its slot's keys and no two items of a slot look alike.

| slot | what it colours (`cockpit/rig.js` reads `look(slot)` every frame) | items (first = default: everybody has it, no code gives it) |
|---|---|---|
| `wheel` | the steering wheel: rim, sheen ring, spokes, hub, the FC mark | `classic` `crimson` `ocean` `moss` `gold` `ivory` |
| `truck_color` | the hood and fenders you look over, the centre highlight, and the trim: the windscreen frame and the dashboard's top edge | `red` `blue` `green` `black` `yellow` `white` |
| `gearbox` | the floor shifter: knob, its outline, the boot, the lever, the gear letter | `stick` `chrome` `wood` `racing` `gold` `carbon` |
| `dice` | the dice hanging from the mirror: body and pips | `white` `red` `blue` `gold` `pink` `black` |
| `needle` | the needles of the two big gauges | `orange` `red` `lime` `cyan` `white` `gold` |

What stays the same in every look: the cab interior, the dashboard body, the instrument housing, the gauge faces (decision: only the five slots recolour; a whole-cab skin can be another slot later – e.g. the NFT).

**Add an item**: append its id to `COSMETIC_ITEMS` (server) and `COSMETICS` (client), give it a palette with the same keys in `LOOKS[slot]`. Then `npm run check` (the headless test pins the default colours and draws every item; the drift tests compare the lists and the palettes) and look at `cosmetic-<slot>-<item>.png` from `node tools/e2e-chrome.mjs`. **The default items must keep drawing exactly what the cockpit always drew** (the committed promo clips and the landing's dash cards depend on it).

**Where it is read** – the ride keeps what it was driven with:
- `StartRideHandler` stamps the wallet's worn (and owned) items on the ride (`ride.Ride.loadout`, JSON, one entry per slot, migration `20261012000000_ride_loadout`; null = every ride from before cosmetics = all classic) and answers it in the ride DTO; `online.js` wears the start answer (the menu already wore `GET /api/wardrobe`).
- `GET /api/watch/:id` (public) carries `ride.loadout`; `watch.js` wears it on the first poll – **live spectators and replays draw the driver's real cockpit**, whatever the driver wears today. Changing the wardrobe later never rewrites a started ride.
- Offline play, the model viewer and the video tool wear the defaults.

## API

Player (signed in):
- `POST /api/promo/redeem {code}` → a union on `kind`: `{kind:'tickets', code, label, poolId, tier, added, balance, cap}` · `{kind:'free_rides', code, label, added, freeRides}`. A cosmetic code is 409 `visuals_are_honk` and takes no redemption. 404 unknown · 409 `promo_unavailable` (disabled / ended / **not active yet** / used up / already redeemed by you) · `no_open_pool` · `ticket_cap`.
- `GET /api/promo/mine` → `{redemptions: [{code, label, description, kind, at}]}` (newest first, ≤ 100).
- `GET /api/wardrobe` → `{equipped: {slot: part}, unlocked: {slot: [default, …]}}` (every slot always set). **The Garage API** (`GET /api/garage`, `POST /api/garage/loadout` – catalog + progress, save a whole selection all-or-nothing) is in docs/garage.md.
- `POST /api/wardrobe/equip {slot, item}` → the wardrobe · 400 `bad_cosmetic` · 409 `not_owned`.

Admin (`/api/admin/promos…`, same guard as the rest: admin host, `fc_admin` session, `X-FC-Admin` on changes):
- `GET /api/admin/promos[?state=active|scheduled|ended|exhausted|disabled]` · `GET /api/admin/promos/redemptions[?code=&wallet=&limit=]`.
- `POST /api/admin/promos/challenge {action:'promo_create', promo} | {action:'promo_disable', code}` → the text to sign. `POST /api/admin/promos {promo, signature}` creates, `POST /api/admin/promos/:code/disable {signature}` stops. The signed text names the action, what it gives and **every field of the code as one JSON line** (`promoJson` in `domain/admin/admin-proof.ts`); free text only ever appears JSON-quoted. The audit row (`promo.create` / `promo.disable`, target = the code) keeps text + signature, written in the same transaction as the change.
- CLI (dev / ops, no signature): `promo:create CODE <effect> [--desc] [--start] [--expires] [--max] [--per-wallet] [--note]` with `--tier 1h --credits 2 [--pool N]` · `--free-rides 3`. `--cosmetic` is not a create flag: it is refused (cab parts are minted by burning TEN4). `promo:list`, `promo:disable CODE`.

## Where it lives

| layer | files |
|---|---|
| domain | `economy/promo-code.entity.ts` (rules, `stateAt`, `whyNotRedeemable`), `promo.types.ts` (`PromoEffect`), `promo.dto.ts` (`describeEffect`, DTOs), `cosmetics.ts`, `wardrobe.dto.ts`, `admin/admin-proof.ts` (intents), `players/player.entity.ts` (`grantFreeRides`) |
| application | `use-cases/players/{redeem-promo,get-my-promos,get-wardrobe,equip-cosmetic,get-garage,save-garage}`, `use-cases/admin/{create-admin-promo,disable-admin-promo,list-promo-redemptions}`, `use-cases/promos/*` (CLI), `services/promo-creation.service.ts`, ports `promo.repository.port.ts`, `cosmetic.repository.port.ts` |
| infrastructure | Prisma repos + `promo.mapper.ts` (the effect is stored flat: `kind` + nullable columns), migration `20261011000000_promo_effects` (`economy.PromoCode` + `startsAt`, `description`, `kind`, `freeRides`, `cosmeticSlot/Item`; `player.CosmeticUnlock`, `player.CosmeticEquip`) |
| presentation | `economy/promos.http.controller.ts`, `admin/admin-promos.http.controller.ts` (+ DTO schemas) |
| client | `site/lobby-promo.js` + the codes section of the PROFILE tab in `site/lobby.js`; `site/admin-promos.js` + the PROMO CODES tab in `site/admin.js`; the landing's invite form (`landing/index.html`, `src/main.js`); `js/cosmetics.js`, `js/cockpit/rig.js`, `js/online.js` |

Race-safety: redeeming runs in ONE transaction under the player row lock. The redemption itself is one atomic `UPDATE economy."PromoCode" SET redeemed = redeemed + 1 WHERE enabled AND startsAt <= now AND (expiresAt IS NULL OR expiresAt > now) AND (max IS NULL OR redeemed < max)`; the per-wallet limit is the `(code, wallet, n)` primary key. A cosmetic unlock from an older code is still `(wallet, slot, item)`. Concurrency tests: free-ride code vs the midnight grant, the last redemption exactly at `startsAt`, one wallet redeeming a cosmetic code N times at once (every try is 409 `visuals_are_honk`, nothing unlocked).

## The player's side

- **Lobby**: the PROFILE tab has a PROMO CODES section: the code field + REDEEM (ids `promo-code` / `promo-go` / `promo-msg`) and "CODES YOU REDEEMED" (the header no longer has a field; the old `#promo` link still works – it is an alias of `#profile`) (an invite link pre-fills the field); the parts themselves are in **GARAGE** (docs/garage.md: progress, preview, pick + SAVE).
- **Landing invite block** (its own `<aside id="promo-band">` right after the hero – not a chapter, no nav link, no h2): type a code → signed in: straight to `lobby.html?promo=CODE#promo`; signed out: the code is kept, the CONNECT button gets focus, and the sign-in redirect carries it. `/?promo=CODE` is a shareable invite link that pre-fills the block. **A link never redeems by itself** – the lobby only pre-fills the field and the player clicks REDEEM. Codes are never listed publicly.
- Analytics (PostHog, `docs/analytics/index.html` funnel 9): browser `promo_invite_viewed`, `promo_invite_submitted`, `promo_redeem_clicked`; server `promo_redeemed` (tickets or free rides, after the commit; a cosmetic code is refused and emits nothing), `cosmetic_equipped`, `promo_created` / `promo_disabled` (aggregate, no wallet), and `ride_started` with one property per slot (`wheel`, `truck_color`, `gearbox`). Free text (descriptions, notes) never goes; refusals are read from the existing `api_request_failed`.

## Tests

- Server (`npm run server:test`, Docker-free): entity, DTOs, catalog + client-mirror drift, wardrobe DTO, admin proof (every field is bound), each handler / service / controller, in-memory repos; HTTP scenarios `test/scenarios/promos.scenarios.ts` (free rides above the cap and the midnight grant, cosmetics + wardrobe, scheduling, the whole signed admin flow) run on in-memory AND PostgreSQL.
- `npm run server:integration`: repository specs (`promo`, `cosmetic`), the migration drift check, the concurrency cases. In a worktree with its own migrations use `TEST_DATABASE_URL=…/freightchain_<branch>_test`.
- Client: `npm run check` (headless: default look pinned, every item draws), `landing` tests (`promos.test.js`, page / pools tests).
- **Expiry and abuse** (`test/scenarios/promos-abuse.scenarios.ts`, in-memory AND PostgreSQL): a code works until the millisecond before `expiresAt` and not at it; what an ended code gave stays (rides, worn parts, the log, the ENDED list); a scheduled code opens exactly at `startsAt`; `perWallet` and the global cap hold; spelling / whitespace / look-alike variants are one code or nothing; hostile bodies are 4xx, never 500; an admin signature is single-use, 5 minutes, and bound to its action; HTML in a description stays text. `test/http/rate-limit.spec.ts`: the redeem route's own per-IP budget.
- **The whole loop in real Chrome**: `bash .claude/skills/run-tests/e2e.sh promo` (`server/scripts/e2e-promo.mjs`) – the admin page creates a free-ride code and a ticket code (the wallet signs each). Cab colours are minted by burning TEN4, not by a code. Players redeem from the lobby AND from the landing's invite block, see the free rides / tickets / garage change, the admin sees who used what (EXHAUSTED / ENDED filters, per-code and per-wallet lists), a code that ends, one that has not started, one used up, one disabled, ten wallets racing for the last use. Screenshots: look at `admin-promos-*.png`, `promo-garage-*.png`, `promo-landing-invite.png`.
- Real Chrome (`bash .claude/skills/run-tests/e2e.sh lobby admin wallet wallet-split`): the PROFILE's promo codes, the admin tab (form → wallet signs → listed → a player redeems → who used it → disable), the landing invite on one origin and on split hosts. `client/tools/e2e-chrome.mjs` saves `cosmetic-<n>.png` – look at them after touching `rig.js`.

## Abuse notes

- **Guessing codes**: `POST /api/promo/redeem` has its own budget, `THROTTLE_PROMO_LIMIT` (30 per minute **per IP** – wallets are free to make, so a per-wallet limit alone would not stop a script). Behind a shared NAT many players share it; raise it for an event.
- A code's existence is visible: unknown = 404, known-but-unusable = 409 with the reason. Accepted for now (codes are meant to be handed out); the budget above is what limits probing.
- Sybil wallets are not detectable here: `perWallet` is per wallet, so a code with no `maxRedemptions` can be farmed with fresh wallets. Give giveaway codes a cap.

## Open

- Items differ in colour only; a different SHAPE (or an NFT's own cab model) means new drawing code in `rig.js`.
- A code cannot be edited or deleted – only disabled; there is no bulk "generate N single-use codes" yet.
- A `free_rides` grant has no expiry of its own; the rides are spent like any free ride.
- Promo analytics were checked with stubbed ingest (unit + HTTP scenarios), not against the real EU project – run the `posthog-test` skill / look at Activity after a deploy.
