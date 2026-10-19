import { CFG } from '../../config.js';
import { basic } from './mats.js';
import { prop } from '../../world/entity-build.js';

/* Roadside furniture, data-driven per route (all of it is destructible). The meshes are entities (client/shared/entity/seed/furniture/); spacing, sides and gaps stay here:
   post:  { body, cap }  – delineator posts every 16 m on both sides
   pole:  { color, every } – a pole with a crossbar on the left every `every` chunks (64 m each) (omit = none)
   guard: { color, post? } – continuous guardrail on both sides (4 m segments)
   lamp:  { color, light, every, side, h?, arm? } – street lamp on a mast with an arm over the road, one every `every` chunks (side 1 right / -1 left / 0 alternating); `light` = hex of the bulb + glow.
          `lampAt(ci)` is pure (the night lighting in world/daynight.js asks it for lamp positions without the chunks being built)
   Posts and guardrails leave a gap on the side of a landmark's apron (`lms`: this chunk's building and its neighbours') so trucks can pull in. */
export function createFurniture({ post = null, pole = null, guard = null, lamp = null }) {
  const pm = post && { body: basic(post.body), cap: basic(post.cap) }, pl = pole && basic(pole.color), gm = guard && basic(guard.color), gp = guard && basic(guard.post ?? 0x8a8f96);
  const lampM = lamp && { mast: basic(lamp.color), bulb: basic(lamp.light, { toneMapped: false }) }, LH = lamp?.h ?? 8.4, LA = lamp?.arm ?? 3.6, LP = 7.8;   // LP = mast distance from the road centre
  const side = ci => lamp.side || (ci / lamp.every & 1 ? 1 : -1);
  return {
    lampRgb: lamp && [(lamp.light >> 16 & 255) / 255, (lamp.light >> 8 & 255) / 255, (lamp.light & 255) / 255],
    lampAt: !lamp ? null : ci => ci % lamp.every ? null : { s: ci * CFG.CHUNK_LEN + CFG.CHUNK_LEN / 2, lat: side(ci) * LP, arm: -side(ci) * LA, id: ci + ':lamp' },   // lat = the mast (shifted with the road edge like everything roadside), lat + arm = under the lamp head
    build({ ci, s0, place, reg, destroyed, lms = [] }) {
      const gap = (s, side) => lms.some(lm => side === lm.side && Math.abs(s - lm.s) < lm.hl + 4);   // entrance: apron half-length (+1) + half a 4 m rail segment + margin; neighbours' aprons can spill into this chunk
      if (pm) for (let k = 0; k < 2; k++) for (const side of [-1, 1]) {
        const id = ci + ':p' + k + side; if (destroyed.has(id) || gap(s0 + k * 16, side)) continue;
        const p = prop('post', {}, pm); place(p, s0 + k * 16, side * 6.6); reg(p, id, s0 + k * 16, side * 6.6);
      }
      if (lampM && ci % lamp.every === 0) {
        const id = ci + ':lamp', sd = side(ci);   // mast beside the road, arm reaches over the lane edge
        if (!destroyed.has(id)) {
          const p = prop('lamp', { h: LH, arm: LA, sd, light: lamp.light }, lampM); place(p, s0 + 16, sd * LP); reg(p, id, s0 + 16, sd * LP);
        }
      }
      if (pl && ci % pole.every === 0) {
        const id = ci + ':pole';
        if (!destroyed.has(id)) {
          const p = prop('pole', {}, { m: pl }); place(p, s0 + 8, -11); reg(p, id, s0 + 8, -11);
        }
      }
      if (gm) for (let k = 0; k < 8; k++) for (const side of [-1, 1]) {
        const s = s0 + k * 4 + 2, id = ci + ':g' + k + side; if (destroyed.has(id) || gap(s, side)) continue;
        const g = prop('guard', {}, { rail: gm, post: gp }); place(g, s, side * 6.9); reg(g, id, s, side * 6.9);
      }
    },
  };
}
