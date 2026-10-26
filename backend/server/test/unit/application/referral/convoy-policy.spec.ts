import { convoyContext } from '../../../support/convoy-context.js';
import { emptyAirdrop } from '../../../../src/application/airdrop/airdrop-rules.js';
import { convoyPolicy } from '../../../../src/application/referral/convoy-policy.js';

const fact = (wallet: string, rideId: string, trip = 'free-2c') => ({ wallet, rideId, trip, status: 'completed', verdict: 'verified', tier: trip === '1h' ? '1h' : 'free', ranked: trip === '1h' });

describe('Convoy runtime policy and immutable activation promises', () => {
  it('uses configured pending capacity and TTL without moving saved deadlines after an edit', async () => {
    const c = convoyContext();
    for (const w of ['host', 'a', 'b']) await c.player(w);
    await c.settingsRepo.upsert('referral_pending_base', 1);
    await c.settingsRepo.upsert('referral_pending_ttl_hours', 2);
    await c.convoy.bind('a', 'host');
    const expiresAt = new Date(c.now().getTime() + 2 * 3600000);
    expect((await c.repo.getByReferee('a'))?.expiresAt).toEqual(expiresAt);
    await expect(c.convoy.bind('b', 'host')).rejects.toMatchObject({ errorCode: 'no_slots' });
    await c.settingsRepo.upsert('referral_pending_ttl_hours', 1);
    await c.convoy.bind('a', 'host');
    expect((await c.repo.getByReferee('a'))?.expiresAt).toEqual(expiresAt);
    c.clock.advance(2 * 3600 + 1);
    await c.convoy.bind('b', 'host');
    expect((await c.repo.getByReferee('b'))?.expiresAt).toEqual(new Date(c.now().getTime() + 3600000));
  });

  it('snapshots amounts, weeks, trust and ranking on activation, while global gift caps remain live', async () => {
    const c = convoyContext();
    for (const w of ['host', 'a', 'b']) await c.player(w);
    for (const [key, value] of Object.entries({ referral_qualify_window_days: 20, referral_ten4_m1_amount: 75, referral_ten4_m1_weeks: 1, referral_min_trust_referrer: 75, referral_referee_promo_ranked: 1, referral_referee_promo_global_week: 0 })) await c.settingsRepo.upsert(key, value);
    await c.convoy.bind('a', 'host');
    await c.convoy.onVerifiedRide(fact('a', 'activate'));
    const activated = (await c.repo.getByReferee('a'))!;
    expect(activated.policy).toMatchObject({ m1Amount: 75, m1Weeks: 1, minTrust: 75, promoRanked: 1 });
    expect(activated.qualifyExpiresAt).toEqual(new Date(c.now().getTime() + 20 * 86400000));
    expect((await c.convoy.account('a')).inbound?.promo).toBe('cap_reached');
    await c.settingsRepo.upsert('referral_ten4_m1_amount', 200);
    await c.settingsRepo.upsert('referral_min_trust_referrer', 50);
    await c.settingsRepo.upsert('referral_referee_promo_ranked', 0);
    await c.campaign.save({ ...emptyAirdrop('a'), rideOk: true, telegramUserId: 'tg', telegramMember: true, telegramGroupMember: true, xUserId: 'x', xAgeOk: true, xFollowersOk: true, xFollows: true, xQuoteOk: true });
    await c.convoy.onVerifiedRide(fact('a', 'paid', '1h'));
    expect(await c.repo.findLedger('convoy:m1:a')).toBeNull();
    const host = await c.storedPlayer('host'); host.setTrustScore(75); await c.players.save(host);
    await c.convoy.refreshMilestones('a');
    expect(await c.repo.findLedger('convoy:m1:a')).toMatchObject({ amount: 75, minTrust: 75, chainState: 'held' });
    expect((await c.convoy.account('host')).invites[0]?.policy).toEqual(activated.policy);
    await c.settingsRepo.upsert('referral_referee_promo_global_week', 1);
    await c.convoy.bind('b', 'host');
    expect((await c.convoy.onVerifiedRide(fact('b', 'new'))).gift.granted).toBe(true);
    expect((await c.repo.getByReferee('b'))?.policy).toMatchObject({ m1Amount: 200, minTrust: 50, promoRanked: 0 });
    expect(convoyPolicy().m1Amount).toBe(100);
  });
});
