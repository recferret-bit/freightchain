# The Garage

The lobby's **GARAGE** tab (`#garage`) is where a player sees every visual part of the cockpit that exists, how many of them they have collected, what unlocked each one, and picks what the next ride is driven with. Nothing in it changes how the truck drives – visuals only, colours only for now (docs/promocodes.md has the promo side and the catalog rules).

## What the player sees

- **COLLECTION** – `n / 48 parts · p %` with a bar, and `n/5` per slot. Defaults are not counted (everybody has them); non-default parts are minted by burning TEN4, with Convoy, Signal and Amber paints earned through referrals. The line under it says so.
- **The cab** – the game's OWN cockpit renderer (`js/cockpit`, no three.js) drawn on a canvas over a sky + road backdrop (`site/garage-cab.js`, loaded lazily, same pattern as the landing's dash cards). An owned pick wears at once, before APPLY. Clicking any part, locked or owned, observes it: the cab previews that part immediately and the detail card shows its description and burn price. A locked part is only a preview – it never enters the pick, so APPLY cannot send it. **Hover** the wheel, shifter, dice, gauges or hood (or the slot's card) and it plays a looped movement: the wheel turns, the lever walks the gears, the dice swing, the needles sweep, the hood gets a gloss glint; a tap toggles it on touch, reduced motion keeps a still frame. Clicking a part on the cab jumps to its card.
- **Nine cards, six parts each (nine truck paints)** – steering wheel, truck paint, shifter, hanging dice, gauge needles. A tile is `WORN` (saved and selected), `SELECTED` (picked, not saved), `SELECT` (owned) or 🔒 (locked), plus `Burns n TEN4` on anything that is not the slot default. The tooltip says how it was earned: `Minted by burning TEN4 · <date>` (a code that starts with `honk:`), `Unlocked by GOLDWHEEL · <date>` (an older promo unlock), `Everybody has this one.`, or `Locked – burn TEN4 to mint it.` Clicking a locked part observes it (and sends `garage_part_clicked owned=false`) – it can never be selected.
- **The detail card** (`#garage-detail`, above the slot cards) – before a click it says to choose a part. After a click that part stays across repaints. Name, description and price come from the garage payload (the database): `Included. Everybody has this one.` for a default, `Burns n TEN4` for anything else, and for an owned unlock the same origin line as the tooltip. A locked part adds `Preview only. Burn TEN4 to keep it.` and a `BURN n TEN4` button. If a non-default has no price on the payload, the honk catalog is only a backup for that number; if it still has none, the button is disabled and the card says the price is unavailable – the client never invents one. The wallet's TEN4 balance is shown when the session knows it.
- **APPLY / RESET** – a selection is local until APPLY. APPLY sends only the slots that changed, and only owned parts, in ONE request (saved in the database; the next ride starts with it). RESET puts the pick back to what is applied; a locked preview can stay on the cab, an owned one does not, so the cab matches the pick again when nothing locked is being previewed. The line beside them says `Not applied yet.` or `Applied – your next ride starts with this loadout.`

## The parts (visual only)

| slot | what it colours | parts (first = default) |
|---|---|---|
| `wheel` | steering wheel rim, sheen ring, spokes, hub | classic · crimson · ocean · moss · gold · ivory |
| `truck_color` | hood, fenders, windscreen frame and dashboard edge | red · blue · green · black · yellow · white · convoy · signal · amber |
| `gearbox` | shifter knob, boot, lever | stick · chrome · wood · racing · gold · carbon |
| `dice` | the dice hanging from the mirror (body + pips) | white · red · blue · gold · pink · black |
| `needle` | the needles of the two big gauges | orange · red · lime · cyan · white · gold |

`dice` and `needle` are the parts the Garage added. Add a part: the id in `server/src/domain/economy/cosmetics.ts` AND `client/js/cosmetics.js`, a palette with the slot's keys in `LOOKS`, then `npm run check`; for a new SLOT also draw it in `cockpit/rig.js` / `common.js`, name it in `site/lobby-promo.js` (`SLOT_NAME`, `ITEM_NAME`, `swatch`) and in the preview in `site/lobby-garage.js`. The server and client catalogs are drift-tested; the default of every slot must keep drawing exactly the old cockpit (the headless test pins the colours).

## Where it is stored

- **What is owned**: `player.CosmeticUnlock (wallet, slot, item, code, at)` – written when TEN4 is burned for the part (`code` = `honk:<id>`). An older promo redemption that already wrote a row still shows. The code and the time are what the Garage shows.
- **What is worn**: `player.CosmeticEquip (wallet, slot, item)` – written by SAVE (and by a TEN4 mint, which wears the new part). Defaults are implicit rows that are never stored.
- **What a ride was driven with**: `ride.Ride.loadout` (JSON, every slot) – stamped when the ride starts from the two tables above. The game, live spectators and replays draw that; changing the Garage later never rewrites a started ride.

## API (signed in)

- `GET /api/garage` → `{ equipped: {slot: part}, slots: [{ slot, parts: [{ id, isDefault, owned, worn, unlockedAt, code, name, description, price }], collected, total }], progress: { collected, total, percent } }`. `price` is whole TEN4 (`"65"`, `"260"`) or `null` for the slot default. The Garage renders that name, description and price from the database.
- `POST /api/garage/loadout { loadout: { <slot>: <part>, … } }` – any subset of the nine slots, nothing else (400 on an unknown slot / part / an empty pick). **All or nothing**: every part is checked first (owned, or the slot's default) and the writes share one transaction – one part not owned is a 409 `not_owned` and nothing is saved. Answers the new `GET /api/garage`.
- `GET /api/wardrobe` and `POST /api/wardrobe/equip` (one part at a time) still exist and agree with the Garage.

## Code map

| | |
|---|---|
| domain | `economy/cosmetics.ts` (catalog, `unlockableCount`, `parseLoadout`), `economy/garage.dto.ts` (`toGarageDto`: parts, progress) |
| application | `use-cases/players/get-garage`, `use-cases/players/save-garage` (validates all, one transaction, `garage_saved`) |
| presentation | `economy/garage.http.controller.ts` + `dto/garage.dto.ts` (strict body) |
| client | `site/lobby-garage.js` (pure builders: progress, detail, tiles, actions), `site/garage-cab.js` (the real cockpit canvas + hover loops; `pose.dice` in `js/cosmetics.js` is its one hook into the cockpit), the GARAGE tab in `site/lobby.js` (`S.garage` = server answer, `S.pick` = owned selection, `S.observe` = the part previewed on the cab and shown in the detail card), `js/cosmetics.js`, `js/cockpit/rig.js` + `common.js` |

## Analytics

Server `garage_saved` (the loadout now worn, `parts_saved`; sets the five slots on the person) and `ride_started` (one property per slot); browser `garage_part_clicked {slot, item, owned}` – locked clicks show which parts people want. See docs/analytics/index.html.

## Tests

`garage.dto.spec`, `get-garage` / `save-garage` handler specs, `garage.http.controller.spec`, HTTP scenarios `promos.scenarios.ts` › "the garage" (memory AND PostgreSQL: catalog, progression with code + time, save all-or-nothing, other wallets), `cosmetics.spec` (drift + palettes), landing `promos.test.js`, the headless pins, and the lobby e2e (`server/scripts/e2e-lobby.mjs`: progress, tooltips, locked click, pick / RESET / SAVE, two slots in one save, the game and a spectator wearing the saved set). Look at `garage-desktop.png` / `garage-phone.png` and the `cosmetic-*.png` tour after touching the UI.

## Open

- New parts come from burning TEN4 (`docs/honk/SPEC.md`). An older promo unlock stays wearable. A chain NFT would be a later source next to `CosmeticUnlock.code`.
- Colours only; new shapes need drawing code. The cab backdrop is a flat 2D sky and road, not the 3D scene.
- Saving is per slot-set; there are no named presets yet.
