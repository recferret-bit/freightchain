import { Keypair, PublicKey, Transaction, type Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import { ProgramChainAdapter, CU_LIMITS, parseKeypair } from '../../../../src/infrastructure/solana/program-chain.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { NotFoundError, ServiceUnavailableError } from '../../../../src/domain/shared/errors.js';
import { FakeClock } from '../../../support/fake-clock.js';
import { rideIdToBytes } from '../../../../src/domain/economy/pledge.types.js';
import { PoolProgramCodec } from '../../../../src/infrastructure/solana/pool-program.codec.js';
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
    solanaRpc: 'http://127.0.0.1:1', solanaRpcFallbacks: [], solanaCommitment: 'confirmed', ticketProgramId: fx.programId, solanaWs: '',
    priorityFee: { percentile: 75, minMicrolamports: 0, maxMicrolamports: 50_000 }, ...env,
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
  it('a buy: the buyer is the fee payer AND the Ticket rent payer and signs alone – byte for byte the fixture\'s instruction', async () => {
    const { adapter } = adapterWith();
    const built = await adapter.buildBuyTransaction({ payer: fx.keys.b, poolId: 0, qty: 1, orderId: ORDER_B });
    const { tx } = programIxs(built.transaction);
    expectIxs(built, fixtureTx('buy_ticket self-paid').instructions);
    expect(built).toMatchObject({ feePayer: fx.keys.b, blockhash: BLOCKHASH, lastValidBlockHeight: 4242, computeUnits: CU_LIMITS.buy, priorityMicrolamports: 1_500 });
    expect(tx.feePayer?.toBase58()).toBe(fx.keys.b);
    expect(tx.serializeMessage().toString('base64')).toBe(built.message);
    expect(tx.signatures.map((s) => s.publicKey.toBase58())).toEqual([fx.keys.b]);
  });

  it('a buy with a reference: the reference rides on buy_ticket as a read-only remaining account; the memo carries only the order id, no accounts', async () => {
    const { adapter } = adapterWith();
    const reference = Keypair.generate().publicKey.toBase58();
    const built = await adapter.buildBuyTransaction({ payer: fx.keys.b, poolId: 0, qty: 1, orderId: ORDER_B, reference });
    const { tx, ixs } = programIxs(built.transaction);
    const plain = tx.instructions[2]!, want = fixtureTx('buy_ticket self-paid').instructions[0]!;
    expect(plain.data.toString('base64')).toBe(Buffer.from(want.data, 'base64').toString('base64'));
    expect(plain.keys.slice(0, -1).map((k) => k.pubkey.toBase58())).toEqual(want.accounts.map((a: { pubkey: string }) => a.pubkey));
    expect(plain.keys.at(-1)).toMatchObject({ isSigner: false, isWritable: false });
    expect(plain.keys.at(-1)?.pubkey.toBase58()).toBe(reference);
    expect(tx.instructions[3]?.programId.toBase58()).toBe('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    expect(tx.instructions[3]?.data.toString()).toBe(ORDER_B);
    expect(tx.instructions[3]?.keys).toEqual([]);
    void ixs;
  });

  it('a refund (+ fail_pool) reads the ticket\'s rent payer; refused when there is no ticket', async () => {
    const { adapter } = adapterWith({ getAccountInfo: async () => accountInfo('ticket pool 1 C') });
    const built = await adapter.buildRefundTransaction({ caller: fx.keys.d, poolId: 1, buyer: fx.keys.c, needsFail: true });
    expectIxs(built, fixtureTx('fail_pool + refund').instructions);
    expect(built).toMatchObject({ feePayer: fx.keys.d, computeUnits: CU_LIMITS.refund + CU_LIMITS.fail_pool });
    const noFail = await adapter.buildRefundTransaction({ caller: fx.keys.d, poolId: 1, buyer: fx.keys.c, needsFail: false });
    expect(noFail.feePayer).toBe(fx.keys.d);
    expectIxs(noFail, [fixtureTx('fail_pool + refund').instructions[1]!]);
    const none = adapterWith({ getAccountInfo: async () => null }).adapter;
    await expect(none.buildRefundTransaction({ caller: fx.keys.d, poolId: 1, buyer: fx.keys.c, needsFail: false })).rejects.toMatchObject({ statusCode: 409, errorCode: 'no_ticket' });
  });

  it('commit_winners / veto_winners: the admin\'s own transactions (it signs and pays in Phantom) – byte for byte the fixture\'s', async () => {
    const { adapter } = adapterWith();
    const want = fx.transactions.find((t) => t.name === 'commit_winners')!;   // not 'commit_winners (a wrong root)', vetoed before it
    const a = want.instructions[0]!.args as { root: string; total: string; count: number };
    const commit = await adapter.buildCommitWinnersTransaction({ authority: fx.keys.authority, poolId: 0, root: Buffer.from(a.root, 'base64'), total: Number(a.total), count: a.count });
    expectIxs(commit, want.instructions);
    expect(commit).toMatchObject({ feePayer: fx.keys.authority, computeUnits: CU_LIMITS.commit_winners });
    expect(Buffer.from(a.root, 'base64').toString('base64')).toBe(fixtureAccount('pool 0 committed').decoded['winnersRoot']); // the root the pool then holds
    const veto = await adapter.buildVetoWinnersTransaction({ authority: fx.keys.authority, poolId: 0 });
    expectIxs(veto, fixtureTx('veto_winners').instructions);
    expect(veto).toMatchObject({ feePayer: fx.keys.authority, computeUnits: CU_LIMITS.veto_winners });
    expect(programIxs(veto.transaction).tx.signatures.map((x) => x.publicKey.toBase58())).toEqual([fx.keys.authority]);
  });

  it('pay_prize: server rank 1 is the program\'s leaf 0, rank 2 leaf 1 – each with its proof, paid by whoever sends it', async () => {
    const { adapter } = adapterWith();
    const args = (name: string) => {
      const a = fixtureTx(name).instructions[0]!.args as { to: string; lamports: string; proof: string[]; rank: number };
      return { to: a.to, lamports: Number(a.lamports), proof: a.proof.map((p) => Buffer.from(p, 'base64')), leaf: a.rank };
    };
    const first = args('pay_prize rank 0 (anyone)'), second = args('pay_prize rank 1 (anyone)'), single = args('pay_prize after the lock (anyone)');
    expect([first.leaf, second.leaf, single.leaf]).toEqual([0, 1, 0]);
    const p1 = await adapter.buildPayPrizeTransaction({ payer: fx.keys.d, poolId: 0, rank: 1, to: first.to, lamports: first.lamports, proof: first.proof });
    expectIxs(p1, fixtureTx('pay_prize rank 0 (anyone)').instructions);
    expect(p1).toMatchObject({ feePayer: fx.keys.d, computeUnits: CU_LIMITS.pay_prize });
    const p2 = await adapter.buildPayPrizeTransaction({ payer: fx.keys.d, poolId: 0, rank: 2, to: second.to, lamports: second.lamports, proof: second.proof });
    expectIxs(p2, fixtureTx('pay_prize rank 1 (anyone)').instructions);
    const p4 = await adapter.buildPayPrizeTransaction({ payer: fx.keys.cranker, poolId: 4, rank: 1, to: single.to, lamports: single.lamports, proof: [] }); // one winner: no proof
    expectIxs(p4, fixtureTx('pay_prize after the lock (anyone)').instructions);
    await expect(adapter.buildPayPrizeTransaction({ payer: fx.keys.d, poolId: 0, rank: 0, to: first.to, lamports: first.lamports, proof: first.proof })).rejects.toBeInstanceOf(RangeError);
  });

  it('close_pool: the admin\'s own transaction; treasuries and the creator from the Pool + Config accounts', async () => {
    const { adapter } = adapterWith({ getMultipleAccountsInfo: async () => [accountInfo('pool 0 active'), accountInfo('config')] });
    const close = await adapter.buildClosePoolTransaction({ authority: fx.keys.authority, poolId: 0 });
    expectIxs(close, fixtureTx('close_pool settled').instructions);
    expect(close).toMatchObject({ feePayer: fx.keys.authority, computeUnits: CU_LIMITS.close_pool });
    const missing = adapterWith({ getMultipleAccountsInfo: async () => [null, accountInfo('config')] }).adapter;
    await expect(missing.buildClosePoolTransaction({ authority: fx.keys.authority, poolId: 9 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('the compute-unit limits cover every measured instruction with ≥ 25 % headroom', () => {
    const measured = (name: string) => Math.max(...fx.transactions.filter((t) => !t.err && t.instructions.length === 1 && t.instructions[0]!.name === name).map((t) => t.computeUnits));
    expect(CU_LIMITS.buy).toBeGreaterThanOrEqual(measured('buy_ticket') * 1.25);
    expect(CU_LIMITS.pay_prize).toBeGreaterThanOrEqual(measured('pay_prize') * 1.25);
    expect(CU_LIMITS.close_pool).toBeGreaterThanOrEqual(measured('close_pool') * 1.25);
    expect(CU_LIMITS.refund + CU_LIMITS.fail_pool).toBeGreaterThanOrEqual(fixtureTx('fail_pool + refund').computeUnits * 1.25);
    expect(CU_LIMITS.open_next_pool).toBeGreaterThanOrEqual(measured('open_next_pool') * 1.25); // two PDA inits (pool + vault funding)
    for (const k of ['commit_winners', 'veto_winners', 'record_ride_attestation', 'settle_pledge', 'refund_pledge', 'seal_road', 'refund_sponsor'] as const) expect(CU_LIMITS[k], k).toBeGreaterThanOrEqual(measured(k) * 1.25);
  });
});

describe('ProgramChainAdapter – pledges and attestations', () => {
  const RIDE = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
  /** the fixture tx's logs with its event's ride id (bytes 8..40 of the event, a test pattern) swapped for a server ride id (a uuid zero-padded to 32 bytes) */
  const withRide = (name: string) => fixtureTx(name).logs.map((l) => {
    if (!l.startsWith('Program data: ')) return l;
    const b = Buffer.from(l.slice('Program data: '.length), 'base64');
    Buffer.from(rideIdToBytes(RIDE)).copy(b, 8);
    return `Program data: ${b.toString('base64')}`;
  });
  const readerOf = (logs: string[] | null, err: unknown = null) => adapterWith({ getTransaction: async () => (logs ? { slot: 9, meta: { err, logMessages: logs } } : null) }).adapter;

  it('readPledgeEvents decodes the program\'s real PledgeCreated / PledgeSettled / PledgeRefunded (lamports as bigint, the ride id back as the uuid)', async () => {
    const created = fixtureTx('create_pledge (winner)').events[0]!;
    expect(await readerOf(withRide('create_pledge (winner)')).readPledgeEvents('sigC')).toEqual([{
      kind: 'PledgeCreated', signature: 'sigC', slot: 9, rideId: RIDE, sponsor: created['sponsor'], driver: created['driver'], pool: created['pool'],
      maxLamports: 1_000_000n, lamportsPerKm: 10_000n, targetKm: 100,
    }]);
    expect(await readerOf(withRide('settle_pledge')).readPledgeEvents('sigS')).toEqual([expect.objectContaining({
      kind: 'PledgeSettled', rideId: RIDE, verifiedKm: 60, earnedLamports: 600_000n, refundedLamports: 400_000n,
    })]);
    expect(await readerOf(withRide('refund_pledge')).readPledgeEvents('sigR')).toEqual([expect.objectContaining({ kind: 'PledgeRefunded', rideId: RIDE, refundedLamports: 1_000_000n })]);
    expect(await readerOf(fixtureTx('buy_ticket self-paid').logs).readPledgeEvents('sigB')).toEqual([]); // pool events are not pledge events
  });

  it('readPledgeEvents: pending / failed / truncated, and a ride id that is no padded uuid is invalid, never guessed', async () => {
    expect(await readerOf(null).readPledgeEvents('s')).toBe('pending');
    expect(await readerOf([], { InstructionError: [0, { Custom: 6000 }] }).readPledgeEvents('s')).toEqual({ invalid: expect.stringMatching(/failed/) });
    expect(await readerOf([...withRide('settle_pledge'), 'Log truncated']).readPledgeEvents('s')).toEqual({ invalid: expect.stringMatching(/truncated/) });
    expect(await readerOf(fixtureTx('settle_pledge').logs).readPledgeEvents('s')).toEqual({ invalid: expect.stringMatching(/undecodable/) });
  });

  it('create_pledge: the sponsor signs and pays; the pledge PDA of (ride uuid, sponsor); the args the program checks (max = rate × km)', async () => {
    const { adapter } = adapterWith();
    const built = await adapter.buildCreatePledgeTransaction({ sponsor: fx.keys.a, poolId: 4, rideId: RIDE, driver: fx.keys.winner, lamportsPerKm: 10_000n, targetKm: 100 });
    const codec = new PoolProgramCodec(fx.programId);
    const fixtureIx = fixtureTx('create_pledge (winner)').instructions[0]!;
    const expected = codec.instruction('create_pledge', {
      sponsor: fx.keys.a, driver: fx.keys.winner, config: codec.configPda(), pool: codec.poolPda(4), pledge: codec.pledgePda(rideIdToBytes(RIDE), fx.keys.a),
    }, { ride_id: rideIdToBytes(RIDE), driver: fx.keys.winner, max_lamports: 1_000_000n, lamports_per_km: 10_000n, target_km: 100 });
    const { ixs, tx } = programIxs(built.transaction);
    expect(ixs[0]!.data).toBe(expected.data.toString('base64'));
    expect(ixs[0]!.accounts.map((a) => a.pubkey)).toEqual(expected.keys.map((k) => k.pubkey.toBase58()));
    expect(ixs[0]!.accounts.map((a) => a.pubkey)[2]).toBe(fixtureIx.accounts[2]!.pubkey); // the config, as the program saw it
    expect(built).toMatchObject({ feePayer: fx.keys.a, computeUnits: CU_LIMITS.create_pledge });
    expect(tx.signatures.map((s) => s.publicKey.toBase58())).toEqual([fx.keys.a]);
  });

  it('pledgeSignatures: the account\'s successful transactions, newest first', async () => {
    const { adapter } = adapterWith({ getSignaturesForAddress: async () => [{ signature: 'new', err: null }, { signature: 'failed', err: { x: 1 } }, { signature: 'old', err: null }] });
    expect(await adapter.pledgeSignatures(fx.keys.a)).toEqual(['new', 'old']);
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
      vault: fixtureTx('buy_ticket self-paid').instructions[0]!.accounts[4]!.pubkey, authority: fx.keys.authority, tier: 1, priceLamports: 100_000_000, minTickets: 3, maxTickets: 10, maxPerWallet: 4,
      prepDeadline: new Date(Number(d['prepDeadline']) * 1000), playDeadline: new Date(Number(d['playDeadline']) * 1000), payoutAt: new Date(Number(d['payoutAt']) * 1000), prizeBps: 6000, seedBps: 2500, feeBps: 1500, paidTicketsEnabled: true, maxPlayerShareBps: 4999,
      feeTreasury: fx.keys.feeTreasury, seedTreasury: fx.keys.seedTreasury, createdAt: new Date(Number(d['createdAt']) * 1000),
      seedCommitment: String(d['seedCommitment']), seedSlot: 1008, seedSlotHash: bs58.encode(Buffer.from(String(d['seedSlotHash']), 'base64')),
      // program v4: sealed (sealSlot 0), nothing committed yet – no root, no lock, no rank paid
      sealSlot: 0, platformFeeBps: 250, winnersRoot: null, winnersTotal: 0, winnersCount: 0, committedAt: null, payFrom: null, paidMask: 0n, sponsorRefunded: 0, openPledges: 0,
    });
    expect(Buffer.from(String(d['seedCommitment']), 'base64').some((b) => b !== 0)).toBe(true);
    // the rent minimum is the cluster's own (read once): devnet's is lower than mainnet's, so the escrow there is vault − 650 240
    let rentReads = 0;
    const devnet = adapterWith({ getMinimumBalanceForRentExemption: async () => { rentReads++; return 650_240; }, getMultipleAccountsInfo: async () => [accountInfo('pool 0 active'), { lamports: 650_240 + 350_000_000 }] }).adapter;
    expect((await devnet.readPool(0))?.escrowLamports).toBe(350_000_000);
    await devnet.readPool(0);
    expect(rentReads).toBe(1);
    expect(await adapterWith({ getMultipleAccountsInfo: async () => [null, null] }).adapter.readPool(5)).toBeNull();
    expect(await adapterWith({ getMultipleAccountsInfo: async () => [{ ...accountInfo('pool 0 active'), owner: PublicKey.default }, null] }).adapter.readPool(0)).toBeNull();
  });

  it('readPool (v4): the committed winners root, its lock (payFrom) and the paid ranks as an exact bigint bitfield', async () => {
    const read = (name: string) => adapterWith({ getMultipleAccountsInfo: async () => [accountInfo(name), { lamports: 890_880 }] }).adapter.readPool(name.startsWith('pool 4') ? 4 : 0);
    const committed = await read('pool 0 committed');
    const root = fx.transactions.find((t) => t.name === 'commit_winners')!.instructions[0]!.args['root'];
    expect(committed).toMatchObject({ winnersRoot: root, winnersTotal: 120_000_000, winnersCount: 2, committedAt: new Date(1_005_000_000), payFrom: new Date(1_005_000_000), paidMask: 0n });
    const settled = await read('pool 0 settled');
    expect(settled).toMatchObject({ status: 'settled', winnersRoot: root, paidMask: 3n, prizesPaid: 120_000_000 });   // both ranks paid: bits 0 and 1
    expect(typeof settled?.paidMask).toBe('bigint');
    expect(await read('pool 4 settled')).toMatchObject({ paidMask: 1n, winnersCount: 1, payFrom: new Date(2_487_060_000) });
  });

  it('readPool (v4): a pool opened by the series is not sealed yet – its all-zero seed commitment is NO commitment (never a road seed)', async () => {
    const pool = fixtureAccount('pool 4 open (series)');
    expect(Buffer.from(String(pool.decoded['seedCommitment']), 'base64').every((b) => b === 0)).toBe(true);
    const state = await adapterWith({ getMultipleAccountsInfo: async () => [accountInfo('pool 4 open (series)'), { lamports: 890_880 }] }).adapter.readPool(4);
    expect(state).toMatchObject({ poolId: 4, address: pool.address, status: 'open', authority: fx.keys.cranker, sealSlot: 1927, winnersRoot: null, payFrom: null, paidMask: 0n, escrowLamports: 0 });
    expect(state?.seedCommitment).toBeUndefined();
    expect(state?.seedSlot).toBeUndefined();
    expect(state?.seedSlotHash).toBeUndefined();
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

  it('feeQuote: the CU price of the hot accounts, the CU limit and the fee (one signature: the wallet pays)', async () => {
    let asked: string[] = [];
    const rpc = { getRecentPrioritizationFees: async (o: { lockedWritableAccounts: PublicKey[] }) => { asked = o.lockedWritableAccounts.map((k) => k.toBase58()); return [{ slot: 1, prioritizationFee: 10_000 }]; } };
    expect(await adapterWith(rpc).adapter.feeQuote({ poolId: 0, kind: 'buy' })).toEqual({ priorityMicrolamports: 10_000, computeUnits: CU_LIMITS.buy, estimatedFeeLamports: 5_000 + 600 });
    expect(asked).toEqual([fixtureAccount('pool 0 active').address, fixtureTx('buy_ticket self-paid').instructions[0]!.accounts[4]!.pubkey]);
    expect((await adapterWith(rpc).adapter.feeQuote({ poolId: null, kind: 'buy' })).estimatedFeeLamports).toBe(5_000 + 600);
    expect(asked).toEqual([fx.programId]);
    expect((await adapterWith(rpc).adapter.feeQuote({ poolId: 0, kind: 'pay_prize' })).estimatedFeeLamports).toBe(5_000 + 220);
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

describe('ProgramChainAdapter – signature status and keys', () => {
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

  it('CRANK_SECRET: base58 or solana-keygen\'s JSON array', () => {
    expect(parseKeypair(bs58.encode(gas.secretKey)).publicKey.toBase58()).toBe(fx.keys.gas);
    expect(parseKeypair(JSON.stringify(Array.from(gas.secretKey))).publicKey.toBase58()).toBe(fx.keys.gas);
  });
});
