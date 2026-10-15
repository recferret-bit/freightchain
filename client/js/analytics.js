/* First-party analytics. The browser posts an allowlisted batch to our API.
   It does not load posthog-js and never sees the project key.
   Nothing runs at import: no fetch, no localStorage, no Math.random.
   Headless (no location) and file:// stay silent so the offline trace does not move. */

import { API_BASE } from './hosts.js';
import { store } from './util.js';

const ANON = 'freightchain.anon';
const ALIASED = 'freightchain.aliased';
const V4 = /^anon_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/* Hard-deleted even if a caller spreads an error or a payment body. The give-up string embeds the signature. */
const BANNED = new Set(['signature', 'nonce', 'message', 'token', 'seed', 'cookie', 'authorization', 'detail', 'secret', 'anon_id', 'transaction']);

let credentials = 'include';   // the pitch deck sends without the session cookie (configure)
let disabled = false;   // document lifetime, not localStorage: one probe, then silence
let timer = 0;
let inflight = 0;
let leaveHooked = false;
let aliasWallet = null;   // freightchain.aliased is written only after { enabled: true }
const queue = [];

function live() {
  if (disabled) return false;
  if (typeof location === 'undefined') return false;   // headless
  if (location.protocol === 'file:') return false;
  return true;
}

/** `credentials: 'omit'` for a page that must not carry the player session (the pitch deck: its page views are anonymous) */
export function configure(opts) { if (opts?.credentials === 'omit' || opts?.credentials === 'include') credentials = opts.credentials; }

export function anonId() {
  const cur = store.get(ANON);
  if (typeof cur === 'string' && V4.test(cur)) return cur;
  const id = `anon_${globalThis.crypto.randomUUID()}`;
  store.set(ANON, id);
  return id;
}

/* `wallet` is read by track() for the alias flag and is not a wire property. */
function clean(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const [k, v] of Object.entries(src)) {
    if (k === 'wallet' || BANNED.has(k) || v === undefined) continue;
    if (v === null) out[k] = null;
    else if (typeof v === 'boolean' || (typeof v === 'number' && Number.isInteger(v))) out[k] = v;
    else if (typeof v === 'string') out[k] = v.length > 200 ? v.slice(0, 200) : v;
  }
  return out;
}

function hookLeave() {
  if (leaveHooked || typeof addEventListener !== 'function') return;
  leaveHooked = true;
  const go = () => flushSoon();
  addEventListener('pagehide', go);
  addEventListener('visibilitychange', () => { if (document.hidden) go(); });
}

export function track(event, properties) {
  if (!live()) return;
  hookLeave();
  const src = properties && typeof properties === 'object' ? properties : {};
  let requestAlias = false;
  if (event === 'session_restored') {
    const wallet = typeof src.wallet === 'string' ? src.wallet : '';
    requestAlias = !!wallet && store.get(ALIASED) !== wallet;
    if (requestAlias) aliasWallet = wallet;
  }
  const props = clean(src);
  if (event === 'session_restored') props.request_alias = requestAlias;
  const ev = { event, properties: props };
  if (requestAlias) ev.request_alias = true;   // sibling of properties; only this event, only when not yet aliased
  queue.push(ev);
  if (queue.length >= 10) pump(false);
  else if (!timer) timer = setTimeout(() => { timer = 0; pump(false); }, 300);
}

/* `force` starts the request even while one is in flight. pagehide must call fetch synchronously:
   a timer armed from the previous request's finally does not run once the document is gone. */
export function flushSoon() {
  if (timer) { clearTimeout(timer); timer = 0; }
  pump(true);
}

function pump(force) {
  if (disabled || !queue.length || !live()) return;
  if (inflight && !force) return;
  if (timer) { clearTimeout(timer); timer = 0; }
  const events = queue.splice(0, 10);
  const marking = events.some(e => e.request_alias) ? aliasWallet : null;
  inflight++;
  void finish(events, marking);
}

async function finish(events, marking) {
  try {
    const r = await fetch(`${API_BASE}/api/telemetry`, { credentials, keepalive: true, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anon_id: anonId(), events }) });
    const j = await r.json().catch(() => null);
    if (r.ok && j && j.enabled === false) { disabled = true; queue.length = 0; return; }   // do not consume the alias flag
    if (r.ok && j && j.enabled === true && marking) store.set(ALIASED, marking);
  } catch { /* a telemetry failure must not surface in the UI */ }
  finally {
    inflight--;
    if (!disabled && inflight === 0 && queue.length) {
      if (queue.length >= 10) pump(false);
      else if (!timer) timer = setTimeout(() => { timer = 0; pump(false); }, 300);
    }
  }
}
