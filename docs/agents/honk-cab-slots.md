# New cab slots

Six items each. The first is free and is the current drawing. One `gold` item is 260 TEN4. Every other item is 65 TEN4. Truck paint has no gold. The gearbox slot already exists. Do not add a second shifter.

| slot | items, in order |
|---|---|
| ornament | spear, ball, star, gold, bird, flag |
| dash | stock, wood, carbon, gold, red, ivory |
| indicator | amber, red, green, gold, ice, white |
| phone | black, silver, gold, red, blue, clear |

`spear`, `stock`, `amber`, and `black` must take the same pixels the cab already draws. A non-default item is the only thing that may change the picture.

Prices stay in base units (`UNIT = 1_000_000`). The program, `HONK_PARTS`, and `COSMETIC_ITEMS` list the same ids. The local pool opens with exactly 50 SOL. That is the deposit, not a dollar price. Ride emission stays on the ledger.
