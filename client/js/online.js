import { CFG } from './config.js';
import { st } from './state.js';
import { API_BASE } from './hosts.js';

/* Online mode – OPT-IN: only when the page was opened as play.html?ride=<id> (made by the lobby). Without it nothing here runs and the game
   behaves exactly like the offline prototype (headless test, e2e, viewer and the file:// build all rely on that).
   The server owns the ride: it hands out the seed + the shift length, times the ride from heartbeats and decides the result (server/src/rides). */
export const online = { ride: null, error: '', status: null, code: null, started: false, done: false, extra: () => ({}) };   // extra: set by ui/game.js → { route, night } for the lobby's live feed (kept out of here so this module needs no world/ imports). status/code ride along on a failed load so the page can classify it without the message.

const api = async (path, body) => {
  const r = await fetch(`${API_BASE}/api/${path}`, { credentials: 'include', signal: AbortSignal.timeout(8000), method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.detail || j.title || `server error ${r.status}`), { status: r.status, code: j.code ?? null });   // RFC 9457 problem+json. Not api_request_failed: the page emits ride_load_failed / ride_start_failed.
  return j;
};
const progress = () => ({ s: st.s, t: st.t, hull: st.hull, paused: st.mode !== 'drive', ...online.extra() });   // t = the game's driven-seconds clock (the server credits its delta, capped by wall time)
let timer = 0;

export async function initOnline() {
  const id = typeof location === 'undefined' ? null : new URL(location.href).searchParams.get('ride');   // (no location in the headless test)
  if (!id) return;
  try {
    const r = await api(`rides/${encodeURIComponent(id)}`);
    if (r.status !== 'created') throw new Error(`this ride is ${r.status} – start a new one in the lobby`);
    online.ride = r;
    CFG.RIDE_MIN_SECONDS = r.minSeconds; CFG.COMPLETE_DIST = r.completeDist;   // both: COMPLETE_DIST was derived from RIDE_MIN_SECONDS at load
  } catch (e) {
    online.status = typeof e.status === 'number' ? e.status : null;
    online.code = typeof e.code === 'string' ? e.code : null;
    online.error = e.message === 'not signed in' ? 'not signed in – open the lobby and connect your wallet' : e.message;
  }
}

export async function beginOnline() {
  if (!online.ride || online.started) return;
  online.started = true;
  await api(`rides/${online.ride.id}/start`, {});
  timer = setInterval(() => api(`rides/${online.ride.id}/heartbeat`, progress()).catch(() => { /* a lost beat is the server's call (timeout) */ }), 10_000);
}

/** outcome 'shift' = the driver ended the shift (the server decides complete / abandoned); 'failed' = crash etc. Idempotent. Resolves to the server's verdict. */
export async function endOnline(outcome, reason = '') {
  if (!online.ride || !online.started || online.done) return null;
  online.done = true; clearInterval(timer);
  try { return await api(`rides/${online.ride.id}/end`, { outcome, reason, ...progress() }); } catch (e) { return { status: 'unknown', reason: e.message }; }
}
