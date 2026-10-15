import { get, post } from './api.js';
import { el, when } from './dom.js';

/* CHAT: a request to the AI ("make the cactus arms thicker", "a water tower landmark") becomes a job on the server – the bridge checks it,
   then the model works through the MCP's tools and saves draft revisions. The log polls the job's events; each draft is previewed at once.
   Earlier requests of the entity are listed under the box: a click replays their log and previews their result. */
export function mountChat(st) {
  const log = el('div', { class: 'ed-log' });
  const prov = el('select', { class: 'ed-sel', onchange: () => fillModels() }), model = el('select', { class: 'ed-sel' });
  const scope = el('select', { class: 'ed-sel', title: 'what the request is about' }, el('option', { value: 'this' }, 'this entity'), el('option', { value: 'new' }, 'a new entity'));
  const box = el('textarea', { class: 'ed-prompt', rows: 3, maxlength: 4000, placeholder: 'e.g. give the police car a longer light bar · make a water tower landmark with a ladder' });
  const send = el('button', { class: 'ed-btn', onclick: () => ask() }, 'SEND'), cancel = el('button', { class: 'ed-btn ed-dim', hidden: true, onclick: () => job && post(`jobs/${job}/cancel`) }, 'CANCEL');
  const past = el('div', { class: 'ed-past' });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); e.stopPropagation(); });   // the viewer's own keys (WASD, arrows) stay out of the box
  const node = el('div', { class: 'ed-chat' }, el('div', { class: 'ed-row' }, scope, prov, model), log, box, el('div', { class: 'ed-row' }, send, cancel), el('div', { class: 'ed-sub', text: 'EARLIER REQUESTS' }), past);
  let job = null, after = 0, timer = null;

  function fillProviders() {
    const ps = st.me?.providers ?? []; prov.textContent = '';
    for (const p of ps) prov.append(el('option', { value: p.id, selected: p.id === st.me.defaultProvider }, p.label ?? p.id));
    fillModels();
    send.disabled = !ps.length; if (!ps.length) line('sys', 'No AI provider is configured on the server (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY or ZAI_API_KEY). SOURCE still edits by hand.');
  }
  function fillModels() { const p = (st.me?.providers ?? []).find(x => x.id === prov.value); model.textContent = ''; for (const m of p?.models ?? []) model.append(el('option', { value: m, selected: m === p.default }, m)); }
  const line = (kind, text) => { log.append(el('div', { class: `ed-l ed-${kind}`, text })); log.scrollTop = log.scrollHeight; };

  async function ask() {
    const prompt = box.value.trim(); if (!prompt || job) return;
    const fresh = scope.value === 'new';
    log.textContent = ''; line('you', prompt);
    try {
      const r = await post('jobs', { prompt, entityId: fresh ? undefined : st.entityId ?? undefined, baseRevisionId: fresh ? undefined : st.head?.row?.headRevisionId ?? null, provider: prov.value || undefined, model: model.value || undefined });
      box.value = ''; follow(r.jobId);
    } catch (e) { line('err', e.message); for (const x of e.errors) line('err', '· ' + x); }
  }
  function follow(id, from = 0) {
    job = id; after = from; cancel.hidden = false; send.disabled = true; clearTimeout(timer);
    const tick = async () => {
      if (job !== id) return;
      let more = false;
      try {
        const r = await get(`jobs/${id}/events?after=${after}`);
        if (job !== id) return;
        more = r.events.length === 200;
        for (const ev of r.events) { after = Math.max(after, ev.seq); await show(ev); if (job !== id) return; }
        if (!more && ['done', 'failed', 'cancelled'].includes(r.status)) { finish(r.status); return; }
      } catch (e) { if (job === id) line('err', e.message); }
      if (job === id) timer = setTimeout(tick, more ? 50 : 1000);
    };
    tick();
  }
  async function show(ev, replay = false) {
    const p = ev.payload ?? {};
    if (ev.type === 'text') line('ai', p.text ?? '');
    else if (ev.type === 'tool_call') line('tool', `→ ${p.name}${p.summary ? ' · ' + p.summary : ''}`);
    else if (ev.type === 'tool_result') line(p.ok === false ? 'err' : 'tool', `← ${p.name}${p.summary ? ' · ' + p.summary : ''}`);
    else if (ev.type === 'status') line('sys', p.text ?? p.status ?? '');
    else if (ev.type === 'usage') line('sys', `tokens ${p.in ?? 0} in · ${p.out ?? 0} out`);
    else if (ev.type === 'error') line('err', p.message ?? 'failed');
    else if (ev.type === 'draft') {
      line('ok', `draft saved: ${p.entityId} #${p.seq ?? ''}`);
      if (!replay) { try { const rev = await get(`revisions/${p.revisionId}`); if (p.entityId !== st.entityId) { st.entityId = p.entityId; } st.preview(rev.config); await st.loadHead(); } catch (e) { line('err', `preview: ${e.message}`); } }
    }
  }
  function finish(status) { job = null; cancel.hidden = true; send.disabled = false; line(status === 'done' ? 'ok' : 'err', status === 'done' ? 'done – the result is a DRAFT: check it, then publish it from HISTORY' : status); loadPast(); }

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
    clearTimeout(timer); job = null; cancel.hidden = true; send.disabled = !(st.me?.providers ?? []).length;
    log.textContent = ''; line('you', j.prompt);
    let last = 0;
    try { const r = await get(`jobs/${j.id}/events?after=0`); for (const ev of r.events) { last = Math.max(last, ev.seq); await show(ev, true); } } catch (e) { line('err', e.message); }
    if (j.resultRevisionId) { try { st.preview((await get(`revisions/${j.resultRevisionId}`)).config); line('sys', 'previewing its result'); } catch (e) { line('err', e.message); } }
    if (j.status === 'running' || j.status === 'queued') follow(j.id, last);
  }
  st.on(() => loadPast());
  return { node, shown: () => { fillProviders(); loadPast(); } };
}
