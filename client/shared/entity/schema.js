import { IDENT, parseExpr } from './expr.js';
import { compileEntity, toParts, GEOS, ROLES, SIGN_STYLES, GLOBAL_MATS } from './plan.js';
import { measure, boxes, union } from './measure.js';
import { ROSTER, rosterOf, LANDMARK_SLOTS } from './roster.js';
import { VEHICLES } from '../traffic.js';

/* validateEntity(entity, { lookup }) → { ok, errors, warnings, measures }
   1. shape: known keys only, types, limits, no collider / gameplay keys anywhere;
   2. compile: every expression parses and every name resolves (plan.js);
   3. run: at the defaults and at every param's min and max (vehicles at their real VEHICLES size) – every number finite, within the part limits;
   4. roster: a rostered id keeps its kind, the params and slots the game passes, its roles, and stays inside its footprint (landmarks) or size (vehicles). */

export const KINDS = ['prop', 'furniture', 'landmark', 'vehicle', 'gantry', 'part'];
export const ID = /^[a-z][a-z0-9-]{1,47}$/;
const LOCKED_KEYS = new Set(['hp', 'dmg', 'slow', 'rf', 'rl', 'hl', 'hd', 'collider', 'collision', 'size', 'mass']);
const PART_KEYS = {
  geo: ['geo', 's', 'at', 'rot', 'order', 'mat', 'anchor'], glow: ['glow', 'at', 'role'], beam: ['beam'], sign: ['sign', 'at'], disk: ['disk', 'at'], banner: ['banner', 'at'],
  group: ['group', 'at', 'rot', 'order', 'do'], for: ['for', 'in', 'range', 'from', 'step', 'while', 'let', 'do'], use: ['use', 'with', 'slots'], ref: ['ref', 'with', 'slots', 'at', 'rot', 'order'],
};
const COMMON = ['when', 'ifSlot', 'tag', 'note'];
const ORDERS = ['XYZ', 'YXZ', 'ZXY', 'XZY', 'YZX', 'ZYX'];
const TOP_KEYS = ['id', 'kind', 'v', 'label', 'note', 'anchor', 'params', 'slots', 'consts', 'vars', 'debris', 'parts'];

/** a part this far from the origin, or a model this large, is not a roadside mesh – the drive loop would build it for every player */
export const MAX_EXTENT_M = 80;
/** min/max/enum corners plus the all-min and all-max runs. More than this is refused instead of silently skipped. */
export const MAX_CORNERS = 96;

export function validateEntity(entity, { lookup = () => null } = {}) {
  const errors = [], warnings = [], err = (p, m) => errors.push(`${p}: ${m}`), warn = (p, m) => warnings.push(`${p}: ${m}`);
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return { ok: false, errors: ['the file must export an object'], warnings, measures: null };
  shape(entity, err);
  if (errors.length) return { ok: false, errors, warnings, measures: null };
  let prog;
  try { prog = compileEntity(entity, { lookup: id => (id === entity.id ? entity : lookup(id)), cache: new Map() }); } catch (e) { errors.push(e.message); return { ok: false, errors, warnings, measures: null }; }
  const ros = rosterOf(entity.id);
  if (ros && ros.kind !== entity.kind) err('kind', `'${entity.id}' is a ${ros.kind} in the game (roster.js) – its kind cannot change`);
  const runs = cornerArgs(entity), slotsGiven = slotSet(entity);
  if (runs.length > MAX_CORNERS) err('params', `more than ${MAX_CORNERS} corners to check – fewer ranged params or a shorter enum`);
  let measures = null;
  for (const args of runs) {
    let parts;
    try { parts = toParts(prog, args, { slots: slotsGiven }); } catch (e) { err(`params ${JSON.stringify(args)}`, e.message); continue; }
    const m = measure(parts);
    if (!m.finite) err(`params ${JSON.stringify(args)}`, 'a size, position or angle is not a finite number (NaN / Infinity)');
    if (m.meshes && overExtent(m)) err(`params ${JSON.stringify(args)}`, `a part is bigger than ${MAX_EXTENT_M} m or sits more than ${MAX_EXTENT_M} m from the origin`);
    for (const p of parts) if (p.t === 'mesh' && p.s.some(v => v <= 0)) { err(`params ${JSON.stringify(args)}`, `a ${p.tag ?? p.geo} part has a size ≤ 0 (${p.s.join(' × ')})`); break; }
    if (!measures) measures = m;
    coupling(entity, ros, parts, m, args, err, warn);
  }
  if (measures?.floating.length && entity.kind !== 'part') warn('parts', `${measures.floating.length} part(s) float: they touch nothing and do not stand on the ground`);
  return { ok: errors.length === 0, errors, warnings, measures };
}

