import * as THREE from 'three';
import { box, hip, pole } from './parts.js';
import { mk } from '../../../world/props.js';

/* Local -Z half of a unit cylinder. rotation.x = PI/2 stands that half up as an arch.
   A full tube scaled flat sits on the walls like a hotdog. */
const BARREL = new THREE.CylinderGeometry(1, 1, 1, 16, 1, false, Math.PI / 2, Math.PI);

/* Restaurants: diner, roadhouse, fast food. */
export const restaurant = [
  { id: 'diner-chrome', hl: 8, hd: 5, make(g, c) {   // barrel-roof chrome diner with a stripe, wrap-around window and a roof sign
    const { m } = c;
    // Wall is z ±7. The pier from the corner to the door is 0.45 m; the window and the stripe
    // are the same length and keep that pier past the door and at the far corner.
    const doorZ = -6, doorW = 1.1, half = 7, pier = doorZ - doorW / 2 + half;
    const z0 = doorZ + doorW / 2 + pier, z1 = half - pier, span = z1 - z0, zc = (z0 + z1) / 2;
    g.add(box(c.wall, 5.5, 2.8, 14, 1, 0, 0)); g.add(box(m.accent, .1, .45, span, -1.77, .35, zc)); g.add(box(m.glass, .1, 1.2, span, -1.77, 1.2, zc)); g.add(box(m.door, .1, 2.1, doorW, -1.77, 0, doorZ));
    const r = mk(BARREL, m.metal, 2.75, 14, 1.9, 1, 2.8, 0); r.rotation.x = Math.PI / 2; g.add(r);
    g.add(pole(m.metal, 7, -2, -7.4, .25)); g.add(c.sign('neon', 4, 1.6, -2, 7, -7.4));
  } },
  { id: 'roadhouse-porch', hl: 7, hd: 6, make(g, c) {   // timber roadhouse: hip roof, porch, chimney and a hanging sign
    const { m } = c;
    g.add(box(c.wall, 8, 3.2, 12, 1.5, 0, 0)); g.add(hip(m.roof, 9.8, 2.6, 13.8, 1.5, 3.2, 0)); g.add(box(m.trim, 3, .18, 12, -4, 3, 0)); g.add(box(m.trim, 3, .15, 12, -4, .2, 0));
    for (const z of [-5.5, -1.8, 1.8, 5.5]) g.add(pole(m.trim, 2.9, -5.4, z, .2));
    g.add(box(m.door, .1, 2.1, 1.2, -2.52, .2, -1.5)); g.add(box(m.glass, .1, 1.2, 2.2, -2.52, 1, 2.5)); g.add(box(m.glass, .1, 1.2, 2.2, -2.52, 1, -4.6));
    // Porch roof tops at 3.18. The board used to start at 2.6 and ran through that slab.
    g.add(box(m.dark, 1, 4.8, 1, 3.5, 0, 4)); g.add(pole(m.metal, 3.7, -5.4, 6.5, .2)); g.add(c.sign('cream', 2.8, 1.8, -5.4, 3.7, 6.5));
  } },
  { id: 'fastfood-drive', hl: 7, hd: 6, make(g, c) {   // fast-food box with a coloured band, drive-through canopy and a big pylon
    const { m } = c;
    // The 9 m window is centered between the door and the right corner (z 6), so both piers match.
    const doorZ = -5, doorW = 1.2, glassW = 9, wallR = 6, gap = (wallR - (doorZ + doorW / 2) - glassW) / 2;
    g.add(box(c.wall, 9, 3.4, 12, 1.5, 0, 0)); g.add(box(m.accent, 9.4, 1, 12.4, 1.5, 3.4, 0)); g.add(box(m.glass, .1, 1.6, glassW, -3.02, .9, doorZ + doorW / 2 + gap + glassW / 2)); g.add(box(m.door, .1, 2.1, doorW, -3.02, 0, doorZ));
    g.add(box(m.roof, 2.8, .25, 9, -4.4, 3.2, 0)); for (const z of [-4, 4]) g.add(pole(m.trim, 3.2, -5.6, z, .2));
    g.add(pole(m.metal, 9, -5.2, 6.4, .35)); g.add(c.sign('red', 3.4, 3, -5.2, 9, 6.4));
  } },
];
