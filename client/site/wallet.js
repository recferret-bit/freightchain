/* Wallet sign-in for the site pages (landing, lobby): connect an injected Solana wallet (Phantom / Solflare), sign the server's challenge,
   the server sets the httpOnly session cookie. No libraries – a 20-line base58 encoder is all the browser needs. */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58(bytes) {
  let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = ''; while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b) break; out = '1' + out; }
  return out;
}

import { API_BASE } from '../js/hosts.js';
import { track } from '../js/analytics.js';

const REJECT = /reject|cancel|closed/i;

/* `opts` is the third argument: never serialized, never the method switch. Omitted opts still report.
   timeoutMs: give up (the game's polls – a hung request must not stall the next one). */
export async function api(path, body, opts) {
  const report = opts?.report !== false;
  const timeoutMs = opts?.timeoutMs;
  try {
    const r = await fetch(`${API_BASE}/api/${path}`, { credentials: 'include', method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.detail || j.title || `server error ${r.status}`), { status: r.status, code: j.code ?? null });   // RFC 9457 problem+json: { title, detail, code, … }
    return j;
  } catch (e) {
    if (report) track('api_request_failed', { route: routeOf(path), http_status: typeof e.status === 'number' ? e.status : null, code: typeof e.code === 'string' ? e.code : null, surface: surface() });
    throw e;   // the same Error, status and code already attached
  }
}

/* The id is not the route: a ride uuid becomes :id so the relay stores a template. */
function routeOf(path) {
  return String(path).split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
}
function surface() {
  if (typeof location === 'undefined') return 'landing';
  const p = location.pathname;
  if (p.endsWith('/lobby.html')) return 'lobby';
  if (p.endsWith('/play.html')) return 'game';
  return 'landing';
}

export const provider = () => window.__fcDevWallet ?? window.phantom?.solana ?? window.solana ?? window.solflare;   // __fcDevWallet: site/dev-wallet.js, localhost only

/* none / phantom / solflare / injected. Do not look at window.solflare until provider() has chosen. */
export function walletName(p = provider()) {
  if (!p) return 'none';
  if (p.isPhantom) return 'phantom';
  if (p.isSolflare || p === window.solflare) return 'solflare';
  return 'injected';
}

const refused = e => e?.code === 4001 || REJECT.test(e?.message ?? '');
const stamp = (e, stage) => { if (e && typeof e === 'object') e.stage = stage; return e; };

export async function signIn() {
  const p = provider();
  const wallet_name = walletName(p);
  try {
    if (!p) throw new Error('No Solana wallet found – install Phantom or Solflare');
    try { await p.connect(); } catch (e) { throw stamp(e, refused(e) ? 'connect_rejected' : 'unknown'); }
    const wallet = p.publicKey.toString();   // Phantom and Solflare both expose it after connect(); connect()'s return shape differs
    let message;
    try { ({ message } = await api('auth/nonce', { wallet }, { report: false })); } catch (e) { throw stamp(e, 'nonce_failed'); }
    track('wallet_signature_requested', { wallet_name });   // just before signMessage; no message, nonce, or pubkey
    let res;
    try { res = await p.signMessage(new TextEncoder().encode(message), 'utf8'); } catch (e) { throw stamp(e, refused(e) ? 'sign_rejected' : 'unknown'); }   // Phantom: { signature }, Solflare: the bytes
    try { return await api('auth/verify', { wallet, signature: b58(res.signature ?? res) }, { report: false }); } catch (e) { throw stamp(e, 'verify_failed'); }
  } catch (e) {
    const stage = e?.stage || (String(e?.message ?? '').startsWith('No Solana wallet found') ? 'no_provider' : 'unknown');
    track('sign_in_failed', { stage, http_status: typeof e?.status === 'number' ? e.status : null, code: typeof e?.code === 'string' ? e.code : null, wallet_name });
    throw e;   // landing's catch text stays the Error it already showed
  }
}
export const signOut = async () => { await api('auth/logout', {}); try { await provider()?.disconnect?.(); } catch { /* ignore */ } };
