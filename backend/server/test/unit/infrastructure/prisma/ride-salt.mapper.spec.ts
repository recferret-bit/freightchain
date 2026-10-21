import { Ride } from '../../../../src/domain/rides/ride.entity.js';
import { RideMapper } from '../../../../src/infrastructure/prisma/mappers/ride.mapper.js';

describe('RideMapper salt commitments', () => {
  it('writes the shadow commits and reads them back', () => {
    const now = new Date('2026-10-20T12:00:00.000Z');
    const ride = Ride.createFree({ id: 'ride-salt', wallet: 'w', seed: 7, minSeconds: 10, now });
    ride.start(now);
    ride.stampSessionKey('c2FsdA==');
    ride.stampSalts('a'.repeat(64), 'b'.repeat(64));
    const written = RideMapper.mutableData(ride.snapshot());
    expect(written.trafficSaltCommit).toBe('a'.repeat(64));
    expect(written.holeSaltCommit).toBe('b'.repeat(64));
    expect(written.sessionKey).toBe('c2FsdA==');
    const row = {
      ...written, id: ride.id, wallet: ride.wallet, tier: ride.tier, seed: ride.seed, createdAt: now,
      lamports: 0n, timeScale: 1, priceUsd: 0, solUsd: null, quoteExpiresAt: null, poolId: null, version: 1,
      seedCommitment: null, blockhash: null, slot: null, loadout: null, challenges: null,
    };
    const back = RideMapper.toDomain(row as never);
    expect(back.trafficSaltCommit).toBe(written.trafficSaltCommit);
    expect(back.holeSaltCommit).toBe(written.holeSaltCommit);
    expect(back.sessionKey).toBe('c2FsdA==');
    expect(back.pauseCount).toBe(0);
  });
});
