import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';

const ANON = 'anon_00000000-0000-4000-8000-000000000000';

/** Anonymous-ok product-analytics relay. The same scenarios run with analytics off (default harness) and on (POSTHOG_KEY plus POSTHOG_ENABLED=1, fetch stubbed before boot). A project token alone stays off. */
export function analyticsScenarios(h: () => Harness): void {
  const { anon } = bindClient(h);
  beforeEach(() => h().reset());

  it('a batch containing ride_completed drops the server name and accepts only a client name', async () => {
    const res = await anon().post('/api/telemetry').send({
      anon_id: ANON,
      events: [
        { event: 'ride_completed', properties: { ride_id: 'x' } },
        { event: 'landing_viewed', properties: { surface: 'hero' } },
      ],
    }).expect(200);
    expect(res.body).not.toMatchObject({ status: 401 });
    if (res.body.enabled === false) {
      expect(res.body).toEqual({ enabled: false, accepted: 0, dropped: 0 });
      return;
    }
    expect(res.body.dropped).toBeGreaterThanOrEqual(1);
    expect(res.body.accepted).toBe(1);
  });

  it('the promo funnel: the three browser events pass (with their allowlisted properties only), the four server events cannot be minted from the browser', async () => {
    const res = await anon().post('/api/telemetry').send({
      anon_id: ANON,
      events: [
        { event: 'promo_invite_viewed', properties: { code: 'WELCOME' } },
        { event: 'promo_invite_submitted', properties: { code: 'WELCOME', signed_in: false, from_link: true, signature: 'never' } },
        { event: 'promo_redeem_clicked', properties: { surface: 'promo', prefilled: true } },
        { event: 'promo_redeemed', properties: { code: 'WELCOME', kind: 'free_rides' } },
        { event: 'cosmetic_equipped', properties: { item: 'noir' } },
        { event: 'promo_created', properties: { code: 'X' } },
        { event: 'promo_disabled', properties: { code: 'X' } },
      ],
    }).expect(200);
    if (res.body.enabled === false) {
      expect(res.body).toEqual({ enabled: false, accepted: 0, dropped: 0 });
      return;
    }
    expect(res.body).toMatchObject({ enabled: true, accepted: 3, dropped: 4 });
  });

  it('anonymous with analytics disabled returns enabled false', async () => {
    const res = await anon().post('/api/telemetry').send({
      anon_id: ANON,
      events: [{ event: 'landing_viewed', properties: { surface: 'hero' } }],
    }).expect(200);
    if (res.body.enabled === false) expect(res.body).toEqual({ enabled: false, accepted: 0, dropped: 0 });
  });

  it('an empty events array is accepted 0 dropped 0', async () => {
    const res = await anon().post('/api/telemetry').send({ events: [] }).expect(200);
    expect(res.body).toMatchObject({ accepted: 0, dropped: 0 });
    expect(typeof res.body.enabled).toBe('boolean');
  });

  it('a missing cookie is 200, not 401 and not a DI 500', async () => {
    const res = await anon().post('/api/telemetry').send({ events: [] }).expect(200);
    expect(res.status).toBe(200);
    expect(res.body.code).toBeUndefined();
    expect(res.body).toMatchObject({ accepted: 0, dropped: 0 });
  });
}
