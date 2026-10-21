/* Deterministic Solana JSON-RPC stand-in for e2e (E1M). No network and no devnet.
   Blockhash is bs58(sha256(seed ‖ slot)) and the slot only moves when a transaction is
   recorded, so the same request sequence always returns the same bytes.
   Listens on 8898 (compose publishes 127.0.0.1:18899). Port 8899 is refused — that
   port is the host solana-test-validator, not this mock. */
import { createHash } from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { browserSource, buildTransfer, formatSiws, install, namedWallet, namedWallets, signMessage, signWire } from '../harness/wallet.mjs';

export const MOCK_PORT = 8898;
export const HOST_PORT = 18899;
export const FEE_LAMPORTS = 5000;
export const START_LAMPORTS = 10_000_000_000;
export const GENESIS_SLOT = 1_000_000;
export const BLOCKHASH_WINDOW = 150;
const SEED = Buffer.from('freightchain-e1m-mock-rpc');
const SYSTEM = '11111111111111111111111111111111';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const SYSTEM_BYTES = Buffer.from(bs58.decode(SYSTEM));
const MEMO_BYTES = Buffer.from(bs58.decode(MEMO));

function blockhashBytes(slot) {
  const buf = Buffer.alloc(SEED.length + 8);
  SEED.copy(buf, 0);
  buf.writeBigUInt64LE(BigInt(slot), SEED.length);
  return createHash('sha256').update(buf).digest();
}

export function blockhashFor(slot) {
  return bs58.encode(blockhashBytes(slot));
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
  throw Object.assign(new Error('truncated transaction'), { code: -32602 });
}

function readU32(buf, o) {
  return (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
}

function readU64(buf, o) {
  let n = 0n;
  for (let i = 0; i < 8; i++) n |= BigInt(buf[o + i]) << (8n * BigInt(i));
  return n;
}

function bad(code, message) {
  throw Object.assign(new Error(message), { code });
}

function pubkeyBytes(text) {
  let raw;
  try { raw = bs58.decode(text); } catch { bad(-32602, 'invalid public key'); }
  if (raw.length !== 32) bad(-32602, 'invalid public key');
  return Buffer.from(raw);
}

/** Legacy transaction only. Versioned messages (high bit) are rejected — Solana Pay transfers are legacy. */
export function parseWire(wire) {
  const buf = Buffer.from(wire);
  const [count, sigAt] = readShort(buf, 0);
  if (count < 1 || count > 8) bad(-32602, 'bad signature count');
  const messageAt = sigAt + count * 64;
  if (messageAt > buf.length) bad(-32602, 'truncated transaction');
  const message = buf.subarray(messageAt);
  if (message.length < 3 + 32 || (message[0] & 0x80) !== 0) bad(-32602, 'versioned transactions are not simulated');
  const header = { numRequiredSignatures: message[0], numReadonlySignedAccounts: message[1], numReadonlyUnsignedAccounts: message[2] };
  if (header.numRequiredSignatures !== count) bad(-32602, 'signature count does not match the header');
  const [nKeys, keysAt] = readShort(message, 3);
  if (nKeys < 1 || keysAt + nKeys * 32 + 32 > message.length) bad(-32602, 'truncated account keys');
  const keys = [];
  for (let i = 0; i < nKeys; i++) keys.push(Buffer.from(message.subarray(keysAt + i * 32, keysAt + (i + 1) * 32)));
  const hashAt = keysAt + nKeys * 32;
  const recent = Buffer.from(message.subarray(hashAt, hashAt + 32));
  let o = hashAt + 32;
  const [nIx, ixAt] = readShort(message, o);
  o = ixAt;
  const instructions = [];
  for (let i = 0; i < nIx; i++) {
    if (o >= message.length) bad(-32602, 'truncated instruction');
    const programIdIndex = message[o++];
    const [nAcc, accAt] = readShort(message, o);
    o = accAt;
    const accounts = [];
    for (let a = 0; a < nAcc; a++) accounts.push(message[o++]);
    const [nData, dataAt] = readShort(message, o);
    o = dataAt;
    const data = Buffer.from(message.subarray(o, o + nData));
    o += nData;
    if (programIdIndex >= nKeys || accounts.some((a) => a >= nKeys)) bad(-32602, 'instruction account index out of range');
    instructions.push({ programIdIndex, accounts, data });
  }
  if (o !== message.length) bad(-32602, 'trailing bytes in the message');
  const signatures = [];
  for (let i = 0; i < count; i++) signatures.push(Buffer.from(buf.subarray(sigAt + i * 64, sigAt + (i + 1) * 64)));
  return { message, header, keys, recent, instructions, signatures };
}

function accountMeta(parsed) {
  const { header, keys } = parsed;
  const n = keys.length;
  const nSign = header.numRequiredSignatures;
  return keys.map((raw, i) => {
    const signer = i < nSign;
    const readonly = signer ? i >= nSign - header.numReadonlySignedAccounts : i >= n - header.numReadonlyUnsignedAccounts;
    return { pubkey: bs58.encode(raw), signer, writable: !readonly, raw };
  });
}

function parseInstructions(parsed, metas) {
  const memos = [];
  const transfers = [];
  const parsedInstructions = [];
  for (const ix of parsed.instructions) {
    const program = metas[ix.programIdIndex];
    const programId = program.pubkey;
    if (program.raw.equals(SYSTEM_BYTES) && ix.data.length === 12 && readU32(ix.data, 0) === 2) {
      const lamports = readU64(ix.data, 4);
      if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) bad(-32602, 'lamports do not fit a JSON number');
      const source = metas[ix.accounts[0]];
      const destination = metas[ix.accounts[1]];
      if (!source?.writable || !destination?.writable) bad(-32602, 'transfer account is not writable');
      transfers.push({ source: source.pubkey, destination: destination.pubkey, lamports: Number(lamports) });
      parsedInstructions.push({ program: 'system', programId, parsed: { type: 'transfer', info: { source: source.pubkey, destination: destination.pubkey, lamports: Number(lamports) } } });
      continue;
    }
    if (program.raw.equals(MEMO_BYTES)) {
      const text = ix.data.toString('utf8');
      memos.push(text);
      parsedInstructions.push({ program: 'spl-memo', programId, parsed: text });
      continue;
    }
    parsedInstructions.push({ programId, accounts: ix.accounts.map((i) => metas[i].pubkey), data: bs58.encode(ix.data) });
  }
  return { memos, transfers, parsedInstructions };
}

