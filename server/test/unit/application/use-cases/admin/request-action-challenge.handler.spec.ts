import { RequestActionChallengeHandler } from '../../../../../src/application/use-cases/admin/request-action-challenge/request-action-challenge.handler.js';
import { RequestActionChallengeCommand } from '../../../../../src/application/use-cases/admin/request-action-challenge/request-action-challenge.command.js';
import { ADMIN_UNIT_WALLET, unitContext, unitRules } from '../../../../support/unit-context.js';

describe('RequestActionChallengeHandler', () => {
  it('the text for exactly one change, naming the admin host, the admin, the ride, the decision and the (quoted) note; stored under the action key', async () => {
    const ctx = unitContext(unitRules({ adminDomain: 'admin.freight.test' }));
    const h = new RequestActionChallengeHandler(ctx.proofs, ctx.clock);
    const { message } = await h.execute(new RequestActionChallengeCommand(ADMIN_UNIT_WALLET, { action: 'override', rideId: 'r-1', decision: 'rejected', note: 'two lines\nNonce: fake' }));
    expect(message.split('\n').slice(0, 8)).toEqual([
      'admin.freight.test – Freight Chain admin action', '', 'Action: set the verdict to REJECTED', 'Ride: r-1', 'Note: "two lines\\nNonce: fake"', '', `Wallet: ${ADMIN_UNIT_WALLET}`, `Nonce: ${message.split('\n')[7]!.slice(7)}`,
    ]);
    expect(ctx.db.challenges.get(`action:${ADMIN_UNIT_WALLET}`)?.message).toBe(message);
    const rejudge = await h.execute(new RequestActionChallengeCommand(ADMIN_UNIT_WALLET, { action: 'rejudge', rideId: 'r-2' }));
    expect(rejudge.message).toContain('Action: RE-JUDGE at the current rules (replaces any decision)\nRide: r-2\n');
    expect(ctx.db.challenges.get(`action:${ADMIN_UNIT_WALLET}`)?.message).toBe(rejudge.message);   // one pending per admin: the newer one
  });

  it('a new promo code is validated BEFORE the wallet is asked to sign: what the entity would refuse is a 400 now and no challenge is stored', async () => {
    const ctx = unitContext();
    const h = new RequestActionChallengeHandler(ctx.proofs, ctx.clock);
    const promo = { code: 'HELLO', effect: { kind: 'free_rides' as const, count: 3 }, description: null, maxRedemptions: null, perWallet: 1, startsAt: null, expiresAt: null, note: null };
    const ask = (over = {}) => h.execute(new RequestActionChallengeCommand(ADMIN_UNIT_WALLET, { action: 'promo_create', promo: { ...promo, ...over } }));
    await expect(ask({ description: 'x'.repeat(201) })).rejects.toMatchObject({ errorCode: 'bad_promo_code' });
    await expect(ask({ expiresAt: new Date(ctx.clock.ms - 1) })).rejects.toMatchObject({ errorCode: 'bad_promo_code' });
    await expect(ask({ effect: { kind: 'cosmetic', slot: 'wheel', item: 'classic' } })).rejects.toMatchObject({ errorCode: 'visuals_are_honk' });
    await expect(ask({ effect: { kind: 'cosmetic', slot: 'wheel', item: 'gold' } })).rejects.toMatchObject({ errorCode: 'visuals_are_honk' });
    expect(ctx.db.challenges.get(`action:${ADMIN_UNIT_WALLET}`)).toBeUndefined();
    expect((await ask()).message).toContain('Action: CREATE promo code HELLO');
  });

  it('a setting is checked before a signature is asked for; a free-ride adjust names the wallet and the delta', async () => {
    const ctx = unitContext();
    const h = new RequestActionChallengeHandler(ctx.proofs, ctx.clock);
    await expect(h.execute(new RequestActionChallengeCommand(ADMIN_UNIT_WALLET, { action: 'setting_update', key: 'nope', value: 1 }))).rejects.toMatchObject({ errorCode: 'bad_setting' });
    await expect(h.execute(new RequestActionChallengeCommand(ADMIN_UNIT_WALLET, { action: 'setting_update', key: 'free_on_signup', value: 100_001 }))).rejects.toMatchObject({ errorCode: 'bad_setting' });
    expect(ctx.db.challenges.get(`action:${ADMIN_UNIT_WALLET}`)).toBeUndefined();
    const ok = await h.execute(new RequestActionChallengeCommand(ADMIN_UNIT_WALLET, { action: 'setting_update', key: 'free_on_signup', value: 7 }));
    expect(ok.message).toContain('Action: SET setting free_on_signup\nValue: 7\n');
    const rides = await h.execute(new RequestActionChallengeCommand(ADMIN_UNIT_WALLET, { action: 'free_rides_adjust', wallet: 'W', delta: -2 }));
    expect(rides.message).toContain('Action: ADJUST free rides by -2\nPlayer: W\n');
  });
});
