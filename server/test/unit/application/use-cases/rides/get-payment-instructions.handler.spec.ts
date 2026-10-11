import { Transaction } from '@solana/web3.js';
import { Keypair } from '@solana/web3.js';
import { GetPaymentInstructionsHandler } from '../../../../../src/application/use-cases/rides/get-payment-instructions/get-payment-instructions.handler.js';
import { GetPaymentInstructionsQuery } from '../../../../../src/application/use-cases/rides/get-payment-instructions/get-payment-instructions.query.js';
import { ConflictError, ServiceUnavailableError } from '../../../../../src/domain/shared/errors.js';
import { TREASURY } from '../../../../support/fake-chain.js';
import { FixedRules, unitContext, unitRules } from '../../../../support/unit-context.js';

describe('GetPaymentInstructionsHandler', () => {
  const wallet = Keypair.generate().publicKey.toBase58();

  it('the unsigned transfer of the quoted lamports to the treasury, with the ride id as memo', async () => {
    const ctx = unitContext();
    const order = await ctx.paidOrder(wallet);
    const p = await new GetPaymentInstructionsHandler(ctx.lookup, ctx.chain, ctx.rules, ctx.clock, ctx.players).execute(new GetPaymentInstructionsQuery(wallet, order.id));
    expect(p).toMatchObject({ treasury: TREASURY, lamports: 50_000_000, memo: order.id, quoteExpiresAt: ctx.clock.ms + 600_000 });
    const tx = Transaction.from(Buffer.from(p.transaction, 'base64'));
    expect(tx.feePayer?.toBase58()).toBe(wallet);
    expect(tx.instructions[1]?.data.toString()).toBe(order.id);
  });

  it('refused once the quote lapsed, for a ride that is not awaiting payment, and without a treasury', async () => {
    const ctx = unitContext();
    const handler = new GetPaymentInstructionsHandler(ctx.lookup, ctx.chain, ctx.rules, ctx.clock, ctx.players);
    const order = await ctx.paidOrder(wallet);
    ctx.clock.advance(600);
    await expect(handler.execute(new GetPaymentInstructionsQuery(wallet, order.id))).rejects.toThrow(new ConflictError('the price quote expired – create the ride again'));
    await expect(handler.execute(new GetPaymentInstructionsQuery(wallet, (await ctx.freeRide(wallet)).id))).rejects.toThrow(new ConflictError('ride is created'));
    const noTreasury = new GetPaymentInstructionsHandler(ctx.lookup, ctx.chain, new FixedRules(unitRules({ treasury: '' })), ctx.clock, ctx.players);
    const fresh = Keypair.generate().publicKey.toBase58(); // `wallet` already accepted on the order above
    const closed = await ctx.paidOrder(fresh, 50_000_000, { offer: false });
    await expect(handler.execute(new GetPaymentInstructionsQuery(fresh, closed.id))).rejects.toMatchObject({ errorCode: 'agreements_required' });
    await expect(noTreasury.execute(new GetPaymentInstructionsQuery(wallet, order.id))).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
