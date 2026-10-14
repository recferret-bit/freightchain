import { Keypair, PublicKey, VersionedTransaction, type Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import { ProgramPayoutAdapter } from '../../../../src/infrastructure/solana/program-payout.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import type { PoolChainPort } from '../../../../src/application/ports/economy/pool-chain.port.js';
import { fixtureAccount, fixtureTx, poolProgramFixture } from '../../../support/chain-fixtures.js';
import { PoolProgramCodec } from '../../../../src/infrastructure/solana/pool-program.codec.js';
import { rideIdToBytes } from '../../../../src/domain/economy/pledge.types.js';

/* No network: the payout key's transactions are checked byte for byte against what the REAL program accepted from it (LiteSVM fixture, payout key = key(9)). */
const fx = poolProgramFixture();
const payoutKey = Keypair.fromSeed(new Uint8Array(32).fill(9));
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const accountInfo = (name: string) => { const a = fixtureAccount(name); return { owner: new PublicKey(a.owner), lamports: Number(a.lamports), data: Buffer.from(a.data, 'base64'), executable: false, rentEpoch: 0 }; };
type Rpc = Partial<Record<keyof Connection, unknown>>;

function payoutWith(rpc: Rpc = {}, env: Partial<EnvService> = {}) {
  const log: string[] = [];
  const sent: Buffer[] = [];
  const adapter = new ProgramPayoutAdapter({
    solanaRpc: 'http://127.0.0.1:1', solanaRpcFallbacks: [], solanaCommitment: 'confirmed', ticketProgramId: fx.programId, payoutSecret: bs58.encode(payoutKey.secretKey), ...env,
  } as unknown as EnvService, { feeQuote: async () => ({ priorityMicrolamports: 1_500, computeUnits: 0, estimatedFeeLamports: 0 }) } as unknown as PoolChainPort);
  (adapter as unknown as { wait: (ms: number) => Promise<void> }).wait = async () => undefined;
  Object.assign((adapter as unknown as { rpc: { primary: object } }).rpc.primary, {
    getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 4242 }),
    simulateTransaction: async () => { log.push('simulate'); return { value: { err: null, logs: [] } }; },
    sendRawTransaction: async (raw: Buffer) => { log.push('send'); sent.push(Buffer.from(raw)); return 'sig'; },
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed', err: null }] }),
    getBlockHeight: async () => 100,
    getMultipleAccountsInfo: async () => [accountInfo('pool 4 open (series)'), accountInfo('config with payout key')],
    ...rpc,
  });
  return { adapter, sent, log };
}
const programIx = (raw: Buffer) => {
  const tx = VersionedTransaction.deserialize(raw), m = tx.message, keys = m.staticAccountKeys;
  expect(keys[0]!.toBase58()).toBe(payoutKey.publicKey.toBase58()); // the payout key pays its own fee
  expect(tx.signatures).toHaveLength(1);
  const i = m.compiledInstructions[2]!;
  return { data: Buffer.from(i.data).toString('base64'), accounts: i.accountKeyIndexes.map((k) => keys[k]!.toBase58()) };
};

const codec = new PoolProgramCodec(fx.programId);
/** a fixture instruction as the payout key sends it: the permissionless caller (the fixture's cranker) is the payout key */
const asPayoutKey = (name: string) => {
  const ix = fixtureTx(name).instructions[0]!;
  return { data: ix.data, accounts: ix.accounts.map((a) => (a.pubkey === fx.keys.cranker ? payoutKey.publicKey.toBase58() : a.pubkey)) };
};

