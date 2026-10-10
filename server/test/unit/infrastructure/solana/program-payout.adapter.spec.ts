import { Keypair, PublicKey, VersionedTransaction, type Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import { ProgramPayoutAdapter } from '../../../../src/infrastructure/solana/program-payout.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import type { PoolChainPort } from '../../../../src/application/ports/economy/pool-chain.port.js';
import { fixtureAccount, fixtureTx, poolProgramFixture } from '../../../support/chain-fixtures.js';

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

describe('ProgramPayoutAdapter – pay_prize / close_pool signed and paid by the payout key', () => {
  it('pay_prize: the fixture\'s bytes; the signature reaches onSigned BEFORE anything is broadcast', async () => {
    const { adapter, sent, log } = payoutWith();
    const expected = fixtureTx('pay_prize by the payout key').instructions[0]!;
    const a = expected.args as Record<string, unknown>;
    let signed: { signature: string; lastValidBlockHeight: number } | null = null;
    const { signature } = await adapter.payPrize({ poolId: Number(a['poolId']), to: String(a['to']), lamports: Number(a['lamports']), rank: Number(a['rank']) }, async (tx) => { log.push('signed'); signed = tx; });
    expect(log.slice(0, 3)).toEqual(['simulate', 'signed', 'send']);
    expect(signed).toEqual({ signature, lastValidBlockHeight: 4242 });
    expect(programIx(sent[0]!)).toEqual({ data: expected.data, accounts: expected.accounts.map((x) => x.pubkey) });
  });

  it('if onSigned refuses (the prize was claimed by another pass), nothing is sent', async () => {
    const { adapter, sent } = payoutWith();
    await expect(adapter.payPrize({ poolId: 4, to: fx.keys.winner, lamports: 1, rank: 1 }, async () => { throw new Error('claimed'); })).rejects.toThrow('claimed');
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
    await expect(off.payPrize({ poolId: 4, to: fx.keys.winner, lamports: 1, rank: 1 }, async () => undefined)).rejects.toMatchObject({ statusCode: 503 });
    let signed = false;
    const refused = payoutWith({ simulateTransaction: async () => ({ value: { err: { InstructionError: [2, { Custom: 6010 }] }, logs: ['TooEarly'] } }) }).adapter;
    await expect(refused.payPrize({ poolId: 4, to: fx.keys.winner, lamports: 1, rank: 1 }, async () => { signed = true; })).rejects.toMatchObject({ errorCode: 'transaction_would_fail' });
    expect(signed).toBe(false);
    expect(payoutWith().adapter.address).toBe(payoutKey.publicKey.toBase58());
  });
});
