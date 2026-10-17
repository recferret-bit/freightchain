import type { TransactionHandle } from '../../../../src/application/ports/shared/transaction.port.js';
import { unitContext } from '../../../support/unit-context.js';

const CA = { 'cf-ipcountry': 'CA' };
const tx = {} as TransactionHandle;

describe('WeeklyTicketService', () => {
  it('grants one 1h ticket to an 18+ prize-geo wallet and does not stack', async () => {
    const ctx = unitContext();
    const player = await ctx.accept('w');
    const first = await ctx.weekly.offer(player, CA, ctx.now());
    expect(first).toMatchObject({ wallet: 'w', weekId: '2036-10-06', tier: '1h', rideId: null });
    expect(first?.expiresAt.toISOString()).toBe('2036-10-12T12:00:00.000Z');
    await ctx.weekly.offer(player, CA, ctx.now());
    expect(ctx.db.weeklyTickets.size).toBe(1);
  });

  it('refuses a guest, a wallet under 18, and an unknown country', async () => {
    const ctx = unitContext();
    const guest = await ctx.sessions.touch('g', ctx.now(), { guest: true });
    expect(await ctx.weekly.offer(guest, CA, ctx.now())).toBeNull();
    const young = await ctx.player('y');
    expect(await ctx.weekly.offer(young, CA, ctx.now())).toBeNull();
    const adult = await ctx.accept('a');
    expect(await ctx.weekly.offer(adult, {}, ctx.now())).toBeNull();
  });

  it('spends the matching tier once, and refuses offer or claim if geo becomes ineligible after issuance', async () => {
    const ctx = unitContext();
    const player = await ctx.accept('w');
    expect(await ctx.weekly.offer(player, CA, ctx.now())).not.toBeNull();
    expect(await ctx.weekly.offer(player, { 'cf-ipcountry': 'DE' }, ctx.now())).toBeNull();
    expect(await ctx.weekly.claim(player, { 'cf-ipcountry': 'DE' }, '1h', 'ride-blocked', ctx.now(), tx)).toBe(false);
    expect(await ctx.weekly.claim(player, CA, '4h', 'ride-other', ctx.now(), tx)).toBe(false);
    expect(await ctx.weekly.claim(player, CA, '1h', 'ride-1', ctx.now(), tx)).toBe(true);
    expect(await ctx.weekly.claim(player, CA, '1h', 'ride-2', ctx.now(), tx)).toBe(false);
    expect(await ctx.weekly.offer(player, CA, ctx.now())).toBeNull();
  });
});
