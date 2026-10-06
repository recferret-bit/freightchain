import { createGround } from '../_shared/ground.js';

/* Red earth with dry spinifex flecks. */
const draw = (g, w, h) => {
  g.fillStyle = '#b4532a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { const v = 120 + Math.random() * 70; g.fillStyle = `rgba(${v + 60},${v - 30},${v - 80},.3)`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 2); }
  for (let i = 0; i < 450; i++) { g.fillStyle = `rgba(172,164,76,${.25 + Math.random() * .35})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 2 + Math.random() * 3); }
  for (let i = 0; i < 18; i++) { g.strokeStyle = 'rgba(90,35,15,.12)'; g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(w * .3, y + 6, w * .6, y - 6, w, y); g.stroke(); }
};
export const createTerrain = () => createGround({ draw, tile: 14 });
