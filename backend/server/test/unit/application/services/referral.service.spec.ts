import { convoyContext } from '../../../support/convoy-context.js';

const fact = (wallet: string, trip = 'free-2c', rideId = 'ride') => ({ wallet, trip, rideId, status: 'completed', verdict: 'verified' });

describe('ReferralService Convoy transition', () => {
  it('mints codes, normalizes binds, refuses invalid/self/competing invites and limits pending slots', async () => {
    const c = convoyContext(), s = c.referral;
    await c.player('host');
    const view = await s.view('host');
    expect(view).toMatchObject({ capacity: 5, available: 5, max: 100, gift: 'convoy', rewards: [], inbound: null });
    expect(view.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    await expect(s.bind('host', view.code)).rejects.toMatchObject({ errorCode: 'own_code' });
    for (let i = 0; i < 6; i++) await c.player(`friend${i}`);
    await expect(s.bind('friend0', 'IIIIIIII')).rejects.toMatchObject({ errorCode: 'bad_code' });
    await expect(s.bind('friend0', 'ZZZZZZZZ')).rejects.toMatchObject({ errorCode: 'unknown_code' });
    for (let i = 0; i < 5; i++) await s.bind(`friend${i}`, ` ${view.code.toLowerCase()} `);
    await s.bind('friend0', view.code);
    await expect(s.bind('friend5', view.code)).rejects.toMatchObject({ errorCode: 'no_slots' });
    expect((await s.view('host')).pending).toBe(5);
  });

  it('EASY cannot activate; MEDIUM grants one usable promo, paints the host, and never increments free balances', async () => {
    const c = convoyContext(), s = c.referral;
    await c.player('host'); await c.player('friend');
    await s.gift('host', 'signal');
    await expect(s.gift('host', 'red')).rejects.toMatchObject({ errorCode: 'bad_gift' });
    await s.bind('friend', (await s.view('host')).code);
    await c.convoy.onVerifiedRide(fact('friend', 'free-1c', 'easy'));
    expect((await s.view('friend')).inbound?.status).toBe('pending');
    await c.convoy.onVerifiedRide(fact('friend'));
    await c.convoy.onVerifiedRide(fact('friend'));
    await s.bind('friend', (await s.view('host')).code);
    expect((await s.view('friend')).inbound).toMatchObject({ status: 'active', promo: 'granted', weeks: 0 });
    expect((await c.repo.ledger()).filter((r) => r.kind === 'promo_1h')).toHaveLength(1);
    expect((await c.storedPlayer('host')).freeRides).toBe(10);
    expect((await c.storedPlayer('friend')).freeRides).toBe(10);
    expect(await c.cosmetics.listEquipped('host')).toMatchObject({ truck_color: 'signal' });
    expect((await s.view('host')).available).toBe(5);
  });

  it('72-hour pending expiration frees slots and allows a new referrer, including existing drivers', async () => {
    const c = convoyContext(), s = c.referral;
    for (const w of ['host', 'other', 'friend']) await c.player(w);
    await c.freeRide('friend', true);
    await s.bind('friend', (await s.view('host')).code);
    c.clock.advance(72 * 3600);
    expect((await s.view('friend')).referredBy).toBe('host');
    c.clock.advance(0.001);
    expect((await s.view('friend')).referredBy).toBeNull();
    await s.bind('friend', (await s.view('other')).code);
    expect((await s.view('friend')).referredBy).toBe('other');
  });

  it('shows a valid historical pending invite and keeps its original 72h deadline on bind', async () => {
    const c = convoyContext(), s = c.referral;
    for (const w of ['host', 'friend']) await c.player(w);
    const old = { referee: 'friend', referrer: 'host', status: 'pending' as const, boundAt: c.now(), expiresAt: new Date(c.now().getTime() + 14 * 86400000), qualifiedAt: null, rideId: null, freeGranted: false, badgeCounted: false };
    await c.legacy.insertReferral(old);
    c.clock.advance(3600);
    expect((await s.view('friend')).inbound?.status).toBe('pending');
    expect((await s.view('host')).pending).toBe(1);
    await s.bind('friend', (await s.view('host')).code);
    expect((await c.repo.getByReferee('friend'))?.expiresAt).toEqual(new Date(old.boundAt.getTime() + 72 * 3600000));
    expect(await c.legacy.referralOf('friend')).toEqual(old);
  });

  it('preserves qualified legacy ownership, records and balances; fresh training starts Convoy without backfill', async () => {
    const c = convoyContext(), s = c.referral;
    for (const w of ['host', 'other', 'friend']) await c.player(w);
    const old = { referee: 'friend', referrer: 'host', status: 'qualified' as const, boundAt: new Date(0), expiresAt: new Date(1), qualifiedAt: new Date(1), rideId: 'historical', freeGranted: true, badgeCounted: true };
    await c.legacy.insertReferral(old);
    await expect(s.bind('friend', (await s.view('other')).code)).rejects.toMatchObject({ errorCode: 'already_bound' });
    expect((await s.view('host')).legacyQualified).toBe(1);
    expect(await c.repo.getByReferee('friend')).toBeNull();
    await c.convoy.onVerifiedRide(fact('friend'));
    expect((await s.view('friend')).inbound?.status).toBe('active');
    expect(await c.legacy.referralOf('friend')).toEqual(old);
    expect((await c.storedPlayer('friend')).freeRides).toBe(10);
  });
});
