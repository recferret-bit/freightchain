import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { PoolRepositoryPort } from '../../src/application/ports/economy/pool.repository.port.js';
import { PromoRepositoryPort } from '../../src/application/ports/economy/promo.repository.port.js';
import { bindClient, newWallet, sign, type Rider } from '../support/client.js';
import { createHarness, type Harness } from '../support/harness.js';
import { aPool } from '../support/pools.js';
import { aPromo, ticketEffect } from '../support/promos.js';

/* AdminGuard and EditorGuard answer a missing session, a player session, and a wallet outside the allowlist with 404 not_found.
   A 403 would confirm the route exists. 403 is only the CSRF header, and only after the session is already privileged. */
const ADMIN = newWallet();
const EDITOR = newWallet();
const SIG = '5'.repeat(88);
const X_ADMIN = 'x-fc-admin';
const X_EDITOR = 'x-fc-editor';

const comparable = (body: Record<string, unknown>): Record<string, unknown> => {
  const { requestId: _requestId, instance: _instance, ...rest } = body;
  return rest;
};

const expectProblem = (res: Response, status: number, code: string): void => {
  expect(res.status).toBe(status);
  expect(String(res.headers['content-type'])).toMatch(/application\/problem\+json/);
  expect(res.body).toMatchObject({ status, code });
};

const sameNotFound = (foreign: Response, missing: Response): void => {
  expectProblem(foreign, 404, 'not_found');
  expectProblem(missing, 404, 'not_found');
  expect(comparable(foreign.body as Record<string, unknown>)).toEqual(comparable(missing.body as Record<string, unknown>));
};

