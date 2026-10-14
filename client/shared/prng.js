/* Shared deterministic PRNG and numeric helpers used identically by the browser game (client/) and backend verification engine (server/). */

/** Sin hash used to place road holes and fork bulge sides (V8 in Chrome and Node compute Math.sin identically). */
export function rnd(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Seeded 32-bit PRNG (mulberry32) used for road layout and traffic streams. */
export function mulberry32(a) {
  let s = a | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const approach = (v, t, r, dt) => (v < t ? Math.min(t, v + r * dt) : Math.max(t, v - r * dt));
