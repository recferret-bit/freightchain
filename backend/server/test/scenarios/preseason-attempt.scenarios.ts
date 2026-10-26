import { RideRepositoryPort } from '../../src/application/ports/rides/ride.repository.port.js';
import { aPromo } from '../support/promos.js';
import { TransactionPort } from '../../src/application/ports/shared/transaction.port.js';
import { AirdropService } from '../../src/application/airdrop/airdrop.service.js';
import { AirdropRepositoryPort } from '../../src/application/airdrop/airdrop.repository.port.js';
import { PromoRepositoryPort } from '../../src/application/ports/economy/promo.repository.port.js';
import { SettingsRepositoryPort } from '../../src/application/ports/settings/settings.repository.port.js';
import { PRESEASON_PROMO_CODE } from '../../src/domain/settings/preseason-event.js';
import { EnvService } from '../../src/infrastructure/config/env.service.js';
import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';

export function preseasonAttemptScenarios(h: () => Harness): void {
  const { login, anon } = bindClient(h);
  beforeEach(() => h().reset());
  it('Pre-season claim refuses a disabled event and creates no attempt', async () => {
    const rider = await login();
    await h().app.get(AirdropService).recordVerifiedRide(rider.address, 'free-2c');
    await h().app.get(SettingsRepositoryPort).upsert('event_mode_enabled', 0);
    expect((await rider.agent.post('/api/airdrop/preseason/claim-attempt').send({ acceptedRules: true }).expect(409)).body.code).toBe('event_closed');
    expect(await h().app.get(PromoRepositoryPort).listUnspent(rider.address)).toEqual([]);
  });
  it('Telegram activity webhook is unavailable without a configured secret', async () => {
    const absent = vi.spyOn(h().app.get(EnvService), 'telegramWebhookSecret', 'get').mockReturnValue(null);
    try { await anon().post('/api/airdrop/telegram/webhook').send({ update_id: 11 }).expect(404); }
    finally { absent.mockRestore(); }
  });
  it('Pre-season grants one usable event ride after authenticated group participation, consent and task completion', async () => {
    const rider = await login(undefined, { offer: false }), other = await login();
    const svc = h().app.get(AirdropService), repo = h().app.get(AirdropRepositoryPort), settings = h().app.get(SettingsRepositoryPort), env = h().app.get(EnvService);
    const now = Math.floor(h().clock.now().getTime() / 1000);
    for (const [key, value] of Object.entries({ event_mode_enabled: 1, event_week_start_utc: now, event_last_start_utc: now + 86400, event_week_end_utc: now + 100000 })) await settings.upsert(key, value);
    const prepare = async (wallet: string, id: string) => {
      await svc.recordVerifiedRide(wallet, 'free-2c');
      await repo.claimTelegram(wallet, id);
      await repo.save({ ...(await repo.get(wallet))!, telegramMember: true, telegramGroupMember: true, xAgeOk: true, xFollowersOk: true, xFollows: true, xQuoteOk: true });
    };
    await prepare(rider.address, '42');
    const claim = () => rider.agent.post('/api/airdrop/preseason/claim-attempt').send({ acceptedRules: true });
    expect((await claim().expect(409)).body.code).toBe('event_consent_required');
    await rider.agent.put('/api/profile/agreements').send({ age18: true, loss: false }).expect(200);
    expect((await claim().expect(409)).body.code).toBe('airdrop_incomplete');
    const secret = 'fixture-secret-never-used-on-telegram';
    const spies = [vi.spyOn(env, 'telegramWebhookSecret', 'get').mockReturnValue(secret), vi.spyOn(env, 'telegramGroupId', 'get').mockReturnValue('-10042')];
    const body = { update_id: 10, message: { date: now, from: { id: 42, is_bot: false }, chat: { id: -10042, type: 'supergroup' }, text: 'Hello everyone I am a new truck driver' } };
    try {
      await anon().post('/api/airdrop/telegram/webhook').send(body).expect(401);
      await anon().post('/api/airdrop/telegram/webhook').set('x-telegram-bot-api-secret-token', secret).send({ ...body, message: { ...body.message, text: 'hi' } }).expect(200);
      expect((await claim().expect(409)).body.code).toBe('airdrop_incomplete');
      for (let i = 0; i < 2; i++) await anon().post('/api/airdrop/telegram/webhook').set('x-telegram-bot-api-secret-token', secret).send(body).expect(200);
      expect((await claim().expect(200)).body).toMatchObject({ points: 0, completedTasks: 3, event: { attemptGranted: true, rulesAccepted: true } });
      await claim().expect(200);
      expect((await h().app.get(PromoRepositoryPort).listUnspent(rider.address)).filter(g => g.code === PRESEASON_PROMO_CODE)).toHaveLength(1);
      await rider.agent.post('/api/promo/redeem').send({ code: PRESEASON_PROMO_CODE }).expect(409);
      const promos = h().app.get(PromoRepositoryPort);
      await promos.insert(aPromo(h().clock.now(), { code: 'OLDER-ORDINARY', effect: { kind: 'ride', tier: '1h' } }));
      await h().app.get(TransactionPort).run(tx => promos.insertGrant({ code: 'OLDER-ORDINARY', wallet: rider.address, n: 1, tier: '1h', rideId: null, createdAt: new Date(h().clock.now().getTime() - 1000) }, tx));
      const ride = (await rider.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
      expect(ride).toMatchObject({ promo: true, minSeconds: 3600, timeScale: 1 });
      expect(await promos.listUnspent(rider.address)).toMatchObject([{ code: 'OLDER-ORDINARY' }]);
      expect((await rider.agent.post(`/api/rides/${ride.id}/start`).send({ ranked: false }).expect(409)).body.code).toBe('event_ranked_required');
      await rider.agent.post(`/api/rides/${ride.id}/start`).set('cf-ipcountry', 'CA').send({ ranked: true }).expect(200);
      await prepare(other.address, '43');
      await svc.recordTelegramActivity('43', h().clock.now());
      await other.agent.put('/api/profile/agreements').send({ age18: true, loss: false }).expect(200);
      await other.agent.post('/api/airdrop/preseason/claim-attempt').send({ acceptedRules: true }).expect(200);
      const sameCourse = (await other.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
      expect(sameCourse.seed).toBe(ride.seed);
      expect(sameCourse.completeDist).toBe(ride.completeDist);
      h().clock.advance(86401);
      const renewed = await login({ kp: other.kp, address: other.address });
      expect((await renewed.agent.post('/api/rides').send({ tier: '1h' }).expect(409)).body.code).toBe('event_closed');
      expect((await renewed.agent.post('/api/rides').send({ tier: 'free', level: 1 }).expect(200)).body.tier).toBe('free');
      expect((await h().app.get(RideRepositoryPort).findById(sameCourse.id))?.status).toBe('cancelled');
    } finally { spies.forEach(s => s.mockRestore()); }
  });
}
