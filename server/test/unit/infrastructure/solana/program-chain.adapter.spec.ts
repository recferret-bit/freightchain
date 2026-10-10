import { Keypair, PublicKey, Transaction, type Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import { ProgramChainAdapter, CU_LIMITS, parseKeypair } from '../../../../src/infrastructure/solana/program-chain.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { NotFoundError, ServiceUnavailableError } from '../../../../src/domain/shared/errors.js';
import { FakeClock } from '../../../support/fake-clock.js';
import { expectedEvent, fixtureAccount, fixtureTx, poolProgramFixture, type FixtureInstruction } from '../../../support/chain-fixtures.js';

/* The RPC is replaced (no network): this checks what the adapter asks for and builds, against the REAL program's instructions and logs (LiteSVM fixtures). */
const fx = poolProgramFixture();
const seedKey = (n: number) => Keypair.fromSeed(new Uint8Array(32).fill(n)); // the fixture's fixed keys (Keypair::new_from_array([n; 32]))
const gas = seedKey(5);
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const ORDER_A = '0b5ec9e3-1f2a-4c3d-8e4f-5a6b7c8d9e0f', ORDER_B = '7d1c0042-a1b2-4cd3-9ef4-05162738495a';

type Rpc = Partial<Record<keyof Connection | '_rpcRequest', unknown>>;
function adapterWith(rpc: Rpc = {}, env: Partial<EnvService> = {}) {
  const adapter = new ProgramChainAdapter({
    solanaRpc: 'http://127.0.0.1:1', solanaRpcFallbacks: [], solanaCommitment: 'confirmed', ticketProgramId: fx.programId, feePayerSecret: undefined, solanaWs: '',
    feePayerMinSol: 0.05, priorityFee: { percentile: 75, minMicrolamports: 0, maxMicrolamports: 50_000 }, ...env,
  } as unknown as EnvService, new FakeClock());
  const waits: number[] = [];
  (adapter as unknown as { wait: (ms: number) => Promise<void> }).wait = async (ms) => { waits.push(ms); };
  Object.assign((adapter as unknown as { rpc: { primary: object } }).rpc.primary, {
    getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 4242 }),
    getRecentPrioritizationFees: async () => [{ slot: 1, prioritizationFee: 1_500 }, { slot: 2, prioritizationFee: 0 }],
    _rpcRequest: async () => ({ error: { code: -32601, message: 'Method not found' } }),
    getMinimumBalanceForRentExemption: async () => 890_880,   // mainnet / local validator; devnet answers 650 240
    ...rpc,
  });
  return { adapter, waits };
}
const sponsored = { feePayerSecret: bs58.encode(gas.secretKey) };
const accountInfo = (name: string) => { const a = fixtureAccount(name); return { owner: new PublicKey(a.owner), lamports: Number(a.lamports), data: Buffer.from(a.data, 'base64'), executable: false }; };
/** the program instructions of a built transaction (after the two compute-budget ones) in the fixture's JSON shape */
function programIxs(base64: string) {
  const tx = Transaction.from(Buffer.from(base64, 'base64'));
  expect(tx.instructions[0]!.programId.toBase58()).toBe('ComputeBudget111111111111111111111111111111');
  expect(tx.instructions[1]!.programId.toBase58()).toBe('ComputeBudget111111111111111111111111111111');
  return { tx, ixs: tx.instructions.slice(2).map((i) => ({ programId: i.programId.toBase58(), data: i.data.toString('base64'), accounts: i.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })) })) };
}
/** The fixture's instructions as a compiled message renders them: a message keeps ONE flag set per account (the union over every use, the fee payer a writable
    signer), so a key that is both `caller` (signer) and `pool_authority` reads back as a signer in both places – the message's doing, not the instruction's. */
function asCompiled(expected: FixtureInstruction[], payer: string) {
  const flags = new Map<string, { isSigner: boolean; isWritable: boolean }>([[payer, { isSigner: true, isWritable: true }]]);
  for (const a of expected.flatMap((i) => i.accounts)) {
    const f = flags.get(a.pubkey) ?? { isSigner: false, isWritable: false };
    flags.set(a.pubkey, { isSigner: f.isSigner || a.isSigner, isWritable: f.isWritable || a.isWritable });
  }
  return expected.map((i) => ({ programId: i.programId, data: i.data, accounts: i.accounts.map((a) => ({ pubkey: a.pubkey, ...flags.get(a.pubkey)! })) }));
}
const expectIxs = (built: { transaction: string; feePayer: string }, expected: FixtureInstruction[]) => expect(programIxs(built.transaction).ixs).toEqual(asCompiled(expected, built.feePayer));