function slotOf(state, raw) {
  const want = Buffer.from(raw);
  const floor = Math.max(0, state.slot - BLOCKHASH_WINDOW);
  for (let slot = state.slot; slot >= floor; slot--) if (want.equals(blockhashBytes(slot))) return slot;
  return null;
}

export function createLedger() {
  const state = { slot: GENESIS_SLOT, balances: new Map(), txs: new Map(), byAddress: new Map(), next: null };
  reset(state);
  return state;
}

function reset(state) {
  state.slot = GENESIS_SLOT;
  state.balances = new Map();
  state.txs = new Map();
  state.byAddress = new Map();
  state.next = null;
  for (const wallet of namedWallets()) state.balances.set(wallet.address, START_LAMPORTS);
}

function balanceOf(state, address) {
  return state.balances.get(address) || 0;
}

function summary(state) {
  const balances = {};
  for (const [address, lamports] of state.balances) balances[address] = lamports;
  const wallets = {};
  for (const wallet of namedWallets()) wallets[wallet.name] = { address: wallet.address, lamports: balanceOf(state, wallet.address) };
  return { slot: state.slot, blockhash: blockhashFor(state.slot), lastValidBlockHeight: state.slot + BLOCKHASH_WINDOW, balances, wallets, transactions: [...state.txs.values()].map((tx) => ({ signature: tx.signature, slot: tx.slot, err: tx.err, memos: tx.memos, pending: tx.pendingLeft > 0 })) };
}

function parseMode(next) {
  if (next === 'confirm') return null;
  if (next === 'fail' || next === 'drop' || next === 'expire') return { kind: next };
  const pending = /^pending:(\d+)$/.exec(String(next ?? ''));
  if (pending) return { kind: 'pending', n: Number(pending[1]) };
  bad(-32602, 'mode must be confirm, pending:N, fail, drop, or expire');
}

function memoField(memos) {
  if (!memos.length) return null;
  return memos.map((text) => `[${Buffer.byteLength(text)}] ${text}`).join('; ');
}

function indexTx(state, tx) {
  state.txs.set(tx.signature, tx);
  for (const key of tx.accountKeys) {
    const list = state.byAddress.get(key.pubkey) || [];
    list.push(tx.signature);
    state.byAddress.set(key.pubkey, list);
  }
}

function reveal(tx) {
  if (!tx) return null;
  if (tx.pendingLeft > 0) { tx.pendingLeft -= 1; return null; }
  return tx;
}

function metaOf(tx) {
  return { err: tx.err, fee: tx.fee, preBalances: tx.preBalances, postBalances: tx.postBalances };
}

function parsedResult(tx) {
  return {
    slot: tx.slot,
    blockTime: tx.blockTime,
    version: 'legacy',
    transaction: { signatures: tx.signatures, message: { accountKeys: tx.accountKeys.map(({ pubkey, signer, writable }) => ({ pubkey, signer, writable, source: 'transaction' })), instructions: tx.parsedInstructions, recentBlockhash: tx.recentBlockhash } },
    meta: metaOf(tx),
  };
}

