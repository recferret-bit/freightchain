/* Deterministic e2e wallet (E1M). Fixed ed25519 seeds, no extension and no devnet.
   Node tests call install() / signAndSend(). Headless Chrome evaluates browserSource()
   (WebCrypto, same seed) so window.solana signs SIWS and the server's transfer bytes,
   then broadcasts them to mock-rpc. Port 8898 — never 8899. */
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export const DEFAULT_RPC = 'http://127.0.0.1:8898';
export const CHAIN = 'solana:devnet';
/** Names the mock ledger funds on reset. The text is not the seed; sha256(text) is. */
export const WALLET_SEEDS = Object.freeze({
  viewerA: 'freightchain-e1m-viewerA',
  viewerB: 'freightchain-e1m-viewerB',
  driverD: 'freightchain-e1m-driverD',
  refR: 'freightchain-e1m-refR',
  attackerX: 'freightchain-e1m-attackerX',
});

const SYSTEM = '11111111111111111111111111111111';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiM5YjVkZTUiLz48L3N2Zz4=';

export function seedBytes(text) {
  return new Uint8Array(createHash('sha256').update(String(text)).digest());
}

export function keypairFromSeed(text) {
  const seed = seedBytes(text);
  const kp = nacl.sign.keyPair.fromSeed(seed);
  return { seed, publicKey: kp.publicKey, secretKey: kp.secretKey, address: bs58.encode(kp.publicKey) };
}

export function namedWallet(name) {
  const text = WALLET_SEEDS[name];
  if (!text) throw new Error(`unknown mock wallet ${name}`);
  return { name, ...keypairFromSeed(text) };
}

export function namedWallets() {
  return Object.keys(WALLET_SEEDS).map((name) => namedWallet(name));
}

/** Canonical SIWS text, same field order as the server's formatSignInMessage. */
export function formatSiws(input, address) {
  let msg = `${input?.domain || 'localhost'} wants you to sign in with your Solana account:\n${address}`;
  if (input?.statement) msg += `\n\n${input.statement}`;
  const fields = [];
  if (input?.uri) fields.push(`URI: ${input.uri}`);
  if (input?.version) fields.push(`Version: ${input.version}`);
  if (input?.chainId) fields.push(`Chain ID: ${input.chainId}`);
  if (input?.nonce) fields.push(`Nonce: ${input.nonce}`);
  if (input?.issuedAt) fields.push(`Issued At: ${input.issuedAt}`);
  if (input?.expirationTime) fields.push(`Expiration Time: ${input.expirationTime}`);
  if (input?.notBefore) fields.push(`Not Before: ${input.notBefore}`);
  if (input?.requestId) fields.push(`Request ID: ${input.requestId}`);
  if (input?.resources?.length) {
    fields.push('Resources:');
    for (const resource of input.resources) fields.push(`- ${resource}`);
  }
  if (fields.length) msg += `\n\n${fields.join('\n')}`;
  return msg;
}

function readShort(buf, offset) {
  let n = 0;
  let shift = 0;
  let o = offset;
  while (o < buf.length && shift <= 28) {
    const b = buf[o++];
    n |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [n, o];
    shift += 7;
  }
  throw new Error('truncated transaction');
}

function writeShort(n) {
  const out = [];
  let left = n;
  for (;;) {
    let b = left & 0x7f;
    left >>>= 7;
    if (left) b |= 0x80;
    out.push(b);
    if (!left) break;
  }
  return Buffer.from(out);
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

function u64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
}

/** Unsigned legacy transfer (optional Solana Pay reference + memo). Signature slot is 64 zero bytes. */
export function buildTransfer({ from, to, lamports, blockhash, memo = null, reference = null }) {
  const payer = Buffer.from(from.publicKey);
  const dest = Buffer.from(bs58.decode(to));
  const hash = Buffer.from(bs58.decode(blockhash));
  if (hash.length !== 32) throw new Error('blockhash must be 32 bytes');
  if (!Number.isInteger(lamports) || lamports < 0) throw new Error('bad lamports');
  const keys = [payer];
  const push = (raw) => {
    const buf = Buffer.from(raw);
    const i = keys.findIndex((k) => k.equals(buf));
    if (i >= 0) return i;
    keys.push(buf);
    return keys.length - 1;
  };
  const destI = dest.equals(payer) ? 0 : push(dest);
  const sysI = push(bs58.decode(SYSTEM));
  const refI = reference ? push(bs58.decode(reference)) : -1;
  const memoI = memo ? push(bs58.decode(MEMO)) : -1;
  const readonlyUnsigned = 1 + (refI >= 0 ? 1 : 0) + (memoI >= 0 ? 1 : 0);
  const ixs = [];
  const transferAccounts = refI >= 0 ? [0, destI, refI] : [0, destI];
  ixs.push({ programIdIndex: sysI, accounts: transferAccounts, data: Buffer.concat([u32(2), u64(lamports)]) });
  if (memo != null) ixs.push({ programIdIndex: memoI, accounts: [0], data: Buffer.from(String(memo)) });
  const body = [Buffer.from([1, 0, readonlyUnsigned]), writeShort(keys.length), Buffer.concat(keys), hash, writeShort(ixs.length)];
  for (const ix of ixs) {
    body.push(Buffer.from([ix.programIdIndex]), writeShort(ix.accounts.length), Buffer.from(ix.accounts), writeShort(ix.data.length), ix.data);
  }
  return Buffer.concat([writeShort(1), Buffer.alloc(64), ...body]);
}

