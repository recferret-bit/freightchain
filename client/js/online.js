import { CFG } from './config.js';
import { st } from './state.js';
import { API_BASE } from './hosts.js';
import { startTelemetry, flushTelemetry, FLUSH_WAIT_MS } from './telemetry.js';
import { setLoadout } from './cosmetics.js';
import { showPrompt, resetPrompts } from './prompt.js';

/* Online mode – OPT-IN: only when the page was opened as play.html?ride=<id> (made by the lobby). Without it nothing here runs and the game
   behaves exactly like the offline prototype (headless test, e2e, viewer and the file:// build all rely on that).
   The server owns the ride: it hands out the seed + the shift length, times the ride from heartbeats and decides the result (server/src/rides). */
export const online = { ride: null, error: '', status: null, code: null, started: false, running: false, done: false, closed: false, extra: () => ({}) };   // extra: set by ui/game.js → { route, night } for the lobby's live feed (kept out of here so this module needs no world/ imports). status/code ride along on a failed load so the page can classify it without the message.

const api = async (path, body) => {
  const r = await fetch(`${API_BASE}/api/${path}`, { credentials: 'include', signal: AbortSignal.timeout(8000), method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.detail || j.title || `server error ${r.status}`), { status: r.status, code: j.code ?? null });   // RFC 9457 problem+json. Not api_request_failed: the page emits ride_load_failed / ride_start_failed.
  return j;
};
const progress = () => ({ s: st.s, t: st.t, hull: st.hull, paused: st.mode !== 'drive', crashesVehicle: st.crashV, crashesBuilding: st.crashB, ...online.extra() });   // t = the game's driven-seconds clock (the server credits its delta, capped by wall time)
let timer = 0;

export async function initOnline() {
  const id = typeof location === 'undefined' ? null : new URL(location.href).searchParams.get('ride');   // (no location in the headless test)
  if (!id) return;
  try {
    const r = await api(`rides/${encodeURIComponent(id)}`);
    if (r.status !== 'created') throw new Error(`this ride is ${r.status} – start a new one in the lobby`);
    online.ride = r;
    CFG.RIDE_MIN_SECONDS = r.minSeconds; CFG.COMPLETE_DIST = r.completeDist;   // both: COMPLETE_DIST was derived from RIDE_MIN_SECONDS at load
    api('wardrobe').then(w => { if (!online.started) setLoadout(w.equipped); }, () => { /* the default cockpit: a promo cosmetic is only a look */ });   // what the lobby's PROMO tab equipped; not awaited – the menu must not wait for a look
  } catch (e) {
    online.status = typeof e.status === 'number' ? e.status : null;
    online.code = typeof e.code === 'string' ? e.code : null;
    online.error = e.message === 'not signed in' ? 'not signed in – open the lobby and connect your wallet' : e.message;
  }
}

export async function beginOnline() {
  if (!online.ride || online.started) return;
  online.started = true;
  const started = await api(`rides/${online.ride.id}/start`, {});
  online.running = true;   // the server has started the ride: its road plan is served from now on (road-plan.js)
  setLoadout(started.loadout);   // what the server stamped on the ride (what spectators and replays draw) – normally what the menu already wore
  startTelemetry(online.ride.id);   // inputs + 10 Hz samples, uploaded in hash-chained batches (the server's verdict reads them)
  resetPrompts();
  timer = setInterval(() => api(`rides/${online.ride.id}/heartbeat`, progress()).then(r => showPrompt(r.challenge), () => { /* a lost beat is the server's call (timeout) */ }), 10_000);   // the response may carry a dispatch prompt (prompt.js): answer it with the key it names
}

/* The game tab closes (or reloads, or navigates away) mid-ride: the ride can never resume – a running ride is not re-opened – so END it now, as if the
   driver had ended the shift (the server decides completed / abandoned), instead of leaving it "on the road" until the heartbeat timeout and the sweep.
   A beacon is the one request a closing page can still send; it is text/plain (no CORS preflight) – the server reads it on this route only
   (server/src/infrastructure/http/middleware/beacon-body.middleware.ts). The last recording batch may not make it – that only costs coverage. */
if (typeof addEventListener === 'function') addEventListener('pagehide', () => {
  if (!online.ride || !online.started || online.done) return;   // also into the back/forward cache: that page COULD come back and beat on, but we can't
  online.done = online.closed = true; clearInterval(timer);      // know it will – counting it "on the road" is what made the board wrong; 'pageshow' below
  try { navigator.sendBeacon(`${API_BASE}/api/rides/${online.ride.id}/end`, new Blob([JSON.stringify({ outcome: 'shift', reason: 'the driver closed the game', ...progress() })], { type: 'text/plain' })); } catch { /* the timeout + sweep still end it */ }
});

/* Back to a game page the back/forward cache kept after that beacon: its ride is over on the server, so don't let it drive on unrecorded – reload, and
   the page says what became of the ride (initOnline: "this ride is abandoned – start a new one in the lobby"). */
if (typeof addEventListener === 'function') addEventListener('pageshow', e => { if (e.persisted && online.closed) location.reload(); });

/** outcome 'shift' = the driver ended the shift (the server decides complete / abandoned); 'failed' = crash etc. Idempotent. Resolves to the server's verdict. */
export async function endOnline(outcome, reason = '') {
  if (!online.ride || !online.started || online.done) return null;
  online.done = true; clearInterval(timer);
  const report = progress();   // taken now: the flush below is async
  await Promise.race([flushTelemetry().catch(() => {}), new Promise(ok => setTimeout(ok, FLUSH_WAIT_MS))]);   // bounded: a slow upload keeps retrying in the background (the server re-judges on arrival); a lost tail only costs coverage
  try { return await api(`rides/${online.ride.id}/end`, { outcome, reason, ...report }); } catch (e) { return { status: 'unknown', reason: e.message }; }
}
