import { AcceptTermsHandler } from '../../../../../../src/application/use-cases/players/terms/accept-terms.handler.js';
import { AcceptTermsCommand } from '../../../../../../src/application/use-cases/players/terms/accept-terms.command.js';
import { MemoryTermsAcceptanceRepository } from '../../../../../support/in-memory/memory-terms.js';
import { unitContext } from '../../../../../support/unit-context.js';

describe('AcceptTermsHandler', () => {
  it('records explicit consent once, stamps age and preserves independent loss agreement', async () => {
    const ctx = unitContext();
    await ctx.sessions.touch('w');
    const repo = new MemoryTermsAcceptanceRepository(ctx.db);
    const handler = new AcceptTermsHandler(ctx.players, repo, ctx.transactions, ctx.clock);
    const command = new AcceptTermsCommand('w', 1, 1);
    expect((await handler.execute(command)).required).toBe(false);
    const first = ctx.db.termsAcceptances[0];
    ctx.clock.advance(60);
    await handler.execute(command);
    expect(ctx.db.termsAcceptances).toEqual([first]);
    expect(await ctx.storedPlayer('w')).toMatchObject({ age18At: first?.acceptedAt, lossAt: null, termsVersion: 1, privacyVersion: 1 });
  });
  it('refuses stale/future versions before writing evidence', async () => {
    const ctx = unitContext();
    const insert = vi.fn();
    const handler = new AcceptTermsHandler(ctx.players, { insert }, ctx.transactions, ctx.clock);
    for (const version of [0, 2]) await expect(handler.execute(new AcceptTermsCommand('w', version, 1))).rejects.toMatchObject({ statusCode: 428, errorCode: 'terms_required' });
    expect(insert).not.toHaveBeenCalled();
  });
});
