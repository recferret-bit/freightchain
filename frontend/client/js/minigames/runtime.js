import { st } from '../state.js';
import { phone } from '../phone.js';
import { API_BASE } from '../hosts.js';
import { setMgAux, telemetryUs } from '../telemetry.js';
import { MG_BADGE_APP } from '../../shared/minigame-kinds.js';
import { machine } from './machine.js';
import { smsModel } from './play.js';
import { takeTrace, traceReset } from './trace.js';
import { t } from './i18n/index.js';

/* Heartbeat delivers armed events. Pictures and the nonce arrive at POST open, when the truck is stopped
   and the parking brake has been on for 2 seconds. The client never learns the expected answer. */

let rideId = null, busy = false, deferring = false, screen = null;
const mac = 'A'.repeat(43);

setMgAux(() => { const aux = takeTrace(); return aux ? { mg: aux } : null; });

/** The phone OS registers itself. This file must not import it: the landing bundles the cockpit, and the OS imports the map. */
export function bindPhone(os) {
  screen = os;
  os.onAnswer = answer => { submit(answer); };
}

export function noteMiniGames(list, id) {
  if (id) rideId = id;
  if (!Array.isArray(list) || !list.length) return;
  const ev = list.find(e => e && (e.state === 'armed' || e.state === 'revealed'));
  if (!ev?.id || machine.event?.id === ev.id) return;
  if (machine.phase !== 'idle' && machine.phase !== 'done') return;
  machine.event = ev; machine.touched = false; machine.deferred = false;
  machine.send('arm');
}

export function noteFrame(now = performance.now()) {
  const stopped = st.v < 0.5 && !!st.park;
  if (stopped) { if (!phone.slowSince) phone.slowSince = now; } else phone.slowSince = 0;
  const safe = !!(phone.slowSince && now - phone.slowSince >= 2000);
  phone.awake = machine.phase === 'opening' || machine.phase === 'revealed' || machine.phase === 'answering';
  if (machine.phase === 'armed') {
    phone.badge = { id: MG_BADGE_APP[machine.event?.kind] ?? 'chat', n: 1 };
    phone.notice = safe ? t('sms.banner') : t('sms.stop_first');
    buzz(true);
    if (safe && phone.open) tryReveal();
  } else if (machine.phase === 'idle') { buzz(false); }
  if (machine.phase === 'revealed' && !machine.touched && st.v >= 0.5 && !machine.deferred && !deferring) {
    deferring = true; machine.send('defer'); if (screen) screen.job = null; phone.iconOrder = null; phone.papers = null; deferring = false;
  }
  const job = screen?.job;
  if (job && (machine.phase === 'revealed' || machine.phase === 'answering') && now - job.shownAt > job.windowMs) {
    machine.send(machine.phase === 'answering' ? 'final' : 'expire');
    job.result = { outcome: 'wrong', final: true, attemptsLeft: 0 };
    phone.notice = t('sms.timeout'); phone.badge = null; buzz(false);
  }
}

export function tryReveal() {
  if (busy || machine.phase !== 'armed' || !rideId || !machine.event) return;
  const safe = !!(phone.slowSince && performance.now() - phone.slowSince >= 2000);
  if (!safe) { phone.notice = t('sms.stop_first'); return; }
  busy = true; const seq = machine.deferred ? 1 : 0; const shownAtUs = telemetryUs();
  machine.send('open');
  // The open body is strict: mac, variantSeq 0|1, safe as a boolean. Timing lives in the mg trace.
  post(`rides/${rideId}/minigames/${machine.event.id}/open`, { variantSeq: seq, mac, safe: true })
    .then(res => { applyOpen(res, shownAtUs); machine.send('reveal'); if (phone.app === 'maps') screen?.home(); })
    .catch(() => { machine.send('armed'); phone.notice = t('sms.fail'); })
    .finally(() => { busy = false; });
}

