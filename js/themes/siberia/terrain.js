import { createGround } from '../_shared/ground.js';

/* Snow with grey drifts and the odd dark twig. */
const draw = (g, w, h) => {
  g.fillStyle = '#e8eef3'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2200; i++) { const v = 205 + Math.random() * 40; g.fillStyle = `rgba(${v - 30},${v - 15},${v},.28)`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 2); }
  for (let i = 0; i < 130; i++) { g.fillStyle = `rgba(70,62,55,${.25 + Math.random() * .3})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
  for (let i = 0; i < 24; i++) { g.strokeStyle = 'rgba(160,178,196,.18)'; g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(w * .3, y + 10, w * .6, y - 10, w, y); g.stroke(); }
};
export const createTerrain = () => createGround({ draw, tile: 14 });
