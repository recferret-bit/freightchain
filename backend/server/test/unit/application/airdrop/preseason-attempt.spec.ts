import { AirdropService } from '../../../../src/application/airdrop/airdrop.service.js';
import { emptyAirdrop, campaignTasksComplete } from '../../../../src/application/airdrop/airdrop-rules.js';
import { MemoryAirdropRepository } from '../../../../src/infrastructure/social/memory-airdrop.repository.js';
import type { TelegramMembershipPort } from '../../../../src/application/airdrop/telegram.port.js';
import type { XAccountPort } from '../../../../src/application/airdrop/x-account.port.js';
import type { TurnstilePort } from '../../../../src/application/airdrop/turnstile.port.js';
import { unitContext } from '../../../support/unit-context.js';
import { PRESEASON_PROMO_CODE } from '../../../../src/domain/settings/preseason-event.js';

it('issues one event attempt only after enabled dates, consent, completed tasks and authenticated group activity', async () => {
  const ctx = unitContext(), repo = new MemoryAirdropRepository();
  await ctx.accept('ada');
  const player = await ctx.storedPlayer('ada'); player.acceptTerms(1, 1, ctx.now()); await ctx.players.save(player);
  const svc = new AirdropService(repo, {} as TelegramMembershipPort, {} as XAccountPort, { required: false } as TurnstilePort, ctx.players, ctx.transactions, ctx.clock, ctx.settings, ctx.promos);
  await repo.claimTelegram('ada', '42');
  await repo.save({ ...emptyAirdrop('ada'), telegramUserId: '42', rideOk: true, telegramMember: true, telegramGroupMember: true, xAgeOk: true, xFollowersOk: true, xFollows: true, xQuoteOk: true });
  expect(campaignTasksComplete(await repo.get('ada'))).toBe(true);
  await expect(svc.claimAttempt('ada', true)).rejects.toMatchObject({ errorCode: 'event_closed' });
  const now = Math.floor(ctx.now().getTime() / 1000);
  for (const [key, value] of Object.entries({ event_mode_enabled: 1, event_week_start_utc: now, event_last_start_utc: now + 86400, event_week_end_utc: now + 100000 })) await ctx.settingsRepo.upsert(key, value);
  await expect(svc.claimAttempt('ada', false)).rejects.toMatchObject({ errorCode: 'event_consent_required' });
  await expect(svc.claimAttempt('ada', true)).rejects.toMatchObject({ errorCode: 'airdrop_incomplete' });
  await svc.recordTelegramActivity('unbound', ctx.now());
  expect((await repo.get('ada'))?.telegramActiveAt).toBeNull();
  await svc.recordTelegramActivity('42', ctx.now());
  const claimed = await svc.claimAttempt('ada', true);
  expect(claimed).toMatchObject({ points: 0, completedTasks: 3, event: { attemptGranted: true, rulesAccepted: true }, claimed: false });
  ctx.clock.advance(1);
  await svc.claimAttempt('ada', true);
  const grants = await ctx.promos.listUnspent('ada');
  expect(grants).toHaveLength(1);
  expect(grants[0]).toMatchObject({ code: PRESEASON_PROMO_CODE, n: 1, tier: '1h' });
});

it('fails closed on unspecified X cost, retains failed-call reservations, and enforces the durable cooldown', async () => {
  const ctx = unitContext(), repo = new MemoryAirdropRepository(), lookup = vi.fn(async () => { throw new Error('fixture provider unavailable'); });
  await ctx.accept('ada');
  const player = await ctx.storedPlayer('ada'); player.acceptTerms(1, 1, ctx.now()); await ctx.players.save(player);
  const svc = new AirdropService(repo, {} as TelegramMembershipPort, { lookup } as unknown as XAccountPort, { required: false } as TurnstilePort, ctx.players, ctx.transactions, ctx.clock, ctx.settings, ctx.promos);
  await svc.recordVerifiedRide('ada', 'free-2c');
  await expect(svc.verifyX('ada', 'ada', '1')).rejects.toMatchObject({ errorCode: 'x_budget_unconfigured' });
  expect(lookup).not.toHaveBeenCalled();
  await ctx.settingsRepo.upsert('airdrop_x_check_cost_cents', 1);
  await ctx.settingsRepo.upsert('airdrop_x_budget_cents', 1);
  await expect(svc.verifyX('ada', 'ada', '1')).rejects.toThrow('fixture provider unavailable');
  expect((await repo.get('ada'))?.xAttemptAt).toEqual(ctx.now());
  await expect(svc.verifyX('ada', 'ada', '1')).rejects.toMatchObject({ errorCode: 'x_verification_pending' });
  ctx.clock.advance(601);
  await expect(svc.verifyX('ada', 'ada', '1')).rejects.toMatchObject({ errorCode: 'x_budget_exhausted' });
  expect(lookup).toHaveBeenCalledTimes(1);
});

it('only the reserved event ride can close as an expired event', async () => {
  const { Ride } = await import('../../../../src/domain/rides/ride.entity.js');
  const input = { id: 'event', wallet: 'ada', tier: '1h' as const, seed: 1, minSeconds: 3600, timeScale: 1, now: new Date('2036-10-08') };
  const event = Ride.createPromo({ ...input, promoCode: PRESEASON_PROMO_CODE });
  event.closeExpiredEvent(input.now);
  expect(event.status).toBe('cancelled');
  expect(() => Ride.createPromo({ ...input, promoCode: 'ORDINARY' }).closeExpiredEvent(input.now)).toThrow('only an event entry');
});
