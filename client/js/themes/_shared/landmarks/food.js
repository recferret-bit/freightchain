import { box, hip, pole } from './parts.js';
import { mk, GEO } from '../../../world/props.js';

/* Restaurants: diner, roadhouse, fast food. */
export const restaurant = [
  { id: 'diner-chrome', hl: 8, hd: 5, make(g, c) {   // barrel-roof chrome diner with a stripe, wrap-around window and a roof sign
    const { m } = c;
    g.add(box(c.wall, 5.5, 2.8, 14, 1, 0, 0)); g.add(box(m.accent, .1, .45, 14.1, -1.77, .35, 0)); g.add(box(m.glass, .1, 1.2, 11.5, -1.77, 1.2, .3)); g.add(box(m.door, .1, 2.1, 1.1, -1.77, 0, -6));
    const r = mk(GEO.cyl, m.metal, 2.8, 14.2, 1.1, 1, 3.2, 0); r.rotation.x = Math.PI / 2; g.add(r);
    g.add(pole(m.metal, 7, -2, -7.4, .25)); g.add(c.sign('neon', 4, 1.6, -2, 7, -7.4));
  } },
  { id: 'roadhouse-porch', hl: 7, hd: 6, make(g, c) {   // timber roadhouse: hip roof, porch, chimney and a hanging sign
    const { m } = c;
    g.add(box(c.wall, 8, 3.2, 12, 1.5, 0, 0)); g.add(hip(m.roof, 9.8, 2.6, 13.8, 1.5, 3.2, 0)); g.add(box(m.trim, 3, .18, 12, -4, 3, 0)); g.add(box(m.trim, 3, .15, 12, -4, .2, 0));
    for (const z of [-5.5, -1.8, 1.8, 5.5]) g.add(pole(m.trim, 2.9, -5.4, z, .2));
    g.add(box(m.door, .1, 2.1, 1.2, -2.52, .2, -1.5)); g.add(box(m.glass, .1, 1.2, 2.2, -2.52, 1, 2.5)); g.add(box(m.glass, .1, 1.2, 2.2, -2.52, 1, -4.6));
    g.add(box(m.dark, 1, 4.8, 1, 3.5, 0, 4)); g.add(pole(m.metal, 3.2, -5.4, 6.5, .2)); g.add(c.sign('cream', 2.8, 1.2, -5.4, 2.6, 6.5));
  } },
  { id: 'fastfood-drive', hl: 7, hd: 6, make(g, c) {   // fast-food box with a coloured band, drive-through canopy and a big pylon
    const { m } = c;
    g.add(box(c.wall, 9, 3.4, 12, 1.5, 0, 0)); g.add(box(m.accent, 9.4, 1, 12.4, 1.5, 3.4, 0)); g.add(box(m.glass, .1, 1.6, 9, -3.02, .9, 0)); g.add(box(m.door, .1, 2.1, 1.2, -3.02, 0, -5));
    g.add(box(m.roof, 2.8, .25, 9, -4.4, 3.2, 0)); for (const z of [-4, 4]) g.add(pole(m.trim, 3.2, -5.6, z, .2));
    g.add(pole(m.metal, 9, -5.2, 6.4, .35)); g.add(c.sign('red', 3.4, 3, -5.2, 9, 6.4));
  } },
];