function applyOpen(res, shownAtUs) {
  const images = new Map();
  const layout = res.layout ?? {};
  const job = { id: res.id, kind: res.kind, variant: res.variant, phase: 'revealed', nonce: res.nonce, windowMs: res.windowMs ?? 30000, attemptsMax: res.attemptsMax ?? (res.kind === 'phone-sms' ? 3 : 1), layout, images, ui: 'list', draft: '', amount: '', shownAt: performance.now(), shownAtUs, firstTouchUs: null, attempt: 1, touched: false, result: null, frameId: null, rowId: null };
  if (screen) screen.job = job; traceReset(res.id); phone.badge = { id: MG_BADGE_APP[res.kind] ?? 'chat', n: 1 }; phone.notice = t('sms.banner');
  if (res.kind === 'phone-sms') { const model = smsModel(layout); if (model.iconOrder) phone.iconOrder = model.iconOrder; }
  for (const assetId of assetIdsOf(res)) loadAsset(res.id, assetId).then(bmp => { if (!bmp) return; images.set(assetId, bmp); refreshPapers(job); }).catch(() => {});
}

function assetIdsOf(res) {
  const ids = [];
  const push = id => { if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id); };
  for (const asset of res.assets ?? []) push(asset.id);
  const layout = res.layout ?? {};
  for (const th of layout.threads ?? []) { push(th.previewAsset); for (const b of th.bubbles ?? []) push(b.assetId); }
  for (const c of [...(layout.cab ?? []), ...(layout.cabAssets ?? [])]) push(c.assetId ?? c.id);
  return ids;
}

function refreshPapers(job) {
  const cab = smsModel(job.layout ?? {}).cab;
  if (!cab.length) return;
  phone.papers = cab.map(c => ({ slot: c.slot ?? 0, img: job.images.get(c.id) })).filter(p => p.img);
}

async function submit(answer) {
  const job = screen?.job; if (!job || !rideId || machine.phase !== 'revealed') return;
  const value = answer?.type === 'code' ? String(answer.value ?? '') : '';
  if (!/^[0-9]{1,6}$/.test(value)) return;
  if (!job.firstTouchUs) job.firstTouchUs = telemetryUs();
  machine.send('answer');
  try {
    const res = await post(`rides/${rideId}/minigames/${job.id}/answer`, { mac, nonce: job.nonce, attempt: job.attempt, answer: value, safe: st.v < 0.5 && !!st.park });
    const passed = res.outcome === 'passed' || res.outcome === 'correct';
    const final = passed || res.final === true || res.outcome === 'failed' || res.status === 'answered';
    const attemptsLeft = final ? 0 : Math.max(0, (job.attemptsMax ?? 3) - (res.attempts ?? job.attempt));
    job.result = { outcome: passed ? 'correct' : 'wrong', final, attemptsLeft, penaltyS: res.penaltyS ?? 0 };
    if (res.lessonId && screen) screen.lesson = { id: res.lessonId, until: performance.now() + 3500 };
    if (final) { machine.send('final'); phone.badge = null; phone.papers = null; buzz(false); }
    else { machine.send('again'); job.draft = ''; job.attempt = (res.attempts ?? job.attempt) + 1; }
  } catch (e) {
    if (e?.status === 410) { machine.send('final'); job.result = { outcome: 'wrong', final: true, attemptsLeft: 0 }; phone.notice = t('sms.timeout'); }
    else if (machine.phase === 'answering') machine.send('again');
  }
}

function loadAsset(eventId, assetId) {
  return fetch(`${API_BASE}/api/rides/${rideId}/minigames/${eventId}/assets/${assetId}`, { credentials: 'include', cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error('asset'); return r.blob(); })
    .then(bitmapFromBlob);
}

function bitmapFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const finish = bmp => { URL.revokeObjectURL(url); resolve(bmp); };
      const makeBitmap = globalThis.createImageBitmap;
      if (typeof makeBitmap === 'function') makeBitmap(img).then(finish, () => finish(img));
      else finish(img);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('asset')); };
    img.src = url;
  });
}

async function post(path, body) {
  const r = await fetch(`${API_BASE}/api/${path}`, { credentials: 'include', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.detail || j.title || 'minigame'), { status: r.status, code: j.code ?? null });
  return j;
}

function buzz(on) {
  if (typeof document === 'undefined') return;
  document.getElementById('phone')?.classList.toggle('buzz', on);
}
