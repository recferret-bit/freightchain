import { RoundPrismaRepository } from '../../../src/infrastructure/prisma/repositories/round.prisma.repository.js';
import { Round, RoundStatus } from '../../../src/domain/economy/round.entity.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, inTx, orderAt, seedPlayer, sleep, testPrisma, wipe } from '../../support/db.js';

describe('RoundPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: RoundPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new RoundPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('insert / findContaining / findLatest; a second round for the same week is null (unique start)', async () => {
    const r1 = await repo.insert(Round.open(T0, 5));
    expect(r1?.snapshot()).toMatchObject({ id: 1, carry: 5, status: RoundStatus.Open });
    expect(await repo.insert(Round.open(at(60), 9))).toBeNull();
    expect((await repo.findContaining(at(60)))?.id).toBe(1);
    const r2 = await repo.insert(Round.open(at(7 * 86_400), 0));
    expect((await repo.findLatest())?.id).toBe(r2?.id);
    expect(await repo.findContaining(at(-30 * 86_400))).toBeNull();
  });

  it('save closes; entriesOf sums the payments (BigInt) of that round only', async () => {
    const round = (await repo.insert(Round.open(T0, 0))) as Round;
    await seedPlayer(prisma, 'w');
    for (const lamports of [3_000_000_000, 4_000_000_000]) { // > 2^31 each: the sum needs BigInt
      const order = orderAt('w', T0, lamports);
      await prisma.ride.create({ data: { id: order.id, wallet: 'w', tier: '1h', seed: 1, minSeconds: 1, completeDist: 1, status: 'created', createdAt: T0, lamports: BigInt(lamports) } });
      await prisma.payment.create({ data: { signature: order.id, rideId: order.id, wallet: 'w', lamports: BigInt(lamports), usd: 5, roundId: round.id, at: T0 } });
    }
    expect(await repo.entriesOf(round.id)).toEqual({ lamports: 7_000_000_000, count: 2 });
    expect(await repo.entriesOf(999)).toEqual({ lamports: 0, count: 0 });
    round.close();
    await repo.save(round);
    expect((await repo.findLatest())?.status).toBe(RoundStatus.Closed);
  });

  it('lockOpen: says whether the round is open, and holds it until the transaction ends', async () => {
    const round = (await repo.insert(Round.open(T0, 0))) as Round;
    expect(await inTx(prisma, (tx) => repo.lockOpen(round.id, tx))).toBe(true);
    const order: string[] = [];
    const settle = inTx(prisma, async (tx) => { await repo.lockOpen(round.id, tx); order.push('settle locked'); await sleep(300); order.push('settle done'); });
    await sleep(50);
    const close = inTx(prisma, async (tx) => { await repo.lockOpen(round.id, tx); order.push('close locked'); round.close(); await repo.save(round, tx); });
    await Promise.all([settle, close]);
    expect(order).toEqual(['settle locked', 'settle done', 'close locked']);
    expect(await inTx(prisma, (tx) => repo.lockOpen(round.id, tx))).toBe(false); // closed now
    expect(await inTx(prisma, (tx) => repo.lockOpen(12345, tx))).toBe(false);
  });
});