describe('negative matrix', () => {
  let harness: Harness;
  const { anon, login, loginAdmin } = bindClient(() => harness);

  beforeAll(async () => {
    harness = await createHarness('memory', {
      RESPONSE_SCHEMA_CHECK: 'strict', FREE_RIDE_SECONDS: '10', PAYMENT_MODE: 'program', ORDER_TTL_MINUTES: '60', LIVE_FREE_DONATIONS: 'off',
      TICKET_PROGRAM_ID: '9e7phdJzKMNJX8ZnqR8SdxNzafNJjYXeZNsjQze3BSvx', ADMIN_WALLETS: ADMIN.address, EDITOR_WALLETS: EDITOR.address,
    });
  }, 60_000);

  afterAll(() => harness?.close());
  beforeEach(async () => { await harness.reset(); });

  const loginEditor = async (): Promise<Rider> => {
    const agent = request.agent(harness.server());
    const { body } = await agent.post('/api/editor/auth/nonce').set(X_EDITOR, '1').send({ wallet: EDITOR.address }).expect(200);
    await agent.post('/api/editor/auth/verify').set(X_EDITOR, '1').send({ wallet: EDITOR.address, signature: sign(EDITOR.kp, body.message as string) }).expect(200);
    return { agent, ...EDITOR };
  };

  /** A started ticket ride: the pledge and the paid donation both need one. */
  const ticketRide = async (): Promise<{ driver: Rider; rideId: string }> => {
    const now = new Date(harness.clock.ms);
    await harness.app.get(PoolRepositoryPort, { strict: false }).upsert(aPool({ id: 1, status: 'active' }, now));
    await harness.app.get(PromoRepositoryPort, { strict: false }).insert(aPromo(now, { code: 'ONE', maxRedemptions: null, effect: ticketEffect({ credits: 1 }) }));
    const driver = await login();
    await driver.agent.post('/api/promo/redeem').send({ code: 'ONE' }).expect(200);
    const ride = (await driver.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body as { id: string };
    await driver.agent.post(`/api/rides/${ride.id}/start`).expect(200);
    return { driver, rideId: ride.id };
  };

  describe('matrix A — auth, validation, .strict()', () => {
    it('player routes without a session are 401 unauthorized', async () => {
      for (const hit of [
        () => anon().get('/api/me'),
        () => anon().get('/api/garage'),
        () => anon().post('/api/rides').send({ tier: 'free' }),
        () => anon().get('/api/tickets/pending'),
        () => anon().post('/api/pledges').send({ rideId: randomUUID(), lamportsPerKm: '1000', targetKm: 1 }),
      ]) {
        const res = await hit();
        expectProblem(res, 401, 'unauthorized');
        expect(res.body.detail).toBe('not signed in');
      }
    });

    it('admin and editor routes without a session are 404 not_found, not 401', async () => {
      for (const hit of [() => anon().get('/api/admin/overview'), () => anon().get('/api/admin/settings'), () => anon().get('/api/editor/me'), () => anon().get('/api/editor/entities')]) {
        const res = await hit();
        expectProblem(res, 404, 'not_found');
      }
    });

    it('a signed-in non-admin on an admin route is 404 not_found, the same body as no cookie', async () => {
      const rider = await login();
      const foreign = await rider.agent.get('/api/admin/overview');
      const absent = await anon().get('/api/admin/overview');
      sameNotFound(foreign, absent);
      expectProblem(await rider.agent.get('/api/admin/rides'), 404, 'not_found');
      expectProblem(await rider.agent.post('/api/admin/settings').set(X_ADMIN, '1').send({ key: 'k', value: 1, signature: 'sig' }), 404, 'not_found');
      expectProblem(await rider.agent.get('/api/editor/me'), 404, 'not_found');
    });

    it('a privileged session that omits the CSRF header is 403 forbidden', async () => {
      const admin = await loginAdmin(ADMIN);
      expectProblem(await admin.agent.post('/api/admin/settings').send({ key: 'k', value: 1, signature: 'sig' }), 403, 'forbidden');
      const editor = await loginEditor();
      expectProblem(await editor.agent.post('/api/editor/jobs').send({ prompt: 'a truck' }), 403, 'forbidden');
    });

    it('a bad body is 400 validation_error and not a 5xx', async () => {
      const rider = await login();
      const admin = await loginAdmin(ADMIN);
      const editor = await loginEditor();
      const cases = [
        anon().post('/api/auth/nonce').send({ wallet: 1 }),
        anon().post('/api/admin/auth/nonce').set(X_ADMIN, '1').send({ wallet: 1 }),
        rider.agent.post('/api/rides').send({ tier: 'nope' }),
        rider.agent.post('/api/tickets').send({ poolId: 'nope', qty: 1 }),
        rider.agent.post('/api/pledges').send({ rideId: 'not-a-uuid', lamportsPerKm: '1000', targetKm: 1 }),
        admin.agent.post('/api/admin/settings').set(X_ADMIN, '1').send({ key: 1, value: 'no', signature: 2 }),
        editor.agent.post('/api/editor/jobs').set(X_EDITOR, '1').send({ prompt: 1 }),
      ];
      for (const pending of cases) {
        const res = await pending;
        expectProblem(res, 400, 'validation_error');
        expect(res.status).toBeLessThan(500);
      }
    });

    it('an unknown field on a strict money, admin, editor, or auth body is 400', async () => {
      const rider = await login();
      const admin = await loginAdmin(ADMIN);
      const editor = await loginEditor();
      const wallet = newWallet().address;
      const cases = [
        anon().post('/api/auth/nonce').send({ wallet, __unexpectedField: 1 }),
        anon().post('/api/admin/auth/nonce').set(X_ADMIN, '1').send({ wallet: ADMIN.address, __unexpectedField: 1 }),
        anon().post('/api/editor/auth/nonce').set(X_EDITOR, '1').send({ wallet: EDITOR.address, __unexpectedField: 1 }),
        rider.agent.post('/api/rides').send({ tier: 'free', __unexpectedField: 1 }),
        rider.agent.post('/api/tickets').send({ poolId: 1, qty: 1, __unexpectedField: 1 }),
        rider.agent.post('/api/pledges').send({ rideId: randomUUID(), lamportsPerKm: '1000', targetKm: 1, __unexpectedField: 1 }),
        rider.agent.post('/api/promo/redeem').send({ code: 'ONE', __unexpectedField: 1 }),
        rider.agent.post('/api/referrals/gift').send({ item: 'nope', __unexpectedField: 1 }),
        admin.agent.post('/api/admin/settings').set(X_ADMIN, '1').send({ key: 'k', value: 1, signature: 'sig', __unexpectedField: 1 }),
        editor.agent.post('/api/editor/jobs').set(X_EDITOR, '1').send({ prompt: 'a truck', __unexpectedField: 1 }),
      ];
      for (const pending of cases) {
        const res = await pending;
        expectProblem(res, 400, 'validation_error');
        expect(JSON.stringify(res.body)).toContain('__unexpectedField');
      }
    });

    it('telemetry and client-error still accept an unknown field', async () => {
      const telemetry = await anon().post('/api/telemetry').send({ events: [{ event: 'play' }], __unexpectedField: 1 });
      expect(telemetry.status).toBe(200);
      const crash = await anon().post('/api/client-error').send({ surface: 'game', name: 'Error', value: 'boom', frames: [], __unexpectedField: 1 });
      expect(crash.status).toBe(200);
    });
  });

  describe('matrix B — someone else\'s :id is the same 404 as a missing id', () => {
    it('ride replays', async () => {
      const owner = await login();
      const other = await login();
      const ride = (await owner.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body as { id: string };
      sameNotFound(await other.agent.get(`/api/rides/${ride.id}/replays`), await other.agent.get('/api/rides/missing-ride/replays'));
    });

    it('pledge confirm', async () => {
      const { rideId } = await ticketRide();
      const sponsor = await login();
      const intruder = await login();
      const created = (await sponsor.agent.post('/api/pledges').send({ rideId, lamportsPerKm: '1000000', targetKm: 1 }).expect(200)).body as { pledge: { id: string } };
      sameNotFound(
        await intruder.agent.post(`/api/pledges/${created.pledge.id}/confirm`).send({ signature: SIG }),
        await intruder.agent.post('/api/pledges/missing-pledge/confirm').send({ signature: SIG }),
      );
    });

    it('ticket order read and confirm', async () => {
      const now = new Date(harness.clock.ms);
      await harness.app.get(PoolRepositoryPort, { strict: false }).upsert(aPool({ id: 1, status: 'active' }, now));
      const owner = await login();
      const other = await login();
      const order = (await owner.agent.post('/api/tickets').send({ poolId: 1, qty: 1 }).expect(200)).body as { id: string };
      const missing = randomUUID();
      sameNotFound(await other.agent.get(`/api/tickets/orders/${order.id}`), await other.agent.get(`/api/tickets/orders/${missing}`));
      sameNotFound(
        await other.agent.post(`/api/tickets/orders/${order.id}/confirm`).send({ signature: SIG }),
        await other.agent.post(`/api/tickets/orders/${missing}/confirm`).send({ signature: SIG }),
      );
    });

    it('donation order confirm', async () => {
      const { rideId } = await ticketRide();
      const fan = await login();
      const other = await login();
      const created = (await fan.agent.post(`/api/watch/${rideId}/donation-orders`).send({ effect: 'tip' }).expect(200)).body as { order: { id: string } };
      sameNotFound(
        await other.agent.post(`/api/watch/${rideId}/donation-orders/${created.order.id}/confirm`).send({ signature: SIG }),
        await other.agent.post(`/api/watch/${rideId}/donation-orders/${randomUUID()}/confirm`).send({ signature: SIG }),
      );
    });
  });
});
