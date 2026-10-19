import { Keypair } from '@solana/web3.js';
import { GetSolanaPayLinkHandler, GetSolanaPayTransactionHandler } from '../../../../src/application/use-cases/solana-pay/solana-pay.handler.js';
import { GetSolanaPayLinkQuery, GetSolanaPayTransactionQuery } from '../../../../src/application/use-cases/solana-pay/solana-pay.query.js';
import { QueryBus } from '@nestjs/cqrs';
import { unitContext } from '../../../support/unit-context.js';
import { NotFoundError } from '../../../../src/domain/shared/errors.js';

describe('Solana Pay handlers', () => {
  it('the link is the app origin and a fixed label', async () => {
    const ctx = unitContext();
    const link = await new GetSolanaPayLinkHandler(ctx.rules).execute(new GetSolanaPayLinkQuery('ignored'));
    expect(link).toEqual({ label: 'Freight Chain', icon: `${ctx.rules.get().appOrigin}/icons/icon-512.png` });
  });

  it('a ride transaction request returns the payment transaction and a devnet message', async () => {
    const ctx = unitContext();
    const wallet = Keypair.generate().publicKey.toBase58();
    const order = await ctx.paidOrder(wallet);
    const bus = { execute: async () => ({ transaction: 'abc', message: 'unused' }) } as unknown as QueryBus;
    const built = await new GetSolanaPayTransactionHandler(bus, ctx.rides, ctx.orders, ctx.donationOrders).execute(new GetSolanaPayTransactionQuery('ride', order.id, wallet));
    expect(built).toEqual({ transaction: 'abc', message: 'Freight Chain shift · devnet' });
  });

  it('another wallet scanning the code is told which account it is for (still a 404); an unknown id stays a plain 404', async () => {
    const ctx = unitContext();
    const wallet = Keypair.generate().publicKey.toBase58(), other = Keypair.generate().publicKey.toBase58();
    const order = await ctx.paidOrder(wallet);
    const bus = { execute: async () => { throw new NotFoundError('ride not found'); } } as unknown as QueryBus;
    const handler = new GetSolanaPayTransactionHandler(bus, ctx.rides, ctx.orders, ctx.donationOrders);
    const wrong = await handler.execute(new GetSolanaPayTransactionQuery('ride', order.id, other)).catch((e: unknown) => e);
    expect(wrong).toBeInstanceOf(NotFoundError);
    expect((wrong as NotFoundError).message).toBe(`This code is for the wallet ${wallet.slice(0, 4)}…${wallet.slice(-4)} – pay it from the wallet app that holds that account (on devnet).`);
    expect((wrong as NotFoundError).errorCode).toBe('wrong_account');
    await expect(handler.execute(new GetSolanaPayTransactionQuery('order', 'no-such-order', other))).rejects.toThrow(new NotFoundError('ride not found'));
  });
});
