import { guardBundle } from '../../shared/entity/bundle.js';
import { compileEntity } from '../../shared/entity/plan.js';
import { ENTITIES_BASE } from '../hosts.js';

/* The entity registry: every 3D model the game draws is a data-only config (client/shared/entity/, built by world/entity-build.js).
   loadEntities() fetches the published bundle from the API (GET /api/entities/bundle: the code's seed with every published revision on top) –
   the game, offline play, replays and the viewer all draw what the server publishes. The seed files in client/shared/entity/seed/ are loaded
   by a browser only (a) with ?entities=baked (tools), (b) from file:// (the standalone build), (c) on localhost / an IP when no API answers
   (client/serve.sh) – never on a real domain, where a missing bundle is an error screen. Node (the headless trace, tests) always uses the seed. */

const byId = new Map(); let cache = new Map(), rev = null;
export function setEntities(list, revision = 'local') {
  byId.clear(); cache = new Map(); rev = revision;
  for (const e of list) byId.set(e.id, e);
}
export const entityConfig = id => byId.get(id) ?? null;
export const entityIds = () => [...byId.keys()];
export const entitiesRev = () => rev;
export function program(id) {
  const e = byId.get(id);
  if (!e) throw new Error(rev === null ? `entities not loaded yet (await loadEntities()) – asked for '${id}'` : `unknown entity '${id}'`);
  return compileEntity(e, { lookup: entityConfig, cache });
}
/* replace one entity (the editor's live preview of a revision); the compile cache is dropped because other entities may `use` it */
export function putEntity(e) { byId.set(e.id, e); cache = new Map(); }

const isNode = typeof globalThis.process !== 'undefined' && !!globalThis.process.versions?.node;
const page = typeof location === 'undefined' ? null : location;
const local = h => /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|[\w-]+\.localhost)$/.test(h) || /^\d+(\.\d+){3}$/.test(h);
export const bakedOnly = () => isNode || !page || page.protocol === 'file:' || new URLSearchParams(page.search).get('entities') === 'baked';
const baked = async () => (await import('../../shared/entity/seed/index.js')).default;

async function fetchBundle(tries, fresh = false) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${ENTITIES_BASE}/api/entities/bundle`, { credentials: 'include', headers: { accept: 'application/json' }, cache: fresh ? 'no-cache' : 'default' });   // no-cache = revalidate (ETag): right after a publish
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const b = await r.json();
      if (!Array.isArray(b?.entities) || !b.entities.length) throw new Error('empty bundle');
      return b;
    } catch (e) { last = e; if (i < tries - 1) await new Promise(res => setTimeout(res, 600 * 2 ** i)); }
  }
  throw last;
}
let loading = null;
/* fetch the bundle again (the viewer after a publish, or to drop previews) */
export function reloadEntities() { loading = null; fresh = true; return loadEntities(); }
let fresh = false;
/* resolves to the bundle's rev once every model is known; on a real domain a bundle that cannot be fetched ends in an error screen (a retry button reloads) */
export function loadEntities() {
  return (loading ??= (async () => {
    if (bakedOnly()) { setEntities(await baked(), 'seed'); return rev; }
    try {
      const b = await fetchBundle(local(page.hostname) ? 1 : 4, fresh);
      setEntities(guardBundle(b.entities, await baked()), b.rev);   // a published config the validator refuses falls back to the seed
    }
    catch (e) {
      if (!local(page.hostname)) { modelsUnavailable(e); throw e; }
      console.info(`[entities] no bundle from the API (${e.message}) – drawing the seed models (client/shared/entity/seed/)`);
      setEntities(await baked(), 'seed');
    }
    return rev;
  })());
}
function modelsUnavailable(e) {
  if (typeof document === 'undefined') return;
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;z-index:99;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#111;color:#eee;font:15px ui-monospace,monospace;text-align:center;padding:16px';
  const t = document.createElement('div'); t.textContent = `The 3D models could not be loaded (${e.message}). Check the connection and try again.`;
  const b = document.createElement('button'); b.textContent = 'RETRY'; b.style.cssText = 'font:inherit;padding:8px 18px;cursor:pointer'; b.onclick = () => location.reload();
  d.append(t, b); document.body.append(d);
}
