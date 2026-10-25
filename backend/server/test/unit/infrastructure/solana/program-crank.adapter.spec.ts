import { Keypair, PublicKey, VersionedTransaction, type Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import { ProgramCrankAdapter } from '../../../../src/infrastructure/solana/program-crank.adapter.js';
import { CU_LIMITS } from '../../../../src/infrastructure/solana/program-chain.adapter.js';
import { PoolProgramCodec } from '../../../../src/infrastructure/solana/pool-program.codec.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import type { PoolChainPort } from '../../../../src/application/ports/economy/pool-chain.port.js';
import { fixtureAccount, fixtureTx, poolProgramFixture, type FixtureInstruction } from '../../../support/chain-fixtures.js';

/* The RPC is replaced (no network): the crank's instructions are checked byte for byte against what the REAL program accepted (LiteSVM fixtures, caller = key d). */
const fx = poolProgramFixture();
const crankKey = Keypair.fromSeed(new Uint8Array(32).fill(4)); // the fixture's key d – the caller of fail_pool / refund / expire_pool / close_pool there
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const accountInfo = (name: string) => { const a = fixtureAccount(name); return { owner: new PublicKey(a.owner), lamports: Number(a.lamports), data: Buffer.from(a.data, 'base64'), executable: false, rentEpoch: 0 }; };
type Rpc = Partial<Record<keyof Connection, unknown>>;

function crankWith(rpc: Rpc = {}, env: Partial<EnvService> = {}) {
  const sent: Buffer[] = [];
  const adapter = new ProgramCrankAdapter({
    solanaRpc: 'http://127.0.0.1:1', solanaRpcFallbacks: [], solanaCommitment: 'confirmed', ticketProgramId: fx.programId, crankSecret: bs58.encode(crankKey.secretKey), ...env,
  } as unknown as EnvService, { feeQuote: async () => ({ priorityMicrolamports: 1_500, computeUnits: 0, estimatedFeeLamports: 0 }) } as unknown as PoolChainPort);
  (adapter as unknown as { wait: (ms: number) => Promise<void> }).wait = async () => undefined;
  Object.assign((adapter as unknown as { rpc: { primary: object } }).rpc.primary, {
    getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 4242 }),
    simulateTransaction: async () => ({ value: { err: null, logs: [] } }),
    sendRawTransaction: async (raw: Buffer) => { sent.push(Buffer.from(raw)); return 'sig'; },
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed', err: null }] }),
    getBlockHeight: async () => 100,
    getMinimumBalanceForRentExemption: async () => 890_880,
    ...rpc,
  });
  return { adapter, sent };
}
/** the program instructions of the sent transaction (after the two compute-budget ones), flags as the compiled message renders them */
function sentIxs(raw: Buffer) {
  const tx = VersionedTransaction.deserialize(raw), m = tx.message, keys = m.staticAccountKeys;
  expect(keys[0]!.toBase58()).toBe(crankKey.publicKey.toBase58()); // the crank pays the fee
  expect(tx.signatures).toHaveLength(1); // …and is the only signer
  return m.compiledInstructions.slice(2).map((i) => ({
    programId: keys[i.programIdIndex]!.toBase58(), data: Buffer.from(i.data).toString('base64'),
    accounts: i.accountKeyIndexes.map((k) => ({ pubkey: keys[k]!.toBase58(), isSigner: m.isAccountSigner(k), isWritable: m.isAccountWritable(k) })),
  }));
}
function asCompiled(expected: FixtureInstruction[]) {
  const flags = new Map<string, { isSigner: boolean; isWritable: boolean }>([[crankKey.publicKey.toBase58(), { isSigner: true, isWritable: true }]]);
  for (const a of expected.flatMap((i) => i.accounts)) {
    const f = flags.get(a.pubkey) ?? { isSigner: false, isWritable: false };
    flags.set(a.pubkey, { isSigner: f.isSigner || a.isSigner, isWritable: f.isWritable || a.isWritable });
  }
  return expected.map((i) => ({ programId: i.programId, data: i.data, accounts: i.accounts.map((a) => ({ pubkey: a.pubkey, ...flags.get(a.pubkey)! })) }));
}
const rentPayerOf = (ix: FixtureInstruction) => ix.accounts[5]!.pubkey; // refund: caller, pool, vault, ticket, buyer, rent_payer, system

