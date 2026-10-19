import { createGround } from '../_shared/ground.js';

/* Pale salt crust with cracked polygons and rusty specks. */
const draw = (g, w, h) => {
  g.fillStyle = '#ddd3c4'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2000; i++) { const v = 170 + Math.random() * 60; g.fillStyle = `rgba(${v + 20},${v + 5},${v - 20},.3)`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3); }
  g.strokeStyle = 'rgba(140,120,100,.32)'; g.lineWidth = 1;
  for (let i = 0; i < 40; i++) { const x = Math.random() * w, y = Math.random() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - .5) * 60, y + (Math.random() - .5) * 60); g.lineTo(x + (Math.random() - .5) * 90, y + (Math.random() - .5) * 90); g.stroke(); }
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(150,90,60,${.2 + Math.random() * .3})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
};
export const createTerrain = () => createGround({ draw, tile: 16 });