function rawResult(tx) {
  return {
    slot: tx.slot,
    blockTime: tx.blockTime,
    version: 'legacy',
    transaction: {
      signatures: tx.signatures,
      message: {
        accountKeys: tx.accountKeys.map((key) => key.pubkey),
        header: tx.header,
        instructions: tx.rawInstructions.map((ix) => ({ programIdIndex: ix.programIdIndex, accounts: ix.accounts, data: bs58.encode(ix.data) })),
        recentBlockhash: tx.recentBlockhash,
      },
    },
    meta: metaOf(tx),
  };
}

function verifySignatures(parsed) {
  for (let i = 0; i < parsed.header.numRequiredSignatures; i++) {
    const ok = nacl.sign.detached.verify(new Uint8Array(parsed.message), new Uint8Array(parsed.signatures[i]), new Uint8Array(parsed.keys[i]));
    if (!ok) bad(-32003, 'signature verification failed');
  }
}

function applyDeltas(state, deltas) {
  for (const [address, delta] of deltas) if (balanceOf(state, address) + delta < 0) bad(-32002, 'insufficient lamports');
  for (const [address, delta] of deltas) state.balances.set(address, balanceOf(state, address) + delta);
}

function record(state, fields) {
  state.slot += 1;
  const tx = { pendingLeft: 0, err: null, fee: FEE_LAMPORTS, blockTime: 1_700_000_000 + state.slot, ...fields, slot: state.slot };
  indexTx(state, tx);
  return tx;
}

function snapshot(state, metas) {
  return metas.map((key) => balanceOf(state, key.pubkey));
}

function sendTransaction(state, params) {
  const [encoded, config] = params;
  if (typeof encoded !== 'string') bad(-32602, 'sendTransaction expects a base64 transaction');
  const encoding = config?.encoding || 'base64';
  let wire;
  try { wire = encoding === 'base58' ? Buffer.from(bs58.decode(encoded)) : Buffer.from(encoded, 'base64'); } catch { bad(-32602, 'transaction encoding is not valid'); }
  const parsed = parseWire(wire);
  verifySignatures(parsed);
  const signature = bs58.encode(parsed.signatures[0]);
  if (state.txs.has(signature)) return signature;
  const mode = state.next;
  state.next = null;
  if (mode?.kind === 'expire') state.slot += BLOCKHASH_WINDOW + 1;
  if (slotOf(state, parsed.recent) == null) bad(-32002, 'Blockhash not found');
  const metas = accountMeta(parsed);
  const { memos, transfers, parsedInstructions } = parseInstructions(parsed, metas);
  if (mode?.kind === 'drop') return signature;
  const payer = metas[0].pubkey;
  const pre = snapshot(state, metas);
  if (mode?.kind === 'fail') {
    if (balanceOf(state, payer) < FEE_LAMPORTS) bad(-32002, 'insufficient lamports');
    state.balances.set(payer, balanceOf(state, payer) - FEE_LAMPORTS);
    const post = snapshot(state, metas);
    record(state, { signature, signatures: parsed.signatures.map((s) => bs58.encode(s)), err: 'InstructionError', recentBlockhash: bs58.encode(parsed.recent), header: parsed.header, accountKeys: metas.map(({ pubkey, signer, writable }) => ({ pubkey, signer, writable })), rawInstructions: parsed.instructions, parsedInstructions, memos, transfers, preBalances: pre, postBalances: post, pendingLeft: 0 });
    return signature;
  }
  const deltas = new Map();
  const add = (address, n) => deltas.set(address, (deltas.get(address) || 0) + n);
  add(payer, -FEE_LAMPORTS);
  for (const transfer of transfers) { add(transfer.source, -transfer.lamports); add(transfer.destination, transfer.lamports); }
  applyDeltas(state, deltas);
  const post = snapshot(state, metas);
  record(state, { signature, signatures: parsed.signatures.map((s) => bs58.encode(s)), err: null, recentBlockhash: bs58.encode(parsed.recent), header: parsed.header, accountKeys: metas.map(({ pubkey, signer, writable }) => ({ pubkey, signer, writable })), rawInstructions: parsed.instructions, parsedInstructions, memos, transfers, preBalances: pre, postBalances: post, pendingLeft: mode?.kind === 'pending' ? mode.n : 0 });
  return signature;
}

function syntheticSignature(label) {
  const first = createHash('sha256').update(label).digest();
  const second = createHash('sha256').update(first).update('mock').digest();
  return Buffer.concat([first, second]);
}

