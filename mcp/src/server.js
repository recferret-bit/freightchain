import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from './backend.js';
import { SKILL, FORMAT } from './paths.js';

/* The entity MCP: the 3d-assets skill (.claude/skills/3d-assets) turned into tools over one backend (backend.js).
   Every write goes through check_entity's validator first, and the backend re-validates (the app server does it again on its side). */
const validator = await import(pathToFileURL(join(SKILL, 'validate.mjs')).href);
const read = p => readFileSync(p, 'utf8');
const json = v => ({ content: [{ type: 'text', text: JSON.stringify(v, null, 1) }] });
const fail = (msg, extra = {}) => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg, ...extra }, null, 1) }] });
const ID = z.string().regex(/^[a-z][a-z0-9-]{1,47}$/).describe('entity id: lower-case letters, digits, dashes');
const SPEC_KINDS = new Set(['car', 'tree', 'building']);

/* The skill's spec gate (validate.mjs) on a request sentence. It only judges what it recognises – a car, a tree or a building with counts / parts;
   anything else ("make the cactus arms thicker") is not a spec and passes. verdict: 'ok' | 'rejected' | 'not_a_spec'. */
export function specVerdict(phrase) {
  const r = validator.evaluate(String(phrase).slice(0, 4000));
  if (r.ok) return { verdict: r.skipped ? 'not_a_spec' : 'ok', kind: r.kind, expect: r.expect ?? null };
  if (SPEC_KINDS.has(r.kind) && !(r.errors ?? []).every(e => /unknown kind|ambiguous/i.test(e))) return { verdict: 'rejected', kind: r.kind, errors: r.errors };
  return { verdict: 'not_a_spec', kind: r.kind ?? null };
}

/* Validate a source against the current heads (+ itself): { ok, errors, warnings, summary } */
export async function checkSource(backend, source) {
  let config;
  try { config = core.parseSource(source); } catch (e) { return { ok: false, errors: [e.message], warnings: [] }; }
  const heads = await backend.configs(); heads[config.id] = config;
  const r = core.validateEntity(config, { lookup: id => heads[id] ?? null });
  const lock = core.rosterOf(config.id);
  return { ok: r.ok, id: config.id, kind: config.kind, errors: r.errors, warnings: r.warnings, gameplay: lock ? { placedBy: lock.kind, lock: lock.lock } : 'not placed by the game (viewer only until a roster row and a call site exist)', summary: r.measures && { meshes: r.measures.meshes, glows: r.measures.glows, sizeXYZ: r.measures.size, bounds: r.measures.bounds, tags: r.measures.tags, roles: r.measures.roles, floatingParts: r.measures.floating.length } };
}

const KIND_FILES = { car: 'car.md', tree: 'tree.md', building: 'building.md' };
export function systemPrompt({ entityId = null, kind = null } = {}) {
  const kindDoc = kind === 'vehicle' ? 'car' : kind === 'landmark' ? 'building' : null;
  return [
    'You edit the 3D models of Freight Chain, a browser truck game. Every model is an ENTITY: a data-only JS module (format below) that the game builds with three.js.',
    'You can only act through the tools. Workflow:',
    '1. Read before writing: get_entity for the entity you change (list_entities to find one; for a new entity, get_entity a similar one as a model).',
    '2. If the request states counts or parts of a car, tree or building (wheels, axles, trunks, storeys, roof, walls), call validate_spec with the request first; when it is rejected, stop and explain why.',
    '3. Write the COMPLETE new source and call check_entity. Fix every error and re-check until ok. Read the warnings and the summary (size, tags, floating parts) – they are your eyes.',
    '4. save_draft exactly once with the final source and a short message (what changed). A draft is not live; a person publishes it.',
    '5. Answer in 1–3 short sentences: what you changed, the size before/after if it moved.',
    'A param the game passes (gameplayLock.lock.params) takes its value from the game: to resize, scale the parts\' expressions, never the param\'s default / min / max.',
    'Change only what was asked. Never invent gameplay (collision, sizes in VEHICLES, footprints): those keys are refused. If the request cannot be done in this format, say so instead of saving.',
    entityId ? `The request is about the entity '${entityId}'.` : 'The request may create a new entity: choose a short id that is not taken (list_entities).',
    '', '---', read(FORMAT),
    kindDoc ? `\n---\nRules for a ${kindDoc} (3d-assets skill):\n${read(join(SKILL, 'kinds', KIND_FILES[kindDoc]))}` : '',
  ].join('\n');
}

