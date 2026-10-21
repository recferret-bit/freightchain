import { GetRoadPlanHandler } from '../../../../../src/application/use-cases/live/get-road-plan/get-road-plan.handler.js';
import { GetRoadPlanQuery } from '../../../../../src/application/use-cases/live/get-road-plan/get-road-plan.query.js';
import { RoadPlan, ROAD_PLAN_VERSION } from '../../../../../src/domain/road/road-plan.js';
import { CHUNK_LEN } from '../../../../../src/domain/road/road-rules.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetRoadPlanHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const handler = new GetRoadPlanHandler(ctx.replayAccess);
    return { ctx, road: (id: string, from: number, to: number) => handler.execute(new GetRoadPlanQuery(id, from, to)) };
  };

  it('a started ride: the holes the server rebuilt from ITS seed, chunk-aligned – the same list the verdict judges on', async () => {
    const { ctx, road } = setup();
    const ride = await ctx.paidRide('driver', true);
    ride.finish('failed', 'done', ctx.now()); await ctx.rides.save(ride);
    const plan = await road(ride.id, 10, 6000);
    expect(plan).toMatchObject({ rideId: ride.id, seed: ride.seed, version: ROAD_PLAN_VERSION, from: 0, to: Math.ceil(6000 / CHUNK_LEN) * CHUNK_LEN, chunk: CHUNK_LEN });
    expect(plan.holes).toEqual(RoadPlan.forSeed(ride.seed, ride.trip).holesBetween(plan.from, plan.to));
    for (const h of plan.holes) expect(h.s >= plan.from && h.s < plan.to + CHUNK_LEN && h.id === `h${h.ci}` && h.type === 'sinkhole').toBe(true);
  });

  it('nothing before the ride started (the seed is not handed out early) and nothing for an unknown ride', async () => {
    const { ctx, road } = setup();
    const ride = await ctx.freeRide('driver', false);
    await expect(road(ride.id, 0, 6000)).rejects.toBeInstanceOf(NotFoundError);
    await expect(road('no-such-ride', 0, 6000)).rejects.toBeInstanceOf(NotFoundError);
  });
});
