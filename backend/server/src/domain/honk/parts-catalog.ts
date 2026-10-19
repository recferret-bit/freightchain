import type { CosmeticSlot } from '../economy/cosmetics.js';

/* Cab parts a TEN4 burn can buy. Seeded into economy.HonkPart; the mint charges that row. */

export interface HonkPartSeed {
  slot: CosmeticSlot;
  item: string;
  name: string;
  description: string;
  /** null = slot default, not for sale. Otherwise base units. */
  price: bigint | null;
  sort: number;
}

const UNIT = 1_000_000n;
/** 260 TEN4. Same number as visualPrice('gold'); the catalog test keeps them equal. */
const GOLD = 260n * UNIT;
/** 65 TEN4. Every unlockable that is not gold. */
const PLAIN = 65n * UNIT;

type Slot = HonkPartSeed['slot'];
const row = (slot: Slot, item: string, name: string, description: string, price: bigint | null, sort: number): HonkPartSeed => ({ slot, item, name, description, price, sort });

/** Item order is COSMETIC_ITEMS. Sort is 0..53. The first item of a slot is not for sale. */
export const HONK_PARTS: readonly HonkPartSeed[] = [
  row('wheel', 'classic', 'Wheel · Classic', 'The stock wheel: a black rim, a dark hub, and the amber mark.', null, 0),
  row('wheel', 'crimson', 'Wheel · Crimson', 'A dark rim with a red sheen ring and a pale mark.', PLAIN, 1),
  row('wheel', 'ocean', 'Wheel · Ocean', 'A dark rim with a blue sheen ring and a pale blue mark.', PLAIN, 2),
  row('wheel', 'moss', 'Wheel · Moss', 'A dark rim with a green sheen ring and a pale green mark.', PLAIN, 3),
  row('wheel', 'gold', 'Wheel · Gold', 'A gold sheen ring, gold spokes, and a gold hub.', GOLD, 4),
  row('wheel', 'ivory', 'Wheel · Ivory', 'A pale rim and hub with a dark mark.', PLAIN, 5),
  row('truck_color', 'red', 'Paint · Red', 'The stock cab: a red hood and fenders.', null, 6),
  row('truck_color', 'blue', 'Paint · Blue', 'A blue hood, fenders, and dash edge.', PLAIN, 7),
  row('truck_color', 'green', 'Paint · Green', 'A green hood, fenders, and dash edge.', PLAIN, 8),
  row('truck_color', 'black', 'Paint · Black', 'A black hood and fenders with a gold dash edge.', PLAIN, 9),
  row('truck_color', 'yellow', 'Paint · Yellow', 'A yellow hood and fenders.', PLAIN, 10),
  row('truck_color', 'white', 'Paint · White', 'A white hood and pale fenders.', PLAIN, 11),
  row('gearbox', 'stick', 'Shifter · Stock', 'The stock shifter: a black knob and boot.', null, 12),
  row('gearbox', 'chrome', 'Shifter · Chrome', 'A bright metal knob and a light rim.', PLAIN, 13),
  row('gearbox', 'wood', 'Shifter · Wood', 'A wooden knob and a brown boot.', PLAIN, 14),
  row('gearbox', 'racing', 'Shifter · Racing', 'A red knob and a metal lever.', PLAIN, 15),
  row('gearbox', 'gold', 'Shifter · Gold', 'A gold knob and a black boot.', GOLD, 16),
  row('gearbox', 'carbon', 'Shifter · Carbon', 'A dark knob with a metal rim and lever.', PLAIN, 17),
  row('dice', 'white', 'Dice · White', 'The stock dice: a white body and red pips.', null, 18),
  row('dice', 'red', 'Dice · Red', 'Red dice with white pips.', PLAIN, 19),
  row('dice', 'blue', 'Dice · Blue', 'Blue dice with white pips.', PLAIN, 20),
  row('dice', 'gold', 'Dice · Gold', 'Gold dice with dark pips.', GOLD, 21),
  row('dice', 'pink', 'Dice · Pink', 'Pink dice with white pips.', PLAIN, 22),
  row('dice', 'black', 'Dice · Black', 'Black dice with pale pips.', PLAIN, 23),
  row('needle', 'orange', 'Needles · Orange', 'The stock needles: orange.', null, 24),
  row('needle', 'red', 'Needles · Red', 'Red needles on both big gauges.', PLAIN, 25),
  row('needle', 'lime', 'Needles · Lime', 'Lime needles on both big gauges.', PLAIN, 26),
  row('needle', 'cyan', 'Needles · Cyan', 'Cyan needles on both big gauges.', PLAIN, 27),
  row('needle', 'white', 'Needles · White', 'White needles on both big gauges.', PLAIN, 28),
  row('needle', 'gold', 'Needles · Gold', 'Gold needles on both big gauges.', GOLD, 29),
  row('ornament', 'spear', 'Ornament · Spear', 'The stock hood spear.', null, 30),
  row('ornament', 'ball', 'Ornament · Ball', 'A ball on the hood in place of the spear.', PLAIN, 31),
  row('ornament', 'star', 'Ornament · Star', 'A star on the hood in place of the spear.', PLAIN, 32),
  row('ornament', 'gold', 'Ornament · Gold', 'A gold ornament on the hood.', GOLD, 33),
  row('ornament', 'bird', 'Ornament · Bird', 'A bird on the hood in place of the spear.', PLAIN, 34),
  row('ornament', 'flag', 'Ornament · Flag', 'A flag on the hood in place of the spear.', PLAIN, 35),
  row('dash', 'stock', 'Dash · Stock', 'The stock dash.', null, 36),
  row('dash', 'wood', 'Dash · Wood', 'A wood dash.', PLAIN, 37),
  row('dash', 'carbon', 'Dash · Carbon', 'A carbon dash.', PLAIN, 38),
  row('dash', 'gold', 'Dash · Gold', 'A gold dash.', GOLD, 39),
  row('dash', 'red', 'Dash · Red', 'A red dash.', PLAIN, 40),
  row('dash', 'ivory', 'Dash · Ivory', 'An ivory dash.', PLAIN, 41),
  row('indicator', 'amber', 'Indicators · Amber', 'The stock amber indicators.', null, 42),
  row('indicator', 'red', 'Indicators · Red', 'Red indicators.', PLAIN, 43),
  row('indicator', 'green', 'Indicators · Green', 'Green indicators.', PLAIN, 44),
  row('indicator', 'gold', 'Indicators · Gold', 'Gold indicators.', GOLD, 45),
  row('indicator', 'ice', 'Indicators · Ice', 'Ice indicators.', PLAIN, 46),
  row('indicator', 'white', 'Indicators · White', 'White indicators.', PLAIN, 47),
  row('phone', 'black', 'Phone · Black', 'The stock black phone.', null, 48),
  row('phone', 'silver', 'Phone · Silver', 'A silver phone.', PLAIN, 49),
  row('phone', 'gold', 'Phone · Gold', 'A gold phone.', GOLD, 50),
  row('phone', 'red', 'Phone · Red', 'A red phone.', PLAIN, 51),
  row('phone', 'blue', 'Phone · Blue', 'A blue phone.', PLAIN, 52),
  row('phone', 'clear', 'Phone · Clear', 'A clear phone.', PLAIN, 53),
];
