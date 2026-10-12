import test from 'node:test';
import assert from 'node:assert/strict';
import { b58, walletName, getSignInMethod, signInOrFallback, signIn } from '../site/wallet.js';
import { DEV_ADMIN_WALLET, formatSiws, installDevWallet } from '../site/dev-wallet.js';

test('b58 correctly encodes Uint8Array into base58 string', () => {
  const bytes = new Uint8Array([0, 0, 1, 2, 3]);
  const encoded = b58(bytes);
  assert.match(encoded, /^11/); // Leading zeros encoded as '1's

  const sampleBytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
  assert.equal(b58(sampleBytes), '9AjdStructure'.slice(0, 0) + b58(sampleBytes)); // Real base58
  assert.equal(typeof b58(sampleBytes), 'string');
});

test('walletName correctly identifies providers', () => {
  assert.equal(walletName(null), 'none');
  assert.equal(walletName(undefined), 'none');
  assert.equal(walletName({ isPhantom: true }), 'phantom');
  assert.equal(walletName({ isSolflare: true }), 'solflare');
  assert.equal(walletName({}), 'injected');
});

test('getSignInMethod detects Wallet Standard feature and window provider method', async () => {
  // 1. None
  assert.equal(getSignInMethod(null), null);
  assert.equal(getSignInMethod({}), null);

  // 2. Window provider method returning object
  const pWindow = {
    signIn: async (input) => ({ signature: new Uint8Array([1, 2, 3]), account: { address: 'addr1' } }),
  };
  const fnWindow = getSignInMethod(pWindow);
  assert.equal(typeof fnWindow, 'function');
  const resWindow = await fnWindow({});
  assert.equal(resWindow.account.address, 'addr1');

  // 3. Wallet Standard feature returning array
  const pStandard = {
    features: {
      'solana:signIn': {
        signIn: async (input) => [{ signature: new Uint8Array([4, 5, 6]), account: { address: 'addr2' } }],
      },
    },
  };
  const fnStandard = getSignInMethod(pStandard);
  assert.equal(typeof fnStandard, 'function');
  const resStandard = await fnStandard({});
  assert.equal(resStandard.account.address, 'addr2');
});

