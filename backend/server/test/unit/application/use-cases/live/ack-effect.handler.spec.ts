import { AckEffectHandler } from '../../../../../src/application/use-cases/live/ack-effect/ack-effect.handler.js';
import { AckEffectCommand } from '../../../../../src/application/use-cases/live/ack-effect/ack-effect.command.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('AckEffectHandler', () => {
  it('gameplay effect stamps are gone', async () => {
    const ctx = unitContext();
    const handler = new AckEffectHandler(ctx.lookup, ctx.rideEvents, ctx.players, ctx.transactions, ctx.clock);
    await expect(handler.execute(new AckEffectCommand('driver', 'ride', 1, { t: 1, s: 1, lat: 0 }))).rejects.toMatchObject({ errorCode: 'not_found', statusCode: 404 });
  });
});