function credit(state, address, lamports, label) {
  pubkeyBytes(address);
  if (!Number.isInteger(lamports) || lamports <= 0 || lamports > Number.MAX_SAFE_INTEGER) bad(-32602, 'lamports must be a positive integer');
  const before = balanceOf(state, address);
  state.balances.set(address, before + lamports);
  const signature = bs58.encode(syntheticSignature(`${label}|${address}|${lamports}|${state.slot}`));
  record(state, {
    signature, signatures: [signature], err: null, fee: 0, recentBlockhash: blockhashFor(state.slot),
    header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
    accountKeys: [{ pubkey: address, signer: true, writable: true }],
    rawInstructions: [], parsedInstructions: [], memos: [], transfers: [],
    preBalances: [before], postBalances: [before + lamports], pendingLeft: 0,
  });
  return signature;
}

function inject(state, body) {
  const payer = body?.payer;
  const to = body?.to;
  const lamports = body?.lamports;
  pubkeyBytes(payer);
  pubkeyBytes(to);
  if (!Number.isInteger(lamports) || lamports < 0) bad(-32602, 'lamports must be an integer');
  const reference = body?.reference ? bs58.encode(pubkeyBytes(body.reference)) : null;
  const memo = body?.memo == null ? null : String(body.memo);
  const accounts = [{ pubkey: payer, signer: true, writable: true }, { pubkey: to, signer: false, writable: true }];
  if (reference && reference !== payer && reference !== to) accounts.push({ pubkey: reference, signer: false, writable: false });
  const memos = memo == null ? [] : [memo];
  const parsedInstructions = [{ program: 'system', programId: SYSTEM, parsed: { type: 'transfer', info: { source: payer, destination: to, lamports } } }];
  if (memo != null) {
    accounts.push({ pubkey: MEMO, signer: false, writable: false });
    parsedInstructions.push({ program: 'spl-memo', programId: MEMO, parsed: memo });
  }
  const signature = bs58.encode(syntheticSignature(`inject|${payer}|${to}|${lamports}|${memo ?? ''}|${reference ?? ''}|${state.slot}`));
  const pre = accounts.map((key) => balanceOf(state, key.pubkey));
  if (balanceOf(state, payer) < lamports + FEE_LAMPORTS) bad(-32002, 'insufficient lamports');
  state.balances.set(payer, balanceOf(state, payer) - lamports - FEE_LAMPORTS);
  state.balances.set(to, balanceOf(state, to) + lamports);
  const post = accounts.map((key) => balanceOf(state, key.pubkey));
  record(state, { signature, signatures: [signature], err: null, recentBlockhash: blockhashFor(state.slot), header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: accounts.length - 2 }, accountKeys: accounts, rawInstructions: [], parsedInstructions, memos, transfers: [{ source: payer, destination: to, lamports }], preBalances: pre, postBalances: post });
  return { ok: true, signature };
}

function encodingOf(params) {
  const opt = params?.[1];
  if (opt && typeof opt === 'object' && opt.encoding) return opt.encoding;
  return 'json';
}

function limitOf(params) {
  const opt = params?.[1];
  const limit = opt && typeof opt === 'object' && Number.isInteger(opt.limit) ? opt.limit : 1000;
  return Math.max(0, Math.min(1000, limit));
}

export function handleRpc(state, request) {
  const id = request?.id ?? null;
  try {
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') bad(-32600, 'invalid request');
    const params = Array.isArray(request.params) ? request.params : [];
    const result = dispatch(state, request.method, params);
    return { jsonrpc: '2.0', id, result };
  } catch (error) {
    return { jsonrpc: '2.0', id, error: { code: error.code || -32603, message: error.message || 'internal' } };
  }
}

