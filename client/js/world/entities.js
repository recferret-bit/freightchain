import SEED from '../../shared/entity/seed/index.js';
import { compileEntity } from '../../shared/entity/plan.js';

/* The entity registry: every 3D model the game draws is a data-only config (client/shared/entity/, built by world/entity-build.js).
   setEntities() swaps the whole set (the viewer's live preview, the published bundle); program(id) compiles on first use. */

const byId = new Map(); let cache = new Map(), rev = 'seed';
export function setEntities(list, revision = 'local') {
  byId.clear(); cache = new Map(); rev = revision;
  for (const e of list) byId.set(e.id, e);
}
export const entityConfig = id => byId.get(id) ?? null;
export const entityIds = () => [...byId.keys()];
export const entitiesRev = () => rev;
export function program(id) {
  const e = byId.get(id);
  if (!e) throw new Error(`unknown entity '${id}'`);
  return compileEntity(e, { lookup: entityConfig, cache });
}
/* replace one entity (the editor's preview of a draft); the compile cache is dropped because other entities may `use` it */
export function putEntity(e) { byId.set(e.id, e); cache = new Map(); }

setEntities(SEED, 'seed');
export async function loadEntities() { return rev; }
