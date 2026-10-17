import { get, post } from './api.js';
import { visibleChatLine } from './chat-line.js';
import { el, when } from './dom.js';
import { putEntity } from '../world/entities.js';

/* CHAT: a request to the AI ("make the cactus arms thicker", "a water tower landmark") becomes a job on the server – the bridge checks it,
   then the model works through the MCP's tools and saves draft revisions. The log polls the job's events; each draft is previewed at once.
   The screen shows the request, the model's answer, draft lines and errors. Tool traces, queue status and token counts stay in the database.
   Earlier requests of the entity are listed under the box: a click replays their log and previews their result. */
export function mountChat(st) {
  const log = el('div', { class: 'ed-log' });
  const scope = el('select', { class: 'ed-sel', title: 'what the request is about' }, el('option', { value: 'this' }, 'this entity'), el('option', { value: 'new' }, 'a new entity'));
  const box = el('textarea', { class: 'ed-prompt', rows: 3, maxlength: 4000, placeholder: 'e.g. give the police car a longer light bar · make a water tower landmark with a ladder' });
  const send = el('button', { class: 'ed-btn', onclick: () => ask() }, 'SEND'), cancel = el('button', { class: 'ed-btn ed-dim', hidden: true, onclick: () => job && post(`jobs/${job}/cancel`).catch(e => line('err', e.message)) }, 'CANCEL');
  const past = el('div', { class: 'ed-past' });
  const work = el('div', { class: 'ed-work', hidden: true, role: 'progressbar', 'aria-label': 'Working', 'aria-valuetext': 'working' },
    el('span', { class: 'ed-work-label', text: 'working' }),
    el('span', { class: 'ed-work-track', 'aria-hidden': 'true' }, el('span', { class: 'ed-work-bar' })));
  const setWorking = on => { work.hidden = !on; };
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); e.stopPropagation(); });   // the viewer's own keys (WASD, arrows) stay out of the box
  const node = el('div', { class: 'ed-chat' }, el('div', { class: 'ed-row' }, scope), log, work, box, el('div', { class: 'ed-row' }, send, cancel), el('div', { class: 'ed-sub', text: 'EARLIER REQUESTS' }), past);
  let job = null, after = 0, timer = null, generation = 0, pending = false;

  /* The model is the one configured on the server. The chat does not ask you to pick one. */
  const configured = () => (st.me?.providers ?? []).length > 0;
  function fillProviders() {
    const on = configured();
    send.disabled = pending || !!job || !on;
    if (!on) line('sys', 'No model key is configured (ZAI_API_KEY). SOURCE still edits by hand.');
  }
  const line = (kind, text) => { log.append(el('div', { class: `ed-l ed-${kind}`, text })); log.scrollTop = log.scrollHeight; };

  async function ask() {
    const prompt = box.value.trim(); if (!prompt || job || pending || !st.me) return;
    const fresh = scope.value === 'new', target = fresh ? null : st.entityId, wallet = st.me.wallet, my = ++generation;
    pending = true; send.disabled = true; setWorking(true);
    log.textContent = ''; line('you', prompt);
    try {
      const r = await post('jobs', { prompt, entityId: fresh ? undefined : st.entityId ?? undefined, baseRevisionId: fresh ? undefined : st.head?.row?.headRevisionId ?? null });
      if (my !== generation || wallet !== st.me?.wallet) return;
      box.value = ''; follow(r.jobId, 0, target);
    } catch (e) { if (my === generation) { setWorking(false); line('err', e.message); for (const x of e.errors ?? []) line('err', '· ' + x); } }
    finally { pending = false; send.disabled = !!job || !configured(); }
  }
  function follow(id, from = 0, target = st.entityId) {
    job = id; after = from; cancel.hidden = false; send.disabled = true; setWorking(true); clearTimeout(timer);
    const my = ++generation, wallet = st.me?.wallet, context = { target, selected: st.entityId, current: () => generation === my && job === id && st.me?.wallet === wallet };
    const tick = async () => {
      if (!context.current()) return;
      let more = false;
      try {
        const r = await get(`jobs/${id}/events?after=${after}`);
        if (!context.current()) return;
        more = r.events.length === 200;
        for (const ev of r.events) { after = Math.max(after, ev.seq); await show(ev, false, context); if (!context.current()) return; }
        if (!more && ['done', 'failed', 'cancelled'].includes(r.status)) { finish(r.status); return; }
      } catch (e) { if (context.current()) { line('err', e.message); if (e.status === 401 || e.status === 404) { finish('failed'); return; } } }
      if (context.current()) timer = setTimeout(tick, more ? 50 : 1000);
    };
    tick();
  }
  async function show(ev, replay = false, context = null) {
    const row = visibleChatLine(ev);
    if (row) line(row.kind, row.text);
    if (ev.type === 'draft' && !replay) {
      const p = ev.payload ?? {};
      try {
        const rev = await get(`revisions/${p.revisionId}`);
        if (!context?.current()) return;
        putEntity(rev.config);   // a helper part must be available when the requested model uses it
        if (st.entityId === context.selected && (p.entityId === context.target || context.target === null)) {
          st.preview(rev.config); context.selected = st.entityId; await st.loadHead();
        }
      } catch (e) { if (context?.current()) line('err', `preview: ${e.message}`); }
    }
  }
  function finish(status) { job = null; setWorking(false); cancel.hidden = true; send.disabled = false; line(status === 'done' ? 'ok' : 'err', status === 'done' ? 'done – the result is a DRAFT: check it, then publish it from HISTORY' : status); loadPast(); }

  let gen = 0;
  async function loadPast() {
    const my = ++gen; if (!st.me || !st.entityId) { past.textContent = ''; return; }
    try {
      const jobs = await get(`jobs?entityId=${encodeURIComponent(st.entityId)}`);
      if (my !== gen) return;
      past.textContent = '';
      for (const j of jobs.slice(0, 20)) past.append(el('div', { class: 'ed-item', title: j.prompt, onclick: () => replayJob(j) }, el('span', { class: `ed-badge ed-${j.status}`, text: j.status }), ' ', j.prompt.slice(0, 80), el('span', { class: 'ed-dim', text: ` · ${when(j.createdAt)}` })));
    } catch { /* the bridge may not be there yet */ }
  }
  async function replayJob(j) {
    clearTimeout(timer); job = null; setWorking(false); cancel.hidden = true; send.disabled = !configured();
    const my = ++generation, wallet = st.me?.wallet, selected = st.entityId, current = () => my === generation && wallet === st.me?.wallet && selected === st.entityId;
    log.textContent = ''; line('you', j.prompt);
    let last = 0;
    let status = j.status;
    try { for (;;) { const r = await get(`jobs/${j.id}/events?after=${last}`); if (!current()) return; status = r.status; for (const ev of r.events) { last = Math.max(last, ev.seq); await show(ev, true); } if (r.events.length < 200) break; } } catch (e) { if (current()) line('err', e.message); }
    if (!current()) return;
    if (status === 'running' || status === 'queued') { follow(j.id, last, j.entityId); return; }
    if (j.resultRevisionId) { try { const rev = await get(`revisions/${j.resultRevisionId}`); if (!current()) return; st.preview(rev.config); line('sys', 'previewing its result'); } catch (e) { if (current()) line('err', e.message); } }
  }
  st.on(() => { if (!st.me) { generation++; job = null; pending = false; setWorking(false); clearTimeout(timer); cancel.hidden = true; send.disabled = true; } loadPast(); });
  return { node, shown: () => { fillProviders(); loadPast(); } };
}
