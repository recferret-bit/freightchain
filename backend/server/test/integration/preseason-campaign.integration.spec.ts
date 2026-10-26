import { createHarness, type Harness } from '../support/harness.js';
import { bindClient } from '../support/client.js';
import { AirdropService } from '../../src/application/airdrop/airdrop.service.js';
import { AirdropRepositoryPort } from '../../src/application/airdrop/airdrop.repository.port.js';
import { XAccountPort } from '../../src/application/airdrop/x-account.port.js';
import { SettingsRepositoryPort } from '../../src/application/ports/settings/settings.repository.port.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { PRESEASON_PROMO_CODE } from '../../src/domain/settings/preseason-event.js';

describe('Pre-season concurrent claims and X budget (PostgreSQL)', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness('postgres'); });
  afterAll(() => h.close());
  beforeEach(() => h.reset());
  const { login } = bindClient(() => h);

  it('parallel event claims and message replays commit exactly one grant and consent stamp', async () => {
    const rider = await login(), svc = h.app.get(AirdropService), repo = h.app.get(AirdropRepositoryPort);
    const settings = h.app.get(SettingsRepositoryPort), db = h.app.get(PrismaService), now = h.clock.now().getTime() / 1000;
    for (const [key, value] of Object.entries({ event_mode_enabled: 1, event_week_start_utc: now, event_last_start_utc: now + 86400, event_week_end_utc: now + 100000 })) await settings.upsert(key, value);
    await svc.recordVerifiedRide(rider.address, 'free-2c');
    await repo.claimTelegram(rider.address, '42');
    await repo.save({ ...(await repo.get(rider.address))!, telegramMember: true, telegramGroupMember: true, xAgeOk: true, xFollowersOk: true, xFollows: true, xQuoteOk: true });
    await Promise.all(Array.from({ length: 8 }, () => svc.recordTelegramActivity('42', h.clock.now())));
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => svc.claimAttempt(rider.address, true)));
    expect(outcomes.every(r => r.event.attemptGranted && r.event.rulesAccepted)).toBe(true);
    expect(await db.promoRideGrant.count({ where: { wallet: rider.address, code: PRESEASON_PROMO_CODE } })).toBe(1);
    expect((await db.airdropClaim.findUnique({ where: { wallet_campaign: { wallet: rider.address, campaign: 'preseason' } } }))?.attemptGrantedAt).toEqual(h.clock.now());
    expect((await repo.get(rider.address))?.points).toBe(0);
  });

  it('competing wallets cannot exceed the last X budget cent and cached retries do not call the provider', async () => {
    const a = await login(), b = await login(), svc = h.app.get(AirdropService), settings = h.app.get(SettingsRepositoryPort), provider = h.app.get(XAccountPort), db = h.app.get(PrismaService);
    await settings.upsert('airdrop_x_budget_cents', 1);
    await settings.upsert('airdrop_x_check_cost_cents', 1);
    for (const wallet of [a.address, b.address]) await svc.recordVerifiedRide(wallet, 'free-2c');
    const lookup = vi.spyOn(provider, 'lookup').mockImplementation(async handle => ({ userId: handle === 'ada' ? '42' : '43', handle, createdAt: new Date('2020-01-01'), followers: 10, followsOfficial: true }));
    const quote = vi.spyOn(provider, 'quote').mockImplementation(async post => ({ userId: post === '1' ? '42' : '43', text: `@FreightChainSol FC-${post === '1' ? a.address : b.address}` }));
    try {
      const outcomes = await Promise.allSettled([svc.verifyX(a.address, 'ada', '1'), svc.verifyX(b.address, 'bob', '2')]);
      expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter(o => o.status === 'rejected').map(o => (o as PromiseRejectedResult).reason.errorCode)).toEqual(['x_budget_exhausted']);
      const won = outcomes[0]?.status === 'fulfilled' ? [a.address, 'ada', '1'] : [b.address, 'bob', '2'];
      await Promise.all(Array.from({ length: 8 }, () => svc.verifyX(won[0]!, won[1]!, won[2]!)));
      expect(lookup).toHaveBeenCalledTimes(1); expect(quote).toHaveBeenCalledTimes(1);
      expect((await db.campaignProviderBudget.findUnique({ where: { campaign: 'preseason' } }))?.reservedCents).toBe(1);
      h.clock.advance(601);
      await expect(svc.verifyX(won[0]!, won[1]!, won[2]!)).rejects.toMatchObject({ errorCode: 'x_budget_exhausted' });
      expect(lookup).toHaveBeenCalledTimes(1);
    } finally { lookup.mockRestore(); quote.mockRestore(); }
  });
});