function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function shape(e, err) {
  for (const k of Object.keys(e)) if (!TOP_KEYS.includes(k)) err(k, LOCKED_KEYS.has(k) ? 'is gameplay – it lives in code (roster.js / VEHICLES / KINDS), never in an entity' : 'unknown key');
  if (typeof e.id !== 'string' || !ID.test(e.id)) err('id', 'lower-case letters, digits and dashes, 2–48 characters, starting with a letter');
  if (!KINDS.includes(e.kind)) err('kind', `one of ${KINDS.join(', ')}`);
  if (e.v !== 1) err('v', 'must be 1');
  if (e.label != null && (typeof e.label !== 'string' || e.label.length > 40)) err('label', 'text of at most 40 characters');
  if (e.note != null && (typeof e.note !== 'string' || e.note.length > 600)) err('note', 'text of at most 600 characters');
  if (e.anchor != null && !['center', 'base'].includes(e.anchor)) err('anchor', "'center' or 'base'");
  if (!Array.isArray(e.parts) || !e.parts.length) err('parts', 'a non-empty list');
  for (const k of ['params', 'slots', 'consts', 'vars']) if (e[k] != null && !isPlain(e[k])) { err(k, 'must be an object'); return; }
  for (const [k, p] of Object.entries(e.params ?? {})) {
    const at = `params.${k}`;
    if (!IDENT.test(k)) err(at, 'bad name');
    if (!isPlain(p)) { err(at, 'must be { default, … }'); continue; }
    for (const q of Object.keys(p)) if (!['type', 'default', 'min', 'max', 'enum', 'maxLen', 'from', 'note'].includes(q)) err(`${at}.${q}`, 'unknown key');
    const t = p.type ?? 'num';
    if (t === 'list') { if (!Array.isArray(p.default) || !p.default.every(Number.isFinite)) err(`${at}.default`, 'a list of numbers'); }
    else if (t === 'bool') { if (typeof p.default !== 'boolean') err(`${at}.default`, 'true or false'); }
    else if (!Number.isFinite(p.default)) err(`${at}.default`, 'a number');
    if (p.min != null && !Number.isFinite(p.min)) err(`${at}.min`, 'a finite number');
    if (p.max != null && !Number.isFinite(p.max)) err(`${at}.max`, 'a finite number');
    if (p.min != null && p.max != null && !(p.min <= p.max)) err(at, 'min must be ≤ max');
    if (p.enum != null && (!Array.isArray(p.enum) || !p.enum.length || p.enum.length > 32 || !p.enum.every(Number.isFinite))) err(`${at}.enum`, 'a list of 1–32 numbers');
  }
  if (Object.keys(e.params ?? {}).length > 32 || Object.keys(e.slots ?? {}).length > 32 || Object.keys(e.consts ?? {}).length > 32 || Object.keys(e.vars ?? {}).length > 32) err('params', 'at most 32 params, slots, consts and vars each');
  for (const [k, s] of Object.entries(e.slots ?? {})) {
    if (!IDENT.test(k)) err(`slots.${k}`, 'bad name');
    if (!isPlain(s)) { err(`slots.${k}`, 'must be an object'); continue; }
    for (const q of Object.keys(s)) if (!['note', 'optional', 'default'].includes(q)) err(`slots.${k}.${q}`, 'unknown key');
  }
  for (const [k, v] of Object.entries(e.consts ?? {})) {
    if (!IDENT.test(k)) err(`consts.${k}`, 'bad name');
    if (!(Number.isFinite(v) || (Array.isArray(v) && v.length <= 32 && v.every(Number.isFinite)))) err(`consts.${k}`, 'a number or a list of numbers');
  }
  for (const [k, v] of Object.entries(e.vars ?? {})) { if (!IDENT.test(k)) err(`vars.${k}`, 'bad name'); expr(v, `vars.${k}`, err); }
  const slotNames = e.kind === 'landmark' ? LANDMARK_SLOTS : Object.keys(e.slots ?? {});
  for (const d of [e.debris ?? []].flat()) if (!slotNames.includes(d)) err('debris', `'${d}' is not a slot`);
  (e.parts ?? []).forEach((p, i) => part(p, `parts[${i}]`, err, e, 0));
}
function expr(v, at, err) {
  if (typeof v === 'number' || typeof v === 'boolean') return;
  if (typeof v !== 'string') return err(at, 'a number or an expression string');
  try { parseExpr(v); } catch (x) { err(at, x.message); }
}
const vec = (v, at, err) => (Array.isArray(v) && v.length === 3 ? v.forEach((x, i) => expr(x, `${at}[${i}]`, err)) : err(at, 'needs [x, y, z]'));
function mat(m, at, err, e) {
  if (Array.isArray(m)) { if (m.length < 1 || m.length > 6) err(at, '1–6 materials'); return m.forEach((x, i) => mat(x, `${at}[${i}]`, err, e)); }
  if (typeof m === 'string') { const ok = e.kind === 'landmark' ? LANDMARK_SLOTS.includes(m) : Object.hasOwn(e.slots ?? {}, m) || (e.kind === 'part' && /^[a-z][a-zA-Z0-9]{0,23}$/.test(m) && !(m in Object.prototype)); if (!ok) err(at, `'${m}' is not a slot of this entity`); return; }
  if (!m || typeof m !== 'object') return err(at, 'a slot name or a material object');
  if ('color' in m) { expr(m.color, `${at}.color`, err); return; }
  if ('global' in m) { if (!GLOBAL_MATS.includes(m.global)) err(`${at}.global`, `one of ${GLOBAL_MATS.join(', ')}`); return; }
  if ('facade' in m) { if (e.kind !== 'landmark') err(at, 'facades are for landmarks'); if (!Array.isArray(m.facade) || m.facade.length !== 2) err(`${at}.facade`, 'needs [columns, rows]'); else m.facade.forEach((x, i) => expr(x, `${at}.facade[${i}]`, err)); return; }
  if ('flag' in m) { if (e.kind !== 'landmark') err(at, 'flags are for landmarks'); expr(m.flag, `${at}.flag`, err); return; }
  if ('if' in m) { expr(m.if, `${at}.if`, err); mat(m.then, `${at}.then`, err, e); mat(m.else, `${at}.else`, err, e); return; }
  err(at, 'unknown material (slot name, { color }, { global }, { facade }, { flag } or { if, then, else })');
}
function part(p, at, err, e, depth) {
  if (depth > 6) return err(at, 'nested deeper than 6');
  if (!p || typeof p !== 'object' || Array.isArray(p)) return err(at, 'a part must be an object');
  const type = Object.keys(PART_KEYS).find(k => k in p);
  if (!type) return err(at, 'unknown part (geo, glow, beam, sign, disk, banner, group, for, use or ref)');
  for (const k of Object.keys(p)) if (!PART_KEYS[type].includes(k) && !COMMON.includes(k)) err(`${at}.${k}`, LOCKED_KEYS.has(k) ? 'is gameplay – it lives in code, never in an entity' : `not allowed on a ${type} part`);
  if (p.when != null) expr(p.when, `${at}.when`, err);
  if (p.tag != null && (typeof p.tag !== 'string' || p.tag.length > 24)) err(`${at}.tag`, 'a short word');
  if (p.ifSlot != null && (typeof p.ifSlot !== 'string' || !/^[a-z][a-zA-Z0-9]{0,23}$/.test(p.ifSlot) || p.ifSlot in Object.prototype)) err(`${at}.ifSlot`, 'a slot name');
  if (p.note != null && (typeof p.note !== 'string' || p.note.length > 200)) err(`${at}.note`, 'text of at most 200 characters');
  if (p.at != null) vec(p.at, `${at}.at`, err);
  if (p.rot != null) vec(p.rot, `${at}.rot`, err);
  if (p.order != null && !ORDERS.includes(p.order)) err(`${at}.order`, `one of ${ORDERS.join(', ')}`);
  if (type === 'geo') { if (!GEOS.includes(p.geo)) err(`${at}.geo`, `one of ${GEOS.join(', ')}`); vec(p.s, `${at}.s`, err); mat(p.mat, `${at}.mat`, err, e); if (p.anchor != null && !['center', 'base'].includes(p.anchor)) err(`${at}.anchor`, "'center' or 'base'"); }
  if (type === 'glow') { for (const k of ['color', 'size', 'gain']) expr(p.glow?.[k], `${at}.glow.${k}`, err); if (p.role != null && !ROLES.includes(p.role)) err(`${at}.role`, `one of ${ROLES.join(', ')}`); }
  if (type === 'beam') for (const k of ['color', 'gain', 'w', 'l', 'z0']) expr(p.beam?.[k], `${at}.beam.${k}`, err);
  if (type === 'sign' || type === 'disk') {
    const g = p[type] ?? {};
    if (!SIGN_STYLES.includes(g.style)) err(`${at}.${type}.style`, `one of ${SIGN_STYLES.join(', ')}`);
    if (e.kind !== 'landmark' && e.kind !== 'part') err(at, 'signs are for landmarks');
    for (const k of type === 'sign' ? ['w', 'h'] : ['r']) expr(g[k], `${at}.${type}.${k}`, err);
    if (g.text != null && (typeof g.text !== 'string' || g.text.length > 32)) err(`${at}.${type}.text`, 'at most 32 characters');
    if (type === 'disk' && typeof g.text !== 'string') err(`${at}.disk.text`, 'needs a text');
  }
  if (type === 'banner') { if (e.kind !== 'gantry') err(at, 'a banner is for the gantry'); for (const k of ['w', 'h']) expr(p.banner?.[k], `${at}.banner.${k}`, err); }
  if (type === 'group') { if (p.group?.role != null && !ROLES.includes(p.group.role)) err(`${at}.group.role`, `one of ${ROLES.join(', ')}`); }
  if (type === 'for') {
    const names = [p.for].flat(); if (!names.length || !names.every(n => typeof n === 'string' && IDENT.test(n))) err(`${at}.for`, 'a name or a list of names');
    if (('range' in p || 'from' in p) && Array.isArray(p.for)) err(`${at}.for`, 'range and from loops take a single variable name');
    const forms = ['in', 'range', 'from'].filter(k => k in p); if (forms.length !== 1) err(at, 'a loop needs exactly one of in, range or from/step/while');
    if ('from' in p) { expr(p.from, `${at}.from`, err); expr(p.step, `${at}.step`, err); expr(p.while, `${at}.while`, err); }
    if ('range' in p) { if (!Array.isArray(p.range) || p.range.length !== 2) err(`${at}.range`, 'needs [from, to)'); else p.range.forEach((x, i) => expr(x, `${at}.range[${i}]`, err)); }
    if (Array.isArray(p.in)) { if (p.in.length > 64) err(`${at}.in`, 'at most 64 rows'); p.in.forEach((r, i) => (Array.isArray(r) ? r.forEach((x, j) => expr(x, `${at}.in[${i}][${j}]`, err)) : expr(r, `${at}.in[${i}]`, err))); }
    else if ('in' in p) expr(p.in, `${at}.in`, err);
    for (const [k, v] of Object.entries(p.let ?? {})) expr(v, `${at}.let.${k}`, err);
  }
  if (type === 'use' || type === 'ref') {
    const id = p[type]; if (typeof id !== 'string' || !ID.test(id)) err(`${at}.${type}`, 'an entity id');
    for (const [k, v] of Object.entries(p.with ?? {})) (Array.isArray(v) ? v.forEach((x, i) => expr(x, `${at}.with.${k}[${i}]`, err)) : expr(v, `${at}.with.${k}`, err));
    for (const [k, m] of Object.entries(p.slots ?? {})) mat(m, `${at}.slots.${k}`, err, e);
  }
  if (Array.isArray(p.do)) p.do.forEach((q, i) => part(q, `${at}.do[${i}]`, err, e, depth + 1));
  else if (type === 'group' || type === 'for') err(`${at}.do`, 'a list of parts');
}

