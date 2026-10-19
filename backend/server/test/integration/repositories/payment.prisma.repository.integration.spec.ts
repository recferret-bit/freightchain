import { PaymentPrismaRepository } from '../../../src/infrastructure/prisma/repositories/payment.prisma.repository.js';
import { Payment } from '../../../src/domain/economy/payment.entity.js';
import { ConflictError } from '../../../src/domain/shared/errors.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, orderAt, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('PaymentPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: PaymentPrismaRepository;
  const rides: string[] = [];
  beforeAll(async () => { prisma = await testPrisma(); repo = new PaymentPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await wipe(prisma);
    await seedPlayer(prisma, 'w');
    await prisma.round.create({ data: { id: 1, startsAt: T0, endsAt: new Date(T0.getTime() + 1e9), carry: 0n, status: 'open' } });
    rides.length = 0;
    for (let i = 0; i < 2; i++) {
      const o = orderAt('w');
      await prisma.ride.create({ data: { id: o.id, wallet: 'w', tier: '1h', seed: 1, minSeconds: 1, completeDist: 1, status: 'awaiting_payment', createdAt: T0 } });
      rides.push(o.id);
    }
  });
  const pay = (signature: string, rideId: string, lamports = 50_000_000) => new Payment({ signature, rideId, wallet: 'w', lamports, usd: 5, roundId: 1, at: T0 });

  it('insert and find it by signature and by ride', async () => {
    await repo.insert(pay('sig-1', rides[0]!, 5_000_000_000));
    expect(await repo.findBySignature('sig-1')).toMatchObject({ rideId: rides[0], lamports: 5_000_000_000, roundId: 1, at: T0 });
    expect((await repo.findByRide(rides[0]!))?.signature).toBe('sig-1');
    expect(await repo.findBySignature('nope')).toBeNull();
  });

  it('a signature pays ONE ride, and a ride is paid ONCE (ConflictError)', async () => {
    await repo.insert(pay('sig-1', rides[0]!));
    await expect(repo.insert(pay('sig-1', rides[1]!))).rejects.toThrow(new ConflictError('this transaction already paid for a ride'));
    await expect(repo.insert(pay('sig-2', rides[0]!))).rejects.toBeInstanceOf(ConflictError);
  });

  it('totalsOf: what a wallet has spent', async () => {
    await repo.insert(pay('a', rides[0]!, 10));
    await repo.insert(pay('b', rides[1]!, 32));
    expect(await repo.totalsOf('w')).toEqual({ lamports: 42, count: 2 });
    expect(await repo.totalsOf('nobody')).toEqual({ lamports: 0, count: 0 });
  });
});
