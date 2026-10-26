import { PoolRepositoryPort } from '../../src/application/ports/economy/pool.repository.port.js';
import { PlayerRepositoryPort } from '../../src/application/ports/players/player.repository.port.js';
import { TicketSettlementService, type PurchaseEvent } from '../../src/application/services/ticket-settlement.service.js';
import type { PoolProps } from '../../src/domain/economy/pool.types.js';
import { bindClient, type Rider } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { aPool } from '../support/pools.js';

/* Buying tickets: an order over HTTP, then the program's TicketBought event settles it. The event is handed to the settlement service directly – the
   stand-in for the chain watcher / the confirm fast path until the chain adapter lands. */
export const TICKET_ORDERS_ENV = { FREE_RIDE_SECONDS: '10', PAYMENT_MODE: 'program', TICKET_PROGRAM_ID: '9e7phdJzKMNJX8ZnqR8SdxNzafNJjYXeZNsjQze3BSvx', ORDER_TTL_MINUTES: '60' };

export function ticketOrderScenarios(h: () => Harness): void {
  const { anon, login, now } = bindClient(h);
  beforeEach(() => h().reset());

  const seedPool = (over: Partial<PoolProps>) => h().app.get(PoolRepositoryPort, { strict: false }).upsert(aPool(over, new Date(now())));
  const settlement = () => h().app.get(TicketSettlementService, { strict: false });
  const bought = (w: Rider, over: Partial<PurchaseEvent> = {}): PurchaseEvent =>
    ({ kind: 'TicketBought', signature: `sig-${w.address.slice(0, 8)}`, index: 0, slot: 1, poolId: 1, buyer: w.address, qty: 2, lamports: 100_000_000, orderId: '', ticketsSold: 2, activated: false, ...over });

  it('order → its purchase event → the order is paid, the tickets are there, and a ride spends one', async () => {
    await seedPool({ id: 1, status: 'active' });
    const w = await login();
    const order = (await w.agent.post('/api/tickets').send({ poolId: 1, qty: 2, burnWarningAccepted: true }).expect(200)).body;
    expect(order).toMatchObject({ poolId: 1, qty: 2, lamports: 100_000_000, status: 'awaiting_payment' });
    expect((await w.agent.get('/api/tickets/pending').expect(200)).body.order.id).toBe(order.id);
    expect(await settlement().settlePurchase(bought(w, { orderId: order.id }))).toMatchObject({ outcome: 'settled', balance: 2 });
    expect((await w.agent.get(`/api/tickets/orders/${order.id}`).expect(200)).body).toMatchObject({ status: 'paid', signature: `sig-${w.address.slice(0, 8)}` });
    expect((await w.agent.get('/api/tickets/pending')).body).toEqual({ order: null });
    expect((await w.agent.get('/api/me')).body.tickets).toMatchObject([{ poolId: 1, balance: 2, bought: 2 }]);
    expect((await w.agent.get('/api/profile')).body.stats).toMatchObject({ spentLamports: 100_000_000, ticketsBought: 2 });
    expect((await w.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body).toMatchObject({ poolId: 1, status: 'created' });
    expect((await anon().get('/api/pools/1')).body).toMatchObject({ sold: 2, buyers: 1, vaultLamports: 100_000_000 });
  });

  it('the purchase reaching the minimum turns the pool live: tickets bought while it was open can now be ridden', async () => {
    await seedPool({ id: 1, status: 'open', minTickets: 2 });
    const w = await login();
    await settlement().settlePurchase(bought(w, { qty: 1, lamports: 50_000_000, ticketsSold: 1 }));
    expect((await w.agent.post('/api/rides').send({ tier: '1h' }).expect(409)).body).toMatchObject({ code: 'pool_not_live' });
    await settlement().settlePurchase(bought(w, { signature: 'sig-2', qty: 1, lamports: 50_000_000, ticketsSold: 2, activated: true }));
    expect((await anon().get('/api/pools/1')).body).toMatchObject({ status: 'active', sold: 2 });
    await w.agent.post('/api/rides').send({ tier: '1h' }).expect(200);
  });

  it('a pool that fails voids the tickets; its buyer is listed as refundable until the Refunded event lands', async () => {
    await seedPool({ id: 1, status: 'open', minTickets: 5 });
    const w = await login();
    await settlement().settlePurchase(bought(w));
    expect(await settlement().applyPoolEvent({ kind: 'PoolFailed', signature: 'fail', index: 0, slot: 2, poolId: 1, ticketsSold: 2 })).toMatchObject({ voided: 2 });
    expect((await w.agent.get('/api/me')).body.tickets).toMatchObject([{ poolId: 1, status: 'refunding', balance: 0, bought: 2, refundable: true }]);
    await settlement().settleRefund({ kind: 'Refunded', signature: 'ref', index: 0, slot: 3, poolId: 1, buyer: w.address, rentPayer: w.address, qty: 2, lamports: 100_000_000, refundedTotal: 100_000_000 });
    expect((await w.agent.get('/api/me')).body.tickets).toEqual([]);
    expect((await w.agent.get('/api/profile')).body.stats).toMatchObject({ spentLamports: 0, ticketsBought: 0 });
  });

  it('refusals: signed-out 401, bad body 400, unknown pool 404, not sellable 409, someone else\'s order 404', async () => {
    await seedPool({ id: 1, status: 'refunding' });
    const w = await login(), other = await login();
    await anon().post('/api/tickets').send({ poolId: 1, qty: 1, burnWarningAccepted: true }).expect(401);
    await w.agent.post('/api/tickets').send({ poolId: 1, qty: 0, burnWarningAccepted: true }).expect(400);
    await w.agent.post('/api/tickets').send({ poolId: 2, qty: 1, burnWarningAccepted: true }).expect(404);
    expect((await w.agent.post('/api/tickets').send({ poolId: 1, qty: 1, burnWarningAccepted: true }).expect(409)).body).toMatchObject({ code: 'not_sellable', detail: 'this pool is refunding' });
    await seedPool({ id: 3, status: 'open' });
    const mine = (await w.agent.post('/api/tickets').send({ poolId: 3, qty: 1, burnWarningAccepted: true }).expect(200)).body;
    await other.agent.get(`/api/tickets/orders/${mine.id}`).expect(404);
    await w.agent.get('/api/tickets/orders/not-a-uuid').expect(400);
  });

  it('the wallet path end to end on the (fake) chain: payment transaction → confirm → paid; refund transaction after the pool failed → settle', async () => {
    await seedPool({ id: 1, status: 'open', minTickets: 5 });
    const w = await login();
    const order = (await w.agent.post('/api/tickets').send({ poolId: 1, qty: 2, burnWarningAccepted: true }).expect(200)).body;
    const pay = (await w.agent.get(`/api/tickets/orders/${order.id}/payment`).expect(200)).body;
    expect(pay).toMatchObject({ orderId: order.id, poolId: 1, lamports: 100_000_000, feePayer: w.address });
    expect(h().poolChain.built[0]).toMatchObject({ kind: 'buy', input: { payer: w.address, orderId: order.id, qty: 2 } });
    const sig = h().poolChain.addEvent('TicketBought', { poolId: 1, buyer: w.address, qty: 2, lamports: 100_000_000, orderId: order.id, ticketsSold: 2, activated: false });
    expect((await w.agent.post(`/api/tickets/orders/${order.id}/confirm`).send({ signature: sig }).expect(200)).body).toMatchObject({ status: 'paid', order: { status: 'paid' } });
    expect((await h().app.get(PlayerRepositoryPort).findByWallet(w.address))?.trustScore).toBe(100);
    await w.agent.get(`/api/pools/1/refund`).expect(409); // still open, before its deadline
    const failed = h().poolChain.addEvent('PoolFailed', { poolId: 1, ticketsSold: 2 });
    expect((await w.agent.post('/api/chain/settle').send({ signature: failed }).expect(200)).body).toMatchObject({ status: 'done', events: [{ kind: 'PoolFailed', outcome: 'applied' }] });
    expect((await w.agent.get(`/api/pools/1/refund`).expect(200)).body).toMatchObject({ poolId: 1, needsFail: false, lamports: 100_000_000 });
    const refunded = h().poolChain.addEvent('Refunded', { poolId: 1, buyer: w.address, rentPayer: w.address, qty: 2, lamports: 100_000_000, refundedTotal: 100_000_000 });
    await w.agent.post('/api/chain/settle').send({ signature: refunded }).expect(200);
    expect((await w.agent.get(`/api/tickets/orders/${order.id}`)).body.status).toBe('refunded');
    expect((await w.agent.get('/api/pools/1/payout')).status).toBe(403); // not the admin
  });

  it('program mode is ticket-only: a paid tier with no live pool is not on sale (no pay-per-ride fallback) and POST /api/rides refuses it', async () => {
    await seedPool({ id: 1, tier: '1h', status: 'active' });
    await seedPool({ id: 2, tier: '4h', status: 'refunding' });
    const tiers = (await anon().get('/api/tiers').expect(200)).body;
    expect(tiers.paymentMode).toBe('program');
    expect(tiers.tiers.map((t: { id: string; available: boolean; lamports: number | null; pool: { id: number } | null }) => [t.id, t.available, t.lamports === null, t.pool?.id ?? null]))
      .toEqual([['free', true, true, null], ['1h', true, false, 1]]);
    const w = await login();
    expect((await w.agent.post('/api/rides').send({ tier: '4h' }).expect(400)).body).toMatchObject({ code: 'tier_retired' });
  });

  it('a pool that missed its goal is refundable at once – before anyone sends fail_pool (the refund transaction bundles it)', async () => {
    await seedPool({ id: 1, status: 'open', minTickets: 5, prepDeadline: new Date(now() + 60_000) });
    const w = await login();
    await settlement().settlePurchase(bought(w));
    expect((await w.agent.get('/api/me')).body.tickets).toMatchObject([{ poolId: 1, status: 'open', refundable: false }]);
    h().clock.advance(61);
    expect((await w.agent.get('/api/me')).body.tickets).toMatchObject([{ poolId: 1, status: 'open', refundable: true }]);
  });
}
