import test from 'node:test';
import assert from 'node:assert/strict';

/* A page: window is an EventTarget, the wallets talk to it through the two Wallet Standard events. Installed BEFORE the module loads (it listens at import). */
globalThis.window = new EventTarget();
window.CustomEvent = globalThis.CustomEvent;
let early = null;
window.addEventListener('wallet-standard:app-ready', ({ detail }) => { early = detail; });   // a wallet that loaded first hears app-ready
const { CHAIN, adapt, isSolanaWallet, safeIcon, wallets } = await import('../site/wallet-standard.js');
const { b58, ensureAccount, provider, walletName } = await import('../site/wallet.js');
const { feePayerOf } = await import('../site/pay.js');

const key = n => new Uint8Array(32).fill(n);
const account = n => ({ address: b58(key(n)), publicKey: key(n), chains: ['solana:devnet'], features: [] });
function fakeWallet(name, { accounts = [account(1)], chains = ['solana:devnet', 'solana:mainnet'], calls = [], signed = null } = {}) {
  const w = {
    version: '1.0.0', name, icon: 'data:image/svg+xml;base64,PHN2Zy8+', chains, accounts: [],
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => { w.accounts = accounts; return { accounts }; } },
      'standard:events': { version: '1.0.0', on: () => () => {} },
      'solana:signAndSendTransaction': { version: '1.0.0', signAndSendTransaction: async (...inputs) => { calls.push(inputs); return [{ signature: new Uint8Array(64).fill(7) }]; } },
      'solana:signMessage': { version: '1.0.0', signMessage: async ({ message }) => [{ signedMessage: signed ?? message, signature: new Uint8Array(64).fill(3) }] },
    },
  };
  return w;
}

test('Wallet Standard discovery: app-ready reaches a wallet that loaded first, register-wallet a late one; non-Solana wallets are left out', () => {
  assert.ok(early?.register, 'the module announced app-ready with { register }');
  early.register(fakeWallet('Early'), fakeWallet('MetaMask'));
  window.dispatchEvent(Object.assign(new Event('wallet-standard:register-wallet'), { detail: api => api.register(fakeWallet('Late'), fakeWallet('EthOnly', { chains: ['eip155:1'] })) }));
  assert.deepEqual(wallets().map(p => p.name), ['Early', 'Late', 'MetaMask']);
  assert.equal(CHAIN, 'solana:devnet');
  assert.equal(isSolanaWallet({ chains: ['solana:devnet'], features: { 'standard:connect': {} } }), false, 'a wallet that signs nothing is not listed');
});

test('a wallet found both ways is listed once (the standard one); a legacy-only wallet stays', async () => {
  const phantom = fakeWallet('Phantom');
  early.register(phantom);
  window.phantom = { solana: { isPhantom: true } }; window.solana = window.phantom.solana; window.solflare = { isSolflare: true };
  const names = wallets().map(p => (p.standard ? p.name : 'legacy:' + (p.isSolflare ? 'Solflare' : 'Phantom')));
  assert.deepEqual(names.filter(n => /Phantom|Solflare/.test(n)), ['Phantom', 'legacy:Solflare']);
  const calls = [];
  phantom.features['solana:signIn'] = { version: '1.0.0', signIn: async (input) => { calls.push(input.domain); return [{ account: account(1), signature: new Uint8Array(64), signedMessage: new Uint8Array() }]; } };
  const injectedCalls = [];
  window.phantom.solana.connect = async () => { injectedCalls.push('connect'); return { publicKey: { toString: () => 'PhantomAddr111' } }; };
  window.phantom.solana.signIn = async (input) => { injectedCalls.push(input.domain); return { publicKey: { toString: () => 'PhantomAddr111' }, signature: new Uint8Array(64), signedMessage: new Uint8Array() }; };
  const adapted = adapt(phantom);
  await adapted.connect();
  await adapted.signIn({ domain: 'freightchain.localhost' });
  assert.deepEqual(calls, ['freightchain.localhost']);
  assert.deepEqual(injectedCalls, [], 'sign-in is solana:signIn, the same call production uses');
  assert.equal(walletName(adapt(phantom)), 'phantom');
  assert.equal(walletName(adapt(fakeWallet('Some New Wallet'))), 'standard', 'analytics get a fixed set, never a free-text name');
  assert.equal(walletName(window.solflare), 'solflare');
  delete window.phantom; delete window.solana; delete window.solflare;
  window.solana = { isMetaMask: true };
  const offered = wallets();
  const phantomAt = offered.findIndex(p => p.name === 'Phantom');
  const metaAt = offered.findIndex(p => p.isMetaMask || /metamask/i.test(p.name ?? ''));
  assert.ok(phantomAt >= 0 && metaAt > phantomAt, 'MetaMask stays behind Phantom');
  delete window.solana;
  assert.ok(provider(), 'provider() is synchronous and finds a wallet');
});

