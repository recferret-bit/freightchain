import { get, post } from './api.js';
import { el, short, when } from './dom.js';
import { diffLines } from './diff.js';

/* HISTORY: every revision of the selected entity, newest first (append-only on the server). A click previews it in the viewer;
   RESTORE makes it the head again (as a new revision), PUBLISH puts it in front of every player (signed with the wallet), DIFF compares it with the head. */
export function mountHistory(st) {
  const list = el('div', { class: 'ed-revs' }), diff = el('pre', { class: 'ed-diff', hidden: true });
  const node = el('div', { class: 'ed-history' }, list, diff);
  let picked = null;
  async function load() {
    list.textContent = ''; diff.hidden = true; if (!st.me || !st.entityId) return;
    let revs = [];
    try { revs = await get(`entities/${encodeURIComponent(st.entityId)}/revisions`); } catch (e) { list.append(el('div', { class: 'ed-dim', text: e.message })); return; }
    if (!revs.length) list.append(el('div', { class: 'ed-dim', text: 'No revisions yet: this entity is still the code\'s seed. Save a draft (SOURCE or CHAT) to start its history.' }));
    for (const r of revs) {
      const row = el('div', { class: 'ed-item' + (r.id === picked ? ' on' : ''), onclick: () => pick(r, row) },
        el('b', { text: `#${r.seq}` }), r.head ? el('span', { class: 'ed-badge ed-head', text: 'HEAD' }) : '', r.published ? el('span', { class: 'ed-badge ed-live', text: 'LIVE' }) : '',
        ' ', (r.prompt ?? r.message ?? '').slice(0, 90), el('div', { class: 'ed-dim', text: `${r.authorWallet === 'seed' ? 'seed' : short(r.authorWallet)} · ${when(r.createdAt)}${r.jobId ? ' · AI' : ''}` }));
      list.append(row);
    }
  }
  async function pick(r, row) {
    picked = r.id; for (const x of list.children) x.classList.remove('on'); row.classList.add('on');
    try {
      const full = await get(`revisions/${r.id}`); st.preview(full.config); st.status(`previewing #${r.seq}`);
      const acts = el('div', { class: 'ed-row' },
        el('button', { class: 'ed-btn', disabled: r.head, onclick: () => post(`entities/${encodeURIComponent(st.entityId)}/restore`, { revisionId: r.id, baseRevisionId: st.head?.row?.headRevisionId ?? null }).then(() => { st.status(`#${r.seq} restored as the head`); return st.loadHead(); }).catch(e => st.status(e.message, true)) }, 'RESTORE'),
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
    for (const d of diffLines(head, rev.source ?? '')) if (d.op !== ' ') diff.append(el('div', { class: d.op === '+' ? 'ed-add' : 'ed-del', text: `${d.op} ${d.line}` }));
    if (!diff.children.length) diff.append(el('div', { class: 'ed-dim', text: 'identical to the head' }));
  }
  st.on(() => load());
  return { node, shown: load };
}