function dispatch(state, method, params) {
  if (method === 'getHealth') return 'ok';
  if (method === 'getLatestBlockhash') return { context: { slot: state.slot }, value: { blockhash: blockhashFor(state.slot), lastValidBlockHeight: state.slot + BLOCKHASH_WINDOW } };
  if (method === 'getBalance') {
    const address = bs58.encode(pubkeyBytes(params[0]));
    return { context: { slot: state.slot }, value: balanceOf(state, address) };
  }
  if (method === 'getAccountInfo') {
    const address = bs58.encode(pubkeyBytes(params[0]));
    const lamports = balanceOf(state, address);
    const value = lamports > 0 ? { executable: false, owner: SYSTEM, lamports, data: ['', 'base64'], rentEpoch: 0 } : null;
    return { context: { slot: state.slot }, value };
  }
  if (method === 'sendTransaction') return sendTransaction(state, params);
  if (method === 'getSignatureStatuses') {
    const list = Array.isArray(params[0]) ? params[0] : [];
    return { context: { slot: state.slot }, value: list.map((signature) => { const tx = reveal(state.txs.get(signature)); if (!tx) return null; return { slot: tx.slot, confirmations: 1, err: tx.err, confirmationStatus: 'confirmed' }; }) };
  }
  if (method === 'getTransaction') {
    const tx = reveal(state.txs.get(params[0]));
    if (!tx) return null;
    return encodingOf(params) === 'jsonParsed' ? parsedResult(tx) : rawResult(tx);
  }
  if (method === 'getSignaturesForAddress') {
    const address = bs58.encode(pubkeyBytes(params[0]));
    let sigs = (state.byAddress.get(address) || []).slice();
    const opt = params[1];
    if (opt && typeof opt === 'object' && opt.before) {
      const at = sigs.indexOf(opt.before);
      if (at >= 0) sigs = sigs.slice(0, at);
    }
    sigs.reverse();
    if (opt && typeof opt === 'object' && opt.until) {
      const at = sigs.indexOf(opt.until);
      if (at >= 0) sigs = sigs.slice(0, at);
    }
    return sigs.filter((signature) => state.txs.get(signature)?.pendingLeft === 0).slice(0, limitOf(params)).map((signature) => {
      const tx = state.txs.get(signature);
      return { signature, slot: tx.slot, err: tx.err, memo: memoField(tx.memos), blockTime: tx.blockTime };
    });
  }
  if (method === 'requestAirdrop') return credit(state, params[0], params[1], 'airdrop');
  bad(-32601, `method not found: ${method}`);
}

function control(state, pathname, body) {
  if (pathname === '/__mock/reset') { reset(state); return { ok: true, ...summary(state) }; }
  if (pathname === '/__mock/ledger') return { ok: true, ...summary(state) };
  if (pathname === '/__mock/fund' || pathname === '/__mock/airdrop') {
    const address = body?.wallet || body?.address;
    const signature = credit(state, address, body?.lamports, pathname.slice(8));
    return { ok: true, signature, lamports: balanceOf(state, address) };
  }
  if (pathname === '/__mock/mode') { state.next = parseMode(body?.next); return { ok: true, next: body?.next }; }
  if (pathname === '/__mock/fail-next') { state.next = { kind: 'fail' }; return { ok: true, next: 'fail' }; }
  if (pathname === '/__mock/inject') return inject(state, body || {});
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) { reject(Object.assign(new Error('body too large'), { code: -32600 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'content-type': 'application/json' };

export async function handleHttp(state, req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && (url.pathname === '/__mock/ledger' || url.pathname === '/health')) {
      const body = url.pathname === '/health' ? { ok: true, result: 'ok' } : { ok: true, ...summary(state) };
      res.writeHead(200, CORS); res.end(JSON.stringify(body)); return;
    }
    if (req.method !== 'POST') { res.writeHead(404, CORS); res.end(JSON.stringify({ ok: false, error: 'not found' })); return; }
    const raw = await readBody(req);
    const json = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    const controlled = control(state, url.pathname, json);
    if (controlled) { res.writeHead(200, CORS); res.end(JSON.stringify(controlled)); return; }
    const out = Array.isArray(json) ? json.map((item) => handleRpc(state, item)) : handleRpc(state, json);
    res.writeHead(200, CORS); res.end(JSON.stringify(out));
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : 500;
    res.writeHead(status, CORS);
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: error.code || -32700, message: error.message || 'parse error' } }));
  }
}

