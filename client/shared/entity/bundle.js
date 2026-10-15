import { validateEntity } from './schema.js';

/* A published bundle is someone else's data (an editor, or an earlier model run). One bad config must not throw out of the
   drive loop: that id falls back to the code's seed, and a seed the bundle omitted is put back. */
export function guardBundle(list, seed) {
  const seedBy = new Map(seed.map((e) => [e.id, e]));
  const known = [...list, ...seed];
  const lookup = (id) => known.find((e) => e && e.id === id) ?? null;
  const out = [];
  const seen = new Set();
  for (const e of list) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || seen.has(e.id)) continue;
    seen.add(e.id);
    let ok = false;
    try { ok = validateEntity(e, { lookup }).ok; } catch { ok = false; }
    const use = ok ? e : seedBy.get(e.id);
    if (use) out.push(use);
  }
  for (const e of seed) if (!seen.has(e.id)) out.push(e);
  return out;
}
