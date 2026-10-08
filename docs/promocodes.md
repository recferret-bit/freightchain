# Promo codes

A promo code is **one effect, one window, one counter**. A player types it (lobby → PROMO, or the invite block on the landing), the server applies the effect in a single transaction under the player's row lock, and every use is logged. Admins make and stop codes on the admin page; every change is signed by their wallet and audited.

Status: built on branch `promocodes`, server + lobby + admin + landing + cockpit. Not deployed – nothing reaches production until the owner asks for it (AGENTS.md "Deploying to production"). Migration `20261011000000_promo_effects` is forward-only and rewrites no data.

## What a code can do

| kind | effect of ONE redemption | notes |
|---|---|---|
| `free_rides` | `+count` free rides (1–20; the admin form has **1** and **3** presets) | added **on top of** the daily ones and **may exceed `freeRidesMax`** (5). The cap only limits the daily refill (`Player.applyDailyGrant`, the midnight SQL): it adds below the cap and never takes anything away, and the lobby countdown shows "full" at or above it. A refund of an unstarted free ride adds one unless the wallet is exactly at the cap. Rule chosen with the owner's brief in mind ("+3 rides" must be worth 3). |
| `tickets` | `credits` free paid-ride tickets of a tier (`1h` / `4h` / `8h`), into the live pool of that tier or a pinned pool | the old promo. An off-chain grant (a sponsored entry): it does **not** count towards the pool's on-chain minimum. Clamped at the pool's per-wallet cap; a wallet already at the cap is refused (409 `ticket_cap`) **before** a redemption is used. Free tickets "per type of ride" = one code per tier. |
| `cosmetic` | unlocks one visual and **wears it**: `wheel`, `truck_color` or `gearbox` | visuals only – no item changes handling, shifting or any rule. A wallet that already owns the item is refused (409 `already_owned`) before a redemption is used. |

Common fields: `code` (3–32 of `A–Z 0–9 - _`, stored upper-case, typed case- and space-insensitively), `description` (player-facing, ≤ 200), `maxRedemptions` (empty = unlimited), `perWallet` (default 1), `startsAt` (default now) → `expiresAt` (empty = no end), `note` (private, ≤ 500).

A code is **immutable** once created apart from being disabled (so the redemption log always reads against what was actually granted). Disabling keeps everything already granted.

State of a code at an instant (`PromoCode.stateAt`): `disabled` › `ended` › `scheduled` (not started) › `exhausted` (every redemption taken) › `active`.

## The cosmetics catalog

