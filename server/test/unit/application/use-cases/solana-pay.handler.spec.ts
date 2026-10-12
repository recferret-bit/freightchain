import { Keypair } from '@solana/web3.js';
import { GetSolanaPayLinkHandler, GetSolanaPayTransactionHandler } from '../../../../src/application/use-cases/solana-pay/solana-pay.handler.js';
import { GetSolanaPayLinkQuery, GetSolanaPayTransactionQuery } from '../../../../src/application/use-cases/solana-pay/solana-pay.query.js';
import { QueryBus } from '@nestjs/cqrs';
import { unitContext } from '../../../support/unit-context.js';

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
    const built = await new GetSolanaPayTransactionHandler(bus).execute(new GetSolanaPayTransactionQuery('ride', order.id, wallet));
    expect(built).toEqual({ transaction: 'abc', message: 'Freight Chain shift · devnet' });
  });
});