test('signAndSendTransaction hands the wallet the server bytes, the connected account and the devnet chain; the signature comes back in base58', async () => {
  const calls = [], p = adapt(fakeWallet('Sender', { calls }));
  const bytes = new Uint8Array([1, ...new Uint8Array(64), 1, 0, 1, 1, ...key(1), 0]);
  const { signature } = await p.signAndSendTransaction(bytes);
  assert.equal(signature, b58(new Uint8Array(64).fill(7)));
  const [[input]] = calls;
  assert.equal(input.transaction, bytes);
  assert.equal(input.chain, 'solana:devnet');
  assert.equal(input.account.address, b58(key(1)));
});

test('ensureAccount: the signed-in account is picked; a wallet on another account gets a plain error', async () => {
  const p = adapt(fakeWallet('Two', { accounts: [account(1), account(2)] }));
  await ensureAccount(p, b58(key(2)));
  assert.equal(p.publicKey.toString(), b58(key(2)));
  const q = adapt(fakeWallet('Other', { accounts: [account(5)] }));
  await assert.rejects(ensureAccount(q, b58(key(6))), e => e.code === 'wallet_account_mismatch' && /signed in as/.test(e.message));
  const legacy = { publicKey: null, async connect() { this.publicKey = { toString: () => 'LegacyAAA111' }; } };
  await assert.rejects(ensureAccount(legacy, 'SessionBBB222'), e => e.code === 'wallet_account_mismatch');
});

test('signMessage: Phantom-style { signature }; a wallet that signed different bytes is refused before the server sees it', async () => {
  const msg = new TextEncoder().encode('freight.test wants you to sign in');
  const ok = await adapt(fakeWallet('Signer')).signMessage(msg);
  assert.equal(ok.signature.length, 64);
  await assert.rejects(adapt(fakeWallet('Prefixer', { signed: new TextEncoder().encode('prefix: freight.test') })).signMessage(msg), e => e.code === 'wallet_message_changed');
});

test('icons: only data:image URIs are shown', () => {
  assert.equal(safeIcon('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(safeIcon('https://evil.example/x.png'), null);
  assert.equal(safeIcon('data:text/html;base64,AAAA'), null);
});

test('feePayerOf reads the first account key of a legacy and a v0 wire transaction', () => {
  const legacyTx = new Uint8Array([1, ...new Uint8Array(64), 1, 0, 1, 2, ...key(9), ...key(4), 0]);
  assert.equal(feePayerOf(legacyTx), b58(key(9)));
  const v0 = new Uint8Array([2, ...new Uint8Array(128), 0x80, 2, 0, 1, 3, ...key(8), ...key(4), ...key(5)]);
  assert.equal(feePayerOf(v0), b58(key(8)));
});

test('payingWallet: with nothing picked on this origin, the standard wallet that already holds the signed-in account pays', async () => {
  const { payingWallet } = await import('../site/wallet.js');
  const holder = fakeWallet('Holder', { accounts: [account(42)] });
  holder.accounts = [account(42)];   // authorised earlier on this page
  early.register(holder);
  assert.equal((await payingWallet(b58(key(42)))).name, 'Holder');
});

test('ensureAccount: a legacy wallet whose connect() sets no publicKey is not called a mismatch (only a known other account is)', async () => {
  await ensureAccount({ publicKey: null, connect: async () => ({}) }, 'SessionBBB222');
  await ensureAccount({ publicKey: null, connect: async () => ({ publicKey: { toString: () => 'SessionBBB222' } }) }, 'SessionBBB222');
});