Server: `server/src/domain/economy/cosmetics.ts`. Client mirror: `client/js/cosmetics.js` (a leaf module – the landing's dash cards run the cockpit without three.js). `server/test/unit/domain/economy/cosmetics.spec.ts` reads the client file and fails on drift.

| slot | what is drawn (`client/js/cockpit/rig.js`) | items (first = default, everybody has it, no code gives it) |
|---|---|---|
| `wheel` | steering wheel: rim, sheen, spokes (count, width), hub | `classic` `sport` `wood` `gold` |
| `truck_color` | hood + fenders paint (what the driver sees; the trailer is untouched) | `red` `blue` `green` `black` `yellow` |
| `gearbox` | the floor shifter: knob (colour, size), boot, lever | `stick` `chrome` `wood` `racing` |

**Add an item**: append its id to `COSMETIC_ITEMS` (server) and `COSMETICS` (client), give it a row in `LOOKS` (client) – the cockpit reads `look(slot)` every frame, so a new row is enough unless the *shape* differs, in which case draw it in `rig.js`. Then `npm run check` (the headless test pins the default colours and draws every item; the server drift test compares the lists). **The default loadout must keep drawing exactly what the cockpit always drew** (the committed promo clips and the landing's dash cards depend on it).

Where the look is read: `online.js` fetches `GET /api/wardrobe` when an online ride loads and calls `setLoadout` (a failure keeps the default). Offline play, the model viewer and the video tool wear the default. **Not done**: spectators / replays draw the default cockpit, not the driver's (the recording does not carry the loadout); the trailer livery is per route, not a cosmetic.

## API

Player (signed in):
- `POST /api/promo/redeem {code}` → a union on `kind`: `{kind:'tickets', code, label, poolId, tier, added, balance, cap}` · `{kind:'free_rides', code, label, added, freeRides}` · `{kind:'cosmetic', code, label, slot, item}`. 404 unknown · 409 `promo_unavailable` (disabled / ended / **not active yet** / used up / already redeemed by you) · `no_open_pool` · `ticket_cap` · `already_owned`.
- `GET /api/promo/mine` → `{redemptions: [{code, label, description, kind, at}]}` (newest first, ≤ 100).
- `GET /api/wardrobe` → `{equipped: {wheel, truck_color, gearbox}, unlocked: {slot: [default, …]}}` (every slot always set).
- `POST /api/wardrobe/equip {slot, item}` → the wardrobe · 400 `bad_cosmetic` · 409 `not_owned`.

Admin (`/api/admin/promos…`, same guard as the rest: admin host, `fc_admin` session, `X-FC-Admin` on changes):
- `GET /api/admin/promos[?state=active|scheduled|ended|exhausted|disabled]` · `GET /api/admin/promos/redemptions[?code=&wallet=&limit=]`.
- `POST /api/admin/promos/challenge {action:'promo_create', promo} | {action:'promo_disable', code}` → the text to sign. `POST /api/admin/promos {promo, signature}` creates, `POST /api/admin/promos/:code/disable {signature}` stops. The signed text names the action, what it gives and **every field of the code as one JSON line** (`promoJson` in `domain/admin/admin-proof.ts`); free text only ever appears JSON-quoted. The audit row (`promo.create` / `promo.disable`, target = the code) keeps text + signature, written in the same transaction as the change.
- CLI (dev / ops, no signature): `promo:create CODE <effect> [--desc] [--start] [--expires] [--max] [--per-wallet] [--note]` with `--tier 1h --credits 2 [--pool N]` · `--free-rides 3` · `--cosmetic wheel:gold`; `promo:list`, `promo:disable CODE`.

## Where it lives

| layer | files |
|---|---|
| domain | `economy/promo-code.entity.ts` (rules, `stateAt`, `whyNotRedeemable`), `promo.types.ts` (`PromoEffect`), `promo.dto.ts` (`describeEffect`, DTOs), `cosmetics.ts`, `wardrobe.dto.ts`, `admin/admin-proof.ts` (intents), `players/player.entity.ts` (`grantFreeRides`) |
| application | `use-cases/players/{redeem-promo,get-my-promos,get-wardrobe,equip-cosmetic}`, `use-cases/admin/{create-admin-promo,disable-admin-promo,list-promo-redemptions}`, `use-cases/promos/*` (CLI), `services/promo-creation.service.ts`, ports `promo.repository.port.ts`, `cosmetic.repository.port.ts` |
| infrastructure | Prisma repos + `promo.mapper.ts` (the effect is stored flat: `kind` + nullable columns), migration `20261011000000_promo_effects` (`economy.PromoCode` + `startsAt`, `description`, `kind`, `freeRides`, `cosmeticSlot/Item`; `player.CosmeticUnlock`, `player.CosmeticEquip`) |
| presentation | `economy/promos.http.controller.ts`, `admin/admin-promos.http.controller.ts` (+ DTO schemas) |
| client | `site/lobby-promo.js` + the PROMO tab in `site/lobby.js`; `site/admin-promos.js` + the PROMO CODES tab in `site/admin.js`; the landing's invite form (`landing/index.html`, `src/main.js`); `js/cosmetics.js`, `js/cockpit/rig.js`, `js/online.js` |

Race-safety: redeeming runs in ONE transaction under the player row lock. The redemption itself is one atomic `UPDATE economy."PromoCode" SET redeemed = redeemed + 1 WHERE enabled AND startsAt <= now AND (expiresAt IS NULL OR expiresAt > now) AND (max IS NULL OR redeemed < max)`; the per-wallet limit is the `(code, wallet, n)` primary key; the cosmetic unlock is `(wallet, slot, item)`. Concurrency tests: free-ride code vs the midnight grant, the last redemption exactly at `startsAt`, one wallet redeeming a cosmetic N times at once.

## The player's side

- **Lobby → PROMO**: the code field, "YOUR TRUCK" (every catalog item: worn / WEAR / locked 🔒 – one click wears it) and "CODES YOU REDEEMED". NEW RIDE keeps its code field too (same ids) with a link to PROMO.
- **Landing invite block** (in the hero, no new chapter): type a code → signed in: straight to `lobby.html?promo=CODE#promo`; signed out: the code is kept, the CONNECT button gets focus, and the sign-in redirect carries it. `/?promo=CODE` is a shareable invite link that pre-fills the block. **A link never redeems by itself** – the lobby only pre-fills the field and the player clicks REDEEM. Codes are never listed publicly.
- Analytics: no events were added for promo codes (they would drag in `docs/analytics`); the existing `lobby_tab_viewed` already carries the tab name.

## Tests

- Server (`npm run server:test`, Docker-free): entity, DTOs, catalog + client-mirror drift, wardrobe DTO, admin proof (every field is bound), each handler / service / controller, in-memory repos; HTTP scenarios `test/scenarios/promos.scenarios.ts` (free rides above the cap and the midnight grant, cosmetics + wardrobe, scheduling, the whole signed admin flow) run on in-memory AND PostgreSQL.
- `npm run server:integration`: repository specs (`promo`, `cosmetic`), the migration drift check, the concurrency cases. In a worktree with its own migrations use `TEST_DATABASE_URL=…/freightchain_<branch>_test`.
- Client: `npm run check` (headless: default look pinned, every item draws), `landing` tests (`promos.test.js`, page / pools tests).
- Real Chrome (`bash .claude/skills/run-tests/e2e.sh lobby admin wallet wallet-split`): the PROMO tab, the admin tab (form → wallet signs → listed → a player redeems → who used it → disable), the landing invite on one origin and on split hosts. `client/tools/e2e-chrome.mjs` saves `cosmetic-<n>.png` – look at them after touching `rig.js`.

## Open

- Spectators / replays do not show the driver's cosmetics (needs the loadout in the watch payload).
- A code cannot be edited or deleted – only disabled; there is no bulk "generate N single-use codes" yet.
- A `free_rides` grant has no expiry of its own; the rides are spent like any free ride.
- No PostHog events for promo codes (see above).