/** Sign the legacy message in place. Returns a new wire buffer. */
export function signWire(wire, kp) {
  const buf = Buffer.from(wire);
  const [count, sigAt] = readShort(buf, 0);
  if (count < 1 || count > 8) throw new Error('bad signature count');
  const messageAt = sigAt + count * 64;
  if (messageAt > buf.length) throw new Error('truncated transaction');
  const message = buf.subarray(messageAt);
  if (message[0] & 0x80) throw new Error('versioned transactions are not signed by this harness');
  const numReq = message[0];
  const [nKeys, keysAt] = readShort(message, 3);
  const pub = Buffer.from(kp.publicKey);
  let index = -1;
  for (let i = 0; i < numReq && i < nKeys; i++) {
    const key = message.subarray(keysAt + i * 32, keysAt + (i + 1) * 32);
    if (Buffer.from(key).equals(pub)) index = i;
  }
  if (index < 0) throw new Error('wallet is not a required signer');
  const sig = nacl.sign.detached(new Uint8Array(message), kp.secretKey);
  const out = Buffer.from(buf);
  out.set(sig, sigAt + index * 64);
  return out;
}

export function signMessage(kp, message) {
  const bytes = typeof message === 'string' ? new TextEncoder().encode(message) : new Uint8Array(message);
  return nacl.sign.detached(bytes, kp.secretKey);
}

function asWire(tx) {
  if (tx instanceof Uint8Array) return Buffer.from(tx);
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(tx)) return Buffer.from(tx);
  if (typeof tx === 'string') return Buffer.from(tx, 'base64');
  if (tx && typeof tx.serialize === 'function') return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  throw new Error('unsupported transaction');
}

export async function sendRaw(rpc, wire) {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [Buffer.from(wire).toString('base64'), { encoding: 'base64', skipPreflight: true, preflightCommitment: 'confirmed' }] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'sendTransaction failed');
  return json.result;
}

export async function signAndSend(kp, tx, rpc = DEFAULT_RPC) {
  const signed = signWire(asWire(tx), kp);
  const signature = await sendRaw(rpc, signed);
  return { signature, signed };
}

function publicKeyOf(kp) {
  return {
    toString: () => kp.address,
    toBase58: () => kp.address,
    toBytes: () => kp.publicKey,
    equals: (other) => (other?.toBase58?.() ?? other?.toString?.()) === kp.address,
  };
}

function assertChain(chain) {
  if (chain && !String(chain).startsWith('solana:')) throw new Error(`unsupported chain ${chain}`);
}

function providerFor(kp, rpc) {
  const key = publicKeyOf(kp);
  const signInResult = (input = {}) => {
    if (input.address && input.address !== kp.address) throw new Error('wallet address does not match the challenge');
    const text = formatSiws(input, kp.address);
    const signedMessage = new TextEncoder().encode(text);
    return { account: { address: kp.address, publicKey: kp.publicKey, chains: [CHAIN], features: ['solana:signIn', 'solana:signMessage', 'solana:signTransaction', 'solana:signAndSendTransaction'] }, signedMessage, signature: signMessage(kp, signedMessage) };
  };
  const provider = {
    isPhantom: true,
    isMockWallet: true,
    publicKey: null,
    async connect() { this.publicKey = key; return { publicKey: key }; },
    async disconnect() { this.publicKey = null; },
    async signMessage(message) { return { signature: signMessage(kp, message) }; },
    async signIn(input) { this.publicKey = key; return signInResult(input); },
    async signTransaction(tx) {
      const wire = asWire(tx);
      const signed = signWire(wire, kp);
      if (typeof tx === 'string') return signed.toString('base64');
      return new Uint8Array(signed);
    },
    async signAndSendTransaction(tx) {
      const signed = signWire(asWire(tx), kp);
      return { signature: await sendRaw(rpc, signed) };
    },
    features: {},
  };
  provider.features = {
    'solana:signIn': { version: '1.0.0', signIn: async (input) => [await provider.signIn(input || {})] },
    'solana:signMessage': { version: '1.0.0', signMessage: async ({ message }) => [{ signedMessage: message, signature: signMessage(kp, message) }] },
    'solana:signTransaction': { version: '1.0.0', signTransaction: async ({ transaction, chain, account }) => { assertChain(chain); if (account?.address && account.address !== kp.address) throw new Error('account'); return [{ signedTransaction: new Uint8Array(signWire(asWire(transaction), kp)) }]; } },
    'solana:signAndSendTransaction': { version: '1.0.0', signAndSendTransaction: async ({ transaction, chain, account }) => { assertChain(chain); if (account?.address && account.address !== kp.address) throw new Error('account'); const signed = signWire(asWire(transaction), kp); await sendRaw(rpc, signed); return [{ signature: firstSignature(signed) }]; } },
  };
  return provider;
}

