import { box, hip, cyl, pole } from './parts.js';
import { spruce } from '../props-basic.js';

/* Motels and hotels. Each implementation: { id, hl, hd (half footprint along / across the road, m), make(g, c) }.
   c = { m (theme materials), wall (this site's wall material), wi, sign(style, w, h, x, y, z[, text]), facade(cols, rows) }. */
export const motel = [
  { id: 'motel-strip', hl: 13, hd: 5, make(g, c) {   // classic one-storey strip, doors under a covered walkway, tall neon pylon
    const { m } = c;
    g.add(box(c.wall, 5, 3, 24, 2, 0, 0)); g.add(box(m.roof, 9.4, .3, 25, -.3, 3, 0));
    for (let i = 0; i < 6; i++) { const z = -10 + i * 4; g.add(box(m.door, .1, 2.1, 1.1, -.52, 0, z)); g.add(box(m.glass, .1, 1.1, 1.6, -.52, 1, z + 1.8)); }
    for (let z = -11.5; z <= 11.5; z += 4.6) g.add(box(m.trim, .15, 3, .15, -4.7, 0, z));
    g.add(pole(m.metal, 7, -4.6, 12.4, .3)); g.add(c.sign('neon', 4.2, 1.8, -4.6, 7, 12.4));
  } },
  { id: 'motel-cabins', hl: 13, hd: 5, make(g, c) {   // row of little hip-roofed cabins + a bigger office
    const { m } = c;
    for (let i = 0; i < 3; i++) { const z = -8 + i * 5.4; g.add(box(c.wall, 4, 2.6, 4, 2, 0, z)); g.add(hip(m.roof, 5.4, 1.7, 5.4, 2, 2.6, z)); g.add(box(m.door, .1, 2, 1, -.02, 0, z - .8)); g.add(box(m.glass, .1, 1, 1.2, -.02, 1, z + 1)); g.add(box(m.trim, 1.4, .12, 3.4, -.7, 2.2, z)); }
    g.add(box(c.wall, 4.5, 3, 5, 2.2, 0, 8.4)); g.add(hip(m.roof, 6, 2, 6.2, 2.2, 3, 8.4)); g.add(box(m.glass, .1, 1.4, 3, -.06, 1, 8.4)); g.add(box(m.door, .1, 2, 1, -.06, 0, 6.6));
    g.add(pole(m.metal, 5, -4, -12, .25)); g.add(c.sign('red', 3.6, 1.6, -4, 5, -12));
  } },
  { id: 'motel-twostory', hl: 12, hd: 5, make(g, c) {   // two floors, open balcony on the road side, stairs at the end
    const { m } = c;
    g.add(box(c.wall, 6, 6, 22, 2, 0, 0)); g.add(box(m.roof, 9, .3, 23, 0, 6, 0)); g.add(box(m.trim, 2, .2, 22, -2, 3, 0)); g.add(box(m.trim, .08, .9, 22, -2.95, 3.2, 0)); g.add(box(m.trim, .08, .9, 22, -2.95, 6.1, 0));
    for (let f = 0; f < 2; f++) for (let i = 0; i < 5; i++) { const z = -9 + i * 4.2; g.add(box(m.door, .1, 2, 1, -1.02, f * 3, z)); g.add(box(m.glass, .1, 1.1, 1.6, -1.02, f * 3 + .9, z + 1.7)); }
    for (let k = 0; k < 6; k++) g.add(box(m.trim, 1.2, .2, .8, -2.2, k * .5, 11.6 - k * .35 - 0.4)); 
    for (const z of [-10.5, -3, 4.5, 10.5]) g.add(pole(m.trim, 3, -2.9, z));
    g.add(pole(m.metal, 8, -4.6, -11.4, .3)); g.add(c.sign('neon', 3.8, 1.8, -4.6, 8, -11.4));
  } },
];
export const hotel = [
  { id: 'hotel-tower', hl: 8, hd: 6, make(g, c) {   // glass-grid tower on a lobby podium with an entrance canopy and roof sign
    const { m } = c;
    g.add(box(c.wall, 12, 4, 14, 0, 0, 0)); g.add(box(m.glass, .1, 2.2, 10, -6.02, .6, 0)); g.add(box(m.roof, 12.4, .3, 14.4, 0, 4, 0));
    g.add(box(c.facade(6, 8), 9, 18, 11, 1.5, 4, 0)); g.add(box(m.roof, 9.3, .4, 11.3, 1.5, 22, 0));
    g.add(box(m.accent, 3, .25, 6, -7, 3.1, 0)); g.add(pole(m.trim, 3, -8.3, -2.7, .2)); g.add(pole(m.trim, 3, -8.3, 2.7, .2));
    g.add(c.sign('neon', 7, 2, 1.5, 22.4, 0));
  } },
  { id: 'hotel-resort', hl: 14, hd: 7, make(g, c) {   // wide three-storey resort: portico with columns, spruce, rooftop sign
    const { m } = c;
    g.add(box(c.facade(14, 4), 9, 9, 26, 2.5, 0, 0)); g.add(box(m.roof, 9.6, .4, 26.6, 2.5, 9, 0)); g.add(box(m.trim, 3, 4.2, 8, -2.4, 0, 0)); g.add(box(m.glass, .1, 2.6, 5, -3.92, .3, 0));
    g.add(box(m.accent, 5.5, .4, 9, -4.4, 4.2, 0)); for (const z of [-4, -1.3, 1.3, 4]) g.add(cyl(m.trim, .3, 4.2, -6.4, 0, z));
    for (const [x, z, h] of [[-5, -10.5, 5], [-5, 10.5, 6], [-6.2, -7, 4]]) { const t = spruce(h, m.trunk, m.leaf); t.position.set(x, 0, z); g.add(t); }
    g.add(c.sign('red', 8, 1.8, 2.5, 9.4, 0));
  } },
];
