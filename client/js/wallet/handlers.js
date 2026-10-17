/* Shared wallet handlers. The landing and the model editor both open a wallet through here – a second copy is what left
   CONNECT WALLET sitting on "opening your wallet…". signInWith is the call the landing page makes (solana:signIn with the
   server's challenge). connectAddress + signBytes is the fallback when the wallet has no sign-in. */
import { b58 } from './b58.js';
import { walletLabel, wallets } from './standard.js';

const REJECT = /reject|cancel|closed/i;
export const refused = e => e?.code === 4001 || REJECT.test(String(e?.message ?? ''));

/** solana:signIn if this wallet has it: the standard feature, else the injected provider's own method. */
export function getSignInMethod(p) {
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

/** The fields solana:signIn expects, taken only from the server's challenge. */
export function signInInput(p, challenge) {
  const known = p.publicKey?.toString?.();
  return {
    domain: challenge.domain, statement: challenge.statement, uri: challenge.uri, version: challenge.version,
    chainId: challenge.chainId, nonce: challenge.nonce, issuedAt: challenge.issuedAt, expirationTime: challenge.expirationTime,
    ...(challenge.address ? { address: challenge.address } : (known ? { address: known } : {})),
  };
}

/** One sign-in sheet. Null when this wallet cannot do it (the caller connects and signs the message instead). A rejection throws. */
export async function signInWith(p, challenge) {
  const signIn = getSignInMethod(p);
  if (!signIn) return null;
  let out;
  try { out = await signIn(signInInput(p, challenge)); }
  catch (e) { if (refused(e)) throw e; return null; }
  if (!out?.signature) return null;
  const wallet = out.account?.address ?? (out.account?.publicKey ? b58(out.account.publicKey) : null) ?? out.publicKey?.toString?.() ?? p.publicKey?.toString?.();
  if (!wallet) return null;
  const message = out.signedMessage ? new globalThis.TextDecoder().decode(out.signedMessage) : challenge.message;
  return { wallet, signature: b58(out.signature), message, nonce: challenge.nonce };
}

/** The injected / standard connect() the landing page falls back to. Returns the address the wallet shared. */
export async function connectAddress(p) {
  const opened = await p.connect();
  const wallet = (opened?.publicKey ?? p.publicKey)?.toString?.();
  if (!wallet) throw new Error('the wallet did not share an address');
  return wallet;
}

/** signMessage, base58. Phantom returns { signature }, Solflare the bytes. */
export async function signBytes(p, message) {
  const res = await p.signMessage(new TextEncoder().encode(message), 'utf8');
  return b58(res?.signature ?? res);
}

/** The challenge names this page, so Phantom will show it. A different host is dropped with no window. */
function pageOwns(c) {
  if (typeof location === 'undefined' || !c) return false;
  if (c.domain && c.domain !== location.host) return false;
  if (c.uri && !String(c.uri).startsWith(location.origin)) return false;
  return !!(c.domain || c.nonce || c.message);
}

/** Call from the click that chose `p`, before any await. Returns `{ mode, pending }`.
 *  `signin` — solana:signIn already started (one sheet), and the challenge names this page.
 *  `wait` — the wallet can sign in, but the challenge is not this page's yet (calling it would open nothing).
 *  `connect` — the wallet has no sign-in. connect() is already started, so the window opens in this click. */
export function beginWallet(p, challenge) {
  if (!getSignInMethod(p)) return { mode: 'connect', pending: connectAddress(p) };
  if (challenge && pageOwns(challenge)) return { mode: 'signin', pending: signInWith(p, challenge) };
  return { mode: 'wait', pending: null };
}

const FRESH_MS = 4 * 60 * 1000;   // the server's nonce lives 5 minutes; leave a minute so a click does not sign an expired one
/** Start `load()` now. `arm(p)` inside the click that chose `p` calls solana:signIn before any await — Phantom draws no window after one.
 *  Call it when the button is shown (and again on pointerdown). A click that arrives before the nonce is the `wait` path. */
export function warmChallenge(load) {
  let value = null, error = null, settled = false, at = 0, promise = null;
  const run = () => {
    settled = false; error = null; value = null;
    promise = Promise.resolve().then(load).then(v => { value = v; settled = true; at = Date.now(); return v; }, e => { error = e; settled = true; throw e; });
    return promise;
  };
  run();
  const api = {
    ready() { return settled && !error && value && Date.now() - at <= FRESH_MS && pageOwns(value) ? value : null; },
    promise() { return promise; },
    keep() { if (settled && !api.ready()) run(); },
    arm(p) { return beginWallet(p, api.ready()); },
  };
  return api;
}

/** The list, even when only one wallet is installed, so CONNECT does not skip the choice. No document (unit tests): the single wallet is used.
 *  `onPick` runs inside the row click. `opts.phone` adds the desktop QR that signs this browser in from a phone. */
export async function chooseWallet(remembered = null, onPick = null, opts = null) {
  if (typeof window !== 'undefined' && window.__fcDevWallet) { onPick?.(window.__fcDevWallet); return window.__fcDevWallet; }
  const all = wallets();
  const ui = typeof document !== 'undefined' && document.body;
  if (!ui) {
    if (all.length === 1) { onPick?.(all[0]); return all[0]; }
    const e = new Error(all.length ? 'No wallet chosen.' : 'No Solana wallet found – install Phantom, Solflare, or Backpack');
    e.stage = all.length ? 'connect_rejected' : 'no_provider';
    throw e;
  }
  const { pickWallet } = await import('./picker.js');
  const p = await pickWallet(all, walletLabel, remembered, onPick, opts);
  if (p?.phone) return p;
  if (!p) {
    const e = new Error(all.length ? 'No wallet chosen.' : 'No Solana wallet found – install Phantom, Solflare, or Backpack');
    e.stage = all.length ? 'connect_rejected' : 'no_provider';
    throw e;
  }
  return p;
}
