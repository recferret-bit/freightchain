import * as THREE from 'three';
import { canvasTex } from '../../world/scene.js';
import { trackMat } from './mats.js';

/* A route's road look. The road is built from strips of variable width (world/roadmesh.js), so the markings are NOT painted into the surface any more:
   surface: shoulder | asphalt | shoulder across u (0 .. .125 | .125 .. .875 | .875 .. 1; the asphalt stretches with the lane count), repeats every 9 m along the road.
   pad:     the same surface for junction aprons (drawn on top of the road strips: polygon offset).
   marks:   an atlas of line columns (MARK), alpha-tested; a marking quad samples one column's centre, the dashes repeat every 9 m (3 m painted).
   shoulder/asphalt/edge: CSS colours (edge: null = no edge lines). speck: base grey of the asphalt grain. shoulderSpeck: optional [r,g,b] for gravel/grass grain.
   centre: { color, style: 'dash' | 'solid' | 'double' } or null. */
export const MARK = { edge: 0, solid: 1, dash: 2, lane: 3, stop: 4 }, MARK_COLS = 8;
export function roadMaterial({ shoulder, asphalt, speck = 40, edge = '#e8e4d6', centre = { color: '#e9b920', style: 'dash' }, shoulderSpeck = null }) {
  const tex = canvasTex(256, 256, (g, w, h) => {
    const a0 = w * .125, a1 = w * .875;
    g.fillStyle = shoulder; g.fillRect(0, 0, w, h);
    if (shoulderSpeck) for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${shoulderSpeck},${.15 + Math.random() * .25})`; g.fillRect(Math.random() < .5 ? Math.random() * a0 : a1 + Math.random() * (w - a1), Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 2); }
    g.fillStyle = asphalt; g.fillRect(a0, 0, a1 - a0, h);
    for (let i = 0; i < 3500; i++) { const v = speck + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v - 4},.45)`; g.fillRect(a0 + Math.random() * (a1 - a0), Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  const cc = centre?.color ?? '#f2f2ee', ec = edge ?? '#f2f2ee';
  const marksTex = canvasTex(MARK_COLS * 16, 64, (g, _, h) => {
    const col = (i, color, dash) => { g.fillStyle = color; g.fillRect(i * 16 + 3, 0, 10, dash ? h / 3 : h); };
    col(MARK.edge, ec); col(MARK.solid, cc); col(MARK.dash, cc, true); col(MARK.lane, ec, true); col(MARK.stop, '#f4f4f0');
  });
  marksTex.wrapS = THREE.ClampToEdgeWrapping; marksTex.generateMipmaps = false; marksTex.minFilter = THREE.LinearFilter;
  return {
    surface: trackMat(new THREE.MeshBasicMaterial({ map: tex })),
    pad: trackMat(new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })),
    marks: trackMat(new THREE.MeshBasicMaterial({ map: marksTex, alphaTest: .5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
    edge: !!edge, centre: centre?.style ?? null,
  };
}
