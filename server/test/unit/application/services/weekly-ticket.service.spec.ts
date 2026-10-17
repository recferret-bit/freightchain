import type { TransactionHandle } from '../../../../src/application/ports/shared/transaction.port.js';
import { unitContext } from '../../../support/unit-context.js';

const CA = { 'cf-ipcountry': 'CA' };
const tx = {} as TransactionHandle;

describe('WeeklyTicketService', () => {
  it('grants one 1h ticket for the 7-day slot and does not stack', async () => {
    const ctx = unitContext();
    const player = await ctx.accept('w');
    const first = await ctx.weekly.offer(player, CA, ctx.now());
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ wallet: 'w', weekId: '2036-10-06', tier: '1h', rideId: null });
    expect(first[0]?.expiresAt.toISOString()).toBe('2036-10-12T12:00:00.000Z');
    await ctx.weekly.offer(player, CA, ctx.now());
    expect(ctx.db.weeklyTickets.size).toBe(1);
  });

  it('leaves 4h and 8h off until their flags are on', async () => {
    const ctx = unitContext();
    const player = await ctx.accept('w');
    expect((await ctx.weekly.offer(player, CA, ctx.now())).map((row) => row.tier)).toEqual(['1h']);
    await ctx.settingsRepo.upsert('weekly_ticket_4h_enabled', 1);
    expect((await ctx.weekly.offer(player, CA, ctx.now())).map((row) => row.tier)).toEqual(['1h', '4h']);
  });

  it('refuses a guest, a wallet under 18, and an unknown country', async () => {
    const ctx = unitContext();
    const guest = await ctx.sessions.touch('g', ctx.now(), { guest: true });
    expect(await ctx.weekly.offer(guest, CA, ctx.now())).toEqual([]);
    const young = await ctx.player('y');
    expect(await ctx.weekly.offer(young, CA, ctx.now())).toEqual([]);
    const adult = await ctx.accept('a');
    expect(await ctx.weekly.offer(adult, {}, ctx.now())).toEqual([]);
  });

  it('spends the matching tier once', async () => {
    const ctx = unitContext();
    const player = await ctx.accept('w');
    expect(await ctx.weekly.claim(player, CA, '4h', 'ride-other', ctx.now(), tx)).toBe(false);
    expect(await ctx.weekly.claim(player, CA, '1h', 'ride-1', ctx.now(), tx)).toBe(true);
    expect(await ctx.weekly.claim(player, CA, '1h', 'ride-2', ctx.now(), tx)).toBe(false);
    expect(await ctx.weekly.offer(player, CA, ctx.now())).toEqual([]);
  });

  it('a 1-day interval expires the unused grant at the next UTC midnight and then issues the next one', async () => {
    const ctx = unitContext();
    await ctx.settingsRepo.upsert('weekly_ticket_1h_days', 1);
    const player = await ctx.accept('w');
    const first = await ctx.weekly.offer(player, CA, ctx.now());
    expect(first[0]?.expiresAt.toISOString()).toBe('2036-10-09T00:00:00.000Z');
    ctx.clock.advance(12 * 3600);
    const second = await ctx.weekly.offer(player, CA, ctx.now());
    expect(second).toHaveLength(1);
    expect(second[0]?.expiresAt.toISOString()).toBe('2036-10-10T00:00:00.000Z');
    expect(ctx.db.weeklyTickets.size).toBe(2);
  });

  it('does not stack a shorter interval on top of an unspent grant', async () => {
    const ctx = unitContext();
    const player = await ctx.accept('w');
    await ctx.weekly.offer(player, CA, ctx.now());
    await ctx.settingsRepo.upsert('weekly_ticket_1h_days', 1);
    ctx.clock.advance(24 * 3600);
    await ctx.weekly.offer(player, CA, ctx.now());
    expect(ctx.db.weeklyTickets.size).toBe(1);
  });

  it('issues nothing once Sunday 12:00 UTC has passed', async () => {
    const ctx = unitContext();
    const player = await ctx.accept('w');
    ctx.clock.advance(4 * 24 * 3600);
    expect(ctx.now().toISOString()).toBe('2036-10-12T12:00:00.000Z');
    expect(await ctx.weekly.offer(player, CA, ctx.now())).toEqual([]);
    expect(ctx.db.weeklyTickets.size).toBe(0);
  });
});
