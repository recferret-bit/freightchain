import { validateEntity } from './schema.js';

/* A published bundle is someone else's data (an editor, or an earlier model run). One bad config must not throw out of the
   drive loop: that id falls back to the code's seed, and a seed the bundle omitted is put back. */
export function guardBundle(list, seed) {
  const seedBy = new Map(seed.map((e) => [e.id, e]));
  const byId = new Map(seedBy);
  const candidates = [], seen = new Set();
  for (const e of list) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || seen.has(e.id)) continue;
    seen.add(e.id);
    byId.set(e.id, e);
    candidates.push(e);
  }
  const lookup = (id) => byId.get(id) ?? null;
  const check = (e) => {
    let ok = false;
    try { ok = validateEntity(e, { lookup }).ok; } catch { ok = false; }
    if (!ok) {
      const fb = seedBy.get(e.id);
      if (fb) byId.set(e.id, fb); else byId.delete(e.id);
    }
  };
  for (const e of candidates) if (e.kind === 'part') check(e);
  for (const e of candidates) if (e.kind !== 'part') check(e);
  const out = [];
  for (const e of candidates) { const u = byId.get(e.id); if (u) out.push(u); }
  for (const e of seed) if (!seen.has(e.id)) out.push(e);
  return out;
}
