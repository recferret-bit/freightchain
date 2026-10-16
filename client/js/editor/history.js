import { get, post } from './api.js';
import { el, short, when } from './dom.js';
import { diffLines } from './diff.js';

/* HISTORY: every revision of the selected entity, newest first (append-only on the server). A click previews it in the viewer;
   RESTORE makes it the head again (as a new revision), PUBLISH puts it in front of every player (signed with the wallet), DIFF compares it with the head. */
export function mountHistory(st) {
  const list = el('div', { class: 'ed-revs' }), diff = el('pre', { class: 'ed-diff', hidden: true });
  const node = el('div', { class: 'ed-history' }, list, diff);
  let picked = null, gen = 0;
  async function load() {
    const my = ++gen; diff.hidden = true; if (!st.me || !st.entityId) { list.textContent = ''; return; }
    let revs = [];
    try { revs = await get(`entities/${encodeURIComponent(st.entityId)}/revisions`); } catch (e) { if (my === gen) { list.textContent = ''; list.append(el('div', { class: 'ed-dim', text: e.message })); } return; }
    if (my !== gen) return;   // a newer load (another entity, a publish) answered first
    list.textContent = '';
    if (!revs.length) list.append(el('div', { class: 'ed-dim', text: 'No revisions yet: this entity is still the code\'s seed. Save a draft (SOURCE or CHAT) to start its history.' }));
    for (const r of revs) {
      const row = el('div', { class: 'ed-item' + (r.id === picked ? ' on' : ''), onclick: () => pick(r, row) },
        el('b', { text: `#${r.seq}` }), r.head ? el('span', { class: 'ed-badge ed-b-head', text: 'HEAD' }) : '', r.published ? el('span', { class: 'ed-badge ed-live', text: 'LIVE' }) : '',
        ' ', (r.prompt ?? r.message ?? '').slice(0, 90), el('div', { class: 'ed-dim', text: `${r.authorWallet === 'seed' ? 'seed' : short(r.authorWallet)} · ${when(r.createdAt)}${r.jobId ? ' · AI' : ''}` }));
      list.append(row);
      if (r.id === picked) pick(r, row, false);   // a reload (a publish, the head moving) keeps the picked revision's actions
    }
  }
  async function pick(r, row, preview = true) {
    const id = st.entityId;
    picked = r.id; for (const x of list.children) { x.classList.remove('on'); x.querySelector('.ed-row')?.remove(); } row.classList.add('on');
    try {
      const full = await get(`revisions/${r.id}`);
      if (!row.isConnected || picked !== r.id || st.entityId !== id) return;
      if (preview) { st.preview(full.config); st.status(`previewing #${r.seq}`); }
      row.querySelector('.ed-row')?.remove();
      const acts = el('div', { class: 'ed-row', onclick: e => e.stopPropagation() },
        el('button', { class: 'ed-btn', disabled: r.head, onclick: () => post(`entities/${encodeURIComponent(id)}/restore`, { revisionId: r.id, baseRevisionId: st.head?.row?.headRevisionId ?? null }).then(() => { st.status(`#${r.seq} restored as the head`); return st.loadHead(); }).catch(e => st.status(e.message, true)) }, 'RESTORE'),
        el('button', { class: 'ed-btn ed-pub', disabled: r.published, onclick: () => confirmPublish(r) }, 'PUBLISH'),
        el('button', { class: 'ed-btn', onclick: () => showDiff(full) }, 'DIFF vs HEAD'));
      row.append(acts);
    } catch (e) { st.status(e.message, true); }
  }
  function confirmPublish(r) {
    st.status(`sign in your wallet to publish #${r.seq} of ${st.entityId} – every player will draw it`);
    st.publish(r.id).then(load).catch(e => st.status(e.message, true));
  }
  function showDiff(rev) {
    diff.textContent = ''; diff.hidden = false;
    const head = st.head?.source ?? '';
    const changed = diffLines(head, rev.source ?? '').filter(d => d.op !== ' ');
    for (const d of changed.slice(0, 500)) diff.append(el('div', { class: d.op === '+' ? 'ed-add' : 'ed-del', text: `${d.op} ${d.line}` }));
    if (changed.length > 500) diff.append(el('div', { class: 'ed-dim', text: `${changed.length - 500} more changed lines` }));
    if (!diff.children.length) diff.append(el('div', { class: 'ed-dim', text: 'identical to the head' }));
  }
  st.on(() => load());
  return { node, shown: load };
}
