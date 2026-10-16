import '../js/crash-boot.js';   // before the admin modules: a throw while they load is still reported
import { ADMIN_BASE, SITE_BASE } from '../js/hosts.js';
import { b58, chooseWallet, ensureAccount, provider, rememberWallet } from './wallet.js';
import { shortAddr } from './pools.js';
import { promosTab } from './admin-promos.js';
import { settingsTab } from './admin-settings.js';
import { playersTab, poolsTab, statsTab, sessionsTab } from './admin-directory.js';
import { payoutsTab } from './admin-pools.js';
import { devWanted, installDevWallet, isLocal, DEV_ADMIN_WALLET } from './dev-wallet.js';
if (devWanted()) installDevWallet();   // localhost only: a dev wallet chosen earlier in this tab stays in place after a reload

/* The admin page: OVERVIEW · REVIEW QUEUE · RIDES · REPLAYS · PLAYERS · POOLS · PAYOUTS · STATS · SESSIONS · PROMO CODES · SETTINGS · SIGN-INS · LOGS · AUDIT (+ #ride/<id>). Vanilla DOM, no framework.
   Only wallets in the server's ADMIN_WALLETS get answers – to everyone else /api/admin/* is a 404 and this page says so.
   Everything from the server goes in with textContent (wallets, reasons, log lines are other people's data) – never innerHTML. */
const $ = id => document.getElementById(id);
const view = $('view');
const TABS = ['overview', 'queue', 'rides', 'replays', 'players', 'pools', 'payouts', 'stats', 'sessions', 'promos', 'settings', 'signins', 'logs', 'audit'];

