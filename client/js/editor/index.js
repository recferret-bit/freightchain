import { get, post } from './api.js';
import { connect, sign } from './wallet.js';
import { mountChat } from './chat.js';
import { mountHistory } from './history.js';
import { mountSource } from './source.js';
import { el, short } from './dom.js';

/* The model EDITOR inside the viewer (storybook): anyone may look; a wallet in the server's EDITOR_WALLETS signs in and gets
   CHAT (ask the AI to create / change an entity – the server's bridge runs it through the MCP), SOURCE (edit the entity file by hand) and
   HISTORY (every revision of the selected entity: preview it in place, diff it, restore it, publish it with a signature). Nothing here changes
   what players see except PUBLISH. Server texts and AI texts are untrusted: written with textContent only. */

export function mountEditor(viewer) {
  const st = { me: null, viewer, entityId: null, head: null, listeners: new Set() };
  const emit = () => { for (const f of st.listeners) f(st); };
  st.on = f => st.listeners.add(f);
  /* the selected entity's head (DB head or the seed) – every tab bases its writes on head.row.headRevisionId */
  st.loadHead = async () => {
    if (!st.me || !st.entityId) return;
    try { st.head = await get(`entities/${encodeURIComponent(st.entityId)}`); } catch (e) { st.head = null; if (e.status !== 404) status(e.message, true); }
    emit();
  };
  st.preview = config => { try { viewer.preview(config); } catch (e) { status(`preview failed: ${e.message}`, true); } };
  st.publish = async revisionId => {
    const { message } = await post(`entities/${encodeURIComponent(st.entityId)}/publish/challenge`, { revisionId });
    const signature = await sign(message);
    const r = await post(`entities/${encodeURIComponent(st.entityId)}/publish`, { revisionId, signature });
    await viewer.reload(); await st.loadHead(); status(`published – bundle ${r.rev}`);
  };

  const toggle = el('button', { id: 'ed-toggle', class: 'ed-btn', title: 'model editor', onclick: () => setOpen(!document.body.classList.contains('editing')) }, '✎ EDIT');
  document.getElementById('side')?.querySelector('h1')?.append(toggle);
  const who = el('span', { class: 'ed-who' }), msg = el('div', { class: 'ed-msg' });
  const status = (t, bad = false) => { msg.textContent = t; msg.classList.toggle('bad', bad); };
  st.status = status;
  const signin = el('div', { class: 'ed-signin' },
    el('p', { text: 'Connect a wallet that is on the editor list to create and change models. Everyone else can look around.' }),
    el('button', { class: 'ed-btn', onclick: () => signIn().catch(e => status(e.status === 404 ? 'this wallet is not on the editor list' : e.message, true)) }, 'CONNECT WALLET'));
  const tabs = el('div', { class: 'ed-tabs' }), body = el('div', { class: 'ed-body' }), entity = el('div', { class: 'ed-entity' });
  const panel = el('div', { id: 'editor' },
    el('div', { class: 'ed-head' }, el('b', { text: 'EDITOR' }), who, el('button', { class: 'ed-x', title: 'close', onclick: () => setOpen(false) }, '×')),
    signin, entity, tabs, body, msg);
  document.body.append(panel);

  const views = { CHAT: mountChat(st), SOURCE: mountSource(st), HISTORY: mountHistory(st) };
  let tab = 'CHAT';
  const showTab = t => { tab = t; for (const b of tabs.children) b.classList.toggle('on', b.dataset.t === t); body.textContent = ''; body.append(views[t].node); views[t].shown?.(); };
  for (const t of Object.keys(views)) tabs.append(el('button', { class: 'ed-tab', 'data-t': t, onclick: () => showTab(t) }, t));

  function setOpen(open) { document.body.classList.toggle('editing', open); if (open && !st.me) refreshMe(); }
  function paintAuth() {
    signin.hidden = !!st.me; tabs.hidden = body.hidden = entity.hidden = !st.me;
    who.textContent = st.me ? short(st.me.wallet) : '';
    if (st.me) { who.append(' ', el('button', { class: 'ed-link', onclick: () => post('auth/logout').finally(() => { st.me = null; paintAuth(); }) }, 'sign out')); showTab(tab); }
  }
  async function refreshMe() { try { st.me = await get('me'); } catch { st.me = null; } paintAuth(); if (st.me) await st.loadHead(); }
  async function signIn() {
    const wallet = await connect(); status('sign the message in your wallet…');
    const { message } = await post('auth/nonce', { wallet });
    await post('auth/verify', { wallet, signature: await sign(message) });
    status(''); await refreshMe();
  }
  st.on(() => {
    const r = st.head?.row; entity.textContent = '';
    if (!st.entityId) return;
    entity.append(el('b', { text: st.entityId }), ` ${r?.kind ?? ''}`, r ? el('span', { class: 'ed-dim', text: ` · head ${r.headSeq ? '#' + r.headSeq : 'seed'} · live ${r.publishedSeq ? '#' + r.publishedSeq : 'seed'}` }) : '',
      el('button', { class: 'ed-link', title: 'drop previews: show what players see', onclick: () => viewer.reload().then(() => status('showing the published models')) }, 'published view'));
  });
  viewer.onSelect(item => { if (item.entity !== st.entityId) { st.entityId = item.entity; st.head = null; st.loadHead(); emit(); } });
  st.entityId = viewer.current?.entity ?? null;
  paintAuth(); refreshMe();
  if (new URLSearchParams(location.search).has('edit')) setOpen(true);
  return st;
}