describe('ProgramPayoutAdapter – commit_winners / pay_prize / close_pool signed and paid by the payout key', () => {
  it('commit_winners: byte for byte what the program accepted from the payout key', async () => {
    const { adapter, sent } = payoutWith();
    const a = fixtureTx('commit_winners by the payout key').instructions[0]!.args as { root: string; total: string; count: number };
    await adapter.commitWinners({ poolId: 4, root: Buffer.from(a.root, 'base64'), total: Number(a.total), count: a.count });
    expect(programIx(sent[0]!)).toEqual(asPayoutKey('commit_winners by the payout key'));
  });

  it('pay_prize: the fixture\'s bytes (server rank 1 = leaf 0, its proof); the signature reaches onSigned BEFORE anything is broadcast', async () => {
    const { adapter, sent, log } = payoutWith();
    const a = fixtureTx('pay_prize after the lock (anyone)').instructions[0]!.args as { to: string; lamports: string; proof: string[]; rank: number };
    expect(a.rank).toBe(0);
    let signed: { signature: string; lastValidBlockHeight: number } | null = null;
    const { signature } = await adapter.payPrize({ poolId: 4, rank: 1, to: a.to, lamports: Number(a.lamports), proof: a.proof.map((p) => Buffer.from(p, 'base64')) }, async (tx) => { log.push('signed'); signed = tx; });
    expect(log.slice(0, 3)).toEqual(['simulate', 'signed', 'send']);
    expect(signed).toEqual({ signature, lastValidBlockHeight: 4242 });
    expect(programIx(sent[0]!)).toEqual(asPayoutKey('pay_prize after the lock (anyone)'));
  });

  it('if onSigned refuses (the prize was claimed by another pass), nothing is sent', async () => {
    const { adapter, sent } = payoutWith();
    await expect(adapter.payPrize({ poolId: 4, to: fx.keys.winner, lamports: 1, rank: 1, proof: [] }, async () => { throw new Error('claimed'); })).rejects.toThrow('claimed');
    expect(sent).toEqual([]);
  });

  it('close_pool: treasuries and the creator from the Pool + Config accounts', async () => {
    const { adapter, sent } = payoutWith();
    await adapter.closePool(4);
    const expected = fixtureTx('close_pool by the payout key').instructions[0]!;
    expect(programIx(sent[0]!)).toEqual({ data: expected.data, accounts: expected.accounts.map((x) => x.pubkey) });
  });

  it('reads the chain clock and the payout key the program names', async () => {
    const clock = Buffer.alloc(40); clock.writeBigInt64LE(2_100_000_000n, 32);
    const { adapter } = payoutWith({ getAccountInfo: async (k: PublicKey) => (k.toBase58() === 'SysvarC1ock11111111111111111111111111111111' ? { data: clock } : accountInfo('config with payout key')) });
    expect((await adapter.chainNow()).getTime()).toBe(2_100_000_000_000);
    expect(await adapter.configuredPayoutAuthority()).toBe(fx.keys.payout);
    const before = payoutWith({ getAccountInfo: async () => accountInfo('config') }).adapter;
    expect(await before.configuredPayoutAuthority()).toBeNull();
  });

  it('without PAYOUT_SECRET it has no address and sends nothing (503); a refused simulation is a 409 before onSigned', async () => {
    const off = payoutWith({}, { payoutSecret: undefined }).adapter;
    expect(off.address).toBeNull();
    await expect(off.payPrize({ poolId: 4, to: fx.keys.winner, lamports: 1, rank: 1, proof: [] }, async () => undefined)).rejects.toMatchObject({ statusCode: 503 });
    let signed = false;
    const refused = payoutWith({ simulateTransaction: async () => ({ value: { err: { InstructionError: [2, { Custom: 6010 }] }, logs: ['TooEarly'] } }) }).adapter;
    await expect(refused.payPrize({ poolId: 4, to: fx.keys.winner, lamports: 1, rank: 1, proof: [] }, async () => { signed = true; })).rejects.toMatchObject({ errorCode: 'transaction_would_fail' });
    expect(signed).toBe(false);
    expect(payoutWith().adapter.address).toBe(payoutKey.publicKey.toBase58());
  });
});

