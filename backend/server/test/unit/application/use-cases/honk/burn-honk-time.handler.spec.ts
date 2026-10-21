import { BurnHonkTimeCommand, BurnHonkTimeHandler } from '../../../../../src/application/use-cases/honk/burn-honk-time.handler.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { OffHonkChain } from './honk.handlers.spec.js';

describe('BurnHonkTimeHandler', () => {
  it('TEN4 time changes are gone', async () => {
    const ctx = unitContext();
    const handler = new BurnHonkTimeHandler(ctx.liveAccess, ctx.players, ctx.honkRepo, ctx.rideEvents, ctx.transactions, ctx.clock, ctx.entropy, new OffHonkChain());
    await expect(handler.execute(new BurnHonkTimeCommand('fan', 'ride', 'night'))).rejects.toThrow(new NotFoundError('TEN4 time changes were removed', 'not_found'));
  });
});
