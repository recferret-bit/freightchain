import { PoolRepositoryPort } from '../../src/application/ports/economy/pool.repository.port.js';
import { bindClient, newWallet } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { aPool } from '../support/pools.js';

/* Ticket reconcile, the single-scenario ticket/pool/chain routes, and order Solana Pay.
   An unpaid reconcile is 200 not_found and does not credit a ticket. */

export function economyGapScenarios(h: () => Harness): void {
  const { anon, login, now } = bindClient(h);
  beforeEach(() => h().reset());
  const seed = (id = 1) => h().app.get(PoolRepositoryPort, { strict: false }).upsert(aPool({ id, status: 'active' }, new Date(now())));

  it('reconcile pays the order whose reference is on chain', async () => {
    await seed();
    const rider = await login();
    const order = (await rider.agent.post('/api/tickets').send({ poolId: 1, qty: 1, burnWarningAccepted: true }).expect(200)).body;
    expect(order.reference).toEqual(expect.any(String));
    const sig = h().poolChain.addEvent('TicketBought', {
      poolId: 1, buyer: rider.address, qty: 1, lamports: order.lamports, orderId: order.id, ticketsSold: 1, activated: false,
    });
    h().chain.mention(order.reference, sig, null);
    const paid = (await rider.agent.post(`/api/tickets/orders/${order.id}/reconcile`).expect(200)).body;
    expect(paid).toMatchObject({ status: 'paid', order: { id: order.id, status: 'paid' } });
    expect((await rider.agent.get('/api/me').expect(200)).body.tickets).toMatchObject([{ poolId: 1, balance: 1 }]);
  });

  it('an unpaid order reconciles as not_found and credits nothing', async () => {
    await seed();
    const rider = await login();
    const order = (await rider.agent.post('/api/tickets').send({ poolId: 1, qty: 1, burnWarningAccepted: true }).expect(200)).body;
    const body = (await rider.agent.post(`/api/tickets/orders/${order.id}/reconcile`).expect(200)).body;
    expect(body).toMatchObject({ status: 'not_found', order: { id: order.id, status: 'awaiting_payment' } });
    expect((await rider.agent.get('/api/me').expect(200)).body.tickets).toEqual([]);
  });

  it('reconcile, payment and confirm: no session 401, a bad id 400, someone else\'s order 404', async () => {
    await seed();
    const rider = await login();
    const other = await login();
    const order = (await rider.agent.post('/api/tickets').send({ poolId: 1, qty: 1, burnWarningAccepted: true }).expect(200)).body;
    await anon().get('/api/tickets/pending').expect(401);
    await anon().get(`/api/tickets/orders/${order.id}/payment`).expect(401);
    await anon().post(`/api/tickets/orders/${order.id}/confirm`).send({ signature: '5'.repeat(88) }).expect(401);
    await anon().post(`/api/tickets/orders/${order.id}/reconcile`).expect(401);
    await rider.agent.get('/api/tickets/orders/not-a-uuid/payment').expect(400);
    await rider.agent.post('/api/tickets/orders/not-a-uuid/confirm').send({ signature: '5'.repeat(88) }).expect(400);
    await rider.agent.post('/api/tickets/orders/not-a-uuid/reconcile').expect(400);
    await rider.agent.post(`/api/tickets/orders/${order.id}/confirm`).send({ signature: 'short' }).expect(400);
    await other.agent.get(`/api/tickets/orders/${order.id}/payment`).expect(404);
    await other.agent.post(`/api/tickets/orders/${order.id}/confirm`).send({ signature: '5'.repeat(88) }).expect(404);
    await other.agent.post(`/api/tickets/orders/${order.id}/reconcile`).expect(404);
    await anon().get('/api/tickets/pending').set('Cookie', 'fc_session=not-a-jwt').expect(401);
  });

  it('an order Solana Pay link is public; the transaction is the buyer\'s', async () => {
    await seed();
    const rider = await login();
    const order = (await rider.agent.post('/api/tickets').send({ poolId: 1, qty: 1, burnWarningAccepted: true }).expect(200)).body;
    expect((await anon().get(`/api/solana-pay/orders/${order.id}`).expect(200)).body.label).toBe('Freight Chain');
    const tx = await anon().post(`/api/solana-pay/orders/${order.id}`).send({ account: rider.address }).expect(200);
    expect(tx.body.message).toMatch(/tickets/);
    expect(typeof tx.body.transaction).toBe('string');
    await anon().get(`/api/solana-pay/orders/${'o'.repeat(65)}`).expect(400);
    await anon().post(`/api/solana-pay/orders/${order.id}`).send({ account: 'nope' }).expect(400);
    expect((await anon().post(`/api/solana-pay/orders/${order.id}`).send({ account: newWallet().address }).expect(404)).body.code).toBe('wrong_account');
    expect((await anon().post('/api/solana-pay/orders/missing-order').send({ account: rider.address }).expect(404)).body.code).toBe('not_found');
  });

  it('standings, refund, payout and settle refuse the calls a person can actually make', async () => {
    await anon().get('/api/pools/9/standings').expect(404);
    await anon().get('/api/pools/x/standings').expect(400);
    await anon().get('/api/pools/4294967296/standings').expect(400);
    await anon().get('/api/pools/1/refund').expect(401);
    await anon().get('/api/pools/1/payout').expect(401);
    await anon().post('/api/chain/settle').send({ signature: '5'.repeat(88) }).expect(401);
    const rider = await login();
    await rider.agent.get('/api/pools/x/refund').expect(400);
    expect((await rider.agent.get('/api/pools/9/refund').expect(404)).body.code).toBe('not_found');
    await seed();
    expect((await rider.agent.get('/api/pools/1/refund').expect(409)).body.code).toBe('not_refundable');
    expect((await rider.agent.get('/api/pools/1/payout').expect(403)).body.code).toBe('not_admin');
    await rider.agent.get('/api/pools/x/payout').expect(400);
    await rider.agent.post('/api/chain/settle').send({}).expect(400);
    await rider.agent.post('/api/chain/settle').send({ signature: 'short' }).expect(400);
    const pending = await rider.agent.post('/api/chain/settle').send({ signature: '5'.repeat(88) }).expect(200);
    expect(pending.body.status).toMatch(/pending|invalid|done/);
  });
}