/* defaults, each ranged param at its own min and max, then EVERY ranged param at min together and at max together.
   One axis at a time misses `1 / (h + s - 12)` when each max is safe alone. Vehicles stay at their real size. */
function cornerArgs(e) {
  const base = {};
  const def = e.kind === 'vehicle' ? VEHICLES[e.id] : null;
  if (def) Object.assign(base, { len: def.len, w: def.w, h: def.h });
  const runs = [base], hi = { ...base }, lo = { ...base };
  let span = false;
  for (const [k, p] of Object.entries(e.params ?? {})) {
    if (def && ['len', 'w', 'h'].includes(k)) continue;
    if (p.enum) for (const v of p.enum) runs.push({ ...base, [k]: v });
    else {
      if (p.min != null) { runs.push({ ...base, [k]: p.min }); lo[k] = p.min; span = true; }
      if (p.max != null) { runs.push({ ...base, [k]: p.max }); hi[k] = p.max; span = true; }
    }
    if ((p.type ?? 'num') === 'bool') runs.push({ ...base, [k]: !p.default });
  }
  if (span) runs.push(lo, hi);
  return runs;
}
function overExtent(m) {
  return m.size.some(v => !(v >= 0) || v > MAX_EXTENT_M) || m.bounds.some(v => !(Math.abs(v) <= MAX_EXTENT_M));
}
function slotSet(e) {
  if (e.kind === 'landmark') return Object.fromEntries(LANDMARK_SLOTS.map(s => [s, 1]));
  const s = {}; for (const [k, v] of Object.entries(e.slots ?? {})) if (!v?.optional) s[k] = 1;
  return s;
}

