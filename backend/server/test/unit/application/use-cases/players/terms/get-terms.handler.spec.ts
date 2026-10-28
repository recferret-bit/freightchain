import { GetTermsHandler } from '../../../../../../src/application/use-cases/players/terms/get-terms.handler.js';
import { GetTermsQuery } from '../../../../../../src/application/use-cases/players/terms/get-terms.query.js';
import { unitContext } from '../../../../../support/unit-context.js';
describe('GetTermsHandler', () => {
  it('reports unaccepted new players and does not invent consent on reads', async () => {
    const ctx = unitContext(); await ctx.sessions.touch('w');
    const handler = new GetTermsHandler(ctx.players);
    expect(await handler.execute(new GetTermsQuery('w'))).toEqual({ required: true, termsVersion: 1, privacyVersion: 1, acceptedTermsVersion: null, acceptedPrivacyVersion: null });
    await expect(handler.execute(new GetTermsQuery('missing'))).rejects.toMatchObject({ statusCode: 404 });
  });
});
