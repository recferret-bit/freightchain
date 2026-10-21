import { LiveChatService, assertReplayText } from '../../../../src/application/live/live-chat.service.js';
import { byReplayTime } from '../../../../src/domain/live/live.dto.js';
import { BadRequestError, ForbiddenError, TooManyRequestsError } from '../../../../src/domain/shared/errors.js';
import { unitContext, unitRules } from '../../../support/unit-context.js';

describe('LiveChatService', () => {
  const setup = () => {
    const ctx = unitContext(unitRules({ live: { chat: 'all', donations: true, freeDonations: true, effects: 'off' } }));
    const chat = new LiveChatService(ctx.replayAccess, ctx.rideEvents, ctx.rideMutes, ctx.adminActions, ctx.rules, ctx.clock);
    return { ctx, chat };
  };

  const finished = async (ctx: ReturnType<typeof unitContext>, wallet = 'driver') => {
    const ride = await ctx.paidRide(wallet, true);
    ride.finish('failed', 'done', ctx.now());
    await ctx.rides.save(ride);
    return ride;
  };

  it('binds replayT, rejects links, banned words and a sixth line, and hides', async () => {
    const { ctx, chat } = setup();
    const ride = await finished(ctx);
    const early = await chat.post('fan', ride.id, 'later', 0);
    expect(early.replayT).toBe(0);
    await expect(chat.post('fan', ride.id, 'see http://evil.test', 0)).rejects.toThrow(new BadRequestError('links are not allowed in chat', 'chat_link_forbidden'));
    await expect(chat.post('fan', ride.id, 'https://evil.test', 0)).rejects.toMatchObject({ errorCode: 'chat_link_forbidden' });
    await expect(chat.post('fan', ride.id, 'buy.example.com now', 0)).rejects.toMatchObject({ errorCode: 'chat_link_forbidden' });
    await expect(chat.post('fan', ride.id, 'join t.me/freight', 0)).rejects.toMatchObject({ errorCode: 'chat_link_forbidden' });
    await expect(chat.post('fan', ride.id, 'this is a scam', 0)).rejects.toThrow(new BadRequestError('that word is not allowed in chat', 'chat_word_forbidden'));
    await expect(chat.post('fan', ride.id, 'x'.repeat(201), 0)).rejects.toThrow(/at most 200/);
    expect(assertReplayText('x'.repeat(200))).toHaveLength(200);
    ctx.clock.advance(61);
    for (let i = 0; i < 5; i++) await chat.post('fan', ride.id, `n${i}`, 0);
    await expect(chat.post('fan', ride.id, 'sixth', 0)).rejects.toThrow(TooManyRequestsError);
    ctx.clock.advance(61);
    expect(await chat.hide(early.id)).toBe(true);
    expect((await ctx.rideEvents.listAfter(ride.id, 0, 20)).some((e) => e.id === early.id)).toBe(false);
    await ctx.adminActions.insert({ wallet: 'mod', action: 'chat.ban', target: 'fan', detail: {}, requestId: null, at: ctx.now(), afterState: { ban: true } });
    await expect(chat.post('fan', ride.id, 'nope', 0)).rejects.toThrow(new ForbiddenError('this wallet cannot chat', 'chat_banned'));
  });

  it('purges chat older than 90 days and keeps tips', async () => {
    const { ctx, chat } = setup();
    const ride = await finished(ctx);
    const line = await chat.post('fan', ride.id, 'old', 0);
    const row = ctx.db.rideEvents.find((e) => e.id === line.id);
    if (row) row.createdAt = new Date(ctx.now().getTime() - 91 * 24 * 60 * 60 * 1000);
    await ctx.rideEvents.insert((await import('../../../../src/domain/live/ride-event.entity.js')).RideEvent.donation({ rideId: ride.id, wallet: 'fan', effect: 'tip', now: row?.createdAt ?? ctx.now(), lamports: 1_000_000 }));
    expect(await chat.purge()).toBe(1);
    expect(ctx.db.rideEvents.some((e) => e.id === line.id)).toBe(false);
    expect(ctx.db.rideEvents.some((e) => e.kind === 'donation' && e.rideId === ride.id)).toBe(true);
  });

  it('orders chat by replayT', () => {
    expect(byReplayTime([{ id: 2, replayT: 30 }, { id: 1, replayT: 5 }, { id: 3, replayT: null }]).map((e) => e.id)).toEqual([1, 2, 3]);
  });
});