export function listen(state, { host = '127.0.0.1', port = MOCK_PORT } = {}) {
  if (Number(port) === 8899) throw new Error('mock-rpc does not bind port 8899 (use 8898)');
  const server = http.createServer((req, res) => { handleHttp(state, req, res).catch(() => { if (!res.headersSent) res.writeHead(500, CORS); res.end(); }); });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

function invokedDirectly() {
  const self = fileURLToPath(import.meta.url);
  const arg = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return arg === self;
}

async function rpcFetch(body) {
  const res = await fetch(`http://127.0.0.1:${MOCK_PORT}`, { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify(body) });
  return res.json();
}

function check(name, ok, detail = '') {
  if (!ok) throw new Error(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`ok  ${name}`);
}

async function selfTest() {
  const started = Date.now();
  let refused = false;
  try { await listen(createLedger(), { port: 8899 }); } catch (error) { refused = /8899/.test(error.message); }
  check('port 8899 is refused before bind', refused);

  const a = namedWallet('viewerA');
  const d = namedWallet('driverD');
  const ref = namedWallet('refR');
  const fresh = () => {
    const one = createLedger();
    const hash = blockhashFor(one.slot);
    const wire = signWire(buildTransfer({ from: a, to: d.address, lamports: 1_000_000, blockhash: hash, memo: 'fc-donation:test', reference: ref.address }), a);
    return { one, hash, wire };
  };
  const run = (state, wire) => handleRpc(state, { jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [Buffer.from(wire).toString('base64'), { encoding: 'base64' }] });
  const first = fresh();
  const sent = run(first.one, first.wire);
  const again = fresh();
  const resent = run(again.one, again.wire);
  check('the same transfer signs to the same signature', sent.result && sent.result === resent.result, sent.error?.message);
  check('driver gained the lamports and the payer paid the fee', first.one.balances.get(d.address) === START_LAMPORTS + 1_000_000 && first.one.balances.get(a.address) === START_LAMPORTS - 1_000_000 - FEE_LAMPORTS);
  check('the referrer balance did not move', first.one.balances.get(ref.address) === START_LAMPORTS);
  const parsed = handleRpc(first.one, { jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sent.result, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] }).result;
  check('parsed transfer, memo, and reference', parsed?.meta?.fee === FEE_LAMPORTS && parsed.meta.err === null && parsed.transaction.message.instructions[0].parsed.info.lamports === 1_000_000 && parsed.transaction.message.instructions[1].parsed === 'fc-donation:test' && parsed.transaction.message.accountKeys.some((key) => key.pubkey === ref.address));
  const listed = handleRpc(first.one, { jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [ref.address, { limit: 5 }] }).result;
  check('reference index is newest first with the memo length prefix', listed?.[0]?.signature === sent.result && listed[0].memo === '[16] fc-donation:test');
  const status = handleRpc(first.one, { jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses', params: [[sent.result], { searchTransactionHistory: true }] }).result;
  check('signature status is confirmed', status?.value?.[0]?.confirmationStatus === 'confirmed' && status.value[0].err === null);
  const dup = run(first.one, first.wire);
  check('a resend does not move lamports twice', dup.result === sent.result && first.one.balances.get(d.address) === START_LAMPORTS + 1_000_000);

  const badSig = Buffer.from(first.wire);
  badSig[1] ^= 0xff;
  const rejected = run(createLedger(), badSig);
  check('a bad signature is rejected', rejected.error?.message === 'signature verification failed');

  const poor = createLedger();
  poor.balances.set(a.address, 1000);
  const broke = run(poor, signWire(buildTransfer({ from: a, to: d.address, lamports: 1, blockhash: blockhashFor(poor.slot) }), a));
  check('insufficient lamports does not pay the driver', broke.error?.message === 'insufficient lamports' && poor.balances.get(d.address) === START_LAMPORTS);

  const failing = createLedger();
  failing.next = { kind: 'fail' };
  const failed = run(failing, signWire(buildTransfer({ from: a, to: d.address, lamports: 50, blockhash: blockhashFor(failing.slot) }), a));
  const failedTx = handleRpc(failing, { jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [failed.result, { encoding: 'jsonParsed' }] }).result;
  check('fail mode sets meta.err and does not pay the driver', failedTx?.meta?.err === 'InstructionError' && failing.balances.get(d.address) === START_LAMPORTS && failing.balances.get(a.address) === START_LAMPORTS - FEE_LAMPORTS);

  const dropping = createLedger();
  dropping.next = { kind: 'drop' };
  const dropped = run(dropping, signWire(buildTransfer({ from: a, to: d.address, lamports: 50, blockhash: blockhashFor(dropping.slot) }), a));
  const missing = handleRpc(dropping, { jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [dropped.result, { encoding: 'jsonParsed' }] }).result;
  check('drop mode returns a signature and stores nothing', dropped.result && missing === null && dropping.balances.get(a.address) === START_LAMPORTS);

  const pending = createLedger();
  pending.next = parseMode('pending:3');
  const hidden = run(pending, signWire(buildTransfer({ from: a, to: d.address, lamports: 50, blockhash: blockhashFor(pending.slot) }), a));
  const polls = [0, 1, 2].map(() => handleRpc(pending, { jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [hidden.result, { encoding: 'jsonParsed' }] }).result);
  const shown = handleRpc(pending, { jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [hidden.result, { encoding: 'jsonParsed' }] }).result;
  check('pending:3 hides the transaction for three reads', polls.every((row) => row === null) && shown?.transaction?.signatures?.[0] === hidden.result);

  const expiring = createLedger();
  const stale = blockhashFor(expiring.slot);
  expiring.next = { kind: 'expire' };
  const expired = run(expiring, signWire(buildTransfer({ from: a, to: d.address, lamports: 50, blockhash: stale }), a));
  check('expire mode invalidates the previous blockhash', expired.error?.message === 'Blockhash not found' && expiring.balances.get(a.address) === START_LAMPORTS);

  const server = await listen(createLedger(), { host: '127.0.0.1', port: MOCK_PORT });
  try {
    check('the socket is 8898', server.address().port === MOCK_PORT);
    const health = await rpcFetch({ jsonrpc: '2.0', id: 1, method: 'getHealth' });
    check('getHealth over HTTP', health.result === 'ok');
    const latest = await rpcFetch({ jsonrpc: '2.0', id: 7, method: 'getLatestBlockhash', params: [{ commitment: 'confirmed' }] });
    check('getLatestBlockhash shape', latest.id === 7 && latest.result.value.lastValidBlockHeight === latest.result.context.slot + BLOCKHASH_WINDOW && bs58.decode(latest.result.value.blockhash).length === 32);
    const info = await rpcFetch({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [a.address, { encoding: 'base64' }] });
    check('getAccountInfo is a funded system account', info.result.value.lamports === START_LAMPORTS && info.result.value.owner === SYSTEM && info.result.value.data[1] === 'base64');
    const empty = await rpcFetch({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [bs58.encode(Buffer.alloc(32, 9))] });
    check('an unfunded account is null and its balance is 0', empty.result.value === null);
    const zero = await rpcFetch({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [bs58.encode(Buffer.alloc(32, 9))] });
    check('getBalance of an unknown account is 0', zero.result.value === 0);

    const window = fakeWindow();
    const installed = install(window, { name: 'viewerA', rpc: `http://127.0.0.1:${MOCK_PORT}` });
    await installed.provider.connect();
    const signedIn = await installed.provider.signIn({ domain: 'freightchain.localhost', statement: 'Sign in to Freight Chain.', uri: 'http://freightchain.localhost/', version: '1', chainId: 'solana:devnet', nonce: 'nonce-e1m', issuedAt: '2026-10-20T00:00:00.000Z' });
    const text = new TextDecoder().decode(signedIn.signedMessage);
    check('SIWS text matches the server field order', text === formatSiws({ domain: 'freightchain.localhost', statement: 'Sign in to Freight Chain.', uri: 'http://freightchain.localhost/', version: '1', chainId: 'solana:devnet', nonce: 'nonce-e1m', issuedAt: '2026-10-20T00:00:00.000Z' }, a.address));
    check('SIWS signature verifies', nacl.sign.detached.verify(signedIn.signedMessage, signedIn.signature, a.publicKey));
    check('window.solana is the injected phantom provider', window.solana?.isPhantom === true && window.phantom.solana === window.solana);
    const seen = [];
    window.addEventListener('wallet-standard:register-wallet', (ev) => { ev.detail({ register: (w) => seen.push(w) }); });
    install(window, { wallet: a, rpc: `http://127.0.0.1:${MOCK_PORT}` });
    check('wallet standard registration exposes signIn and signAndSend', seen[0]?.features?.['solana:signIn'] && seen[0].features['solana:signAndSendTransaction'] && seen[0].chains.includes('solana:devnet'));

    const hash = (await rpcFetch({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash' })).result.value.blockhash;
    const unsigned = buildTransfer({ from: a, to: d.address, lamports: 42, blockhash: hash, memo: 'fc-donation:wallet', reference: ref.address });
    const sentByWallet = await installed.provider.signAndSendTransaction(unsigned);
    const after = await rpcFetch({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [d.address] });
    check('window.solana signAndSend confirms a transfer', after.result.value === START_LAMPORTS + 42 && typeof sentByWallet.signature === 'string');
    const nodeSig = signMessage(a, signedIn.signedMessage);
    check('detached SIWS bytes match signMessage', Buffer.from(nodeSig).equals(Buffer.from(signedIn.signature)));

    await vmBrowser(unsigned, a);

    const require = createRequire(import.meta.url);
    const web3 = require('../../../backend/server/node_modules/@solana/web3.js/lib/index.cjs.js');
    const payer = web3.Keypair.fromSeed(a.seed);
    check('web3.js Keypair.fromSeed matches the harness address', payer.publicKey.toBase58() === a.address);
    const connection = new web3.Connection(`http://127.0.0.1:${MOCK_PORT}`, 'confirmed');
    const block = await connection.getLatestBlockhash('confirmed');
    const tx = new web3.Transaction({ feePayer: payer.publicKey, recentBlockhash: block.blockhash });
    const transfer = web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: new web3.PublicKey(d.address), lamports: 77 });
    transfer.keys.push({ pubkey: new web3.PublicKey(ref.address), isSigner: false, isWritable: false });
    tx.add(transfer);
    tx.add(new web3.TransactionInstruction({ keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }], programId: new web3.PublicKey(MEMO), data: Buffer.from('fc-donation:web3') }));
    const ours = buildTransfer({ from: a, to: d.address, lamports: 77, blockhash: block.blockhash, memo: 'fc-donation:web3', reference: ref.address });
    check('buildTransfer matches web3.js message bytes', Buffer.from(tx.serializeMessage()).equals(Buffer.from(ours.subarray(1 + 64))));
    tx.sign(payer);
    const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const got = await connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    const balance = await connection.getBalance(new web3.PublicKey(d.address), 'confirmed');
    const statuses = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    check('web3.js Connection reads the mock transfer', got?.meta?.err == null && got.transaction.message.instructions.some((ix) => ix.parsed?.type === 'transfer' && ix.parsed.info.lamports === 77) && balance === after.result.value + 77 && statuses.value[0]?.confirmationStatus === 'confirmed', `balance ${balance}`);

    const resetJson = await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/reset`, { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' }, body: '{}' })).json();
    check('reset restores the named wallets', resetJson.ok === true && resetJson.wallets.viewerA.lamports === START_LAMPORTS && resetJson.wallets.driverD.lamports === START_LAMPORTS && resetJson.transactions.length === 0);
    const failNext = await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/fail-next`, { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' }, body: '{}' })).json();
    const armedHash = (await rpcFetch({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash' })).result.value.blockhash;
    const armed = await rpcFetch({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [signWire(buildTransfer({ from: a, to: d.address, lamports: 5, blockhash: armedHash }), a).toString('base64'), { encoding: 'base64' }] });
    const armedTx = await rpcFetch({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [armed.result, { encoding: 'jsonParsed' }] });
    const driverAfterFail = await rpcFetch({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [d.address] });
    check('POST /__mock/fail-next fails the next send', failNext.next === 'fail' && armedTx.result?.meta?.err === 'InstructionError' && driverAfterFail.result.value === START_LAMPORTS);
    const attacker = namedWallet('attackerX');
    const injected = await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/inject`, { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ payer: a.address, to: attacker.address, lamports: 9, memo: 'fc-donation:test', reference: ref.address }) })).json();
    const injectedTx = await rpcFetch({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [injected.signature, { encoding: 'jsonParsed' }] });
    const attackerBal = await rpcFetch({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [attacker.address] });
    check('inject records a transfer to the named recipient', injected.ok === true && injectedTx.result.transaction.message.instructions[0].parsed.info.destination === attacker.address && attackerBal.result.value === START_LAMPORTS + 9);
    const airdrop = await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/airdrop`, { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ wallet: a.address, lamports: 100 }) })).json();
    check('airdrop credits the wallet', airdrop.ok === true && airdrop.lamports === START_LAMPORTS - FEE_LAMPORTS - 9 - FEE_LAMPORTS + 100);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
  }
  check('the listen socket is closed', server.listening === false);
  const elapsed = Date.now() - started;
  if (elapsed >= 2000) throw new Error(`self-test took ${elapsed}ms`);
  console.log(`self-test ok ${elapsed}ms`);
}

function fakeWindow() {
  const listeners = new Map();
  return {
    solana: null,
    phantom: null,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    dispatchEvent(ev) { for (const fn of listeners.get(ev.type) || []) fn(ev); return true; },
  };
}

async function vmBrowser(unsigned, kp) {
  const { webcrypto } = await import('node:crypto');
  const vm = await import('node:vm');
  const window = fakeWindow();
  const context = vm.createContext({ window, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, fetch: globalThis.fetch.bind(globalThis), atob: globalThis.atob, btoa: globalThis.btoa, CustomEvent: window.CustomEvent, console });
  vm.runInContext(browserSource({ wallet: kp, rpc: `http://127.0.0.1:${MOCK_PORT}` }), context);
  const browserSig = await window.solana.signMessage(new TextEncoder().encode('freightchain'));
  const local = signMessage(kp, 'freightchain');
  check('browser WebCrypto signature matches tweetnacl', Buffer.from(browserSig.signature).equals(Buffer.from(local)));
  const signed = await window.solana.signIn({ domain: 'localhost', nonce: 'n', issuedAt: '2026-10-20T00:00:00Z' });
  check('browser SIWS verifies', nacl.sign.detached.verify(signed.signedMessage, signed.signature, kp.publicKey) && new TextDecoder().decode(signed.signedMessage) === formatSiws({ domain: 'localhost', nonce: 'n', issuedAt: '2026-10-20T00:00:00Z' }, kp.address));
  const sent = await window.solana.signAndSendTransaction(new Uint8Array(unsigned));
  check('browser script broadcasts the same wire', typeof sent.signature === 'string' && sent.signature.length > 40);
}

if (invokedDirectly()) {
  if (process.argv.includes('--self-test')) {
    setImmediate(() => {
      selfTest().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
    });
  } else {
    const port = Number(process.env.MOCK_RPC_PORT || MOCK_PORT);
    const host = process.env.MOCK_RPC_HOST || '127.0.0.1';
    listen(createLedger(), { host, port }).then((server) => {
      console.log(`mock-rpc listening on http://${host}:${server.address().port}`);
    }, (error) => { console.error(error.message); process.exit(1); });
  }
}