export function buildServer(backend, { name = 'freightchain-entities' } = {}) {
  const server = new McpServer({ name, version: '1.0.0' }, { instructions: 'Tools to read, check and save Freight Chain 3D entities (data-only configs). Use the prompt entity-editor as the system prompt.' });

  server.registerTool('list_entities', { title: 'List entities', description: 'Every entity: id, kind, label, and its head / published revision numbers.', inputSchema: { kind: z.enum(['vehicle', 'prop', 'furniture', 'landmark', 'gantry', 'part']).optional() }, annotations: { readOnlyHint: true } },
    async ({ kind }) => json((await backend.list()).filter(r => !kind || r.kind === kind).map(r => ({ id: r.id, kind: r.kind, label: r.label, head: r.headSeq, published: r.publishedSeq }))));
  server.registerTool('get_entity', { title: 'Read an entity', description: 'The current (head) source of an entity and what the game locks about it.', inputSchema: { id: ID }, annotations: { readOnlyHint: true } },
    async ({ id }) => { try { const e = await backend.get(id), lock = core.rosterOf(id); return json({ id, kind: e.row.kind, headSeq: e.row.headSeq, publishedSeq: e.row.publishedSeq, gameplayLock: lock ?? null, source: e.source }); } catch (x) { return fail(x.message); } });
  server.registerTool('get_format', { title: 'Entity format', description: 'The full entity format reference (parts, expressions, materials, limits, gameplay rules).', inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => ({ content: [{ type: 'text', text: read(FORMAT) }] }));
  server.registerTool('validate_spec', { title: 'Check a request', description: "The 3d-assets skill's spec gate on the user's sentence: a car / tree / building with an impossible count (a car with 2 wheels) is rejected. Other requests are not specs.", inputSchema: { phrase: z.string().max(4000) }, annotations: { readOnlyHint: true } },
    async ({ phrase }) => json(specVerdict(phrase)));
  server.registerTool('check_entity', { title: 'Validate a source', description: 'Parse and validate a full entity source (shape, expressions, every param at its min and max, the gameplay contract) and measure it: size, tags, roles, floating parts. Call before save_draft.', inputSchema: { source: z.string().max(64 * 1024) }, annotations: { readOnlyHint: true } },
    async ({ source }) => json(await checkSource(backend, source)));
  server.registerTool('diff_entity', { title: 'Diff against the head', description: 'Line diff of a source against the entity\'s current head.', inputSchema: { id: ID, source: z.string().max(64 * 1024) }, annotations: { readOnlyHint: true } },
    async ({ id, source }) => { let head = ''; try { head = (await backend.get(id)).source; } catch { /* new entity */ } const a = head.split('\n'), b = source.split('\n'), sa = new Set(a), sb = new Set(b); return json({ removed: a.filter(l => !sb.has(l)), added: b.filter(l => !sa.has(l)) }); });
  server.registerTool('save_draft', { title: 'Save a draft revision', description: 'Store the source as a new DRAFT revision of the entity (a new id creates the entity). Validated again; nothing is published.', inputSchema: { id: ID, source: z.string().max(64 * 1024), message: z.string().min(1).max(200).describe('what changed, at most 200 characters') }, annotations: { destructiveHint: false, idempotentHint: false } },
    async ({ id, source, message }) => {
      const c = await checkSource(backend, source);
      if (!c.ok) return fail('not saved: the entity is not valid', { errors: c.errors, warnings: c.warnings });
      if (c.id !== id) return fail(`not saved: the source's id is '${c.id}', not '${id}'`);
      try { const r = await backend.save(id, source, message); return json({ saved: true, revisionId: r.id, entityId: r.entityId ?? id, seq: r.seq ?? null, warnings: c.warnings }); }
      catch (x) { return fail(`not saved: ${x.message}`, { errors: x.errors ?? [], warnings: x.warnings ?? [] }); }
    });

  server.registerResource('entity-format', 'entity://format', { title: 'Entity format', mimeType: 'text/markdown' }, async uri => ({ contents: [{ uri: uri.href, text: read(FORMAT) }] }));
  server.registerResource('roster', 'entity://roster', { title: 'Gameplay roster (read-only)', mimeType: 'application/json' }, async uri => ({ contents: [{ uri: uri.href, text: JSON.stringify(core.ROSTER, null, 1) }] }));
  server.registerResource('skill', 'skill://3d-assets/SKILL.md', { title: '3d-assets skill', mimeType: 'text/markdown' }, async uri => ({ contents: [{ uri: uri.href, text: read(join(SKILL, 'SKILL.md')) }] }));
  for (const f of readdirSync(join(SKILL, 'kinds'))) server.registerResource(`kind-${f}`, `skill://3d-assets/kinds/${f}`, { title: `3d-assets: ${f}`, mimeType: 'text/markdown' }, async uri => ({ contents: [{ uri: uri.href, text: read(join(SKILL, 'kinds', f)) }] }));

  server.registerPrompt('entity-editor', { title: 'Entity editor', description: 'System prompt for an AI that edits one entity (or makes a new one) through these tools.', argsSchema: { entityId: z.string().optional(), kind: z.string().optional() } },
    ({ entityId, kind }) => ({ messages: [{ role: 'user', content: { type: 'text', text: systemPrompt({ entityId: entityId || null, kind: kind || null }) } }] }));
  return server;
}