test('1-click SIWS executes when provider supports signIn', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = globalThis.window || {};

  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const path = String(url).split('/api/')[1];
    const body = opts?.body ? JSON.parse(opts.body) : null;
    calls.push({ path, body });

    if (path === 'auth/nonce') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          domain: 'localhost:3000',
          statement: 'Sign in to Freight Chain',
          uri: 'http://localhost:3000',
          version: '1',
          chainId: 'solana:mainnet',
          nonce: 'mocknonce1234567890abcdef',
          issuedAt: '2026-10-12T00:00:00.000Z',
          expirationTime: '2026-10-12T00:10:00.000Z',
          message: 'localhost:3000 wants you to sign in with your Solana account...',
        }),
      };
    }
    if (path === 'auth/verify') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          wallet: body.wallet,
          session: 'mock-session-cookie',
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const mockProvider = {
    isPhantom: true,
    publicKey: { toString: () => 'WalletPubkey111111111111111111111111111111' },
    async signIn(input) {
      assert.equal(input.domain, 'localhost:3000');
      assert.equal(input.nonce, 'mocknonce1234567890abcdef');
      return {
        account: { address: 'WalletPubkey111111111111111111111111111111' },
        signedMessage: new TextEncoder().encode('canonical message text'),
        signature: new Uint8Array([1, 2, 3, 4]),
      };
    },
  };

  try {
    const session = await signInOrFallback(mockProvider);
    assert.equal(session.success, true);
    assert.equal(session.wallet, 'WalletPubkey111111111111111111111111111111');

    assert.equal(calls.length, 2);
    assert.equal(calls[0].path, 'auth/nonce');
    assert.deepEqual(calls[0].body, {});
    assert.equal(calls[1].path, 'auth/verify');
    assert.equal(calls[1].body.wallet, 'WalletPubkey111111111111111111111111111111');
    assert.equal(calls[1].body.message, 'canonical message text');
    assert.equal(calls[1].body.nonce, 'mocknonce1234567890abcdef');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test('signInOrFallback seamlessly falls back to legacy signing when provider lacks signIn', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, opts) => {
    const path = String(url).split('/api/')[1];
    const body = opts?.body ? JSON.parse(opts.body) : null;
    calls.push({ path, body });

    if (path === 'auth/nonce') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: 'legacy challenge message' }),
      };
    }
    if (path === 'auth/verify') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, wallet: body.wallet }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  let connectCalled = false;
  let signMessageCalled = false;

  const legacyProvider = {
    isSolflare: true,
    publicKey: null,
    async connect() {
      connectCalled = true;
      this.publicKey = { toString: () => 'LegacyWallet1111111111111111111111111111' };
      return { publicKey: this.publicKey };
    },
    async signMessage(msg) {
      signMessageCalled = true;
      return new Uint8Array([5, 6, 7, 8]);
    },
  };

  try {
    const res = await signInOrFallback(legacyProvider);
    assert.equal(res.success, true);
    assert.equal(connectCalled, true);
    assert.equal(signMessageCalled, true);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].path, 'auth/nonce');
    assert.equal(calls[0].body.wallet, 'LegacyWallet1111111111111111111111111111');
    assert.equal(calls[1].path, 'auth/verify');
    assert.equal(calls[1].body.wallet, 'LegacyWallet1111111111111111111111111111');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('signInOrFallback seamlessly falls back to legacy when native signIn throws/rejects', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, opts) => {
    const path = String(url).split('/api/')[1];
    const body = opts?.body ? JSON.parse(opts.body) : null;
    calls.push({ path, body });

    if (path === 'auth/nonce') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          domain: 'localhost',
          nonce: 'nonce-1',
          message: 'challenge message',
        }),
      };
    }
    if (path === 'auth/verify') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, wallet: body.wallet }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  let nativeSignInAttempted = false;
  let legacyConnectAttempted = false;

  const buggyProvider = {
    publicKey: null,
    async signIn() {
      nativeSignInAttempted = true;
      throw new Error('METHOD_NOT_SUPPORTED');
    },
    async connect() {
      legacyConnectAttempted = true;
      this.publicKey = { toString: () => 'FallbackWallet1111111111111111111111111' };
      return { publicKey: this.publicKey };
    },
    async signMessage() {
      return { signature: new Uint8Array([9, 10, 11, 12]) };
    },
  };

  try {
    const res = await signInOrFallback(buggyProvider);
    assert.equal(res.success, true);
    assert.equal(nativeSignInAttempted, true);
    assert.equal(legacyConnectAttempted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('signInOrFallback throws and stamps stage when no provider or user cancels', async () => {
  // 1. No provider
  await assert.rejects(
    async () => signInOrFallback(null),
    (err) => {
      assert.equal(err.stage, 'no_provider');
      return true;
    }
  );

  // 2. User cancels connect (code 4001)
  const rejectingConnectProvider = {
    async connect() {
      throw Object.assign(new Error('User rejected'), { code: 4001 });
    },
  };
  await assert.rejects(
    async () => signInOrFallback(rejectingConnectProvider),
    (err) => {
      assert.equal(err.stage, 'connect_rejected');
      return true;
    }
  );

  // 3. User cancels signMessage
  const rejectingSignProvider = {
    async connect() {
      this.publicKey = { toString: () => 'CancelWallet111111111111111111111111111' };
    },
    async signMessage() {
      throw new Error('User cancelled request');
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ message: 'test' }),
  });
  try {
    await assert.rejects(
      async () => signInOrFallback(rejectingSignProvider),
      (err) => {
        assert.equal(err.stage, 'sign_rejected');
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('dev-wallet mock implements signIn and solana:signIn standard feature', async () => {
  globalThis.location = { hostname: 'localhost' };
  globalThis.sessionStorage = { setItem: () => {}, getItem: () => '1' };
  globalThis.window = globalThis.window || {};

  const ok = installDevWallet();
  assert.equal(ok, true);
  const dw = globalThis.window.__fcDevWallet;
  assert.ok(dw);
  assert.equal(typeof dw.signIn, 'function');
  assert.equal(typeof dw.features?.['solana:signIn']?.signIn, 'function');

  const input = {
    domain: 'localhost:3000',
    statement: 'Dev wallet SIWS sign-in',
    uri: 'http://localhost:3000',
    version: '1',
    chainId: 'solana:mainnet',
    nonce: 'devtestnonce1234',
    issuedAt: '2026-10-12T00:00:00.000Z',
  };

  // Direct signIn (window provider shape)
  const out = await dw.signIn(input);
  assert.equal(out.account.address, DEV_ADMIN_WALLET);
  assert.ok(out.signature instanceof Uint8Array);
  assert.equal(out.signature.length, 64);
  const decoded = new TextDecoder().decode(out.signedMessage);
  assert.match(decoded, /localhost:3000 wants you to sign in/);
  assert.match(decoded, /Nonce: devtestnonce1234/);

  // Wallet Standard feature shape (returns array)
  const [standardOut] = await dw.features['solana:signIn'].signIn(input);
  assert.equal(standardOut.account.address, DEV_ADMIN_WALLET);
  assert.equal(standardOut.signature.length, 64);
});