describe('ProgramCrankAdapter – sends what the program accepted, signed and paid by the crank key', () => {
  it('sealing budgets for a seed near the end of the SlotHashes window', async () => {
    const { adapter, sent } = crankWith();
    await adapter.send({ step: 'seal_road', poolId: 1 });
    const tx = VersionedTransaction.deserialize(sent[0]!);
    const budget = Buffer.from(tx.message.compiledInstructions[0]!.data).readUInt32LE(1);
    // Local validator measured 58,512 CU at 442 slots; reserve room for all 512 entries.
    expect(budget).toBeGreaterThanOrEqual(75_000);
    expect(budget).toBeLessThanOrEqual(100_000);
  });
  it('a refund batch uses the accepted instruction and only the crank signature', async () => {
    const { adapter, sent } = crankWith();
    const fixture = fixtureTx('cancel_pool + refund').instructions;
    await adapter.send({ step: 'refund', poolId: 1, tickets: [{ buyer: fx.keys.c, rentPayer: rentPayerOf(fixture[1]!), lamports: 1 }] });
    expect(sentIxs(sent.at(-1)!)).toEqual(asCompiled([fixture[1]!]));
  });

  it('expire_pool and close_pool of a refunded pool (treasuries read from the Pool and Config accounts)', async () => {
    const { adapter, sent } = crankWith({ getMultipleAccountsInfo: async () => [accountInfo('pool 1 refunding'), accountInfo('config')] });
    await adapter.send({ step: 'expire_pool', poolId: 3 });
    expect(sentIxs(sent[0]!)).toEqual(asCompiled(fixtureTx('expire_pool').instructions));
    await adapter.send({ step: 'close_pool', poolId: 1 });
    expect(sentIxs(sent.at(-1)!)).toEqual(asCompiled(fixtureTx('close_pool cancelled (refunded pool, anyone)').instructions));
  });

  it('a refund batch is at most 8 tickets, its compute budget scales with it', async () => {
    const { adapter, sent } = crankWith();
    const tickets = Array.from({ length: 10 }, () => ({ buyer: Keypair.generate().publicKey.toBase58(), rentPayer: fx.keys.gas, lamports: 1 }));
    await adapter.send({ step: 'refund', poolId: 1, tickets });
    const tx = VersionedTransaction.deserialize(sent[0]!);
    expect(tx.message.compiledInstructions).toHaveLength(2 + 8);
    expect(Buffer.from(tx.message.compiledInstructions[0]!.data).readUInt32LE(1)).toBe(CU_LIMITS.refund * 8); // SetComputeUnitLimit(u32)
  });

  it('reads the chain clock, every pool of Config.pool_count and a pool\'s open tickets', async () => {
    const clock = Buffer.alloc(40); clock.writeBigInt64LE(2_100_000_000n, 32);
    let filters: unknown = null;
    const { adapter } = crankWith({
      getAccountInfo: async (k: PublicKey) => (k.toBase58() === 'SysvarC1ock11111111111111111111111111111111' ? { data: clock } : accountInfo('config')),
      getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map((_, i) => (i === 0 ? accountInfo('pool 0 active') : null)),
      getProgramAccounts: async (_p: PublicKey, o: { filters: unknown }) => { filters = o.filters; return [{ pubkey: PublicKey.default, account: accountInfo('ticket pool 1 C') }]; },
    });
    expect((await adapter.chainNow()).getTime()).toBe(2_100_000_000_000);
    const pools = await adapter.listPools();
    expect(pools.map((p) => [p.poolId, p.status])).toEqual([[0, 'active']]);
    const tickets = await adapter.listTickets(1);
    expect(tickets).toEqual([{ buyer: fx.keys.c, rentPayer: expect.any(String), lamports: expect.any(Number) }]);
    expect(filters).toEqual([{ dataSize: 87 }, { memcmp: { offset: 0, bytes: expect.any(String) } }, { memcmp: { offset: 72, bytes: bs58.encode(Buffer.from([1, 0, 0, 0])) } }]);
  });

  it('without CRANK_SECRET it has no address and refuses to send (503); a refused simulation or a dropped transaction is a 409', async () => {
    const off = crankWith({}, { crankSecret: undefined }).adapter;
    expect(off.address).toBeNull();
    await expect(off.send({ step: 'fail_pool', poolId: 1 })).rejects.toMatchObject({ statusCode: 503 });
    const refused = crankWith({ simulateTransaction: async () => ({ value: { err: { InstructionError: [2, { Custom: 6011 }] }, logs: ['NotFailable'] } }) }).adapter;
    await expect(refused.send({ step: 'fail_pool', poolId: 1 })).rejects.toMatchObject({ statusCode: 409, errorCode: 'transaction_would_fail' });
    const dropped = crankWith({ getSignatureStatuses: async () => ({ value: [null] }), getBlockHeight: async () => 5_000 }).adapter;
    await expect(dropped.send({ step: 'fail_pool', poolId: 1 })).rejects.toMatchObject({ statusCode: 409, errorCode: 'transaction_dropped' });
    expect(crankWith().adapter.address).toBe(crankKey.publicKey.toBase58());
  });

  it('open_next_pool: the fixture\'s instruction, the pool / vault PDAs seeded with Config.pool_count, the series\' treasuries; listSeries decodes the schedule', async () => {
    const { adapter, sent } = crankWith({
      getMultipleAccountsInfo: async (keys: PublicKey[]) => (keys.length === 2 ? [accountInfo('series 1'), accountInfo('config with payout key')] : keys.map((_, i) => (i === 0 ? accountInfo('series 1') : null))),
    });
    const expected = fixtureTx('open_next_pool').instructions[0]!;
    const poolCount = Number(fixtureAccount('config with payout key').decoded['poolCount']);
    await adapter.send({ step: 'open_next_pool', poolId: -1, tier: 1 });
    const [got] = sentIxs(sent[0]!);
    expect(got!.data).toBe(expected.data); // discriminator + tier 1
    expect(got!.accounts.map((a) => a.pubkey)).toEqual([
      crankKey.publicKey.toBase58(), expected.accounts[1]!.pubkey, expected.accounts[2]!.pubkey,
      new PoolProgramCodec(fx.programId).poolPda(poolCount).toBase58(), new PoolProgramCodec(fx.programId).vaultPda(poolCount).toBase58(),
      ...expected.accounts.slice(5).map((a) => a.pubkey),
    ]);
    const series = await adapter.listSeries();
    expect(series).toEqual([expect.objectContaining({ tier: 1, enabled: true, saleSecs: 86_400, playSecs: 7_200, verifySecs: 172_800, minTickets: 0, periodSecs: 86400, startBufferSecs: 4500, lastPoolId: null, feeTreasury: fx.keys.feeTreasury })]);
    await expect(adapter.send({ step: 'open_next_pool', poolId: -1 })).rejects.toMatchObject({ errorCode: 'bad_crank_step' });
  });
});
