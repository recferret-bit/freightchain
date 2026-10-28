import { VerdictStatus } from '../../../../src/domain/verdict/verdict.dto.js';
import { PRESEASON_EVENT_ID } from '../../../../src/domain/prize/event-settlement.js';
import { eventUnit } from '../../../support/event-fixtures.js';
import { unitContext } from '../../../support/unit-context.js';

describe('EventSettlementService', () => {
  it('ranks verified event rides, keeps RU on the board without a prize, and prices the rest from the table', async () => {
    const ctx = unitContext(), ev = eventUnit(ctx);
    await ev.schedule();
    await ev.rideOf('a', 9000); await ev.rideOf('ru', 9900, { country: 'RU' }); await ev.rideOf('b', 8000); await ev.rideOf('flag', 9999, { verdict: VerdictStatus.Flagged });
    const v = await ev.view.view(PRESEASON_EVENT_ID);
    expect(v.settlement.rows.map((r) => [r.wallet, r.rank, r.place, r.amountCents])).toEqual([['ru', 1, null, 0], ['a', 2, 1, 10000], ['b', 3, 2, 7000]]);
    expect(v.candidates.map((c) => [c.wallet, c.geoAccess])).toEqual([['ru', 'play_only_no_prizes'], ['a', 'eligible'], ['b', 'eligible']]);
    expect(v).toMatchObject({ phase: 'pending', tableIsDefault: true });
  });

  it('phase follows the review end and the lock; no schedule is always pending', async () => {
    const ctx = unitContext(), ev = eventUnit(ctx);
    expect((await ev.view.view(PRESEASON_EVENT_ID)).phase).toBe('pending');
    await ev.schedule();
    ctx.clock.advance(1001);
    expect((await ev.view.view(PRESEASON_EVENT_ID)).phase).toBe('preliminary');
    await ev.repo.lock(PRESEASON_EVENT_ID, 'adm', ctx.now(), [], undefined as never);
    expect((await ev.view.view(PRESEASON_EVENT_ID)).phase).toBe('final');
    await ctx.settingsRepo.upsert('event_review_end_utc', 0);
    expect((await ev.view.view(PRESEASON_EVENT_ID)).schedule).toBeNull();
  });

  it('flags shared sign-in subnets between listed wallets and applies review flags', async () => {
    const ctx = unitContext(), ev = eventUnit(ctx);
    await ev.schedule();
    for (const [w, bps] of [['a', 9000], ['b', 8000], ['c', 7000]] as const) await ev.rideOf(w, bps);
    for (const [w, ip] of [['a', 'deadbeefcafe0001'], ['b', 'deadbeefcafe0001'], ['c', 'other-subnet-hmac']] as const) await ctx.signIns.insert({ wallet: w, at: ctx.now(), ipHash: ip });
    await ev.repo.saveReview(PRESEASON_EVENT_ID, { wallet: 'c', disqualified: true, prizeEligibleOverride: null, note: 'dup', sanctionsCheckedAt: null, sanctionsClean: null, sanctionsRef: null, updatedBy: 'adm', updatedAt: ctx.now() }, undefined as never);
    await ev.repo.saveReview(PRESEASON_EVENT_ID, { wallet: 'b', disqualified: false, prizeEligibleOverride: false, note: null, sanctionsCheckedAt: ctx.now(), sanctionsClean: true, sanctionsRef: 'x', updatedBy: 'adm', updatedAt: ctx.now() }, undefined as never);
    const { candidates } = await ev.view.view(PRESEASON_EVENT_ID);
    const by = Object.fromEntries(candidates.map((c) => [c.wallet, c]));
    expect(by['a']).toMatchObject({ ipOverlaps: ['b'], ipPrefixHmac: ['deadbeef'], place: 1, amountCents: 10000 });
    expect(by['b']).toMatchObject({ ipOverlaps: ['a'], prizeEligible: false, amountCents: 0, sanctionsClean: true, sanctionsFresh: true });
    expect(by['c']).toMatchObject({ disqualified: true, rank: 0, amountCents: 0 });
  });

  it('an unset or inverted event window lists nobody', async () => {
    const ctx = unitContext(), ev = eventUnit(ctx);
    await ev.rideOf('a', 9000);
    expect((await ev.view.view(PRESEASON_EVENT_ID)).candidates).toEqual([]);
  });

  it('shows at most 35 ranked candidates', async () => {
    const ctx = unitContext(), ev = eventUnit(ctx);
    await ev.schedule();
    for (let i = 0; i < 40; i++) await ev.rideOf(`w${i}`, 9000 - i);
    const v = await ev.view.view(PRESEASON_EVENT_ID);
    expect(v.candidates).toHaveLength(35);
    expect(v.settlement.rows).toHaveLength(40);
  });
});
