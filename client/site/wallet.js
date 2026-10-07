/* Wallet sign-in for the site pages (landing, lobby): connect an injected Solana wallet (Phantom / Solflare), sign the server's challenge,
   the server sets the httpOnly session cookie. No libraries – a 20-line base58 encoder is all the browser needs. */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58(bytes) {
  let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = ''; while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b) break; out = '1' + out; }
  return out;
}

export async function api(path, body) {
  const r = await fetch(`/api/${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message || `server error ${r.status}`), { status: r.status });
  return j;
}

export const provider = () => window.phantom?.solana ?? window.solana ?? window.solflare;

export async function signIn() {
  const p = provider();
  if (!p) throw new Error('No Solana wallet found – install Phantom or Solflare');
  await p.connect();
  const wallet = p.publicKey.toString();   // Phantom and Solflare both expose it after connect(); connect()'s return shape differs
  const { message } = await api('auth/nonce', { wallet });
  const res = await p.signMessage(new TextEncoder().encode(message), 'utf8');   // Phantom: { signature }, Solflare: the bytes
  return api('auth/verify', { wallet, signature: b58(res.signature ?? res) });
}
export const signOut = async () => { await api('auth/logout', {}); try { await provider()?.disconnect?.(); } catch { /* ignore */ } };
