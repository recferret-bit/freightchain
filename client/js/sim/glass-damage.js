import { st } from '../state.js';
import { CFG } from '../config.js';
import { audio } from './audio.js';

/* Windscreen damage generator: impacts leave a crack star (size ∝ dmg) and scratches; topped up so crack/scratch counts track hull loss. */

const rr = (a, b) => a + Math.random() * (b - a);

function crackAt(x, y, sev) {   // radial spokes with a kink + a side branch, and concentric rings on hard hits
  const segs = [], n = 5 + Math.round(sev * 5), R = 3 + sev * 11;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + rr(0, .5), len = R * rr(.5, 1.2), pts = [[0, 0]]; let px = 0, py = 0, aa = a;
    for (let j = 0; j < 3; j++) {
      aa += rr(-.4, .4); px += Math.cos(aa) * len / 3; py += Math.sin(aa) * len / 3; pts.push([px, py]);
      if (j === 1 && sev > .4 && Math.random() < .6) { const ba = aa + (Math.random() < .5 ? -1 : 1) * rr(.5, 1), bl = len * rr(.2, .4); segs.push([[px, py], [px + Math.cos(ba) * bl, py + Math.sin(ba) * bl]]); }
    }
    segs.push(pts);
  }
  if (sev > .55) for (const k of [.35, .65]) {   // spider-web rings, broken into short arcs
    const r = R * k, a0 = rr(0, 6.28), pts = [];
    for (let j = 0; j <= 7; j++) { const a = a0 + j / 7 * 4.2, w = r * rr(.85, 1.1); pts.push([Math.cos(a) * w, Math.sin(a) * w]); }
    segs.push(pts);
  }
  st.cracks.push({ x, y, sev, segs }); if (st.cracks.length > 14) st.cracks.shift();
}

function scratch() {   // thin slightly curved line, mostly sweeping horizontally like grit dragged by the wipers
  const a = rr(-.5, .5) + (Math.random() < .3 ? 1.4 : 0), len = rr(4, 16), bend = rr(-.4, .4), pts = [[0, 0]];
  for (let j = 1; j <= 4; j++) { const aa = a + bend * j / 4; pts.push([pts[j - 1][0] + Math.cos(aa) * len / 4, pts[j - 1][1] + Math.sin(aa) * len / 4]); }
  st.scratches.push({ x: rr(.08, .92), y: rr(.07, .5), pts, a: rr(.25, .6) }); if (st.scratches.length > 40) st.scratches.shift();
}

export function glassHit(dmg) {
  const sev = Math.min(1, dmg / 12);
  if (dmg >= 2) { audio.play('glass', .5 + sev * .5); crackAt(rr(.2, .8), rr(.08, .48), Math.max(.2, sev)); }
  for (let i = 0, n = 1 + Math.round(sev * 4); i < n; i++) scratch();
  const lost = 100 - st.hull;   // top up so the glass never looks healthier than the hull
  while (st.cracks.length < Math.min(10, Math.floor(lost / CFG.GLASS_CRACK_STEP))) crackAt(rr(.1, .9), rr(.08, .5), rr(.05, .3));
  while (st.scratches.length < Math.min(30, Math.floor(lost / CFG.GLASS_SCRATCH_STEP))) scratch();
}
