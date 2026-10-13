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
import { store } from '../js/util.js';
import { wallets, walletLabel } from './wallet-standard.js';

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

/** Which wallet signs in: none → the install / open-in-wallet panel (then throws no_provider); one → it; several → the picker. */
export async function chooseWallet() {
  if (typeof window !== 'undefined' && window.__fcDevWallet) return window.__fcDevWallet;
  const all = wallets();
  if (all.length === 1) return all[0];
  const { pickWallet } = await import('./wallet-picker.js');
  const p = await pickWallet(all, walletLabel, store.get(PICKED));
  if (!p) throw stamp(new Error(all.length ? 'No wallet chosen.' : 'No Solana wallet found – install Phantom or Solflare'), all.length ? 'connect_rejected' : 'no_provider');
  return p;
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

/** Detects SIWS capability: Wallet Standard feature or window provider method */
export function getSignInMethod(p = provider()) {
  if (!p) return null;
  if (p.standard) return p.features['solana:signIn'] ? input => p.signIn(input) : null;   // through the adapter: it keeps the account the wallet signed in with
  if (typeof p.features?.['solana:signIn']?.signIn === 'function') {
    return async (input) => {
      const res = await p.features['solana:signIn'].signIn(input);
      return Array.isArray(res) ? res[0] : res;
    };
  }
  if (typeof p.signIn === 'function') {
    return async (input) => {
      const res = await p.signIn(input);
      return Array.isArray(res) ? res[0] : res;
    };
  }
  return null;
}

/** Attempts 1-click Native SIWS; returns session on success or null to trigger fallback */
async function tryNativeSignIn(p, wallet_name) {
  const signInMethod = getSignInMethod(p);
  if (!signInMethod) return null;

  let challenge;
  try {
    challenge = await api('auth/nonce', {}, { report: false });
  } catch {
    return null;
  }

  const knownWallet = p.publicKey?.toString();
  const signInInput = {
    domain: challenge.domain,
    statement: challenge.statement,
    uri: challenge.uri,
    version: challenge.version,
    chainId: challenge.chainId,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expirationTime: challenge.expirationTime,
    ...(challenge.address ? { address: challenge.address } : (knownWallet ? { address: knownWallet } : {})),
  };

  track('wallet_signature_requested', { wallet_name });

  let out;
  try {
    out = await signInMethod(signInInput);
  } catch (e) {
    if (refused(e)) throw stamp(e, 'sign_rejected');   // the visitor said no: no second prompt
    return null;   // the wallet's signIn is broken / unsupported for this input: fall back to connect + signMessage
  }

  if (!out?.signature) return null;

  const wallet = out.account?.address ?? (out.account?.publicKey ? b58(out.account.publicKey) : p.publicKey?.toString());
  if (!wallet) return null;

  const signature = b58(out.signature);
  const message = out.signedMessage ? new globalThis.TextDecoder().decode(out.signedMessage) : challenge.message;
  const nonce = challenge.nonce;

  try {
    return await api('auth/verify', { wallet, signature, message, nonce }, { report: false });
  } catch (e) {
    if (e?.status === 401) return null;   // the wallet changed a field of the issued sign-in text: the server-built message (connect + signMessage) still works
    throw stamp(e, 'verify_failed');
  }
}

/** Legacy 2-step sign-in: connect() + signMessage() */
async function legacySignIn(p, wallet_name) {
  try { await p.connect(); } catch (e) { throw stamp(e, refused(e) ? 'connect_rejected' : 'unknown'); }
  const wallet = p.publicKey.toString();   // Phantom and Solflare both expose it after connect(); connect()'s return shape differs
  let challenge;
  try { challenge = await api('auth/nonce', { wallet }, { report: false }); } catch (e) { throw stamp(e, 'nonce_failed'); }
  track('wallet_signature_requested', { wallet_name });   // just before signMessage; no message, nonce, or pubkey
  let res;
  try { res = await p.signMessage(new TextEncoder().encode(challenge.message), 'utf8'); } catch (e) { throw stamp(e, refused(e) ? 'sign_rejected' : 'unknown'); }   // Phantom: { signature }, Solflare: the bytes
  try { return await api('auth/verify', { wallet, signature: b58(res.signature ?? res) }, { report: false }); } catch (e) { throw stamp(e, 'verify_failed'); }
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

/** CONNECT: choose the wallet (picker when several), remember it for the payments on this origin, then sign in. */
export async function signIn() {
  let p;
  try { p = await chooseWallet(); } catch (e) { track('sign_in_failed', { stage: e?.stage ?? 'unknown', http_status: null, code: null, wallet_name: 'none' }); throw e; }
  const session = await signInOrFallback(p);
  rememberWallet(p);   // only a wallet that actually signed in becomes the paying one
  return session;
}
/** The wallet the payments on this origin use from now on (provider() looks it up by label). */
export const rememberWallet = p => { if (p && !p.isDevWallet) store.set(PICKED, walletLabel(p)); };
export const signOut = async () => { await api('auth/logout', {}); try { await provider()?.disconnect?.(); } catch { /* ignore */ } };
