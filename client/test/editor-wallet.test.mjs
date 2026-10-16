import test from 'node:test';
import assert from 'node:assert/strict';

/* The shared wallet module listens at import, so the page exists first. */
globalThis.window = new EventTarget();
window.CustomEvent = globalThis.CustomEvent;
globalThis.location = { hostname: 'storybook.freightchain.localhost', host: 'storybook.freightchain.localhost', protocol: 'http:', port: '', origin: 'http://storybook.freightchain.localhost' };
let api = null;
window.addEventListener('wallet-standard:app-ready', e => { api = e.detail; });
const { editorSignIn, sign } = await import('../js/editor/wallet.js');
const { signInWith } = await import('../js/wallet/handlers.js');

const addr = 'So11111111111111111111111111111111111111112';
const challenge = {
  domain: 'storybook.freightchain.localhost', statement: 'EDITOR sign-in', uri: 'http://storybook.freightchain.localhost',
  version: '1', chainId: 'solana:devnet', nonce: 'nonce1234', issuedAt: '2026-10-17T00:00:00.000Z', expirationTime: '2026-10-17T00:05:00.000Z',
  message: 'storybook.freightchain.localhost wants you to sign in with your Solana account:\n{{address}}',
};

test('the editor opens the wallet with the same sign-in handler as the landing page', async () => {
  assert.equal(typeof api?.register, 'function');
  const seen = [];
  const phantom = {
    name: 'Phantom', chains: ['solana:devnet'],
    features: {
      'standard:connect': { connect: () => { seen.push('connect'); return new Promise(() => {}); } },
      'solana:signMessage': { signMessage: async ({ message }) => [{ signedMessage: message, signature: new Uint8Array(64).fill(9) }] },
      'solana:signIn': { signIn: async (input) => { seen.push(input); return [{ account: { address: addr, chains: ['solana:devnet'] }, signedMessage: new TextEncoder().encode(`${input.domain} wants you to sign in with your Solana account:\n${addr}`), signature: new Uint8Array(64).fill(4) }]; } },
    },
  };
  api.register(phantom);
  const signed = await signInWith((await import('../js/wallet/standard.js')).wallets().find(p => p.name === 'Phantom'), challenge);
  assert.equal(signed.wallet, addr);
  assert.equal(signed.nonce, 'nonce1234');
  assert.match(signed.message, new RegExp(`^${challenge.domain} wants you to sign in`));
  assert.deepEqual(seen[0].domain, challenge.domain);
  assert.ok(!seen.includes('connect'));

  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
    if (String(url).endsWith('/auth/nonce')) return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(challenge) };
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ editor: { wallet: addr } }) };
  };
  assert.equal(await editorSignIn(), addr);
  assert.equal(calls[0].url, '/api/editor/auth/nonce');
  assert.deepEqual(calls[0].body, {});
  assert.equal(calls[1].body.wallet, addr);
  assert.equal(calls[1].body.nonce, 'nonce1234');
  assert.match(calls[1].body.message, /^storybook\.freightchain\.localhost wants you to sign in/);
  assert.ok(!seen.includes('connect'), 'a hanging connect() is never awaited');
  assert.equal(await sign('publish this'), (await import('../js/wallet/b58.js')).b58(new Uint8Array(64).fill(9)));

  const { beginWallet } = await import('../js/wallet/handlers.js');
  const p = (await import('../js/wallet/standard.js')).wallets().find(w => w.name === 'Phantom');
  const opened = [];
  window.phantom = { solana: { isPhantom: true, async connect() { opened.push('connect'); return { publicKey: { toString: () => addr } }; }, async signIn() { opened.push('signin'); return { account: { address: addr }, signature: new Uint8Array(64).fill(1), signedMessage: new TextEncoder().encode('x') }; } } };
  assert.equal(beginWallet(p, null).mode, 'wait', 'no challenge yet: do not call the hanging connect()');
  const signedIn = beginWallet(p, challenge);
  assert.equal(signedIn.mode, 'signin');
  await signedIn.pending;
  const other = beginWallet(p, { ...challenge, domain: 'other.test', uri: 'http://other.test' });
  assert.equal(other.mode, 'wait', 'a challenge for another site is not sent: Phantom would drop it with no window');
  assert.deepEqual(opened, [], 'sign-in goes through solana:signIn, not window.phantom.solana');
  delete window.phantom;
});
