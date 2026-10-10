import { Keypair, Transaction } from '@solana/web3.js';
import { FakePoolChain } from '../../support/fake-pool-chain.js';
import { ServiceUnavailableError } from '../../../src/domain/shared/errors.js';

/* The shared test double behaves like the port promises (other workstreams' handler specs and scenarios run on it). */
describe('FakePoolChain', () => {
  const buyer = Keypair.generate();
  const order = { payer: buyer.publicKey.toBase58(), poolId: 1, qty: 2, orderId: '0b5ec9e3-1f2a-4c3d-8e4f-5a6b7c8d9e0f' };

  it('scripted events per signature, in the program history oldest first; unknown signatures are pending', async () => {
    const chain = new FakePoolChain();
    const s1 = chain.addEvent('PoolActivated', { poolId: 1, ticketsSold: 10 });
    const s2 = chain.addTransaction([{ kind: 'PoolFailed', poolId: 2, ticketsSold: 1 }, { kind: 'Refunded', poolId: 2, buyer: 'b', rentPayer: 'b', qty: 1, lamports: 5, refundedTotal: 5 }]);
    expect(await chain.readEvents(s2)).toMatchObject([{ kind: 'PoolFailed', index: 0, signature: s2 }, { kind: 'Refunded', index: 1 }]);
    expect(await chain.readEvents('nope')).toBe('pending');
    chain.events.set('bad', { invalid: 'failed' });
    expect(await chain.readEvents('bad')).toEqual({ invalid: 'failed' });
    expect((await chain.recentProgramSignatures(null, 10)).map((s) => s.signature)).toEqual([s1, s2]);
    expect((await chain.recentProgramSignatures(s1, 10)).map((s) => s.signature)).toEqual([s2]);
    expect(chain.readCount).toBe(3);
  });

  it('records what it built: real unsigned transactions, the signer is the fee payer', async () => {
    const chain = new FakePoolChain();
    const built = await chain.buildBuyTransaction(order);
    expect(built.feePayer).toBe(order.payer);
    expect(Transaction.from(Buffer.from(built.transaction, 'base64')).serializeMessage().toString('base64')).toBe(built.message);
    expect((await chain.buildRefundTransaction({ caller: order.payer, poolId: 1, buyer: order.payer, needsFail: false })).feePayer).toBe(order.payer);
    expect(chain.built.map((b) => b.kind)).toEqual(['buy', 'refund']);
    expect(chain.built[0]!.input).toEqual(order);
  });

  it('statuses, the log subscription, an RPC outage, reset', async () => {
    const chain = new FakePoolChain();
    expect(await chain.signatureStatus('x', 250)).toBe('unknown');
    chain.blockHeight = 251;
    expect(await chain.signatureStatus('x', 250)).toBe('expired');
    chain.statuses.set('x', 'finalized');
    expect(await chain.signatureStatus('x', 250)).toBe('finalized');
    const seen: string[] = [];
    const off = chain.subscribeLogs((s) => seen.push(s));
    chain.emitLogs('a');
    off();
    chain.emitLogs('b');
    expect(seen).toEqual(['a']);
    chain.rpcDown = true;
    await expect(chain.readPool(1)).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(chain.feeQuote({ poolId: null, kind: 'buy' })).rejects.toBeInstanceOf(ServiceUnavailableError);
    chain.reset();
    expect(await chain.readPool(1)).toBeNull();
    expect(chain.statuses.size + chain.built.length + chain.signatures.length).toBe(0);
  });
});
