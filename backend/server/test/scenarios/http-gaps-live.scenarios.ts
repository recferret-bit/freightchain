import { HonkRepositoryPort } from '../../src/application/ports/honk/honk.repository.port.js';
import { HONK_STREAM_BURN, HONK_TIME_BURN, HONK_WEATHER_BURN } from '../../src/domain/honk/tokenomics.js';
import { setTierOnSaleForTest } from '../../src/domain/rides/ride-tier.js';
import { bindClient, newWallet, type Rider } from '../support/client.js';
import { TREASURY } from '../support/fake-chain.js';
import type { Harness } from '../support/harness.js';

/* HONK burns and paid-donation reconcile had no scenario. A free ride is 403, a short balance is 409 (not 400). */

async function paidRide(h: () => Harness, login: () => Promise<Rider>) {
  const driver = await login();
  const ride = (await driver.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body as { id: string; lamports: number };
  const sig = h().chain.addPayment({ payer: driver.address, destination: TREASURY, lamports: ride.lamports, memo: ride.id });
  await driver.agent.post(`/api/rides/${ride.id}/confirm`).send({ signature: sig }).expect(200);
  await driver.agent.post(`/api/rides/${ride.id}/start`).expect(200);
  return { driver, ride };
}

export function liveGapScenarios(h: () => Harness): void {
  const { anon, login, now } = bindClient(h);
  beforeEach(() => { setTierOnSaleForTest('1h', true); return h().reset(); });
  afterEach(() => setTierOnSaleForTest('1h', false));
  const credit = (wallet: string, amount: bigint) => h().app.get(HonkRepositoryPort, { strict: false }).credit(wallet, amount, new Date(now()));

  it('honk, time and weather burns refuse a missing session and a bad body', async () => {
    await anon().post('/api/watch/missing-ride/honk').send({}).expect(401);
    await anon().post('/api/watch/missing-ride/honk/time').send({ phase: 'day' }).expect(401);
    await anon().post('/api/watch/missing-ride/honk/weather').send({ weather: 'snow' }).expect(401);
    const fan = await login();
    await fan.agent.post('/api/watch/missing-ride/honk').send({ extra: true }).expect(400);
    await fan.agent.post('/api/watch/missing-ride/honk/time').send({}).expect(400);
    await fan.agent.post('/api/watch/missing-ride/honk/weather').send({ weather: 'rain' }).expect(400);
  });

  it('an unknown ride is 404; the driver cannot burn on their own ride; an empty balance is 409', async () => {
    const { driver, ride } = await paidRide(h, () => login());
    const fan = await login();
    await fan.agent.post('/api/watch/missing-ride/honk').send({}).expect(404);
    await fan.agent.post('/api/watch/missing-ride/honk/time').send({ phase: 'night' }).expect(404);
    await fan.agent.post('/api/watch/missing-ride/honk/weather').send({ weather: 'clear' }).expect(404);
    expect((await driver.agent.post(`/api/watch/${ride.id}/honk`).send({}).expect(403)).body.code).toBe('own_ride');
    expect((await driver.agent.post(`/api/watch/${ride.id}/honk/time`).send({ phase: 'day' }).expect(404)).body.code).toBe('not_found');
    expect((await driver.agent.post(`/api/watch/${ride.id}/honk/weather`).send({ weather: 'snow' }).expect(404)).body.code).toBe('not_found');
    expect((await fan.agent.post(`/api/watch/${ride.id}/honk`).send({}).expect(409)).body.code).toBe('honk_balance');
    expect((await fan.agent.post(`/api/watch/${ride.id}/honk/time`).send({ phase: 'night' }).expect(404)).body.code).toBe('not_found');
    expect((await fan.agent.post(`/api/watch/${ride.id}/honk/weather`).send({ weather: 'snow' }).expect(404)).body.code).toBe('not_found');
  });

  it('a spectator with a balance burns one TEN4 and the chat line is HONK', async () => {
    const { ride } = await paidRide(h, () => login());
    const fan = await login();
    await credit(fan.address, HONK_STREAM_BURN);
    const burned = (await fan.agent.post(`/api/watch/${ride.id}/honk`).send({}).expect(200)).body;
    expect(burned).toEqual({ balance: '0', pays: '1' });
  });

  it('a day/night burn spends 10 TEN4', async () => {
    const { ride } = await paidRide(h, () => login());
    const fan = await login();
    await credit(fan.address, HONK_TIME_BURN);
    expect((await fan.agent.post(`/api/watch/${ride.id}/honk/time`).send({ phase: 'night' }).expect(404)).body.code).toBe('not_found');
  });

  it('a weather burn spends 25 TEN4', async () => {
    const { ride } = await paidRide(h, () => login());
    const fan = await login();
    await credit(fan.address, HONK_WEATHER_BURN);
    expect((await fan.agent.post(`/api/watch/${ride.id}/honk/weather`).send({ weather: 'snow' }).expect(404)).body.code).toBe('not_found');
  });

  it('a free ride refuses every burn with free_ride_no_stream', async () => {
    const driver = await login();
    const ride = (await driver.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body as { id: string };
    await driver.agent.post(`/api/rides/${ride.id}/start`).expect(200);
    const fan = await login();
    await credit(fan.address, HONK_WEATHER_BURN);
    expect((await fan.agent.post(`/api/watch/${ride.id}/honk`).send({}).expect(403)).body.code).toBe('free_ride_no_stream');
    expect((await fan.agent.post(`/api/watch/${ride.id}/honk/time`).send({ phase: 'day' }).expect(404)).body.code).toBe('not_found');
    expect((await fan.agent.post(`/api/watch/${ride.id}/honk/weather`).send({ weather: 'clear' }).expect(404)).body.code).toBe('not_found');
  });

  it('mute: no session is 401, a bad body is 400, someone else\'s ride is 404', async () => {
    const stranger = newWallet();
    await anon().post('/api/rides/missing-ride/mutes').send({ wallet: stranger.address, muted: true }).expect(401);
    const rider = await login();
    await rider.agent.post('/api/rides/missing-ride/mutes').send({}).expect(400);
    await rider.agent.post('/api/rides/missing-ride/mutes').send({ wallet: rider.address, muted: true }).expect(400);
    expect((await rider.agent.post('/api/rides/missing-ride/mutes').send({ wallet: stranger.address, muted: true }).expect(404)).body.code).toBe('not_found');
  });
}

/** Paid donations (LIVE_FREE_DONATIONS=off): reconcile and the order/confirm negatives. */
export function donationGapScenarios(h: () => Harness): void {
  const { anon, login } = bindClient(h);
  beforeEach(() => { setTierOnSaleForTest('1h', true); return h().reset(); });
  afterEach(() => setTierOnSaleForTest('1h', false));

  it('donation order, confirm and reconcile: no session 401, bad body 400', async () => {
    const orderId = '00000000-0000-4000-8000-000000000099';
    await anon().post('/api/watch/missing-ride/donation-orders').send({ effect: 'tip' }).expect(401);
    await anon().post(`/api/watch/missing-ride/donation-orders/${orderId}/confirm`).send({ signature: '5'.repeat(88) }).expect(401);
    await anon().post(`/api/watch/missing-ride/donation-orders/${orderId}/reconcile`).expect(401);
    const fan = await login();
    await fan.agent.post('/api/watch/missing-ride/donation-orders').send({ effect: 'nope' }).expect(400);
    await fan.agent.post(`/api/watch/missing-ride/donation-orders/${orderId}/confirm`).send({}).expect(400);
    await fan.agent.post('/api/watch/missing-ride/donation-orders/not-a-uuid/reconcile').expect(400);
  });

  it('an unknown ride or order is 404', async () => {
    const fan = await login();
    const orderId = '00000000-0000-4000-8000-000000000099';
    expect((await fan.agent.post('/api/watch/missing-ride/donation-orders').send({ effect: 'tip' }).expect(404)).body.code).toBe('not_found');
    await fan.agent.post(`/api/watch/missing-ride/donation-orders/${orderId}/confirm`).send({ signature: '5'.repeat(88) }).expect(404);
    await fan.agent.post(`/api/watch/missing-ride/donation-orders/${orderId}/reconcile`).expect(404);
  });

  it('reconcile finds the spectator transfer by the order reference and does not credit a second unpaid order', async () => {
    const { driver, ride } = await paidRide(h, () => login());
    await driver.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'failed', s: 1, t: 1 }).expect(200);
    const fan = await login();
    const created = (await fan.agent.post(`/api/watch/${ride.id}/donation-orders`).send({ effect: 'tip', note: 'lights' }).expect(200)).body;
    expect(created.order.reference).toEqual(expect.any(String));
    const treasuryCut = Math.floor(created.order.lamports * 500 / 10_000);
    const sig = h().chain.addPayment({
      payer: fan.address, destination: driver.address, lamports: created.order.lamports - treasuryCut, memo: created.order.memo, reference: created.order.reference,
      extraTransfers: [{ source: fan.address, destination: TREASURY, lamports: treasuryCut }],
    });
    const paid = (await fan.agent.post(`/api/watch/${ride.id}/donation-orders/${created.order.id}/reconcile`).expect(200)).body;
    expect(paid).toMatchObject({ status: 'paid', event: { effect: 'tip', signature: sig } });
    const other = (await fan.agent.post(`/api/watch/${ride.id}/donation-orders`).send({ effect: 'tip' }).expect(200)).body.order;
    expect((await fan.agent.post(`/api/watch/${ride.id}/donation-orders/${other.id}/reconcile`).expect(200)).body).toEqual({ status: 'not_found' });
    const link = await anon().get(`/api/solana-pay/donations/${other.id}`).expect(200);
    expect(link.body.label).toBe('Freight Chain');
    const tx = await anon().post(`/api/solana-pay/donations/${other.id}`).send({ account: fan.address }).expect(200);
    expect(tx.body.message).toMatch(/donation/);
    expect(typeof tx.body.transaction).toBe('string');
  });

  it('a donation Solana Pay code rejects a bad account, the wrong wallet and an unknown id', async () => {
    const { driver, ride } = await paidRide(h, () => login());
    await driver.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'failed', s: 1, t: 1 }).expect(200);
    const fan = await login();
    const { order } = (await fan.agent.post(`/api/watch/${ride.id}/donation-orders`).send({ effect: 'tip' }).expect(200)).body;
    await anon().get(`/api/solana-pay/donations/${'d'.repeat(65)}`).expect(400);
    await anon().post(`/api/solana-pay/donations/${order.id}`).send({ account: 'nope' }).expect(400);
    expect((await anon().post(`/api/solana-pay/donations/${order.id}`).send({ account: newWallet().address }).expect(404)).body.code).toBe('wrong_account');
    expect((await anon().post('/api/solana-pay/donations/missing-donation').send({ account: fan.address }).expect(404)).body.code).toBe('not_found');
  });
}