describe('ProgramPayoutAdapter – ride attestations and pledges (program v4: a pledge settles on ITS ride\'s attestation)', () => {
  const RIDE = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
  const ours = rideIdToBytes(RIDE);
  /** the fixture's instruction with its test ride id ([n; 32]) swapped for a server ride (a uuid zero-padded to 32 bytes): the id in the data, and the PDAs derived from it */
  const withRide = (name: string, fill: number, sponsor: string) => {
    const theirs = Buffer.alloc(32, fill), x = asPayoutKey(name), data = Buffer.from(x.data, 'base64'), at = data.indexOf(theirs);
    expect(at).toBeGreaterThan(0);
    Buffer.from(ours).copy(data, at);
    const swap = new Map([
      [codec.rideAttestationPda(4, theirs).toBase58(), codec.rideAttestationPda(4, ours).toBase58()],
      [codec.pledgePda(theirs, sponsor).toBase58(), codec.pledgePda(ours, sponsor).toBase58()],
    ]);
    const derived = x.accounts.filter((a) => swap.has(a));
    return { data: data.toString('base64'), accounts: x.accounts.map((a) => swap.get(a) ?? a), derived };
  };

  it('the codec derives the program\'s own RideAttestation and Pledge addresses', () => {
    expect(codec.rideAttestationPda(4, Buffer.alloc(32, 0x51)).toBase58()).toBe(fixtureAccount('ride attestation pool 4 winner').address);
    expect(codec.pledgePda(Buffer.alloc(32, 0x51), fx.keys.brand).toBase58()).toBe(fixtureAccount('pledge on the winner\'s ride').address);
  });

  it('record_ride_attestation: the payout key signs and pays the account\'s rent; the fixture\'s bytes for the ride', async () => {
    const { adapter, sent } = payoutWith();
    const a = fixtureTx('record_ride_attestation by the payout key').instructions[0]!.args as { driver: string; telemetryRoot: string; verifiedKm: number; status: number };
    await adapter.recordRideAttestation({ poolId: 4, rideId: RIDE, driver: a.driver, telemetryRoot: Buffer.from(a.telemetryRoot, 'base64'), verifiedKm: a.verifiedKm, status: a.status });
    const want = withRide('record_ride_attestation by the payout key', 0x51, fx.keys.brand);
    expect(want.derived).toHaveLength(1);   // the ride attestation PDA
    expect(programIx(sent[0]!)).toEqual({ data: want.data, accounts: want.accounts });
  });

  it('settle_pledge / refund_pledge: the pledge and the RIDE\'s attestation PDA; the payout key only sends them', async () => {
    const { adapter, sent } = payoutWith();
    await adapter.settlePledge({ poolId: 4, rideId: RIDE, sponsor: fx.keys.brand, driver: fx.keys.winner });
    const settle = withRide('settle_pledge', 0x51, fx.keys.brand);
    expect(settle.derived).toHaveLength(2);
    expect(programIx(sent[0]!)).toEqual({ data: settle.data, accounts: settle.accounts });
    await adapter.refundPledge({ poolId: 4, rideId: RIDE, sponsor: fx.keys.brand, driver: fx.keys.c });
    const refund = withRide('refund_pledge', 0x52, fx.keys.brand);
    expect(refund.derived).toHaveLength(2);
    expect(programIx(sent[1]!)).toEqual({ data: refund.data, accounts: refund.accounts });
  });

  it('rideAttestationOf: the ride\'s RideAttestation account decoded; null when there is none', async () => {
    let asked = '';
    const { adapter } = payoutWith({ getAccountInfo: async (k: PublicKey) => { asked = k.toBase58(); return accountInfo('ride attestation pool 4 winner'); } });
    expect(await adapter.rideAttestationOf(4, RIDE)).toEqual({ driver: fx.keys.winner, status: 1, verifiedKm: 60, settleFrom: new Date(2_487_060_000), settledPledges: 0 });
    expect(asked).toBe(codec.rideAttestationPda(4, ours).toBase58());
    expect(await payoutWith({ getAccountInfo: async () => null }).adapter.rideAttestationOf(4, RIDE)).toBeNull();
  });
});