function firstSignature(signed) {
  const [count, sigAt] = readShort(signed, 0);
  if (count < 1) throw new Error('no signature');
  return new Uint8Array(signed.subarray(sigAt, sigAt + 64));
}

function standardWallet(kp, provider) {
  const standard = {
    version: '1.0.0',
    name: 'Phantom',
    icon: ICON,
    chains: [CHAIN],
    accounts: [],
    features: {
      'standard:events': { version: '1.0.0', on: () => () => {} },
      'solana:signIn': provider.features['solana:signIn'],
      'solana:signMessage': provider.features['solana:signMessage'],
      'solana:signTransaction': provider.features['solana:signTransaction'],
      'solana:signAndSendTransaction': provider.features['solana:signAndSendTransaction'],
    },
  };
  standard.features['standard:connect'] = {
    version: '1.0.0',
    connect: async () => {
      await provider.connect();
      standard.accounts = [{ address: kp.address, publicKey: kp.publicKey, chains: [CHAIN], features: ['solana:signIn', 'solana:signMessage', 'solana:signTransaction', 'solana:signAndSendTransaction'] }];
      return { accounts: standard.accounts };
    },
  };
  return standard;
}

/** Legacy window.solana plus a Wallet Standard registration. `window` may be happy-dom or a stub. */
export function install(window, { name = 'viewerA', wallet = null, rpc = DEFAULT_RPC } = {}) {
  if (!window) throw new Error('window is required');
  const kp = wallet ?? namedWallet(name);
  const provider = providerFor(kp, rpc);
  const standard = standardWallet(kp, provider);
  const registerWith = (api) => api.register(standard);
  window.solana = provider;
  window.phantom = { solana: provider };
  if (typeof window.addEventListener === 'function') window.addEventListener('wallet-standard:app-ready', (ev) => { try { registerWith(ev.detail); } catch { /* the page registered us already */ } });
  const Ctor = window.CustomEvent || globalThis.CustomEvent;
  if (typeof window.dispatchEvent === 'function' && typeof Ctor === 'function') {
    window.dispatchEvent(new Ctor('wallet-standard:register-wallet', { detail: registerWith }));
  }
  return { provider, wallet: kp, standard, rpc };
}

