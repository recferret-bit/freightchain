import { AckEffectHandler } from '../../../../../src/application/use-cases/live/ack-effect/ack-effect.handler.js';
import { AckEffectCommand } from '../../../../../src/application/use-cases/live/ack-effect/ack-effect.command.js';
import { RideEvent } from '../../../../../src/domain/live/ride-event.entity.js';
import type { EffectId } from '../../../../../src/domain/live/live-rules.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('AckEffectHandler', () => {
  const setup = async () => {
    const ctx = unitContext();
    const handler = new AckEffectHandler(ctx.lookup, ctx.rideEvents, ctx.players, ctx.transactions, ctx.clock);
    const ride = await ctx.freeRide('driver', true);
    const donate = async (effect: EffectId, rideId = ride.id) => (await ctx.rideEvents.insert(RideEvent.donation({ rideId, wallet: 'fan', effect, now: ctx.now() })))!;
    const ack = (wallet: string, eventId: number, report: { t: number; s: number; lat: number | null; missed?: boolean } = { t: 30, s: 1500, lat: 2.4 }, rideId = ride.id) => handler.execute(new AckEffectCommand(wallet, rideId, eventId, report));
    return { ctx, ride, donate, ack };
  };

  it('the owner stamps an applied effect; a re-sent ack answers with the first stamp', async () => {
    const { ctx, donate, ack } = await setup();
    const hole = await donate('sinkhole');
    expect((await ack('driver', hole.id!)).applied).toEqual({ t: 30, s: 1500, lat: 2.4, placed: true });
    ctx.clock.advance(5);
    expect((await ack('driver', hole.id!, { t: 99, s: 9, lat: 0 })).applied).toEqual({ t: 30, s: 1500, lat: 2.4, placed: true });
    expect((await ctx.rideEvents.findById(hole.id!))?.applied?.at.getTime()).toBe(ctx.clock.ms - 5000);
  });

  it('an obstacle the driver\'s game could not place is stamped missed (placed:false), so spectators stop waiting', async () => {
    const { donate, ack } = await setup();
    const hole = await donate('potholes');
    expect((await ack('driver', hole.id!, { t: 3, s: 120, lat: null, missed: true } as never)).applied).toEqual({ t: 3, s: 120, lat: null, placed: false });
  });

  it('someone else’s ride or another ride’s event is not found; a tip has nothing to apply; an ended ride is 409', async () => {
    const { ctx, ride, donate, ack } = await setup();
    const night = await donate('night');
    await expect(ack('intruder', night.id!)).rejects.toBeInstanceOf(NotFoundError);
    const other = await ctx.freeRide('driver2', true);
    const elsewhere = await donate('night', other.id);
    await expect(ack('driver', elsewhere.id!)).rejects.toThrow(new NotFoundError('event not found'));
    await expect(ack('driver', 9999)).rejects.toBeInstanceOf(NotFoundError);
    ctx.clock.advance(20);
    const tip = await donate('tip');
    await expect(ack('driver', tip.id!)).rejects.toBeInstanceOf(BadRequestError);
    ride.finish('shift', null, ctx.now()); await ctx.rides.save(ride);
    await expect(ack('driver', night.id!)).rejects.toBeInstanceOf(ConflictError);
  });
});
