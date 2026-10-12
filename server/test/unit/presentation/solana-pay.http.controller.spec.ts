import { SolanaPayHttpController } from '../../../src/presentation/solana-pay/solana-pay.http.controller.js';
import { GetSolanaPayLinkQuery, GetSolanaPayTransactionQuery } from '../../../src/application/use-cases/solana-pay/solana-pay.query.js';
import { busMock } from '../../support/bus.js';

describe('SolanaPayHttpController', () => {
  it('dispatches each transaction request to the bus, with no session', async () => {
    const queries = busMock({ label: 'Freight Chain', transaction: 'dHg=' });
    const c = new SolanaPayHttpController(queries.bus);
    const id = { id: 'ride-1' };
    await c.rideLink(id); expect(queries.last()).toEqual(new GetSolanaPayLinkQuery('ride-1'));
    await c.ride(id, { account: 'Wallet111111111111111111111111111111111111' });
    expect(queries.last()).toEqual(new GetSolanaPayTransactionQuery('ride', 'ride-1', 'Wallet111111111111111111111111111111111111'));
    await c.orderLink(id); expect(queries.last()).toEqual(new GetSolanaPayLinkQuery('ride-1'));
    await c.order(id, { account: 'A' }); expect(queries.last()).toEqual(new GetSolanaPayTransactionQuery('order', 'ride-1', 'A'));
    await c.donationLink(id); expect(queries.last()).toEqual(new GetSolanaPayLinkQuery('ride-1'));
    await c.donation(id, { account: 'A' }); expect(queries.last()).toEqual(new GetSolanaPayTransactionQuery('donation', 'ride-1', 'A'));
  });
});
