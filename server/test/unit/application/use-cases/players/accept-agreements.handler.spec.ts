import { AcceptAgreementsHandler } from '../../../../../src/application/use-cases/players/accept-agreements/accept-agreements.handler.js';
import { AcceptAgreementsCommand } from '../../../../../src/application/use-cases/players/accept-agreements/accept-agreements.command.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('AcceptAgreementsHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const analytics = new RecordingAnalytics();
    const handler = new AcceptAgreementsHandler(ctx.sessions, ctx.players, ctx.transactions, ctx.clock, analytics);
    const put = (age18: boolean, loss: boolean, wallet = 'w') => handler.execute(new AcceptAgreementsCommand(wallet, age18, loss));
    return { ctx, analytics, put };
  };

  it('starts off; one box does not emit; both-on emits once; a repeat keeps the stamp; off clears; on again after the clock moves is a new event', async () => {
    const { ctx, analytics, put } = setup();
    const age = await put(true, false);
    expect(age).toMatchObject({ age18: true, loss: false, lossAt: null, age18At: ctx.now().getTime() });
    expect(analytics.named('agreements_accepted')).toHaveLength(0);
    const both = await put(true, true);
    expect(both.age18At).toBe(age.age18At); // the first stamp sticks
    expect(both.lossAt).toBe(ctx.now().getTime());
    expect(analytics.named('agreements_accepted')).toEqual([expect.objectContaining({
      distinctId: 'w', uuid: null, timestamp: ctx.now(),
      dedupeKey: `player:w:agreements:${both.age18At}:${both.lossAt}`,
      properties: { age18_at: both.age18At, loss_at: both.lossAt, source: 'server' },
    })]);
    expect((await put(true, true)).age18At).toBe(both.age18At);
    expect(analytics.named('agreements_accepted')).toHaveLength(1);
    expect(await put(false, false)).toMatchObject({ age18: false, loss: false, age18At: null, lossAt: null });
    expect((await ctx.storedPlayer('w')).paidPlayAllowed).toBe(false);
    ctx.clock.advance(1);
    const again = await put(true, true);
    expect(again.age18At).toBe(ctx.now().getTime());
    expect(again.age18At).not.toBe(both.age18At);
    expect(analytics.named('agreements_accepted')).toHaveLength(2);
    expect(analytics.named('agreements_accepted')[1]?.dedupeKey).not.toBe(analytics.named('agreements_accepted')[0]?.dedupeKey);
  });
});
