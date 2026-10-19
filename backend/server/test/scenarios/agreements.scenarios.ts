import { bindClient, newWallet, type Rider } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { setTierOnSaleForTest } from '../../src/domain/rides/ride-tier.js';

/* The two profile boxes (18+ and the loss offer). Off until the rider ticks them. A paid order, a resume into a paid ride, an unsigned
   payment transaction and a non-free start are 409 agreements_required. Confirming SOL already sent is not. Same scenarios on in-memory and PostgreSQL. */
export const AGREEMENTS_ADMIN = newWallet();
export const AGREEMENTS_ENV = { ADMIN_WALLETS: AGREEMENTS_ADMIN.address };

const OFF = { age18: false, loss: false, age18At: null, lossAt: null };

export function agreementsScenarios(h: () => Harness): void {
  const { login, loginAdmin, sec } = bindClient(h);
  beforeEach(() => { setTierOnSaleForTest('1h', true); return h().reset(); }); // the 1h cases are pay-per-ride; production leaves 1h off until a pool exists
  afterEach(() => setTierOnSaleForTest('1h', false));

  const rider = () => login(newWallet(), { offer: false });
  const put = (w: Rider, body: { age18: boolean; loss: boolean }) => w.agent.put('/api/profile/agreements').send(body);

  it('both boxes start off; a free ride stays open; the cheap paid refusals still answer before the offer', async () => {
    const w = await rider();
    expect((await w.agent.get('/api/me').expect(200)).body.agreements).toEqual(OFF);
    expect((await w.agent.get('/api/profile').expect(200)).body.agreements).toEqual(OFF);
    expect((await w.agent.post('/api/tickets').send({ poolId: 1, qty: 1 }).expect(503)).body.code).toBe('service_unavailable'); // transfer mode, before the offer
    expect((await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body).toMatchObject({ tier: 'free', status: 'created' });
    expect((await w.agent.post('/api/rides').send({ tier: '1h', tutorial: true }).expect(409)).body.code).not.toBe('agreements_required');
    expect((await w.agent.post('/api/rides').send({ tier: '4h' }).expect(409)).body.code).toBe('tier_not_on_sale');
    expect((await w.agent.post('/api/rides').send({ tier: '1h' }).expect(409)).body).toMatchObject({ code: 'agreements_required', status: 409 });
    await w.agent.put('/api/profile/agreements').send({ age18: true }).expect(400);
  });

  it('both boxes, then a paid order; unchecking blocks the resume and the unsigned transaction; SOL already sent still confirms; start waits for the boxes', async () => {
    const w = await rider();
    const age = (await put(w, { age18: true, loss: false }).expect(200)).body;
    expect(age).toMatchObject({ age18: true, loss: false, lossAt: null });
    expect(age.age18At).toEqual(expect.any(Number));
    expect((await w.agent.post('/api/rides').send({ tier: '1h' }).expect(409)).body.code).toBe('agreements_required');
    const both = (await put(w, { age18: true, loss: true }).expect(200)).body;
    expect(both.age18At).toBe(age.age18At); // the first stamp sticks while the box stays on
    expect(both.lossAt).toEqual(expect.any(Number));
    const ride = (await w.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    expect(ride).toMatchObject({ tier: '1h', status: 'awaiting_payment' });
    expect((await w.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body.id).toBe(ride.id);
    await put(w, { age18: true, loss: false }).expect(200);
    expect((await w.agent.post('/api/rides').send({ tier: '1h' }).expect(409)).body.code).toBe('agreements_required');
    expect((await w.agent.get(`/api/rides/${ride.id}/payment`).expect(409)).body.code).toBe('agreements_required');
    await put(w, { age18: true, loss: true }).expect(200);
    const payment = (await w.agent.get(`/api/rides/${ride.id}/payment`).expect(200)).body;
    expect(payment.lamports).toBe(ride.lamports);
    await put(w, { age18: false, loss: false }).expect(200);
    const sig = h().chain.addPayment({ payer: w.address, lamports: ride.lamports, memo: ride.id, reference: payment.reference });
    expect((await w.agent.post(`/api/rides/${ride.id}/confirm`).send({ signature: sig }).expect(200)).body).toMatchObject({ status: 'paid' });
    expect((await w.agent.post(`/api/rides/${ride.id}/start`).expect(409)).body.code).toBe('agreements_required');
    sec(1);
    const again = (await put(w, { age18: true, loss: true }).expect(200)).body;
    expect(again.age18At).not.toBe(age.age18At);
    expect(again.lossAt).not.toBe(both.lossAt);
    expect((await w.agent.post(`/api/rides/${ride.id}/start`).expect(200)).body.status).toBe('running');
    const admin = await loginAdmin(AGREEMENTS_ADMIN);
    expect((await admin.agent.get(`/api/admin/players/${w.address}`).expect(200)).body.player).toMatchObject({ age18At: again.age18At, lossAt: again.lossAt });
  });
}
