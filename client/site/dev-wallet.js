/* LOCAL-ONLY stand-in for Phantom, so the admin page can be tried without a wallet extension: a fixed ed25519 key (its seed is public, in this file –
   it is worth nothing anywhere else) that signs through WebCrypto like a real wallet, so the server still verifies every signature.
   Supports both standard signMessage and native 1-click SIWS (solana:signIn).
   It only installs on localhost / 127.0.0.1, and only does anything where the server lists its address in ADMIN_WALLETS – production never does. */
export const DEV_ADMIN_WALLET = '64GheTAtcPoz6Re29qwWxzKU2gtZCTF6gC1NBPVgaL2N';
const JWK = { kty: 'OKP', crv: 'Ed25519', d: 'ZnJlaWdodGNoYWluLWxvY2FsLWRldi1hZG1pbi1rZXk', x: 'SyDuFEOY3aRIQ_t3OdRBrOwwqzM1Ij_jAuS3WGkpz5M' };
export const FLAG = 'freightchain.devwallet';
export const isLocal = () => ['localhost', '127.0.0.1'].includes(location.hostname);
export const devWanted = () => { try { return isLocal() && sessionStorage.getItem(FLAG) === '1'; } catch { return false; } };

export function formatSiws(input, address) {
  let msg = `${input?.domain || 'localhost'} wants you to sign in with your Solana account:\n${address}`;
  if (input?.statement) msg += `\n\n${input.statement}`;
  const f = [];
  if (input?.uri) f.push(`URI: ${input.uri}`);
  if (input?.version) f.push(`Version: ${input.version}`);
  if (input?.chainId) f.push(`Chain ID: ${input.chainId}`);
  if (input?.nonce) f.push(`Nonce: ${input.nonce}`);
  if (input?.issuedAt) f.push(`Issued At: ${input.issuedAt}`);
  if (input?.expirationTime) f.push(`Expiration Time: ${input.expirationTime}`);
  if (input?.notBefore) f.push(`Not Before: ${input.notBefore}`);
  if (input?.requestId) f.push(`Request ID: ${input.requestId}`);
  if (input?.resources?.length) {
    f.push('Resources:');
    for (const r of input.resources) f.push(`- ${r}`);
  }
  if (f.length) msg += `\n\n${f.join('\n')}`;
  return msg;
}

export function installDevWallet() {
  if (!isLocal()) return false;
  try { sessionStorage.setItem(FLAG, '1'); } catch { /* the wallet just won't survive a reload */ }
  const key = globalThis.crypto.subtle.importKey('jwk', JWK, { name: 'Ed25519' }, false, ['sign']);
  const devWallet = {
    isPhantom: true, isDevWallet: true, publicKey: null,
    async connect() { this.publicKey = { toString: () => DEV_ADMIN_WALLET }; return { publicKey: this.publicKey }; },
    async signMessage(msg) { return { signature: new Uint8Array(await globalThis.crypto.subtle.sign('Ed25519', await key, msg)) }; },
    async signIn(input = {}) {
      this.publicKey = { toString: () => DEV_ADMIN_WALLET };
      const address = input.address || DEV_ADMIN_WALLET;
      const text = formatSiws(input, address);
      const msgBytes = new TextEncoder().encode(text);
      const sigBytes = new Uint8Array(await globalThis.crypto.subtle.sign('Ed25519', await key, msgBytes));
      const pubKeyBytes = Uint8Array.from(atob(JWK.x.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      return {
        account: { address: DEV_ADMIN_WALLET, publicKey: pubKeyBytes },
        signedMessage: msgBytes,
        signature: sigBytes,
      };
    },
    features: {
      'solana:signIn': {
        version: '1.0.0',
        signIn: async (...inputs) => [await devWallet.signIn(inputs[0] || {})],
      },
    },
    async disconnect() {},
  };
  window.__fcDevWallet = devWallet;
  return true;
}