function coupling(e, ros, parts, m, args, err, warn) {
  const at = `params ${JSON.stringify(args)}`;
  if (!ros) return;
  const lock = ros.lock;
  if (ros.kind === 'prop' || ros.kind === 'furniture') {
    for (const p of lock.params) if (!Object.hasOwn(e.params ?? {}, p)) err('params', `the game passes '${p}' – keep that param`);
    for (const s of lock.slots) if (!Object.hasOwn(e.slots ?? {}, s)) err('slots', `the game passes the material '${s}' – keep that slot`);
    for (const r of lock.roles ?? []) if (!m.roles.includes(r)) err(at, `needs a part with role '${r}'`);
    if (lock.kind === 'tree' && (m.tags.trunk ?? 0) !== 1) err(at, `a tree has exactly one part tagged 'trunk' (found ${m.tags.trunk ?? 0})`);
  }
  if (ros.kind === 'vehicle') {
    const def = VEHICLES[e.id], need = lock.roles;
    for (const r of need) if (!m.roles.includes(r)) err(at, `the traffic AI needs a group with role '${r}'`);
    for (const r of m.roles) if (r.startsWith('flash') && !need.includes(r)) err(at, `only police, medic and fire have a siren ('${r}') – the ride recording stores it`);
    const tyres = m.tags.tyre ?? 0, want = e.id === 'freighter' ? 6 : 4;
    if (tyres !== want) err(at, `a ${def.name} has ${want} tyres (parts tagged 'tyre'; found ${tyres})`);
    const body = union(boxes(parts).filter(b => !['tyre', 'rim', 'hub'].includes(b.part.tag) && b.part.t === 'mesh'));
    const halfW = def.w / 2 + .1, halfL = def.len / 2 + .1;
    if (body[0] < -halfW || body[3] > halfW || body[2] < -halfL || body[5] > halfL || body[4] > def.h + .1) err(at, `the body leaves the ${def.len} × ${def.w} × ${def.h} m box traffic collides with (VEHICLES) by more than 10 cm`);
  }
  if (ros.kind === 'landmark') {
    const { hl, hd } = lock, b = m.bounds;
    if (b[0] < -hd - 3 || b[3] > hd + 3 || b[2] < -hl - 3 || b[5] > hl + 3) warn(at, `parts reach more than 3 m outside the ${hl * 2} × ${hd * 2} m footprint the truck collides with (roster.js) – it would drive through them`);
  }
}

export { ROSTER };
