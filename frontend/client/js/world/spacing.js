/* Roadside objects keep their distance: no prop (rock, cactus, tree…) may stand inside a warning sign, a guardrail or a building, and no two things may be closer than GAP.
   A LEAF module (no three.js) so the rule is unit-tested directly (test/spacing.test.mjs) and the headless test can re-check what chunks.js really laid out.
   Footprints are boxes in road coordinates: s along the road, l across it, half-sizes rf (along) / rl (across) = the collider's r, or its rf / rl for long things.
   rank = who wins: buildings first, then furniture (posts, poles, lamps, guardrails: laid out on a fixed grid), then the hole-warning signs, then ordinary scenery.
   chunks.js places in that order, so a lower-ranked object that does not fit is the one that is dropped. */
export const GAP = 1.2;   // m of clear ground between two footprints
export const RANK = { building: 0, post: 1, pole: 1, lamp: 1, gantry: 1, guard: 1, sign: 2, cactus: 3, bush: 3, rock: 3, tree: 3, termite: 3, drift: 3 };
/* furniture and buildings are spaced by their own grids, and a warning sign is designed to stand beyond the posts / rails (holes.js SIGN_LAT): not checked against each other */
const exempt = (a, b) => (a.rank <= 1 && b.rank <= 1) || (a.rank + b.rank === 3 && Math.min(a.rank, b.rank) === 1);
/** do two footprints { s, l, rf, rl, rank } overlap or come closer than `gap`? */
export const overlap = (a, b, gap = GAP) => !exempt(a, b) && Math.abs(a.s - b.s) < a.rf + b.rf + gap && Math.abs(a.l - b.l) < a.rl + b.rl + gap;
/** footprint of a placed object: kind + KINDS row `d` (props.js) at road position (s, l) */
export const footprintOf = (kind, d, s, l) => ({ kind, rank: RANK[kind], s, l, rf: d.rf ?? d.r, rl: d.rl ?? d.r });
/** ordinary scenery is kept inside its own chunk [s0, s0 + len) with room for GAP on each side, so two chunks built independently (in any order, a replay seeking
    around) can never put objects into each other; returns the s to use */
export const insideChunk = (s, rf, s0, len, gap = GAP) => { const m = gap + .3 + rf; return 2 * m >= len ? s0 + len / 2 : Math.min(Math.max(s, s0 + m), s0 + len - m); };
/** an occupancy list for one chunk: fits(f) / claim(f) */
export function occupancy() {
  const items = [];
  return { items, fits: f => f.rank === undefined || !items.some(o => overlap(f, o)), claim(f) { if (f.rank !== undefined && items.some(o => overlap(f, o))) return false; items.push(f); return true; } };
}
