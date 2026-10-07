import { createGround } from '../_shared/ground.js';

/* Alpine meadow: mown stripes and a scatter of wildflowers. */
const draw = (g, w, h) => {
  g.fillStyle = '#5d9a42'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 32) { g.fillStyle = 'rgba(255,255,255,.045)'; g.fillRect(x, 0, 16, h); }
  for (let i = 0; i < 2400; i++) { const v = 60 + Math.random() * 60; g.fillStyle = `rgba(${v - 20},${v + 70},${v - 30},.3)`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3); }
  for (let i = 0; i < 90; i++) { g.fillStyle = Math.random() < .5 ? 'rgba(245,225,90,.8)' : 'rgba(245,245,245,.8)'; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
};
export const createTerrain = () => createGround({ draw, tile: 10 });
