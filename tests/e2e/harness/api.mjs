/* HTTP client for the dockerised API. A tweetnacl keypair stands in for the wallet extension. */
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export const BASE = process.env.E2E_BASE || '';
export const REQUIRE = process.env.E2E_REQUIRE === '1';
export const SOLANA = process.env.E2E_SOLANA_RPC || '';

export function apiTest(test, name, fn, options = {}) {
  if (!BASE && REQUIRE) {
    test(name, () => { throw new Error('E2E_BASE is required (npm run test:e2e:block1)'); });
    return;
  }
  test(name, { skip: BASE ? false : 'E2E_BASE is not set — npm run test:e2e:block1 starts the stack', ...options }, fn);
}

export function chainTest(test, name, fn) {
  if (!SOLANA && process.env.E2E_REQUIRE_CHAIN === '1') {
    test(name, () => { throw new Error('E2E_SOLANA_RPC is required (npm run test:e2e:block2)'); });
    return;
  }
  test(name, { skip: SOLANA ? false : 'E2E_SOLANA_RPC is not set — npm run test:e2e:block2 starts the validator' }, fn);
}

export function keypair(seed) {
  const kp = seed ? nacl.sign.keyPair.fromSeed(seed) : nacl.sign.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey, wallet: bs58.encode(kp.publicKey) };
}

/** The localhost admin dev wallet. Its seed is public in client/site/dev-wallet.js and is useless off this suite. */
export function devAdmin() {
  return keypair(new TextEncoder().encode('freightchain-local-dev-admin-key'));
}

export function sign(secretKey, message) {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), secretKey));
}

export function session(base = BASE) {
  let cookie = '';
  async function call(path, { method, body, headers } = {}) {
    const r = await fetch(base + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    const parts = set.length ? set : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
    for (const c of parts) {
      const pair = c.split(';')[0];
      const name = pair.split('=')[0];
      const kept = cookie.split('; ').filter((p) => p && !p.startsWith(name + '='));
      cookie = [...kept, pair].join('; ');
    }
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { status: r.status, json };
  }
  return { call, cookie: () => cookie };
}

export async function signInPlayer(api, keys = keypair()) {
  const nonce = await api.call('/api/auth/nonce', { body: { wallet: keys.wallet } });
  if (nonce.status !== 200) throw new Error(`nonce ${nonce.status} ${JSON.stringify(nonce.json)}`);
  const ver = await api.call('/api/auth/verify', { body: { wallet: keys.wallet, signature: sign(keys.secretKey, nonce.json.message) } });
  if (ver.status !== 200) throw new Error(`verify ${ver.status} ${JSON.stringify(ver.json)}`);
  return { ...keys, me: ver.json };
}

export async function signInAdmin(api, keys = devAdmin()) {
  const hdr = { 'x-fc-admin': '1' };
  const nonce = await api.call('/api/admin/auth/nonce', { body: { wallet: keys.wallet }, headers: hdr });
  if (nonce.status !== 200) throw new Error(`admin nonce ${nonce.status} ${JSON.stringify(nonce.json)}`);
  const ver = await api.call('/api/admin/auth/verify', {
    body: { wallet: keys.wallet, signature: sign(keys.secretKey, nonce.json.message) },
    headers: hdr,
  });
  if (ver.status !== 200) throw new Error(`admin verify ${ver.status} ${JSON.stringify(ver.json)}`);
  return { ...keys, session: ver.json };
}

/** Admin changes: ask for the exact text, sign it, return the signature. */
export async function adminSign(api, keys, path, body) {
  const ch = await api.call(path, { body, headers: { 'x-fc-admin': '1' } });
  if (ch.status !== 200) throw new Error(`challenge ${path} ${ch.status} ${JSON.stringify(ch.json)}`);
  return sign(keys.secretKey, ch.json.message);
}
