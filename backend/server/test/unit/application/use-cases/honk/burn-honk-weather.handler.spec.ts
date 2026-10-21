import { BurnHonkWeatherCommand, BurnHonkWeatherHandler } from '../../../../../src/application/use-cases/honk/burn-honk-weather.handler.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { OffHonkChain } from './honk.handlers.spec.js';

describe('BurnHonkWeatherHandler', () => {
  it('TEN4 weather changes are gone', async () => {
    const ctx = unitContext();
    const handler = new BurnHonkWeatherHandler(ctx.liveAccess, ctx.players, ctx.honkRepo, ctx.rideEvents, ctx.transactions, ctx.clock, ctx.entropy, new OffHonkChain());
    await expect(handler.execute(new BurnHonkWeatherCommand('fan', 'ride', 'snow'))).rejects.toThrow(new NotFoundError('TEN4 weather changes were removed', 'not_found'));
  });
});