describe('ProgramChainAdapter – builds what the program accepted', () => {
  it('a gasless buy: sponsor = fee payer (and Ticket rent payer), the buyer signs for the price – byte for byte the fixture\'s instruction', async () => {
    const { adapter } = adapterWith({}, sponsored);
    const built = await adapter.buildBuyTransaction({ payer: fx.keys.a, poolId: 0, qty: 2, orderId: ORDER_A });
    const { tx } = programIxs(built.transaction);
    expectIxs(built, fixtureTx('buy_ticket sponsored').instructions);
    expect(built).toMatchObject({ feePayer: fx.keys.gas, blockhash: BLOCKHASH, lastValidBlockHeight: 4242, computeUnits: CU_LIMITS.buy, priorityMicrolamports: 1_500 });
    expect(tx.feePayer?.toBase58()).toBe(fx.keys.gas);
    expect(tx.serializeMessage().toString('base64')).toBe(built.message); // the bytes /submit compares
    expect(tx.signatures.map((s) => s.publicKey.toBase58())).toEqual([fx.keys.gas, fx.keys.a]);
    const own = await adapter.buildBuyTransaction({ payer: fx.keys.a, poolId: 0, qty: 2, orderId: ORDER_A, selfPaid: true }); // cap used up / client fallback
    expect(own.feePayer).toBe(fx.keys.a);
  });

  it('a self-paid buy without a sponsor: the buyer is both signers', async () => {
    const built = await adapterWith().adapter.buildBuyTransaction({ payer: fx.keys.b, poolId: 0, qty: 1, orderId: ORDER_B });
    expectIxs(built, fixtureTx('buy_ticket self-paid').instructions);
    expect(built.feePayer).toBe(fx.keys.b);
  });

  it('a refund (+ fail_pool) reads the ticket\'s rent payer; refused when there is no ticket', async () => {
    const { adapter } = adapterWith({ getAccountInfo: async () => accountInfo('ticket pool 1 C') }, sponsored);
    const built = await adapter.buildRefundTransaction({ caller: fx.keys.d, poolId: 1, buyer: fx.keys.c, needsFail: true });
    expectIxs(built, fixtureTx('fail_pool + refund').instructions);
    expect(built).toMatchObject({ feePayer: fx.keys.gas, computeUnits: CU_LIMITS.refund + CU_LIMITS.fail_pool });
    const noFail = await adapter.buildRefundTransaction({ caller: fx.keys.d, poolId: 1, buyer: fx.keys.c, needsFail: false, selfPaid: true });
    expect(noFail.feePayer).toBe(fx.keys.d);
    expectIxs(noFail, [fixtureTx('fail_pool + refund').instructions[1]!]);
    const none = adapterWith({ getAccountInfo: async () => null }).adapter;
    await expect(none.buildRefundTransaction({ caller: fx.keys.d, poolId: 1, buyer: fx.keys.c, needsFail: false })).rejects.toMatchObject({ statusCode: 409, errorCode: 'no_ticket' });
  });

  it('pay_prize and close_pool are the admin\'s own transactions (it signs and pays in Phantom)', async () => {
    const { adapter } = adapterWith({ getMultipleAccountsInfo: async () => [accountInfo('pool 0 active'), accountInfo('config')] }, sponsored);
    const prize = await adapter.buildPayPrizeTransaction({ authority: fx.keys.authority, poolId: 0, to: fx.keys.winner, lamports: 100_000_000, rank: 1 });
    expectIxs(prize, fixtureTx('pay_prize').instructions);
    expect(prize.feePayer).toBe(fx.keys.authority);
    const close = await adapter.buildClosePoolTransaction({ authority: fx.keys.authority, poolId: 0 });
    expectIxs(close, fixtureTx('close_pool settled').instructions);
    const missing = adapterWith({ getMultipleAccountsInfo: async () => [null, accountInfo('config')] }).adapter;
    await expect(missing.buildClosePoolTransaction({ authority: fx.keys.authority, poolId: 9 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('the compute-unit limits cover every measured instruction with ≥ 25 % headroom', () => {
    const measured = (name: string) => Math.max(...fx.transactions.filter((t) => !t.err && t.instructions.length === 1 && t.instructions[0]!.name === name).map((t) => t.computeUnits));
    expect(CU_LIMITS.buy).toBeGreaterThanOrEqual(measured('buy_ticket') * 1.25);
    expect(CU_LIMITS.pay_prize).toBeGreaterThanOrEqual(measured('pay_prize') * 1.25);
    expect(CU_LIMITS.close_pool).toBeGreaterThanOrEqual(measured('close_pool') * 1.25);
    expect(CU_LIMITS.refund + CU_LIMITS.fail_pool).toBeGreaterThanOrEqual(fixtureTx('fail_pool + refund').computeUnits * 1.25);
  });
});

describe('ProgramChainAdapter – reads', () => {
  it('readEvents decodes the program\'s events; pending / failed / unrelated / truncated', async () => {
    const t = fixtureTx('buy_ticket self-paid');
    const tx = (meta: unknown) => adapterWith({ getTransaction: async () => ({ slot: 77, meta }) }).adapter;
    expect(await tx({ err: null, logMessages: t.logs }).readEvents('sig')).toEqual(t.events.map((e, index) => ({ ...expectedEvent(e), signature: 'sig', slot: 77, index })));
    expect(await adapterWith({ getTransaction: async () => null }).adapter.readEvents('sig')).toBe('pending');
    expect(await tx({ err: { InstructionError: [0, { Custom: 6007 }] }, logMessages: [] }).readEvents('sig')).toEqual({ invalid: expect.stringMatching(/failed/) });
    expect(await tx({ err: null, logMessages: ['Program 11111111111111111111111111111111 invoke [1]'] }).readEvents('sig')).toEqual({ invalid: 'not a pool program transaction' });
    expect(await tx({ err: null, logMessages: [...t.logs, 'Log truncated'] }).readEvents('sig')).toEqual({ invalid: expect.stringMatching(/truncated/) });
    expect(await tx(null).readEvents('sig')).toEqual({ invalid: expect.stringMatching(/metadata/) });
  });

  it('readPool: the Pool account + its vault from one read; the escrow excludes the rent minimum', async () => {
    const pool = fixtureAccount('pool 0 active');
    const vault = 890_880 + 350_000_000;
    const { adapter } = adapterWith({ getMultipleAccountsInfo: async (keys: PublicKey[]) => { expect(keys.length).toBe(2); return [accountInfo('pool 0 active'), { lamports: vault }]; } });
    const state = await adapter.readPool(0);
    const d = pool.decoded;
    expect(state).toEqual({
      poolId: 0, address: pool.address, status: 'active', ticketsSold: 3, buyers: 2, sponsored: 50_000_000, prizesPaid: 0, refunded: 0, vaultLamports: vault, escrowLamports: 350_000_000,
      vault: fixtureTx('buy_ticket sponsored').instructions[0]!.accounts[4]!.pubkey, authority: fx.keys.authority, tier: 1, priceLamports: 100_000_000, minTickets: 3, maxTickets: 10, maxPerWallet: 4,
      prepDeadline: new Date(Number(d['prepDeadline']) * 1000), playDeadline: new Date(Number(d['playDeadline']) * 1000), prizeBps: 6000, seedBps: 2500, feeBps: 1500,
      feeTreasury: fx.keys.feeTreasury, seedTreasury: fx.keys.seedTreasury, createdAt: new Date(Number(d['createdAt']) * 1000),
    });
    // the rent minimum is the cluster's own (read once): devnet's is lower than mainnet's, so the escrow there is vault − 650 240
    let rentReads = 0;
    const devnet = adapterWith({ getMinimumBalanceForRentExemption: async () => { rentReads++; return 650_240; }, getMultipleAccountsInfo: async () => [accountInfo('pool 0 active'), { lamports: 650_240 + 350_000_000 }] }).adapter;
    expect((await devnet.readPool(0))?.escrowLamports).toBe(350_000_000);
    await devnet.readPool(0);
    expect(rentReads).toBe(1);
    expect(await adapterWith({ getMultipleAccountsInfo: async () => [null, null] }).adapter.readPool(5)).toBeNull();
    expect(await adapterWith({ getMultipleAccountsInfo: async () => [{ ...accountInfo('pool 0 active'), owner: PublicKey.default }, null] }).adapter.readPool(0)).toBeNull();
  });

  it('recentProgramSignatures walks back to the cursor and hands out the OLDEST first (failed ones too)', async () => {
    const sigs = Array.from({ length: 1003 }, (_, i) => ({ signature: `s${1003 - i}`, slot: 1003 - i, err: i === 0 ? { x: 1 } : null })); // newest first
    const calls: unknown[] = [];
    const { adapter } = adapterWith({ getSignaturesForAddress: async (_: PublicKey, o: { before?: string }) => { calls.push(o); const from = o.before ? sigs.findIndex((s) => s.signature === o.before) + 1 : 0; return sigs.slice(from, from + 1000); } });
    const out = await adapter.recentProgramSignatures('s0', 5);
    expect(out.map((s) => s.signature)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(calls).toEqual([{ until: 's0', before: undefined, limit: 1000 }, { until: 's0', before: 's4', limit: 1000 }]);
    const all = await adapter.recentProgramSignatures('s0', 5000);
    expect(all.at(-1)).toEqual({ signature: 's1003', slot: 1003, failed: true });
    const fresh = await adapterWith({ getSignaturesForAddress: async () => sigs.slice(0, 1000) }).adapter.recentProgramSignatures(null, 2);
    expect(fresh.map((s) => s.signature)).toEqual(['s1002', 's1003']); // no cursor: the newest, oldest first
  });

  it('feeQuote: the CU price of the hot accounts, the CU limit and the fee; two signatures when the sponsor pays', async () => {
    let asked: string[] = [];
    const rpc = { getRecentPrioritizationFees: async (o: { lockedWritableAccounts: PublicKey[] }) => { asked = o.lockedWritableAccounts.map((k) => k.toBase58()); return [{ slot: 1, prioritizationFee: 10_000 }]; } };
    expect(await adapterWith(rpc).adapter.feeQuote({ poolId: 0, kind: 'buy' })).toEqual({ priorityMicrolamports: 10_000, computeUnits: CU_LIMITS.buy, estimatedFeeLamports: 5_000 + 600 });
    expect(asked).toEqual([fixtureAccount('pool 0 active').address, fixtureTx('buy_ticket sponsored').instructions[0]!.accounts[4]!.pubkey]);
    expect((await adapterWith(rpc, sponsored).adapter.feeQuote({ poolId: null, kind: 'buy' })).estimatedFeeLamports).toBe(10_600);
    expect(asked).toEqual([fx.programId]);
    expect((await adapterWith(rpc, sponsored).adapter.feeQuote({ poolId: 0, kind: 'pay_prize' })).estimatedFeeLamports).toBe(5_000 + 170);
    await adapterWith(rpc, { ticketProgramId: '' }).adapter.feeQuote({ poolId: null, kind: 'buy' }); // transfer mode: the network's own recent fees
    expect(asked).toEqual([]);
  });

  it('simulate names the program error; an RPC failure is 503; no program configured is 503', async () => {
    const built = await adapterWith().adapter.buildBuyTransaction({ payer: fx.keys.b, poolId: 0, qty: 1, orderId: ORDER_B });
    expect(await adapterWith({ simulateTransaction: async () => ({ value: { err: null, unitsConsumed: 19_000, logs: [] } }) }).adapter.simulate(built)).toEqual({ ok: true, unitsConsumed: 19_000 });
    const sold = adapterWith({ simulateTransaction: async () => ({ value: { err: { InstructionError: [2, { Custom: 6007 }] }, logs: ['x'] } }) }).adapter;
    expect(await sold.simulate(built)).toEqual({ ok: false, reason: expect.stringMatching(/^SoldOut: /) });
    const down = async () => { throw new Error('429'); };
    await expect(adapterWith({ getLatestBlockhash: down }).adapter.buildBuyTransaction({ payer: fx.keys.b, poolId: 0, qty: 1, orderId: ORDER_B })).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(adapterWith({ getTransaction: down }).adapter.readEvents('s')).rejects.toBeInstanceOf(ServiceUnavailableError);
    const off = adapterWith({}, { ticketProgramId: '' }).adapter;
    await expect(off.buildBuyTransaction({ payer: fx.keys.b, poolId: 0, qty: 1, orderId: ORDER_B })).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(off.readPool(0)).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(off.subscribeLogs(() => undefined)).toBeTypeOf('function'); // no-op
    expect(adapterWith().adapter.subscribeLogs(() => undefined)).toBeTypeOf('function'); // no SOLANA_WS: no-op
  });
});

describe('ProgramChainAdapter – the gas sponsor', () => {
  const buyer = seedKey(1);
  async function signedBuy(rpc: Rpc = {}, qty = 2) {
    const h = adapterWith(rpc, sponsored);
    const built = await h.adapter.buildBuyTransaction({ payer: fx.keys.a, poolId: 0, qty, orderId: ORDER_A });
    const tx = Transaction.from(Buffer.from(built.transaction, 'base64'));
    tx.partialSign(buyer); // what Phantom's signTransaction does
    return { ...h, built, signed: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') };
  }
  const healthy = (statuses: unknown[], sent: Buffer[] = [], height = 4100) => ({
    getBlockHeight: async () => height, getBalance: async () => 1e9,
    simulateTransaction: async () => ({ value: { err: null, logs: [] } }),
    sendRawTransaction: async (raw: Buffer) => { sent.push(raw); return 'x'; },
    getSignatureStatuses: async () => ({ value: [statuses.shift() ?? null] }),
  });

  it('co-signs exactly the built transaction, re-sends until confirmed, returns its signature', async () => {
    const sent: Buffer[] = [];
    const { adapter, built, signed, waits } = await signedBuy(healthy([null, { confirmationStatus: 'processed', err: null }, { confirmationStatus: 'confirmed', err: null }], sent));
    const out = await adapter.cosignAndSend({ signedTransaction: signed, expectedMessage: built.message, lastValidBlockHeight: built.lastValidBlockHeight });
    expect(sent.length).toBe(3);
    const landed = Transaction.from(sent[0]!);
    expect(landed.verifySignatures()).toBe(true);
    expect(out).toEqual({ signature: bs58.encode(landed.signature!), lastValidBlockHeight: 4242, confirmed: true });
    expect(waits.every((w) => w === 2_000)).toBe(true);
  });

  it('refuses a message it did not build (400) before touching the network', async () => {
    const { adapter, built } = await signedBuy({ getBlockHeight: async () => { throw new Error('must not be asked'); } });
    const other = await signedBuy({}, 1); // a valid, signed buy – but not the one stored with this order
    await expect(adapter.cosignAndSend({ signedTransaction: other.signed, expectedMessage: built.message, lastValidBlockHeight: 4242 })).rejects.toMatchObject({ statusCode: 400, errorCode: 'transaction_mismatch' });
  });

  it('a stale blockhash is 400; no sponsor or an empty one is 503; a failing transaction 409', async () => {
    const stale = await signedBuy(healthy([], [], 5000));
    await expect(stale.adapter.cosignAndSend({ signedTransaction: stale.signed, expectedMessage: stale.built.message, lastValidBlockHeight: 4242 })).rejects.toMatchObject({ statusCode: 400, errorCode: 'transaction_expired' });
    const broke = await signedBuy({ ...healthy([]), getBalance: async () => 1_000 });
    await expect(broke.adapter.cosignAndSend({ signedTransaction: broke.signed, expectedMessage: broke.built.message, lastValidBlockHeight: 4242 })).rejects.toBeInstanceOf(ServiceUnavailableError);
    const failing = await signedBuy({ ...healthy([]), simulateTransaction: async () => ({ value: { err: { InstructionError: [2, { Custom: 6008 }] }, logs: [] } }) });
    await expect(failing.adapter.cosignAndSend({ signedTransaction: failing.signed, expectedMessage: failing.built.message, lastValidBlockHeight: 4242 }))
      .rejects.toMatchObject({ errorCode: 'transaction_would_fail', message: expect.stringMatching(/WalletCap/) });
    const self = adapterWith();
    await expect(self.adapter.cosignAndSend({ signedTransaction: stale.signed, expectedMessage: stale.built.message, lastValidBlockHeight: 4242 })).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('dropped (blockhash gone, never seen) → 409 dropped; landed but failed → 409 failed', async () => {
    let height = 4000;
    const dropped = await signedBuy({ ...healthy([]), getBlockHeight: async () => (height += 200) });
    await expect(dropped.adapter.cosignAndSend({ signedTransaction: dropped.signed, expectedMessage: dropped.built.message, lastValidBlockHeight: 4242 })).rejects.toMatchObject({ statusCode: 409, errorCode: 'transaction_dropped' });
    const failed = await signedBuy(healthy([{ confirmationStatus: 'confirmed', err: { InstructionError: [2, { Custom: 6006 }] } }]));
    await expect(failed.adapter.cosignAndSend({ signedTransaction: failed.signed, expectedMessage: failed.built.message, lastValidBlockHeight: 4242 })).rejects.toMatchObject({ errorCode: 'transaction_failed' });
  });

  it('an inflated lastValidBlockHeight (not the stored one) is 400 before anything is sent; a network that never answers ends the loop UNCONFIRMED (not an error: the watcher credits it)', async () => {
    const sent: Buffer[] = [];
    const inflated = await signedBuy(healthy([], sent));
    await expect(inflated.adapter.cosignAndSend({ signedTransaction: inflated.signed, expectedMessage: inflated.built.message, lastValidBlockHeight: 1_000_000 }))
      .rejects.toMatchObject({ statusCode: 400, errorCode: 'block_height_invalid' });
    expect(sent.length).toBe(0);
    const silent = await signedBuy(healthy([], sent, 4000));
    expect(await silent.adapter.cosignAndSend({ signedTransaction: silent.signed, expectedMessage: silent.built.message, lastValidBlockHeight: 4242 }))
      .toMatchObject({ confirmed: false, lastValidBlockHeight: 4242 });
    expect(sent.length).toBe(60);
  });

  it('sent, but the status read is refused: answers unconfirmed WITH the signature (the transaction may have landed) instead of a 503', async () => {
    const sent: Buffer[] = [];
    const blind = await signedBuy({ ...healthy([], sent), getSignatureStatuses: async () => { throw new Error('429 rate limited'); } });
    const out = await blind.adapter.cosignAndSend({ signedTransaction: blind.signed, expectedMessage: blind.built.message, lastValidBlockHeight: 4242 });
    expect(out.confirmed).toBe(false);
    expect(out.signature).toBe(bs58.encode(Transaction.from(sent[0]!).signature!));
    expect(sent.length).toBe(1); // it does not keep re-sending into a blind RPC
  });

  it('signatureStatus never says expired on a fallback\'s word: the primary down is 503', async () => {
    const h = adapterWith({ getSignatureStatuses: async () => { throw new Error('down'); } }, { solanaRpcFallbacks: ['http://127.0.0.1:2'] });
    const fallback = (h.adapter as unknown as { rpc: { fallbacks: object[] } }).rpc.fallbacks[0]!;
    Object.assign(fallback, { getSignatureStatuses: async () => ({ value: [null] }), getBlockHeight: async () => 1e9 });
    await expect(h.adapter.signatureStatus('sig', 100)).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('signatureStatus: the commitment when known, expired past the block height, unknown before', async () => {
    const status = (s: unknown, height: number) => adapterWith({ getSignatureStatuses: async () => ({ value: [s] }), getBlockHeight: async () => height }).adapter.signatureStatus('sig', 100);
    expect(await status({ confirmationStatus: 'finalized', err: null }, 999)).toBe('finalized');
    expect(await status(null, 101)).toBe('expired');
    expect(await status(null, 100)).toBe('unknown');
  });

  it('FEE_PAYER_SECRET: base58 or solana-keygen\'s JSON array', () => {
    expect(parseKeypair(bs58.encode(gas.secretKey)).publicKey.toBase58()).toBe(fx.keys.gas);
    expect(parseKeypair(JSON.stringify(Array.from(gas.secretKey))).publicKey.toBase58()).toBe(fx.keys.gas);
  });
});
