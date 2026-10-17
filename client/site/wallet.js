/* Wallet sign-in for the site pages (landing, lobby): the shared handlers in js/wallet/ open the wallet, this file talks to the player API
   and the server sets the httpOnly session cookie. */
import { API_BASE } from '../js/hosts.js';
import { track } from '../js/analytics.js';
import { store } from '../js/util.js';
import { b58 } from '../js/wallet/b58.js';
import { chooseWallet as chooseShared, getSignInMethod, signInWith, warmChallenge } from '../js/wallet/handlers.js';
import { wallets, walletLabel } from '../js/wallet/standard.js';

export { b58, getSignInMethod };

const REJECT = /reject|cancel|closed/i;

/* `opts` is the third argument: never serialized. The method is POST when there is a body, unless opts.method says otherwise (the profile boxes are PUT).
   timeoutMs: give up (the game's polls – a hung request must not stall the next one). */
export async function api(path, body, opts) {
  const report = opts?.report !== false;
  const timeoutMs = opts?.timeoutMs;
  const method = opts?.method ?? (body ? 'POST' : 'GET');
  try {
    const r = await fetch(`${API_BASE}/api/${path}`, { credentials: 'include', cache: 'no-store', method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined });   // no-store: a buy credits tickets, and a cached GET /api/me would paint the old count
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

const PICKED = 'freightchain.wallet';   // the label of the wallet the visitor last signed in with (per origin: the landing and the lobby may each ask once)
/** The wallet to use: the localhost dev wallet, else the one picked at sign-in, else the only / first one found (Wallet Standard first, then legacy globals). */
export function provider() {
  if (typeof window === 'undefined') return null;
  if (window.__fcDevWallet) return window.__fcDevWallet;   // site/dev-wallet.js, localhost only
  const all = wallets(), picked = store.get(PICKED);
  return all.find(p => walletLabel(p) === picked) ?? all[0] ?? null;
}

/* none / phantom / solflare / backpack / standard / injected – a fixed set (analytics wallet_name), never a wallet's own free-text name. */
export function walletName(p = provider()) {
  if (!p) return 'none';
  const n = p.standard ? p.name.toLowerCase() : '';
  if (p.isPhantom || n === 'phantom') return 'phantom';
  if (p.isSolflare || n === 'solflare' || (!p.standard && typeof window !== 'undefined' && p === window.solflare)) return 'solflare';
  if (p.isBackpack || n === 'backpack') return 'backpack';
  return p.standard ? 'standard' : 'injected';
}

/** Which wallet signs in. The list always opens in the browser, including when only one wallet is installed. `onPick` runs in the row click. */
export async function chooseWallet(onPick) {
  try { return await chooseShared(store.get(PICKED), onPick, { phone: true, api }); }
  catch (e) { throw stamp(e, e?.stage ?? 'unknown'); }
}

/** Connects `p` to `address` (the account the server built the transaction for) or says plainly that the wallet is on another account. */
export async function ensureAccount(p, address) {
  if (p.standard) return p.ensure(address);
  const r = p.publicKey ? null : await p.connect();
  const now = (r?.publicKey ?? p.publicKey)?.toString();   // Phantom / Solflare set publicKey; connect()'s return shape differs
  if (address && now && now !== address) throw Object.assign(new Error(`The wallet is on account ${shortAddr(now)}, but you are signed in as ${shortAddr(address)} – switch the account in the wallet, or sign out and in again.`), { code: 'wallet_account_mismatch' });
}
const shortAddr = a => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : 'none');

/** The wallet that pays for `address` (the signed-in account): the one picked at sign-in on this origin, else a standard wallet that already holds the account,
 *  else ask (several wallets – the pick is per origin, so the watch page or an old session may not have one), else the only one. */
export async function payingWallet(address) {
  if (typeof window === 'undefined') return null;
  if (window.__fcDevWallet) return window.__fcDevWallet;
  const all = wallets(), picked = all.find(p => walletLabel(p) === store.get(PICKED));
  if (picked) return picked;
  const holder = all.find(p => p.standard && address && p.holds(address));
  if (holder) return holder;
  if (all.length > 1) { const p = await chooseWallet(); rememberWallet(p); return p; }
  return all[0] ?? null;
}

const refused = e => e?.code === 4001 || REJECT.test(e?.message ?? '');
const stamp = (e, stage) => { if (e && typeof e === 'object') e.stage = stage; return e; };

/** Attempts 1-click Native SIWS; returns session on success or null to trigger fallback */
async function tryNativeSignIn(p, wallet_name) {
  if (!getSignInMethod(p)) return null;
  let challenge;
  try { challenge = await api('auth/nonce', {}, { report: false }); } catch { return null; }
  track('wallet_signature_requested', { wallet_name });
  let signed;
  try { signed = await signInWith(p, challenge); }   // the shared handler: one sheet, or null when this wallet cannot sign in that way
  catch (e) { if (refused(e)) throw stamp(e, 'sign_rejected'); return null; }   // the visitor said no: no second prompt
  if (!signed) return null;
  try { return await api('auth/verify', { wallet: signed.wallet, signature: signed.signature, message: signed.message, nonce: signed.nonce }, { report: false }); }
  catch (e) { if (e?.status === 401) return null; throw stamp(e, 'verify_failed'); }   // a rewritten sign-in text: connect + signMessage still works
}

/** signMessage after the wallet is already connected. */
async function legacyAfterConnect(p, wallet_name) {
  const wallet = p.publicKey.toString();   // Phantom and Solflare both expose it after connect(); connect()'s return shape differs
  let challenge;
  try { challenge = await api('auth/nonce', { wallet }, { report: false }); } catch (e) { throw stamp(e, 'nonce_failed'); }
  track('wallet_signature_requested', { wallet_name });   // just before signMessage; no message, nonce, or pubkey
  let res;
  try { res = await p.signMessage(new TextEncoder().encode(challenge.message), 'utf8'); } catch (e) { throw stamp(e, refused(e) ? 'sign_rejected' : 'unknown'); }   // Phantom: { signature }, Solflare: the bytes
  try { return await api('auth/verify', { wallet, signature: b58(res.signature ?? res) }, { report: false }); } catch (e) { throw stamp(e, 'verify_failed'); }
}

/** Legacy 2-step sign-in: connect() + signMessage() */
async function legacySignIn(p, wallet_name) {
  try { await p.connect(); } catch (e) { throw stamp(e, refused(e) ? 'connect_rejected' : 'unknown'); }
  return legacyAfterConnect(p, wallet_name);
}

/** 1-click SIWS with seamless fallback to legacy message signing */
export async function signInOrFallback(p = provider()) {
  const wallet_name = walletName(p);
  try {
    if (!p) throw stamp(new Error('No Solana wallet found – install Phantom or Solflare'), 'no_provider');
    const session = await tryNativeSignIn(p, wallet_name);
    if (session) return session;
    return await legacySignIn(p, wallet_name);
  } catch (e) {
    const stage = e?.stage || (String(e?.message ?? '').startsWith('No Solana wallet found') ? 'no_provider' : 'unknown');
    track('sign_in_failed', { stage, http_status: typeof e?.status === 'number' ? e.status : null, code: typeof e?.code === 'string' ? e.code : null, wallet_name });
    throw e;   // landing's catch text stays the Error it already showed
  }
}

let warmed = null;
/** Start the nonce now. CONNECT calls solana:signIn inside the click only when this has already returned — Phantom draws no window after an await. */
export function prepareSignIn() {
  if (!warmed) warmed = warmChallenge(() => api('auth/nonce', {}, { report: false }));
  else warmed.keep();
  return warmed;
}

/** The signature that `job` already started, or null when this wallet cannot sign that way. A rejection throws. */
async function finishArmed(p, job, wallet_name) {
  if (job.mode === 'connect') {
    try { await job.pending; } catch (e) { throw stamp(e, refused(e) ? 'connect_rejected' : 'unknown'); }
    return legacyAfterConnect(p, wallet_name);
  }
  if (job.mode === 'wait') {
    let challenge;
    try { challenge = await job.prep.promise(); } catch { return null; }
    if (!challenge) return null;
    track('wallet_signature_requested', { wallet_name });
    let signed;
    try { signed = await signInWith(p, challenge); }
    catch (e) { if (refused(e)) throw stamp(e, 'sign_rejected'); return null; }
    if (!signed) return null;
    try { return await api('auth/verify', { wallet: signed.wallet, signature: signed.signature, message: signed.message, nonce: signed.nonce }, { report: false }); }
    catch (e) { if (e?.status === 401) return null; throw stamp(e, 'verify_failed'); }
  }
  track('wallet_signature_requested', { wallet_name });
  let signed;
  try { signed = await job.pending; }
  catch (e) { if (refused(e)) throw stamp(e, 'sign_rejected'); return null; }
  if (!signed) return null;
  try { return await api('auth/verify', { wallet: signed.wallet, signature: signed.signature, message: signed.message, nonce: signed.nonce }, { report: false }); }
  catch (e) { if (e?.status === 401) return null; throw stamp(e, 'verify_failed'); }
}

/** CONNECT: the wallet the visitor picks. solana:signIn is started inside that click when the nonce is already here. */
export async function signIn() {
  const prep = prepareSignIn();
  let job = null;
  let p;
  try { p = await chooseWallet(w => { job = prep.arm(w); }); }   // the site wrapper already supplies the remembered label; the function runs inside the click
  catch (e) { track('sign_in_failed', { stage: e?.stage ?? 'unknown', http_status: null, code: null, wallet_name: 'none' }); throw e; }
  if (p?.phone) return api('me');   // the QR poll already set this browser's session cookie
  if (!job) job = prep.arm(p);
  job.prep = prep;
  const wallet_name = walletName(p);
  try {
    const session = await finishArmed(p, job, wallet_name) ?? await legacySignIn(p, wallet_name);
    rememberWallet(p);
    return session;
  } catch (e) {
    const stage = e?.stage || 'unknown';
    track('sign_in_failed', { stage, http_status: typeof e?.status === 'number' ? e.status : null, code: typeof e?.code === 'string' ? e.code : null, wallet_name });
    throw e;
  }
}
/** The wallet the payments on this origin use from now on (provider() looks it up by label). */
export const rememberWallet = p => { if (p && !p.isDevWallet) store.set(PICKED, walletLabel(p)); };
export const signOut = async () => { await api('auth/logout', {}); try { await provider()?.disconnect?.(); } catch { /* ignore */ } };
