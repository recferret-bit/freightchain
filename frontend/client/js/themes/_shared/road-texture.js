import * as THREE from 'three';
import { canvasTex } from '../../world/scene.js';
import { rnd } from '../../util.js';
import { trackMat } from './mats.js';

/* Depth order (polygon offsets, so 3 cm of real height still wins at 500 m, where the depth buffer steps are ~5 cm): ground 0 < surface -2 < landmark apron and junction pad -3 < marks -4 < hole decals -5…. The apron sits over the shoulder so the grass strip does not show between the asphalt and the lot. */
/* A route's road look. The road is built from strips of variable width (world/roadmesh.js), so the markings are NOT painted into the surface any more:
   surface: shoulder | asphalt | shoulder across u (0 .. .125 | .125 .. .875 | .875 .. 1; the asphalt stretches with the lane count), repeats every 9 m along the road.
   pad:     the same surface for junction aprons (drawn on top of the road strips: polygon offset).
   marks:   an atlas of line columns (MARK), alpha-tested; a marking quad samples one column's centre, the dashes repeat every 9 m (3 m painted).
   shoulder/asphalt/edge: CSS colours (edge: null = no edge lines). speck: base grey of the asphalt grain. shoulderSpeck: optional [r,g,b] for gravel/grass grain.
   centre: { color, style: 'dash' | 'solid' | 'double' } or null. */
export const MARK = { edge: 0, solid: 1, dash: 2, lane: 3, stop: 4 }, MARK_COLS = 8;
export function roadMaterial({ shoulder, asphalt, speck = 40, edge = '#e8e4d6', centre = { color: '#e9b920', style: 'dash' }, shoulderSpeck = null }) {
  const tex = canvasTex(256, 256, (g, w, h) => {
    const a0 = w * .125, a1 = w * .875, aw = a1 - a0;
    g.fillStyle = shoulder; g.fillRect(0, 0, w, h);
    if (shoulderSpeck) for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${shoulderSpeck},${.15 + Math.random() * .25})`; g.fillRect(Math.random() < .5 ? Math.random() * a0 : a1 + Math.random() * (w - a1), Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 2); }
    for (let i = 0; i < 360; i++) {   // shoulder coarse aggregate & edge grading (deterministic rnd keeps headless trace stable)
      const sd = rnd(i * 3.1) < .5, x = sd ? a0 - 1 - rnd(i * 5.7) * (a0 * .85) : a1 + 1 + rnd(i * 5.7) * ((w - a1) * .85), y = rnd(i * 7.3) * h;
      g.fillStyle = `rgba(0,0,0,${.08 + rnd(i * 2.9) * .12})`; g.fillRect(x, y, 1 + rnd(i * 4.1) * 2.5, 1 + rnd(i * 6.3) * 2);
    }
    g.fillStyle = asphalt; g.fillRect(a0, 0, aw, h);
    // truck wheel-rut polish bands (two per lane direction) + crown paving joint
    for (const u of [.19, .34, .66, .81]) {
      const rx = a0 + aw * u - aw * .045, rw = aw * .09;
      g.fillStyle = 'rgba(0,0,0,.11)'; g.fillRect(rx, 0, rw, h);
      g.fillStyle = 'rgba(255,255,255,.025)'; g.fillRect(rx + rw * .25, 0, rw * .5, h);
    }
    g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(w * .5 - 1, 0, 2, h);   // longitudinal paving joint
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(a0, 0, 2, h); g.fillRect(a1 - 2, 0, 2, h);   // crisp asphalt drop-off lip
    for (let i = 0; i < 3500; i++) { const v = speck + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v - 4},.45)`; g.fillRect(a0 + Math.random() * aw, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
    for (let i = 0; i < 14; i++) {   // tar-sealed micro-cracks (wrapping cleanly inside tile)
      const y0 = (i + .5) / 14 * h, x0 = a0 + 8 + rnd(i * 11.3) * (aw - 42), len = 12 + rnd(i * 17.1) * 26;
      g.strokeStyle = 'rgba(12,12,14,.22)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x0, y0);
      g.lineTo(x0 + len * .5, y0 + (rnd(i * 19.7) - .5) * 5); g.lineTo(x0 + len, y0 + (rnd(i * 23.3) - .5) * 5); g.stroke();
    }
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  const cc = centre?.color ?? '#f2f2ee', ec = edge ?? '#f2f2ee';
  const marksTex = canvasTex(MARK_COLS * 16, 64, (g, _, h) => {
    const col = (i, color, dash) => {
      const hh = dash ? h / 3 : h, x0 = i * 16 + 3;
      g.fillStyle = color; g.fillRect(x0, 0, 10, hh);
      for (let k = 0; k < 28; k++) {   // subtle thermoplastic bead & wear grain inside the 10 px stripe
        g.fillStyle = k & 1 ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.10)';
        g.fillRect(x0 + 1 + rnd(i * 31 + k * 7) * 7, rnd(i * 19 + k * 11) * (hh - 2), 1.2, 1.5);
      }
    };
    col(MARK.edge, ec); col(MARK.solid, cc); col(MARK.dash, cc, true); col(MARK.lane, ec, true); col(MARK.stop, '#f4f4f0');
  });
  marksTex.wrapS = THREE.ClampToEdgeWrapping; marksTex.generateMipmaps = false; marksTex.minFilter = THREE.LinearFilter;
  return {
    surface: trackMat(new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
    pad: trackMat(new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })),
    marks: trackMat(new THREE.MeshBasicMaterial({ map: marksTex, alphaTest: .5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })),
    edge: !!edge, centre: centre?.style ?? null,
  };
}
