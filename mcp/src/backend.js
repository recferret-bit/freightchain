import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO, SEED } from './paths.js';

const core = await import(pathToFileURL(join(REPO, 'client', 'shared', 'entity', 'index.js')).href);
const KINDS_DIR = { vehicle: 'vehicle', prop: 'prop', furniture: 'furniture', landmark: 'landmark', gantry: 'gantry', part: 'part' };
const ID = /^[a-z][a-z0-9-]{1,47}$/;

/* Where entities live. Both answer the same calls:
     list() → rows · get(id) → { row, source, config } · configs() → { id: config } (heads) · save(id, source, message) → revision
   HttpBackend: the app's editor API for one job (docs/editor-api.md, /api/editor/mcp/*, the job's capability token) – the editor bridge.
   FileBackend: the repo's seed files (client/shared/entity/seed/) – Claude Code over stdio, edits land in git like any other change. */
export class HttpBackend {
  constructor(appUrl, jobToken) { this.url = appUrl.replace(/\/$/, ''); this.token = jobToken; }
  async call(path, { method = 'GET', body } = {}) {
    if (!this.token) throw new Error('no job token: this MCP only works inside an editor job');
    const r = await fetch(`${this.url}/api/editor/mcp/${path}`, { method, headers: { 'x-fc-job': this.token, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { detail: text }; }
    if (!r.ok) { const e = new Error(data?.detail ?? `HTTP ${r.status}`); e.errors = data?.errors ?? []; e.warnings = data?.warnings ?? []; e.status = r.status; throw e; }
    return data;
  }
  list() { return this.call('entities'); }
  get(id) { return this.call(`entities/${encodeURIComponent(id)}`); }
  configs() { return this.call('configs'); }
  save(id, source, message) { return this.call(`entities/${encodeURIComponent(id)}/drafts`, { method: 'POST', body: { source, message } }); }
}

export class FileBackend {
  /** save_draft overwrites the seed file in place (the HTTP backend appends a revision) */
  overwrites = true;
  constructor(seedDir = SEED) { this.dir = seedDir; }
  files() { const out = []; for (const k of Object.values(KINDS_DIR)) for (const f of readdirSync(join(this.dir, k))) if (f.endsWith('.js')) out.push({ kind: k, id: f.slice(0, -3), path: join(this.dir, k, f) }); return out; }
  async list() { return this.files().map(f => { const c = core.parseSource(readFileSync(f.path, 'utf8')); return { id: f.id, kind: c.kind, label: c.label ?? null, source: 'seed', headRevisionId: null, publishedRevisionId: null, headSeq: null, publishedSeq: null, updatedAt: null }; }); }
  async get(id) {
    const f = this.files().find(x => x.id === id); if (!f) { const e = new Error(`no entity '${id}'`); e.status = 404; throw e; }
    const source = readFileSync(f.path, 'utf8'), config = core.parseSource(source);
    return { row: { id, kind: config.kind, label: config.label ?? null, source: 'seed', headRevisionId: null, publishedRevisionId: null, headSeq: null, publishedSeq: null, updatedAt: null }, source, config };
  }
  async configs() { const o = {}; for (const f of this.files()) o[f.id] = core.parseSource(readFileSync(f.path, 'utf8')); return o; }
  async save(id, source, message) {
    if (!ID.test(id)) throw new Error('bad id');
    const config = core.parseSource(source); if (config.id !== id) throw new Error(`the source's id is '${config.id}', not '${id}'`);
    const others = new Map(Object.entries(await this.configs()));
    const v = core.validateEntity(config, { lookup: x => (x === id ? config : others.get(x) ?? null) }); if (!v.ok) { const e = new Error('the entity is not valid'); e.errors = v.errors; e.warnings = v.warnings; throw e; }
    const old = this.files().find(x => x.id === id);
    if (old && old.kind !== config.kind) throw new Error(`'${id}' is a ${old.kind}; its kind cannot change`);
    const path = join(this.dir, KINDS_DIR[config.kind], `${id}.js`), fresh = !existsSync(path);
    writeFileSync(path, source.endsWith('\n') ? source : source + '\n');
    if (fresh && this.dir === SEED) execFileSync(process.execPath, [join(REPO, 'client', 'tools', 'entity-seed-index.mjs')], { stdio: 'ignore' });   // the repo's own seed list
    return { id: `file:${id}`, entityId: id, seq: null, message, path };
  }
}
export { core };
