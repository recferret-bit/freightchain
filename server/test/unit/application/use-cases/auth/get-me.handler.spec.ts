import { GetMeHandler } from '../../../../../src/application/use-cases/auth/get-me/get-me.handler.js';
import { GetMeQuery } from '../../../../../src/application/use-cases/auth/get-me/get-me.query.js';
import { DEMO_UNIT_WALLET, unitContext } from '../../../../support/unit-context.js';

describe('GetMeHandler', () => {
  it('returns the profile, applying the lazy daily grant once per UTC day', async () => {
    const ctx = unitContext();
    const handler = new GetMeHandler(ctx.sessions, ctx.rules);
    expect(await handler.execute(new GetMeQuery('w'))).toMatchObject({ wallet: 'w', freeRides: 5, demo: false, createdAt: ctx.clock.ms });
    ctx.clock.advance(86_400);
    expect((await handler.execute(new GetMeQuery('w'))).freeRides).toBe(6);
    expect((await handler.execute(new GetMeQuery('w'))).freeRides).toBe(6);
  });

  it('flags a demo wallet', async () => {
    const ctx = unitContext();
    expect(await new GetMeHandler(ctx.sessions, ctx.rules).execute(new GetMeQuery(DEMO_UNIT_WALLET))).toMatchObject({ demo: true, demoScale: 60 });
  });
});
