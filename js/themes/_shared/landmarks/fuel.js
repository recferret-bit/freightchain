import { box, hip, cyl, pole } from './parts.js';
import { mk, GEO } from '../../../world/props.js';

/* Gas stations: canopy, truck stop, old-school kiosk. */
const pump = (g, m, x, z, h = 1.5) => { g.add(box(m.accent, .7, h, .5, x, .2, z)); g.add(box(m.dark, .72, .45, .52, x, .2 + h * .6, z)); };
export const gas = [
  { id: 'gas-canopy', hl: 11, hd: 8, make(g, c) {   // modern station: shop at the back, wide canopy over two pump islands, price pylon
    const { m } = c;
    g.add(box(c.wall, 6, 3.2, 10, 5, 0, 0)); g.add(box(m.glass, .1, 1.6, 7.5, 1.98, .8, 0)); g.add(box(m.roof, 6.4, .3, 10.4, 5, 3.2, 0));
    g.add(box(m.trim, 9, .3, 14, -2, 5.1, 0)); g.add(box(m.accent, 9.1, .4, 14.1, -2, 4.7, 0));
    for (const z of [-5.5, 5.5]) for (const x of [-5, 1]) g.add(pole(m.trim, 5.1, x, z, .5));
    for (const z of [-3, 3]) { g.add(box(m.lot, 1.2, .25, 3.4, -2, 0, z)); pump(g, m, -2, z - .9); pump(g, m, -2, z + .9); }
    g.add(pole(m.metal, 7, -7.4, -9.6, .35)); g.add(c.sign('red', 3.2, 2.6, -7.4, 7, -9.6));
  } },
  { id: 'gas-truckstop', hl: 14, hd: 9, make(g, c) {   // long truck-stop canopy, four diesel pumps, big shop and a tall pylon
    const { m } = c;
    g.add(box(c.wall, 8, 4, 22, 5, 0, 0)); g.add(box(m.glass, .1, 2, 17, 1.02, .9, 0)); g.add(box(m.roof, 8.4, .3, 22.4, 5, 4, 0)); g.add(box(m.accent, .1, .6, 22, .98, 3.2, 0));
    g.add(box(m.trim, 10, .3, 24, -3.5, 5.9, 0)); g.add(box(m.accent2, 10.1, .5, 24.1, -3.5, 5.5, 0));
    for (const z of [-10, 0, 10]) for (const x of [-7.8, -.7]) g.add(pole(m.trim, 5.9, x, z, .5));
    g.add(box(m.lot, 1.4, .25, 18, -4.5, 0, 0)); for (const z of [-6, -2, 2, 6]) { pump(g, m, -4.5, z, 1.7); }
    g.add(pole(m.metal, 11, -8.6, -13, .45)); g.add(c.sign('blue', 4, 3, -8.6, 11, -13));
  } },
  { id: 'gas-kiosk', hl: 7, hd: 6, make(g, c) {   // old-school kiosk with a hip roof, two globe-top pumps and a round sign on a pole
    const { m } = c;
    g.add(box(c.wall, 4, 3, 5, 3.5, 0, 0)); g.add(hip(m.roof, 5.2, 1.6, 6.2, 3.5, 3, 0)); g.add(box(m.glass, .1, 1.2, 3, 1.48, 1, 0)); g.add(box(m.door, .1, 2, 1, 1.48, 0, 1.6));
    g.add(box(m.trim, 5, .25, 7, -.8, 3.6, 0)); for (const z of [-3.2, 3.2]) g.add(pole(m.trim, 3.6, -3, z, .3));
    for (const z of [-1.6, 1.6]) { g.add(box(m.accent, .6, 1.4, .6, -.8, 0, z)); g.add(cyl(m.white, .38, .5, -.8, 1.4, z)); }
    g.add(pole(m.metal, 6, -4.8, 5, .25)); const d = mk(GEO.cyl, m.accent, 1.5, .2, 1.5, -4.8, 6.4, 5); d.rotation.z = Math.PI / 2; g.add(d);
  } },
];
