import { createGround } from '../_shared/ground.js';

/* Sun-baked sand with faint wind streaks. */
const draw = (g, w, h) => {
  g.fillStyle = '#c9a56e'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2500; i++) { const v = 150 + Math.random() * 70; g.fillStyle = `rgba(${v + 30},${v},${v - 55},.35)`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 2); }
  for (let i = 0; i < 30; i++) { g.strokeStyle = 'rgba(120,85,45,.12)'; g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(w * .3, y + 8, w * .6, y - 8, w, y); g.stroke(); }
};
export const createTerrain = () => createGround({ draw, tile: 12 });
