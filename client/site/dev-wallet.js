/* LOCAL-ONLY stand-in for Phantom, so the admin page can be tried without a wallet extension: a fixed ed25519 key (its seed is public, in this file –
   it is worth nothing anywhere else) that signs through WebCrypto like a real wallet, so the server still verifies every signature.
   It only installs on localhost / 127.0.0.1, and only does anything where the server lists its address in ADMIN_WALLETS – production never does. */
export const DEV_ADMIN_WALLET = '64GheTAtcPoz6Re29qwWxzKU2gtZCTF6gC1NBPVgaL2N';
const JWK = { kty: 'OKP', crv: 'Ed25519', d: 'ZnJlaWdodGNoYWluLWxvY2FsLWRldi1hZG1pbi1rZXk', x: 'SyDuFEOY3aRIQ_t3OdRBrOwwqzM1Ij_jAuS3WGkpz5M' };
export const FLAG = 'freightchain.devwallet';
export const isLocal = () => ['localhost', '127.0.0.1'].includes(location.hostname);
export const devWanted = () => { try { return isLocal() && sessionStorage.getItem(FLAG) === '1'; } catch { return false; } };

export function installDevWallet() {
  if (!isLocal()) return false;
  try { sessionStorage.setItem(FLAG, '1'); } catch { /* the wallet just won't survive a reload */ }
  const key = crypto.subtle.importKey('jwk', JWK, { name: 'Ed25519' }, false, ['sign']);
  window.__fcDevWallet = {   // not window.solana: a real Phantom owns it read-only – wallet.js's provider() looks at __fcDevWallet first
    isPhantom: true, isDevWallet: true, publicKey: null,
    async connect() { this.publicKey = { toString: () => DEV_ADMIN_WALLET }; return { publicKey: this.publicKey }; },
    async signMessage(msg) { return { signature: new Uint8Array(await crypto.subtle.sign('Ed25519', await key, msg)) }; },
    async disconnect() {},
  };
  return true;
}
