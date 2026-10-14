/* The editor's own wallet sign-in (no player session, nothing from /site/ – storybook does not serve it): an injected Solana wallet
   connects, signs the server's text with signMessage, and the server checks the signature and EDITOR_WALLETS. */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58encode(bytes) {
  let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = '1' + s; }
  return s;
}
export const provider = () => globalThis.phantom?.solana ?? globalThis.backpack ?? globalThis.solflare ?? globalThis.solana ?? null;
export async function connect() {
  const p = provider(); if (!p) throw new Error('no Solana wallet in this browser (Phantom, Backpack or Solflare)');
  const r = await p.connect(); const key = r?.publicKey ?? p.publicKey; if (!key) throw new Error('the wallet did not share an address');
  return key.toString();
}
export async function sign(message) {
  const p = provider(); if (!p?.signMessage) throw new Error('this wallet cannot sign messages');
  const r = await p.signMessage(new TextEncoder().encode(message), 'utf8');
  return b58encode(r?.signature ?? r);
}