/** Self-contained page script. WebCrypto Ed25519 of the same seed matches tweetnacl, so signatures stay deterministic. */
export function browserSource({ name = 'viewerA', wallet = null, rpc = DEFAULT_RPC } = {}) {
  const kp = wallet ?? namedWallet(name);
  const jwk = { kty: 'OKP', crv: 'Ed25519', d: Buffer.from(kp.seed).toString('base64url'), x: Buffer.from(kp.publicKey).toString('base64url') };
  return `(() => {
    const RPC = ${JSON.stringify(rpc)};
    const ADDRESS = ${JSON.stringify(kp.address)};
    const PUB = Uint8Array.from(${JSON.stringify([...kp.publicKey])});
    const JWK = ${JSON.stringify(jwk)};
    const CHAIN = ${JSON.stringify(CHAIN)};
    let keyPromise = null;
    const key = () => keyPromise || (keyPromise = crypto.subtle.importKey('jwk', JWK, { name: 'Ed25519' }, false, ['sign']));
    const sign = async (bytes) => new Uint8Array(await crypto.subtle.sign('Ed25519', await key(), bytes));
    const readShort = (buf, offset) => { let n = 0, shift = 0, o = offset; while (o < buf.length && shift <= 28) { const b = buf[o++]; n |= (b & 0x7f) << shift; if ((b & 0x80) === 0) return [n, o]; shift += 7; } throw new Error('truncated transaction'); };
    const wireOf = (tx) => { if (tx instanceof Uint8Array) return tx; if (typeof tx === 'string') { const bin = atob(tx); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; } throw new Error('unsupported transaction'); };
    const signWire = async (tx) => {
      const buf = wireOf(tx); const [count, sigAt] = readShort(buf, 0); const messageAt = sigAt + count * 64; const message = buf.subarray(messageAt);
      const numReq = message[0]; const [nKeys, keysAt] = readShort(message, 3); let index = -1;
      for (let i = 0; i < numReq && i < nKeys; i++) { const key = message.subarray(keysAt + i * 32, keysAt + (i + 1) * 32); if (key.length === PUB.length && key.every((b, j) => b === PUB[j])) index = i; }
      if (index < 0) throw new Error('wallet is not a required signer');
      const sig = await sign(message); const out = new Uint8Array(buf); out.set(sig, sigAt + index * 64); return { out, sig };
    };
    const send = async (bytes) => {
      let s = ''; for (const b of bytes) s += String.fromCharCode(b);
      const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [btoa(s), { encoding: 'base64', skipPreflight: true }] }) });
      const json = await res.json(); if (json.error) throw new Error(json.error.message || 'sendTransaction failed'); return json.result;
    };
    const siws = (input, address) => { let msg = (input && input.domain || 'localhost') + ' wants you to sign in with your Solana account:\\n' + address; if (input && input.statement) msg += '\\n\\n' + input.statement; const f = [];
      if (input && input.uri) f.push('URI: ' + input.uri); if (input && input.version) f.push('Version: ' + input.version); if (input && input.chainId) f.push('Chain ID: ' + input.chainId); if (input && input.nonce) f.push('Nonce: ' + input.nonce);
      if (input && input.issuedAt) f.push('Issued At: ' + input.issuedAt); if (input && input.expirationTime) f.push('Expiration Time: ' + input.expirationTime); if (input && input.notBefore) f.push('Not Before: ' + input.notBefore); if (input && input.requestId) f.push('Request ID: ' + input.requestId);
      if (input && input.resources && input.resources.length) { f.push('Resources:'); for (const r of input.resources) f.push('- ' + r); } if (f.length) msg += '\\n\\n' + f.join('\\n'); return msg; };
    const account = () => ({ address: ADDRESS, publicKey: PUB, chains: [CHAIN], features: ['solana:signIn', 'solana:signMessage', 'solana:signTransaction', 'solana:signAndSendTransaction'] });
    const pk = { toString: () => ADDRESS, toBase58: () => ADDRESS, toBytes: () => PUB };
    const provider = { isPhantom: true, isMockWallet: true, publicKey: null,
      connect: async () => { provider.publicKey = pk; return { publicKey: pk }; },
      disconnect: async () => { provider.publicKey = null; },
      signMessage: async (message) => ({ signature: await sign(message instanceof Uint8Array ? message : new TextEncoder().encode(message)) }),
      signIn: async (input = {}) => { if (input.address && input.address !== ADDRESS) throw new Error('wallet address does not match the challenge'); provider.publicKey = pk; const text = siws(input, ADDRESS); const signedMessage = new TextEncoder().encode(text); return { account: account(), signedMessage, signature: await sign(signedMessage) }; },
      signTransaction: async (tx) => { const { out } = await signWire(tx); return typeof tx === 'string' ? btoa(Array.from(out, (b) => String.fromCharCode(b)).join('')) : out; },
      signAndSendTransaction: async (tx) => { const { out } = await signWire(tx); return { signature: await send(out) }; },
    };
    provider.features = {
      'solana:signIn': { version: '1.0.0', signIn: async (input) => [await provider.signIn(input || {})] },
      'solana:signMessage': { version: '1.0.0', signMessage: async ({ message }) => [{ signedMessage: message, signature: await sign(message) }] },
      'solana:signTransaction': { version: '1.0.0', signTransaction: async ({ transaction }) => [{ signedTransaction: (await signWire(transaction)).out }] },
      'solana:signAndSendTransaction': { version: '1.0.0', signAndSendTransaction: async ({ transaction }) => { const { out, sig } = await signWire(transaction); await send(out); return [{ signature: sig }]; } },
    };
    const standard = { version: '1.0.0', name: 'Phantom', icon: ${JSON.stringify(ICON)}, chains: [CHAIN], accounts: [], features: {
      'standard:connect': { version: '1.0.0', connect: async () => { await provider.connect(); standard.accounts = [account()]; return { accounts: standard.accounts }; } },
      'standard:events': { version: '1.0.0', on: () => () => {} },
      'solana:signIn': provider.features['solana:signIn'], 'solana:signMessage': provider.features['solana:signMessage'], 'solana:signTransaction': provider.features['solana:signTransaction'], 'solana:signAndSendTransaction': provider.features['solana:signAndSendTransaction'],
    } };
    const registerWith = (api) => api.register(standard);
    window.solana = provider; window.phantom = { solana: provider };
    window.addEventListener('wallet-standard:app-ready', (ev) => { try { registerWith(ev.detail); } catch (e) {} });
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: registerWith }));
  })();`;
}
