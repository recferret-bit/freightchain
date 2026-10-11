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

export const provider = () => (typeof window === 'undefined' ? null : window.__fcDevWallet ?? window.phantom?.solana ?? window.solana ?? window.solflare);   // __fcDevWallet: site/dev-wallet.js, localhost only

/* none / phantom / solflare / injected. Do not look at window.solflare until provider() has chosen. */
export function walletName(p = provider()) {
  if (!p) return 'none';
  if (p.isPhantom) return 'phantom';
  if (p.isSolflare || (typeof window !== 'undefined' && p === window.solflare)) return 'solflare';
  return 'injected';
}

const refused = e => e?.code === 4001 || REJECT.test(e?.message ?? '');
const stamp = (e, stage) => { if (e && typeof e === 'object') e.stage = stage; return e; };

/** Detects SIWS capability: Wallet Standard feature or window provider method */
export function getSignInMethod(p = provider()) {
  if (!p) return null;
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
  } catch {
    return null; // Modal rejected or method threw: seamlessly fall back to legacy
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

export const signIn = signInOrFallback;
export const signOut = async () => { await api('auth/logout', {}); try { await provider()?.disconnect?.(); } catch { /* ignore */ } };
