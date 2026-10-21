import { PoolRepositoryPort } from '../../src/application/ports/economy/pool.repository.port.js';
import type { PoolProps } from '../../src/domain/economy/pool.types.js';
import { bindClient, type Rider } from '../support/client.js';
import { newPoolSignature } from '../support/fake-pool-chain.js';
import type { Harness } from '../support/harness.js';
import { aPool } from '../support/pools.js';

/* The chain pushing to us: POST /api/chain/webhook through the REAL app (guard, Zod, filter); the pool program is the FakePoolChain, so a delivery only
   NAMES signatures and the server reads each transaction back from "the chain". No client call settles anything here. */
export const WEBHOOK_SECRET = 'scenario-webhook-secret-0123';
export const WEBHOOK_ENV = { FREE_RIDE_SECONDS: '10', PAYMENT_MODE: 'program', TICKET_PROGRAM_ID: '9e7phdJzKMNJX8ZnqR8SdxNzafNJjYXeZNsjQze3BSvx', ORDER_TTL_MINUTES: '60', WEBHOOK_SECRET };

export function webhookScenarios(h: () => Harness): void {
  const { anon, login, now } = bindClient(h);
  beforeEach(() => h().reset());

  const seedPool = (over: Partial<PoolProps>) => h().app.get(PoolRepositoryPort, { strict: false }).upsert(aPool(over, new Date(now())));
  const deliver = (body: unknown) => anon().post('/api/chain/webhook').set('x-webhook-secret', WEBHOOK_SECRET).send(body as object);
  const buy = (w: Rider, over: Record<string, unknown> = {}) =>
    h().poolChain.addEvent('TicketBought', { poolId: 1, buyer: w.address, qty: 2, lamports: 100_000_000, orderId: '', ticketsSold: 2, activated: false, ...over });

  it('a purchase delivered by the webhook credits the ticket with no client call: order paid, tickets there, the event on the pool page', async () => {
    await seedPool({ id: 1, status: 'active' });
    const w = await login();
    const order = (await w.agent.post('/api/tickets').send({ poolId: 1, qty: 2, burnWarningAccepted: true }).expect(200)).body;
    const sig = buy(w, { orderId: order.id });
    // a Helius "enhanced" delivery: its event data (here: a lie about the amount) is ignored – only the signature is used
    expect((await deliver([{ signature: sig, nativeTransfers: [{ amount: 1 }], type: 'TRANSFER' }]).expect(200)).body).toEqual({ received: 1, settled: 1, pending: 0 });
    expect((await w.agent.get(`/api/tickets/orders/${order.id}`).expect(200)).body).toMatchObject({ status: 'paid', signature: sig });
    expect((await w.agent.get('/api/me')).body.tickets).toMatchObject([{ poolId: 1, balance: 2, bought: 2 }]);
    const page = (await anon().get('/api/pools/1').expect(200)).body;
    expect(page).toMatchObject({ id: 1, sold: 2 });
    expect(page.recent).toEqual([{ signature: sig, kind: 'TicketBought', wallet: w.address, lamports: 100_000_000, outcome: 'settled', at: now(), finalized: false }]);
    // re-delivered (QuickNode retries): settled again, credited once
    expect((await deliver({ signatures: [sig] }).expect(200)).body).toEqual({ received: 1, settled: 1, pending: 0 });
    expect((await w.agent.get('/api/me')).body.tickets).toMatchObject([{ balance: 2 }]);
    await w.agent.post('/api/rides').send({ tier: '1h' }).expect(200);
  });

  it('PoolFailed by webhook voids the tickets (refundable), then Refunded by webhook marks the order refunded', async () => {
    await seedPool({ id: 1, status: 'open', minTickets: 5 });
    const w = await login();
    const order = (await w.agent.post('/api/tickets').send({ poolId: 1, qty: 2, burnWarningAccepted: true }).expect(200)).body;
    const bought = buy(w, { orderId: order.id });
    const failed = h().poolChain.addEvent('PoolFailed', { poolId: 1, ticketsSold: 2 });
    // QuickNode Streams shape: matched transactions nested in the payload
    expect((await deliver({ data: [{ matchedTransactions: [{ signature: bought }, { transaction: { signatures: [failed] } }] }] }).expect(200)).body).toEqual({ received: 2, settled: 2, pending: 0 });
    expect((await w.agent.get('/api/me')).body.tickets).toMatchObject([{ poolId: 1, status: 'refunding', balance: 0, bought: 2, refundable: true }]);
    expect((await anon().get('/api/pools/1')).body).toMatchObject({ status: 'refunding' });
    const refunded = h().poolChain.addEvent('Refunded', { poolId: 1, buyer: w.address, rentPayer: w.address, qty: 2, lamports: 100_000_000, refundedTotal: 100_000_000 });
    expect((await deliver([refunded]).expect(200)).body).toMatchObject({ settled: 1 });
    expect((await w.agent.get(`/api/tickets/orders/${order.id}`)).body).toMatchObject({ status: 'refunded' });
    expect((await w.agent.get('/api/me')).body.tickets).toEqual([]);
    expect((await anon().get('/api/pools/1')).body.recent.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(['TicketBought', 'PoolFailed', 'Refunded']));
  });

  it('a signature the chain does not show yet is pending (nothing credited from the body); junk is ignored', async () => {
    await seedPool({ id: 1, status: 'active' });
    const unseen = newPoolSignature();
    expect((await deliver([{ signature: unseen, events: [{ kind: 'TicketBought', qty: 99 }] }, 'not-a-signature', 42]).expect(200)).body).toEqual({ received: 1, settled: 0, pending: 1 });
    expect((await deliver({}).expect(200)).body).toEqual({ received: 0, settled: 0, pending: 0 });
    expect((await anon().get('/api/pools/1')).body).toMatchObject({ sold: 0, recent: [] });
  });

  it('refusals: no / wrong secret 401 (problem+json), Bearer accepted, an unfiltered stream 400, the RPC down 503', async () => {
    const sig = newPoolSignature();
    expect((await anon().post('/api/chain/webhook').send([sig]).expect(401)).body).toMatchObject({ status: 401, code: 'unauthorized' });
    await anon().post('/api/chain/webhook').set('x-webhook-secret', 'wrong-secret-wrong-secret').send([sig]).expect(401);
    expect((await anon().post('/api/chain/webhook').set('authorization', `Bearer ${WEBHOOK_SECRET}`).send([sig]).expect(200)).body).toMatchObject({ received: 1 });
    const many = Array.from({ length: 101 }, () => newPoolSignature());
    expect((await deliver(many).expect(400)).body).toMatchObject({ code: 'validation_error', detail: expect.stringMatching(/at most 100 signatures/) });
    h().poolChain.rpcDown = true;
    expect((await deliver([sig]).expect(503)).body).toMatchObject({ code: 'service_unavailable' });
  });
}
