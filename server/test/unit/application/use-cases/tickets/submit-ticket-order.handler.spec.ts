import { Keypair, Transaction } from '@solana/web3.js';
import { GetTicketPaymentHandler } from '../../../../../src/application/use-cases/tickets/get-ticket-payment/get-ticket-payment.handler.js';
import { GetTicketPaymentQuery } from '../../../../../src/application/use-cases/tickets/get-ticket-payment/get-ticket-payment.query.js';
import { SubmitTicketOrderHandler } from '../../../../../src/application/use-cases/tickets/submit-ticket-order/submit-ticket-order.handler.js';
import { SubmitTicketOrderCommand } from '../../../../../src/application/use-cases/tickets/submit-ticket-order/submit-ticket-order.command.js';
import { SettleChainSignatureCommand } from '../../../../../src/application/use-cases/chain/settle-chain-signature/settle-chain-signature.command.js';
import { BadRequestError, ConflictError, TooManyRequestsError } from '../../../../../src/domain/shared/errors.js';
import { paymentSetup } from './ticket-payment.support.js';

describe('SubmitTicketOrderHandler – the gasless path', () => {
  const setup = async (cap = 20) => {
    const s = await paymentSetup({ sponsorEnabled: true, sponsorPerWalletPerDay: cap });
    s.ctx.poolChain.sponsor = Keypair.generate();
    const payment = new GetTicketPaymentHandler(s.ctx.orders, s.ctx.players, s.ctx.sponsoredTxs, s.ctx.poolChain, s.rules, s.ctx.transactions, s.ctx.clock);
    const h = new SubmitTicketOrderHandler(s.ctx.orders, s.ctx.sponsoredTxs, s.ctx.poolChain, s.bus, s.rules, s.ctx.clock);
    const built = () => payment.execute(new GetTicketPaymentQuery(s.wallet, s.order.id, false));
    return { ...s, built, submit: (signed: string) => h.execute(new SubmitTicketOrderCommand(s.wallet, s.order.id, signed)) };
  };

  it('co-signs exactly the bytes it built, records the sponsorship and settles the purchase', async () => {
    const s = await setup();
    const tx = await s.built();
    const signed = s.signAsBuyer(tx.transaction);
    // the fake "lands" it: the signature the sponsor's co-sign produces carries the purchase
    const sig = (await s.ctx.poolChain.cosignAndSend({ signedTransaction: signed, expectedMessage: tx.message, lastValidBlockHeight: tx.lastValidBlockHeight })).signature;
    s.ctx.poolChain.addTransaction([s.purchaseOf(s.order.id)], sig);
    expect(await s.submit(signed)).toMatchObject({ signature: sig, status: 'paid', order: { status: 'paid' } });
    expect(await s.ctx.sponsoredTxs.countSince(s.wallet, new Date(0))).toBe(1);
  });

  it('sent but unconfirmed (the RPC would not say): answers PENDING with the signature, records the sponsorship, never an error – the watcher credits it later', async () => {
    const s = await setup();
    const tx = await s.built();
    const signed = s.signAsBuyer(tx.transaction);
    const sig = (await s.ctx.poolChain.cosignAndSend({ signedTransaction: signed, expectedMessage: tx.message, lastValidBlockHeight: tx.lastValidBlockHeight })).signature;
    s.ctx.poolChain.cosignResult = { signature: sig, confirmed: false };
    const out = await s.submit(signed);
    expect(out).toMatchObject({ signature: sig, status: 'pending', order: { status: 'awaiting_payment' } });
    expect(await s.ctx.sponsoredTxs.countSince(s.wallet, new Date(0))).toBe(1);
    // …the transaction did land: the settlement path (watcher / webhook / the wallet's own settle call) credits the order once
    s.ctx.poolChain.addTransaction([s.purchaseOf(s.order.id)], sig);
    await s.bus.execute(new SettleChainSignatureCommand(sig));
    expect((await s.ctx.orders.findById(s.order.id))?.status).toBe('paid');
  });

  it('a forged transaction (different bytes than the order\'s message) is refused – nothing is signed or recorded', async () => {
    const s = await setup();
    await s.built();
    const forged = new Transaction({ feePayer: s.ctx.poolChain.sponsor!.publicKey, blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 250 });
    forged.add({ keys: [{ pubkey: s.buyer.publicKey, isSigner: true, isWritable: true }], programId: s.buyer.publicKey, data: Buffer.from('drain') });
    forged.partialSign(s.buyer);
    await expect(s.submit(forged.serialize({ requireAllSignatures: false }).toString('base64'))).rejects.toBeInstanceOf(BadRequestError);
    expect(s.ctx.poolChain.cosigned).toHaveLength(0);
    expect(await s.ctx.sponsoredTxs.countSince(s.wallet, new Date(0))).toBe(0);
  });

  it('409 before the payment transaction was asked for or after the order lapsed; 429 over the daily cap', async () => {
    const s = await setup(1);
    await expect(s.submit('AAAA')).rejects.toThrow(new ConflictError('ask for the payment transaction first', 'no_transaction'));
    await s.built();
    await s.ctx.sponsoredTxs.record({ signature: 'y', wallet: s.wallet, kind: 'buy', feeLamports: 5000, at: s.ctx.now() });
    await expect(s.submit('AAAA')).rejects.toBeInstanceOf(TooManyRequestsError);
    s.ctx.clock.advance(3600);
    await expect(s.submit('AAAA')).rejects.toMatchObject({ errorCode: 'order_closed' });
  });
});
