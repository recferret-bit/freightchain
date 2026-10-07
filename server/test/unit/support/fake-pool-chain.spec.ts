import { Keypair, Transaction } from '@solana/web3.js';
import { FakePoolChain } from '../../support/fake-pool-chain.js';
import { BadRequestError, ServiceUnavailableError } from '../../../src/domain/shared/errors.js';

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

  it('records what it built: real unsigned transactions, fee payer = the sponsor when there is one', async () => {
    const chain = new FakePoolChain();
    const self = await chain.buildBuyTransaction(order);
    expect(self.feePayer).toBe(order.payer);
    chain.sponsor = Keypair.generate();
    const gasless = await chain.buildBuyTransaction(order);
    expect(gasless.feePayer).toBe(chain.sponsor.publicKey.toBase58());
    expect(Transaction.from(Buffer.from(gasless.transaction, 'base64')).serializeMessage().toString('base64')).toBe(gasless.message);
    expect(chain.built.map((b) => b.kind)).toEqual(['buy', 'buy']);
    expect(chain.built[0]!.input).toEqual(order);
  });

  it('cosignAndSend runs the production checks: no sponsor 503, another message 400, the right one co-signed', async () => {
    const chain = new FakePoolChain();
    const built = await chain.buildBuyTransaction(order);
    await expect(chain.cosignAndSend({ signedTransaction: built.transaction, expectedMessage: built.message, lastValidBlockHeight: 250 })).rejects.toBeInstanceOf(ServiceUnavailableError);
    chain.sponsor = Keypair.generate();
    const mine = await chain.buildBuyTransaction(order);
    const tx = Transaction.from(Buffer.from(mine.transaction, 'base64'));
    tx.partialSign(buyer);
    const signed = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
    await expect(chain.cosignAndSend({ signedTransaction: signed, expectedMessage: built.message, lastValidBlockHeight: 250 })).rejects.toBeInstanceOf(BadRequestError);
    const out = await chain.cosignAndSend({ signedTransaction: signed, expectedMessage: mine.message, lastValidBlockHeight: 250 });
    expect(out.lastValidBlockHeight).toBe(250);
    expect(chain.cosigned.map((c) => c.signature)).toEqual([out.signature]);
    chain.cosignResult = new Error('boom');
    await expect(chain.cosignAndSend({ signedTransaction: signed, expectedMessage: mine.message, lastValidBlockHeight: 250 })).rejects.toThrow('boom');
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
