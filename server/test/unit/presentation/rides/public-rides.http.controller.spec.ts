import { PublicRidesHttpController } from '../../../../src/presentation/rides/public-rides.http.controller.js';
import { GetPublicRideQuery } from '../../../../src/application/use-cases/rides/get-public-ride/get-public-ride.query.js';
import { rideIdParamsSchema } from '../../../../src/presentation/common/dto/common.dto.js';
import { busMock } from '../../../support/bus.js';

describe('PublicRidesHttpController', () => {
  const dummyDto = {
    id: 'ride-1',
    route: 'brenner',
    tier: 'free',
    status: 'completed',
    reason: null,
    km: 12.5,
    driveSeconds: 150,
    finishedAt: 1700000000000,
    round: 1,
    rank: null,
    paymentSignature: null,
    seed: 12345,
    seedSlot: null,
    wallet: 'Gsea...Cqbn',
    fullWallet: 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn',
    tipsLamports: 0,
    pledgesLamports: 0,
    verdict: null,
  };

  it('dispatches GetPublicRideQuery and returns the public ride DTO', async () => {
    const queries = busMock(dummyDto);
    const controller = new PublicRidesHttpController(queries.bus);

    const result = await controller.getPublic({ id: 'ride-1' });
    expect(queries.last()).toEqual(new GetPublicRideQuery('ride-1'));
    expect(result).toEqual(dummyDto);
  });

  describe('params schema', () => {
    it('accepts valid ride ids', () => {
      expect(rideIdParamsSchema.safeParse({ id: 'ride-1' }).success).toBe(true);
      expect(rideIdParamsSchema.safeParse({ id: '00000000-0000-4000-8000-000000000001' }).success).toBe(true);
    });

    it('rejects empty or overly long ids', () => {
      expect(rideIdParamsSchema.safeParse({ id: '' }).success).toBe(false);
      expect(rideIdParamsSchema.safeParse({ id: 'x'.repeat(65) }).success).toBe(false);
    });
  });
});