/* ───────── helpers ───────── */
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
async function api(path, body) {
  const r = await fetch(`${ADMIN_BASE}/api/admin/${path}`, {
    credentials: 'include', method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json', 'x-fc-admin': '1' } : {},   // the header proves the change came from this page (CSRF)
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.detail || j.title || `server error ${r.status}`), { status: r.status, requestId: j.requestId });
  return j;
}
const short = w => (w ? shortAddr(w) : '–');
const time = ms => (ms == null ? '–' : new Date(ms).toLocaleString());
const ago = ms => { if (ms == null) return '–'; const s = Math.round((Date.now() - ms) / 1000); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
const km = m => (m / 1000).toFixed(2);
const sol = l => `${(l / 1e9).toFixed(3)} SOL`;
const bytes = b => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} kB`);
const REVIEW = { under_review: 'UNDER REVIEW', accepted: 'ACCEPTED', rejected: 'REJECTED' }, REVIEW_CLASS = { under_review: 'flagged', accepted: 'verified', rejected: 'rejected' };
const reviewBadge = r => (r ? el('span', { class: `v ${REVIEW_CLASS[r] ?? 'none'}`, title: 'a paid ride\'s review: under review until the checks verify it or you decide' }, REVIEW[r] ?? r) : '');
const badge = (v, overridden) => el('span', { class: `v ${v ?? 'none'}${overridden ? ' ovr' : ''}`, title: overridden ? 'decided by an admin' : '' }, (v ?? 'unjudged').toUpperCase());
const wallet = w => el('span', { class: 'mono', title: w }, short(w));
const fail = e => (sessionGone(e) ? (store(null), showSignIn('Your admin session ended – sign in again.')) : view.replaceChildren(el('div', { class: 'card' }, el('p', { class: 'bad' }, e.message), e.requestId ? el('p', { class: 'dim' }, `request id ${e.requestId}`) : '')));

/* ───────── shell ───────── */
const S = { tab: 'overview', me: null };
let seq = 0, loading = null;   // loading = { key, at }: a refresh (R held down, a double click) of what is already loading must not start a second load
const STALE_MS = 15000;   // …unless that load hangs
async function go({ dedupe = false } = {}) {
  const key = location.hash;
  if (dedupe && loading?.key === key && Date.now() - loading.at < STALE_MS) return;
  const mine = ++seq, current = () => mine === seq;   // a newer go() (another tab, a filter) supersedes this one
  const [t, arg] = key.slice(1).split('/');
  const tab = t === 'ride' ? 'ride' : TABS.includes(t) ? t : 'overview';
  const same = tab === S.tab && view.dataset.tab === tab && !arg;   // a refresh of the open tab keeps its content until the new one is ready
  S.tab = tab;
  loading = { key, at: Date.now() };
  document.querySelectorAll('.tabs a').forEach(a => { const on = a.dataset.tab === tab; a.classList.toggle('on', on); a.setAttribute('aria-selected', on); });
  // "Loading…" only if the answer is slow: a fast one would flash it for a frame
  const wait = same ? 0 : setTimeout(() => { if (current()) view.replaceChildren(el('p', { class: 'dim' }, 'Loading…')); }, 150);
  if (!same) { view.replaceChildren(); view.dataset.tab = ''; }
  refreshQueueCount();
  // the tabs paint through `gv`: a load that a newer go() superseded (another tab clicked meanwhile) must not draw over it
  const gv = { replaceChildren: (...kids) => { if (current()) view.replaceChildren(...kids); }, dataset: view.dataset };
  const ctx = { api, el, view: gv, signAt, time, ago, wallet, go };
  try { await ({ overview: () => overview(gv), queue: () => queue(gv), rides: () => rides(gv), replays: () => replays(gv), promos: () => promosTab(ctx), settings: () => settingsTab(ctx, arg), players: () => playersTab(ctx, arg), pools: () => poolsTab(ctx, arg), payouts: () => payoutsTab(ctx), stats: () => statsTab(ctx), sessions: () => sessionsTab(ctx), signins: () => signins(gv), logs: () => logs(gv), audit: () => audit(gv), ride: () => ride(arg, gv) })[tab](); if (current()) view.dataset.tab = arg ? '' : tab; } catch (e) { if (current()) fail(e); } finally { clearTimeout(wait); if (current()) loading = null; }
}
addEventListener('hashchange', () => go());
$('refresh').onclick = () => go({ dedupe: true });
document.querySelector('.tabs').addEventListener('click', e => { if (e.target.closest('a')?.dataset.tab === S.tab && !location.hash.includes('/')) e.preventDefault(); });   // the open tab's button does nothing
addEventListener('keydown', e => { if (e.key === 'r' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '')) go({ dedupe: true }); });

const refreshQueueCount = () => api('queue/count').then(({ underReview, flagged }) => { $('tab-queue-n').textContent = (underReview ?? flagged) || ''; }, () => {});   // a count: this runs on every tab change

/* ───────── OVERVIEW ───────── */
async function overview(view) {
  const o = await api('overview');
  paintMode(o.config);
  const tile = (v, l) => el('div', { class: 'tile' }, el('b', {}, v), el('span', {}, l));
  const counts = obj => Object.entries(obj).sort().map(([k, n]) => `${k} ${n}`).join(' · ') || '–';
  view.replaceChildren(
    el('h2', {}, 'RIGHT NOW'),
    el('div', { class: 'tiles' }, tile(o.players, 'players'), tile(o.signIns24h, 'sign-ins, 24 h'), tile(o.running, 'on the road'), tile(o.underReview ?? o.verdicts.flagged ?? 0, 'waiting for review'),
      tile(o.payments.count, `payments (${sol(o.payments.lamports)})`), tile(o.telemetry.batches, `recording batches (${bytes(o.telemetry.bytes)})`)),
    el('h2', {}, 'RIDES BY STATUS'), el('div', { class: 'card dim' }, counts(o.rides)),
    el('h2', {}, 'VERDICTS'), el('div', { class: 'card dim' }, counts(o.verdicts)),
    el('h2', {}, 'SETTINGS'),
    el('div', { class: 'card' }, el('dl', { class: 'kv' },
      el('dt', {}, 'VERDICT_ENFORCE'), el('dd', {}, o.config.verdictEnforce ? 'true – the paid boards rank verified shifts only' : 'false – SHADOW mode: verdicts are shown, ranking ignores them'),
      el('dt', {}, 'TELEMETRY_RETENTION_DAYS'), el('dd', {}, o.config.telemetryRetentionDays ? `${o.config.telemetryRetentionDays} days (flagged rides kept until reviewed)` : '0 – recordings kept forever'),
      el('dt', {}, 'server time'), el('dd', {}, time(o.now)))));
}
function paintMode(cfg) { $('chip-mode').textContent = cfg.verdictEnforce ? 'VERDICTS ENFORCED' : 'SHADOW MODE'; $('chip-mode').className = `chip${cfg.verdictEnforce ? '' : ' demo'}`; }

/* ───────── RIDES / QUEUE / REPLAYS ───────── */
function rideTable(rows) {
  if (!rows.length) return el('div', { class: 'card empty' }, 'Nothing here.');
  return el('div', { class: 'card', style: 'padding:6px 8px;overflow-x:auto' }, el('table', { class: 'dense' },
    el('thead', {}, el('tr', {}, ...['created', 'rider', 'tier', 'pool', 'status', 'km', 'driven', 'verdict', 'review', 'reason'].map(h => el('th', { class: h === 'km' || h === 'driven' ? 'r' : null }, h)))),
    el('tbody', {}, rows.map(r => el('tr', { class: 'click', onclick: () => { location.hash = `#ride/${r.id}`; } },
      el('td', {}, ago(r.createdAt)), el('td', {}, wallet(r.wallet)), el('td', {}, r.tier + (r.timeScale > 1 ? ` ×${r.timeScale}` : '')), el('td', { class: 'mono' }, r.poolId ?? '–'), el('td', {}, r.status),
      el('td', { class: 'r' }, km(r.distance)), el('td', { class: 'r' }, `${Math.round(r.driveSeconds)} s`), el('td', {}, r.status === 'completed' ? badge(r.verdict, r.overridden) : ''), el('td', {}, reviewBadge(r.review)), el('td', { class: 'dim' }, r.reason ?? ''))))));
}
async function queue(view) {
  const pool = new URLSearchParams(location.search).get('pool') ?? '';
  const { rows } = await api(`rides?review=under_review&limit=200${/^\d+$/.test(pool) ? `&pool=${pool}` : ''}`);
  if (!pool) $('tab-queue-n').textContent = rows.length || '';
  const input = el('input', { placeholder: 'pool id (all pools when empty)', value: pool, inputmode: 'numeric', 'aria-label': 'pool' });
  const apply = () => { const v = input.value.trim(); history.replaceState(null, '', `${location.pathname}${/^\d+$/.test(v) ? `?pool=${v}` : ''}#queue`); go(); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
  const pools = [...new Set(rows.map(r => r.poolId).filter(p => p != null))].sort((a, b) => a - b);
  view.replaceChildren(el('h2', {}, `REVIEW QUEUE · ${rows.length}${/^\d+$/.test(pool) ? ` · POOL ${pool}` : ''}`),
    el('p', { class: 'dim' }, 'Every PAID completed ride waits here until you decide – flagged ones, ones the checks REJECTED (a machine reject is not final for the player) and ones not judged yet; clean (verified) rides are accepted on their own. Paid rides come first, then the flagged free rides. Pool-level marks (pool-…) come from the pool:attention check. Open one to decide: ACCEPT = accepted, REJECT = rejected.'),
    el('div', { class: 'filters' }, input, el('button', { onclick: apply }, 'FILTER'), ...pools.map(p => el('a', { href: `?pool=${p}#queue`, class: 'chip' }, `pool ${p}`))),
    rideTable(rows));
}
async function rides(view) {
  const q = new URLSearchParams(location.search);
  const f = { wallet: q.get('wallet') ?? '', status: q.get('status') ?? '', verdict: q.get('verdict') ?? '' };
  const input = el('input', { placeholder: 'wallet (full address)', value: f.wallet, 'aria-label': 'wallet' });
  const select = (name, opts) => el('select', { 'aria-label': name }, el('option', { value: '' }, `any ${name}`), ...opts.map(o => el('option', { value: o, selected: f[name] === o }, o)));
  const status = select('status', ['running', 'completed', 'abandoned', 'failed', 'created', 'awaiting_payment', 'expired', 'cancelled']), verdict = select('verdict', ['verified', 'flagged', 'rejected', 'none']);
  const apply = () => { const p = new URLSearchParams(); if (input.value.trim()) p.set('wallet', input.value.trim()); if (status.value) p.set('status', status.value); if (verdict.value) p.set('verdict', verdict.value); history.replaceState(null, '', `${location.pathname}${p.size ? `?${p}` : ''}#rides`); go(); };
  const params = new URLSearchParams({ limit: '100' }); for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
  const { rows } = await api(`rides?${params}`);
  view.replaceChildren(el('h2', {}, 'RIDES'), el('div', { class: 'filters' }, input, status, verdict, el('button', { onclick: apply }, 'FILTER')), rideTable(rows));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
}
async function replays(view) {
  const q = new URLSearchParams(location.search);
  const f = { status: q.get('status') ?? '', paid: q.get('paid') ?? '' };
  const select = (name, label, opts) => el('select', { 'aria-label': name }, el('option', { value: '' }, label), ...opts.map(([v, l]) => el('option', { value: v, selected: f[name] === v }, l)));
  const status = select('status', 'any status', [['pending', 'pending'], ['verified', 'verified'], ['flagged', 'flagged'], ['rejected', 'rejected']]);
  const paid = select('paid', 'paid + free', [['true', 'paid only'], ['false', 'free only']]);
  const apply = () => { const p = new URLSearchParams(); if (status.value) p.set('status', status.value); if (paid.value) p.set('paid', paid.value); history.replaceState(null, '', `${location.pathname}${p.size ? `?${p}` : ''}#replays`); go(); };
  const params = new URLSearchParams({ limit: '100' }); for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
  const { queue: qInfo, rows } = await api(`replays?${params}`);
  view.replaceChildren(
    el('h2', {}, `REPLAY VERIFICATION · QUEUE (${qInfo.kind.toUpperCase()}: ${qInfo.depth} PENDING)`),
    el('p', { class: 'dim' }, 'Each completed shift is re-simulated on the backend at 10 Hz against the seeded road, PRNG traffic and spectator donation events (verdict.RideReplay + verdict.RideReplayFlag). Open a ride to inspect its red flags or click RE-JUDGE to run a new verification session.'),
    el('div', { class: 'filters' }, status, paid, el('button', { onclick: apply }, 'FILTER')),
    rows.length ? el('div', { class: 'card', style: 'padding:6px 8px;overflow-x:auto' }, el('table', { class: 'dense', id: 'replay-table' },
      el('thead', {}, el('tr', {}, ...['queued', 'ride', 'seq', 'tier', 'status', 'rec / sim km', 'rec / sim hull', 'crashes', 'events', 'red flags'].map(h => el('th', {}, h)))),
      el('tbody', {}, rows.map(r => el('tr', { class: 'click', onclick: () => { location.hash = `#ride/${r.rideId}`; } },
        el('td', { title: time(r.queuedAt) }, ago(r.queuedAt)), el('td', { class: 'mono' }, r.rideId.slice(0, 8)), el('td', {}, `#${r.seq}`), el('td', {}, r.isPaid ? 'paid' : 'free'),
        el('td', {}, badge(r.status, false)), el('td', {}, `${km(r.recordedDistance)} / ${km(r.simulatedDistance)}`), el('td', {}, `${Math.round(r.recordedHull)} / ${Math.round(r.simulatedHull)} %`),
        el('td', {}, `${r.simulatedCrashesVehicle}v · ${r.simulatedCrashesBuilding}b`), el('td', {}, `${r.eventsCorrelated}/${r.eventsExpected}`),
        el('td', { class: r.redFlags.length ? 'bad' : 'dim' }, r.redFlags.length ? r.redFlags.map(x => x.code).join(', ') : '–'))))))
      : el('div', { class: 'card empty' }, 'No replay verification sessions yet.'));
}

/* ───────── ONE RIDE ───────── */
async function ride(id, view) {
  const d = await api(`rides/${encodeURIComponent(id)}`);
  const r = d.ride, v = d.verdict, reps = d.replays ?? [];
  const kv = (...pairs) => el('dl', { class: 'kv' }, pairs.flatMap(([k, val]) => [el('dt', {}, k), el('dd', {}, val)]));
  const lock = on => document.querySelectorAll('.actions button').forEach(b => { b.disabled = on; });   // one click = one wallet prompt = one signed change
  const decide = async decision => {
    const note = $('note').value.trim();
    lock(true);
    $('decide-msg').textContent = 'Sign the decision in your wallet…';
    try {
      const signature = await signChange(id, { action: 'override', decision, note: note || undefined });
      $('decide-msg').textContent = 'Saving…';
      await api(`rides/${encodeURIComponent(id)}/verdict`, { decision, note: note || undefined, signature }); go();
    } catch (e) { $('decide-msg').textContent = e.message; $('decide-msg').className = 'bad'; lock(false); }
  };
  const rejudge = async () => {
    const msg = $('decide-msg') ?? $('judge-msg');
    lock(true);
    msg.textContent = 'Sign the re-judge in your wallet…';
    try {
      const signature = await signChange(id, { action: 'rejudge' });
      msg.textContent = 'Judging…';
      await api(`rides/${encodeURIComponent(id)}/rejudge`, { signature }); go();
    } catch (e) { msg.textContent = e.message; msg.className = 'bad'; lock(false); }
  };
  view.replaceChildren(
    el('p', {}, el('a', { href: '#queue' }, '← review queue'), ' · ', el('a', { href: '?#replays' }, 'replays'), ' · ', el('a', { href: `?wallet=${r.wallet}#rides` }, 'this rider\'s rides'), ' · ', el('a', { href: `#players/${r.wallet}` }, 'player'), ' · ', el('a', { href: `#signins/${r.wallet}` }, 'sign-ins'), ' · ', el('a', { href: `#settings/${r.wallet}` }, 'free rides'), ' · ', el('a', { href: `#logs/${r.id}` }, 'log lines')),
    el('h2', {}, 'RIDE'),
    el('div', { class: 'card' }, kv(['id', el('span', { class: 'mono' }, r.id)], ['rider', el('span', { class: 'mono' }, r.wallet)], ['tier / status', `${r.tier} · ${r.status}${r.reason ? ` – ${r.reason}` : ''}`],
      ['driven', `${km(r.distance)} km in ${Math.round(r.driveSeconds)} s (shift ${r.minSeconds} s / ${km(r.completeDist)} km${r.timeScale > 1 ? `, demo ×${r.timeScale}` : ''})`],
      ['created · started · ended', `${time(r.createdAt)} · ${time(r.startedAt)} · ${time(r.endedAt)}`], ['hull · last heartbeat', `${r.hull ?? '–'} % · ${time(r.lastHbAt)}`],
      ['seed · round · pool', `${r.seed} · ${r.roundId ?? '–'} · ${r.poolId ?? '–'}`], ['review', r.review ? reviewBadge(r.review) : 'free ride / not completed – no review'], ['payment', d.payment ? `${sol(d.payment.lamports)} · ${d.payment.signature}` : r.tier === 'free' ? 'free ride' : 'none'])),
    el('h2', {}, 'VERDICT'),
    v ? el('div', { class: 'card' },
      el('p', {}, badge(v.status, !!v.override), ` judged ${time(v.judgedAt)} · rules v${v.rulesVersion}`),
      v.override ? el('p', { class: 'dim' }, `decided by ${v.override.by} at ${time(v.override.at)}${v.override.note ? ` – “${v.override.note}”` : ''}`) : '',
      v.reasons.length ? el('div', { class: 'reasons' }, v.reasons.map(x => el('div', { class: `reason ${x.severity}` }, el('b', {}, `${x.code} `), el('span', { class: 'dim' }, `(${x.severity}) `), x.detail))) : el('p', { class: 'good' }, 'No reasons – the recording passed every check.'),
      el('details', {}, el('summary', { class: 'dim' }, 'scores'), el('pre', { class: 'json' }, JSON.stringify(v.scores, null, 2))),
      el('div', { class: 'actions' }, el('textarea', { id: 'note', placeholder: 'note (why) – kept in the audit log', maxlength: '500' }),
        el('button', { onclick: () => decide('verified') }, 'ACCEPT · VERIFIED'), el('button', { class: 'reject', onclick: () => decide('rejected') }, 'REJECT'),
        el('button', { class: 'ghost', onclick: rejudge, title: 'run the checks again at the current rules – replaces a decision' }, 'RE-JUDGE')),
      el('p', { id: 'decide-msg', class: 'dim' }, 'Your decision replaces the status; a late batch leaves it alone, RE-JUDGE replaces it.'))
      : r.status === 'completed'
        ? el('div', { class: 'card' }, el('p', { class: 'bad' }, 'Completed but not judged (judging failed after the ride ended).'), el('div', { class: 'actions' }, el('button', { onclick: rejudge }, 'JUDGE NOW')), el('p', { id: 'judge-msg', class: 'dim' }))
        : el('div', { class: 'card dim' }, 'Not judged – only completed shifts are.'),
    el('h2', {}, `REPLAY VERIFICATION · ${reps.length} SESSION(S)`),
    reps.length ? el('div', { class: 'card', id: 'ride-replays' }, ...reps.map(rep => el('div', { class: 'replay-session' },
      el('p', {}, badge(rep.status, false), ` session #${rep.seq} · ${rep.simHz} Hz · rules v${rep.rulesVersion} · completed ${time(rep.completedAt ?? rep.queuedAt)}`),
      kv(['recorded vs simulated', `${km(rep.recordedDistance)} km / ${km(rep.simulatedDistance)} km · hull ${Math.round(rep.recordedHull)} % / ${Math.round(rep.simulatedHull)} %`],
        ['simulated crashes · events', `${rep.simulatedCrashesVehicle} vehicle, ${rep.simulatedCrashesBuilding} building · ${rep.eventsCorrelated}/${rep.eventsExpected} live events correlated`]),
      rep.redFlags.length ? el('div', { class: 'reasons' }, rep.redFlags.map(f => el('div', { class: `reason ${f.severity}` }, el('b', {}, `${f.code} `), el('span', { class: 'dim' }, `[${f.category} · ${f.severity}${f.atSecond != null ? ` @ ${f.atSecond.toFixed(1)}s` : ''}] `), f.detail))) : el('p', { class: 'good' }, '0 replay red flags.'),
      el('details', {}, el('summary', { class: 'dim' }, `session #${rep.seq} scores`), el('pre', { class: 'json' }, JSON.stringify(rep.scores, null, 2))))))
      : el('div', { class: 'card dim' }, 'No replay verification sessions recorded.'),
    el('h2', {}, `RECORDING · ${d.batches.length} BATCHES`),
    d.batches.length ? el('div', { class: 'card', style: 'padding:6px 8px;overflow-x:auto' }, el('table', { class: 'dense' },
      el('thead', {}, el('tr', {}, ...['seq', 'game s', 'samples', 'inputs', 'size', 'hash', 'received'].map(h => el('th', { class: ['samples', 'inputs', 'size'].includes(h) ? 'r' : null }, h)))),
      el('tbody', {}, d.batches.map(b => el('tr', {}, el('td', {}, b.seq), el('td', {}, `${b.t0}–${b.t1}`), el('td', { class: 'r' }, b.samples), el('td', { class: 'r' }, b.inputs), el('td', { class: 'r' }, bytes(b.bytes)),
        el('td', { class: b.hashOk ? 'good' : 'bad' }, b.hashOk ? 'ok' : 'MISMATCH'), el('td', { class: 'dim' }, time(b.receivedAt)))))))
      : el('div', { class: 'card dim' }, 'No recording uploaded.'));
}

/* ───────── SIGN-INS ───────── */
async function signins(view) {
  const w = location.hash.split('/')[1] ?? '';
  const { rows } = await api(`signins?limit=200${w ? `&wallet=${encodeURIComponent(w)}` : ''}`);
  view.replaceChildren(el('h2', {}, `SIGN-INS${w ? ` · ${short(w)}` : ''}`),
    el('p', { class: 'dim' }, 'One row per successful wallet sign-in. Sessions are signed cookies (7 days); a single session cannot be revoked – rotating JWT_SECRET signs everybody out.'),
    rows.length ? el('div', { class: 'card', style: 'padding:6px 8px;overflow-x:auto' }, el('table', { class: 'dense' },
      el('thead', {}, el('tr', {}, ...['when', 'rider', 'ip', 'browser'].map(h => el('th', {}, h)))),
      el('tbody', {}, rows.map(s => el('tr', {}, el('td', { title: time(s.at) }, ago(s.at)), el('td', {}, el('a', { href: `?wallet=${s.wallet}#rides`, class: 'mono' }, short(s.wallet))), el('td', { class: 'mono' }, s.ip ?? '–'), el('td', { class: 'dim' }, s.userAgent ?? '–'))))))
      : el('div', { class: 'card empty' }, 'No sign-ins yet.'));
}

/* ───────── LOGS ───────── */
async function logs(view) {
  const pre = decodeURIComponent(location.hash.split('/')[1] ?? '');
  const q = el('input', { placeholder: 'filter: request id, wallet, ride id, words', value: pre, 'aria-label': 'filter' });
  const level = el('select', { 'aria-label': 'level' }, ...[['', 'all levels'], ['warn', 'warn + error'], ['error', 'errors only']].map(([v, l]) => el('option', { value: v }, l)));
  const out = el('div', { class: 'card log', id: 'log' });
  const load = async () => {
    const p = new URLSearchParams({ limit: '200' }); if (q.value.trim()) p.set('q', q.value.trim()); if (level.value) p.set('level', level.value);
    const { entries } = await api(`logs?${p}`);
    out.replaceChildren(...(entries.length ? entries.map(e => {
      const { time: t, level: lv, context, msg, ...fields } = e;
      return el('div', { class: `l ${lv}` }, el('span', { class: 'dim' }, new Date(t).toLocaleTimeString()), el('span', {}, lv), el('span', { class: 'dim' }, context), el('span', {}, msg, Object.keys(fields).length ? el('span', { class: 'f' }, ` ${JSON.stringify(fields)}`) : ''));
    }) : [el('span', { class: 'dim' }, 'No matching lines.')]));
  };
  view.replaceChildren(el('h2', {}, 'LOGS · THIS SERVER PROCESS'),
    el('p', { class: 'dim' }, 'The newest 5000 lines kept in memory (gone after a restart). The durable log is the container\'s: npm run ops -- logs --since 24h --grep <id>.'),
    el('div', { class: 'filters' }, q, level, el('button', { onclick: load }, 'FILTER')), out);
  q.addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
  await load();
}

/* ───────── AUDIT ───────── */
async function audit(view) {
  const { rows } = await api('actions?limit=200');
  view.replaceChildren(el('h2', {}, 'AUDIT · ADMIN ACTIONS'),
    rows.length ? el('div', { class: 'card', style: 'padding:6px 8px;overflow-x:auto' }, el('table', { class: 'dense' },
      el('thead', {}, el('tr', {}, ...['when', 'admin', 'action', 'target', 'detail', 'request'].map(h => el('th', {}, h)))),
      el('tbody', {}, rows.map(a => el('tr', {}, el('td', { title: time(a.at) }, ago(a.at)), el('td', {}, wallet(a.wallet)), el('td', {}, a.action),
        el('td', {}, a.action.startsWith('verdict.') ? el('a', { href: `#ride/${a.target}`, class: 'mono' }, a.target.slice(0, 8)) : a.action.startsWith('promo.') ? el('a', { href: '#promos', class: 'mono' }, a.target) : a.action.startsWith('setting.') ? el('a', { href: '#settings', class: 'mono' }, a.target) : a.action.startsWith('free_rides.') ? el('a', { href: `#settings/${a.target}`, title: a.target }, wallet(a.target)) : a.action.startsWith('pool.') ? el('a', { href: '#payouts', class: 'mono' }, `pool ${a.target}`) : wallet(a.target)), el('td', { class: 'dim' }, JSON.stringify(a.detail)), el('td', { class: 'mono dim' }, a.requestId ?? '–'))))))
      : el('div', { class: 'card empty' }, 'No admin actions yet.'));
}

/* ───────── admin session ─────────
   The admin page has its OWN sign-in: the wallet signs an "ADMIN sign-in" message, the server sets the fc_admin cookie (httpOnly, this host and /api/admin
   only, ADMIN_SESSION_TTL_MINUTES long). The player session from the main site grants nothing here. Who / until when is kept in sessionStorage for the chip. */
const SESSION_KEY = 'freightchain.admin';
const stored = () => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null'); } catch { return null; } };
const store = v => { try { if (v) sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)); else sessionStorage.removeItem(SESSION_KEY); } catch { /* private mode: the chip just stays empty */ } };
function paintSession(s) {
  $('chip-wallet').textContent = s ? `${short(s.wallet)} · until ${new Date(s.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  $('signout').hidden = !s;
}
async function adminSignIn() {
  const p = await chooseWallet();
  rememberWallet(p);
  await p.connect();
  const walletAddr = p.publicKey.toString();
  const { message } = await api('auth/nonce', { wallet: walletAddr });
  const res = await p.signMessage(new TextEncoder().encode(message), 'utf8');   // Phantom: { signature }, Solflare: the bytes
  return api('auth/verify', { wallet: walletAddr, signature: b58(res.signature ?? res) });
}
/* every change is signed by the admin wallet for exactly that change: the server's text (ride + decision + note, or every field of a promo code) → the wallet signs →
   the change carries the signature; the audit keeps both. The wallet must be the signed-in admin's. `path` is the challenge route of the thing being changed. */
async function signAt(path, intent) {
  const p = provider();
  if (!p) throw new Error('No Solana wallet found – changes are signed by your admin wallet (Phantom / Solflare)');
  const s = stored();
  if (s) await ensureAccount(p, s.wallet); else await p.connect();   // a Wallet Standard wallet that authorised several accounts signs with the admin's one
  const { message } = await api(path, intent);
  const res = await p.signMessage(new TextEncoder().encode(message), 'utf8');
  return b58(res.signature ?? res);
}
const signChange = (rideId, intent) => signAt(`rides/${encodeURIComponent(rideId)}/challenge`, intent);
$('signout').onclick = async () => { try { await api('auth/logout', {}); } finally { store(null); location.reload(); } };

function showSignIn(why) {
  paintSession(null);
  document.querySelector('.tabs').hidden = true;
  const msg = el('p', { class: 'dim' }, why ?? 'This page is for the wallets in the server\'s ADMIN_WALLETS. Sign in with one of them – your wallet signs an ADMIN sign-in message (no transaction, no fee).');
  const button = el('button', { id: 'admin-signin', onclick: async () => {
    button.disabled = true; msg.className = 'dim'; msg.textContent = 'Waiting for the wallet…';
    try { store(await adminSignIn()); location.reload(); } catch (e) {
      button.disabled = false; msg.className = 'bad';
      msg.textContent = e.status === 404 ? 'This wallet is not an admin wallet (ADMIN_WALLETS).' : e.message;
    }
  } }, 'SIGN IN AS ADMIN');
  const dev = !isLocal() ? '' : el('button', { id: 'admin-dev', class: 'ghost', title: `local test wallet ${DEV_ADMIN_WALLET} – needs it in the server's ADMIN_WALLETS`, onclick: () => { installDevWallet(); button.click(); } }, 'DEV WALLET (local)');
  view.replaceChildren(el('div', { class: 'card', id: 'denied' }, el('h2', {}, 'ADMIN SIGN-IN'), msg, el('div', { class: 'actions' }, button, dev),
    el('p', { class: 'dim' }, el('a', { href: `${SITE_BASE}/` }, 'back to the site'))));
}
/* a 404 from the admin API means "no (valid) admin session" – unless it is a ride that does not exist while the session is still fresh */
const sessionGone = e => e.status === 404 && !(stored()?.expiresAt > Date.now() && ['ride', 'players', 'pools'].includes(S.tab));   // a fresh session + an unknown ride / wallet / pool is "not found", not "signed out"

/* ───────── boot ───────── */
try {
  // on a real domain the admin page lives on admin.<apex> only (the server answers /api/admin/* nowhere else): /admin.html on the apex moves there
  if (ADMIN_BASE && location.origin !== ADMIN_BASE) { location.replace(`${ADMIN_BASE}/${location.hash}`); await new Promise(() => {}); }
  const o = await api('overview');
  paintMode(o.config);
  paintSession(stored());
  go();
} catch (e) {
  if (e.status === 404) { store(null); showSignIn(); } else { document.querySelector('.tabs').hidden = true; fail(e); }
}
