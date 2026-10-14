import { post } from './api.js';
import { el } from './dom.js';
import { parseSource } from '../../shared/entity/source.js';
import { validateEntity } from '../../shared/entity/schema.js';
import { entityConfig } from '../world/entities.js';

/* SOURCE: the entity's file as text (a data-only `export default { … }` – client/shared/entity/). CHECK runs the same validator the server
   runs, PREVIEW shows it in the viewer without saving, SAVE stores it as a draft revision on top of the head. NEW starts another entity. */
const TEMPLATE = id => `export default {
  id: '${id}', kind: 'part', v: 1, label: '${id}',
  note: 'what it is',
  params: { h: { default: 2, min: 1, max: 4, note: 'height, m' } },
  slots: { m: { note: 'main material' } },
  parts: [
    { geo: 'box', tag: 'body', mat: 'm', s: [1, 'h', 1], at: [0, 'h / 2', 0] },
  ],
};
`;
export function mountSource(st) {
  const newId = el('input', { class: 'ed-in ed-newid', placeholder: 'new-id', maxlength: 48 });
  newId.addEventListener('keydown', e => e.stopPropagation());
  const text = el('textarea', { class: 'ed-src', spellcheck: 'false' }), out = el('div', { class: 'ed-out' }), message = el('input', { class: 'ed-in', placeholder: 'what changed (for the history)', maxlength: 200 });
  text.addEventListener('keydown', e => e.stopPropagation());
  message.addEventListener('keydown', e => e.stopPropagation());
  const report = (errors, warnings = []) => { out.textContent = ''; for (const x of errors) out.append(el('div', { class: 'ed-err', text: x })); for (const x of warnings) out.append(el('div', { class: 'ed-warn', text: x })); };
  function check() {
    try { const cfg = parseSource(text.value), r = validateEntity(cfg, { lookup: entityConfig }); report(r.errors, r.warnings); if (r.ok && !r.warnings.length) out.append(el('div', { class: 'ed-okl', text: `valid · ${r.measures?.meshes ?? 0} meshes · ${r.measures?.size?.join(' × ')} m` })); return r.ok ? cfg : null; }
    catch (e) { report([e.message]); return null; }
  }
  const node = el('div', { class: 'ed-source' }, text, out, message,
    el('div', { class: 'ed-row' },
      el('button', { class: 'ed-btn', onclick: check }, 'CHECK'),
      el('button', { class: 'ed-btn', onclick: () => { const c = check(); if (c) st.preview(c); } }, 'PREVIEW'),
      el('button', { class: 'ed-btn', onclick: () => save() }, 'SAVE DRAFT'),
      newId, el('button', { class: 'ed-btn ed-dim', onclick: () => { const id = newId.value.trim(); if (/^[a-z][a-z0-9-]{1,47}$/.test(id)) { text.value = TEMPLATE(id); report([]); } else report(['a new id: lower-case letters, digits and dashes, starting with a letter']); } }, 'NEW')));
  async function save() {
    const cfg = check(); if (!cfg) return;
    const same = cfg.id === st.entityId;
    try {
      const r = await post(`entities/${encodeURIComponent(cfg.id)}/drafts`, { source: text.value, message: message.value.trim() || 'hand edit', baseRevisionId: same ? st.head?.row?.headRevisionId ?? null : null });
      st.status(`saved ${cfg.id} #${r.seq} (a draft – publish it from HISTORY)`); message.value = ''; st.preview(cfg); st.entityId = cfg.id; await st.loadHead();
    } catch (e) { report([e.message, ...e.errors], e.warnings); }
  }
  const fill = () => { if (st.head?.source && document.activeElement !== text) text.value = st.head.source; };
  st.on(fill);
  return { node, shown: fill };
}
