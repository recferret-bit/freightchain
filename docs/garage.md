# The Garage

The lobby's **GARAGE** tab (`#garage`) is where a player sees every visual part of the cockpit that exists, how many of them they have collected, what unlocked each one, and picks what the next ride is driven with. Nothing in it changes how the truck drives – visuals only, colours only for now (docs/promocodes.md has the promo side and the catalog rules).

## What the player sees

- **COLLECTION** – `n / 25 parts · p %` with a bar, and `n/5` per slot. Defaults are not counted (everybody has them); every non-default part is "found" by redeeming a promo code. The line under it says so and points at the PROMO tab.
- **Preview** – a drawing of the cockpit (SVG, built with `createElementNS`) with the parts picked right now: hood and trim, wheel, shifter, hanging dice, gauge needles. Same palettes the game uses (`client/js/cosmetics.js`).
- **Five cards, six parts each** – steering wheel, truck paint, shifter, hanging dice, gauge needles. A tile is `WORN` (saved and selected), `SELECTED` (picked, not saved), `SELECT` (owned) or 🔒 (locked). The tooltip says how it was earned: `Unlocked by GOLDWHEEL · <date>`, `Everybody has this one.`, or `Locked – a promo code unlocks it.` Clicking a locked part explains it (and sends `garage_part_clicked owned=false`) – it can never be selected.
- **SAVE LOADOUT / RESET** – a selection is local until SAVE. SAVE sends only the slots that changed in ONE request; RESET goes back to what is saved. The line beside them says `Not saved yet.` or `Saved – your next ride starts with this loadout.`

## The parts (visual only)

| slot | what it colours | parts (first = default) |
|---|---|---|
| `wheel` | steering wheel rim, sheen ring, spokes, hub | classic · crimson · ocean · moss · gold · ivory |
| `truck_color` | hood, fenders, windscreen frame and dashboard edge | red · blue · green · black · yellow · white |
| `gearbox` | shifter knob, boot, lever | stick · chrome · wood · racing · gold · carbon |
| `dice` | the dice hanging from the mirror (body + pips) | white · red · blue · gold · pink · black |
| `needle` | the needles of the two big gauges | orange · red · lime · cyan · white · gold |

`dice` and `needle` are the parts the Garage added. Add a part: the id in `server/src/domain/economy/cosmetics.ts` AND `client/js/cosmetics.js`, a palette with the slot's keys in `LOOKS`, then `npm run check`; for a new SLOT also draw it in `cockpit/rig.js` / `common.js`, name it in `site/lobby-promo.js` (`SLOT_NAME`, `ITEM_NAME`, `swatch`) and in the preview in `site/lobby-garage.js`. The server and client catalogs are drift-tested; the default of every slot must keep drawing exactly the old cockpit (the headless test pins the colours).

## Where it is stored

- **What is owned**: `player.CosmeticUnlock (wallet, slot, item, code, at)` – written when a promo code is redeemed (the code and the time are what the Garage shows).
- **What is worn**: `player.CosmeticEquip (wallet, slot, item)` – written by SAVE (and by a redemption, which wears the new part). Defaults are implicit rows that are never stored.
- **What a ride was driven with**: `ride.Ride.loadout` (JSON, every slot) – stamped when the ride starts from the two tables above. The game, live spectators and replays draw that; changing the Garage later never rewrites a started ride.

## API (signed in)

- `GET /api/garage` → `{ equipped: {slot: part}, slots: [{ slot, parts: [{ id, isDefault, owned, worn, unlockedAt, code }], collected, total }], progress: { collected, total, percent } }`.
- `POST /api/garage/loadout { loadout: { <slot>: <part>, … } }` – any subset of the five slots, nothing else (400 on an unknown slot / part / an empty pick). **All or nothing**: every part is checked first (owned, or the slot's default) and the writes share one transaction – one part not owned is a 409 `not_owned` and nothing is saved. Answers the new `GET /api/garage`.
- `GET /api/wardrobe` and `POST /api/wardrobe/equip` (one part at a time) still exist and agree with the Garage.

## Code map

| | |
|---|---|
| domain | `economy/cosmetics.ts` (catalog, `unlockableCount`, `parseLoadout`), `economy/garage.dto.ts` (`toGarageDto`: parts, progress) |
| application | `use-cases/players/get-garage`, `use-cases/players/save-garage` (validates all, one transaction, `garage_saved`) |
| presentation | `economy/garage.http.controller.ts` + `dto/garage.dto.ts` (strict body) |
| client | `site/lobby-garage.js` (pure builders: progress, preview, tiles, actions), the GARAGE tab in `site/lobby.js` (`S.garage` = server answer, `S.pick` = selection), `js/cosmetics.js`, `js/cockpit/rig.js` + `common.js` |

## Analytics

Server `garage_saved` (the loadout now worn, `parts_saved`; sets the five slots on the person) and `ride_started` (one property per slot); browser `garage_part_clicked {slot, item, owned}` – locked clicks show which parts people want. See docs/analytics/index.html.

## Tests

`garage.dto.spec`, `get-garage` / `save-garage` handler specs, `garage.http.controller.spec`, HTTP scenarios `promos.scenarios.ts` › "the garage" (memory AND PostgreSQL: catalog, progression with code + time, save all-or-nothing, other wallets), `cosmetics.spec` (drift + palettes), landing `promos.test.js`, the headless pins, and the lobby e2e (`server/scripts/e2e-lobby.mjs`: progress, tooltips, locked click, pick / RESET / SAVE, two slots in one save, the game and a spectator wearing the saved set). Look at `garage-desktop.png` / `garage-phone.png` and the `cosmetic-*.png` tour after touching the UI.

## Open

- Parts come only from promo codes. Other sources (an achievement, a milestone, an NFT) would add a source next to `CosmeticUnlock.code`.
- Colours only; new shapes need drawing code. The preview is a drawing, not the real cockpit.
- Saving is per slot-set; there are no named presets yet.
