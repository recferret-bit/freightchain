import * as THREE from 'three';
import { box, pole, car } from './parts.js';
import { mk, GEO } from '../../../world/props.js';

/* Police stop points: checkpoint booth, speed trap, small station. */
const cones = (g, m, x, z0, n, dz) => { for (let i = 0; i < n; i++) g.add(mk(GEO.cone, m.cone, .3, .7, .3, x, .35, z0 + i * dz)); };
export const police = [
  { id: 'police-checkpoint', hl: 6, hd: 4, make(g, c) {   // guard booth, raised barrier arm, cones and a cruiser
    const { m } = c;
    g.add(box(c.wall, 2.4, 2.6, 2.4, 2.8, 0, -3.5)); g.add(box(m.glass, .1, 1.1, 1.8, 1.58, 1, -3.5)); g.add(box(m.blue, 3, .25, 3, 2.8, 2.6, -3.5)); g.add(box(m.red, .4, .2, .4, 2.3, 2.85, -3.5)); g.add(box(m.blue, .4, .2, .4, 3.3, 2.85, -3.5));
    g.add(box(m.dark, .3, 1.1, .3, .4, 0, -.9));
    const arm = new THREE.Group(); arm.position.set(.4, 1.1, -.9); arm.rotation.z = -1.1;
    for (let i = 0; i < 6; i++) arm.add(box(i % 2 ? m.white : m.red, .7, .14, .14, -.35 - i * .7, 0, 0));
    g.add(arm); cones(g, m, -3, -4.5, 5, 1.6); car(g, m, 2.4, 3, 0);
    g.add(pole(m.metal, 2.6, -3.8, 4.8, .12)); g.add(c.sign('red', 1.8, 1, -3.8, 2.4, 4.8, 'STOP'));
  } },
  { id: 'police-speedtrap', hl: 5, hd: 4, make(g, c) {   // cruiser tucked behind a billboard, radar on a tripod, nose to the road
    const { m } = c;
    g.add(pole(m.metal, 3, -.5, -2.2, .2)); g.add(pole(m.metal, 3, -.5, 2.2, .2)); g.add(c.sign('blue', 5, 1.8, -.5, 2.6, 0));
    car(g, m, 2.4, 0, -Math.PI / 2); g.add(pole(m.dark, 1.3, -3, 3.8, .1)); g.add(box(m.dark, .5, .3, .3, -3, 1.3, 3.8));
    cones(g, m, -3.6, -3.8, 3, 1.5);
  } },
  { id: 'police-station', hl: 10, hd: 6, make(g, c) {   // small station house with a blue band, flag pole, rooftop lamp and two cruisers
    const { m } = c;
    g.add(box(c.wall, 7, 3.4, 12, 2.5, 0, 3)); g.add(box(m.roof, 7.6, .3, 12.6, 2.5, 3.4, 3)); g.add(box(m.blue, .1, .7, 12, -1.02, 2.2, 3)); g.add(box(m.glass, .1, 1.3, 5, -1.02, .8, 3)); g.add(box(m.door, .1, 2.1, 1.2, -1.02, 0, 6.8));
    g.add(box(m.blue, .8, .5, .8, 2.5, 3.7, 3));   // roof joint, top at 4.2 — the banner used to float at x=-1, half a metre above the eave
    g.add(c.sign('blue', 4, 1.3, 2.5, 4.18, 3));   // centred on the joint, 2 cm into it so the shared top plane does not flicker
    g.add(pole(m.metal, 8, -3.5, -5, .2));
    (c.flags.length ? c.flags : [[m.red, m.red]]).forEach((pair, i) => g.add(mk(GEO.box, [pair[0], pair[1], pair[0], pair[0], pair[0], pair[0]], .06, 1, 1.6, -3.5, 7.5 - i * 1.15, -5.88)));   // hoist overlaps the pole by 2 cm; a second country hangs below
    car(g, m, -3, -1.5, 0); car(g, m, -3, 3.6, 0, false);
  } },
];
