import { AirdropPrismaRepository } from '../../../src/infrastructure/prisma/repositories/airdrop.prisma.repository.js';
import { emptyAirdrop } from '../../../src/application/airdrop/airdrop-rules.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { FakeClock } from '../../support/fake-clock.js';
import { at, inTx, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('AirdropPrismaRepository', () => {
  let prisma: PrismaService;
  let repo: AirdropPrismaRepository;
  const clock = new FakeClock();
  beforeAll(async () => { prisma = await testPrisma(); repo = new AirdropPrismaRepository(prisma, clock); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => { await wipe(prisma); await seedPlayer(prisma, 'ada'); await seedPlayer(prisma, 'bob'); });

  it('persists the gates, social owners, 48h hold and final claim across independent connections', async () => {
    await repo.save({ ...emptyAirdrop('ada'), rideOk: true });
    expect(await repo.claimTelegram('ada', 'tg')).toBe('ok');
    expect(await repo.claimX('ada', 'x')).toBe('ok');
    const row = { ...(await repo.get('ada'))!, telegramMember: true, telegramGroupMember: true, telegramActiveAt: at(1), rulesAcceptedAt: at(2), attemptGrantedAt: at(2), xAttemptAt: at(3), xVerifiedAt: at(4), xPostId: '123', points: 12, xHandle: 'ada_x', xAgeOk: true, xFollowersOk: true, xFollows: true, xQuoteOk: true, turnstileOk: true, heldAt: at(1), claimedAt: at(172801) };
    await repo.save(row);
    const other = await testPrisma();
    try {
      const restarted = new AirdropPrismaRepository(other, clock);
      expect(await restarted.get('ada')).toEqual(row);
      expect(await restarted.findTelegramOwner('tg')).toBe('ada');
      expect(await restarted.findTelegramOwner('missing')).toBeNull();
      expect(await restarted.claimTelegram('bob', 'tg')).toBe('taken');
      expect(await restarted.claimX('bob', 'x')).toBe('taken');
      expect(await restarted.claimTelegram('ada', 'different')).toBe('changed');
      expect(await restarted.claimX('ada', 'x')).toBe('ok');
    } finally { await other.$disconnect(); }
  });

  it('serializes competing social claims without aborting the losing transaction', async () => {
    const results = await Promise.all(['ada', 'bob'].map((wallet) => inTx(prisma, async (tx) => {
      const result = await repo.claimTelegram(wallet, 'same', tx);
      await prisma.$queryRaw`SELECT 1`;
      await repo.save({ ...(await repo.get(wallet, tx) ?? emptyAirdrop(wallet)), rideOk: true }, tx);
      return result;
    })));
    expect(results.sort()).toEqual(['ok', 'taken']);
    expect(await prisma.airdropClaim.count({ where: { telegramUserId: 'same' } })).toBe(1);
    expect(await prisma.airdropClaim.count({ where: { rideVerifiedAt: { not: null } } })).toBe(2);
  });

  it('rolls back a social reservation so another wallet can bind it', async () => {
    await expect(inTx(prisma, async (tx) => {
      expect(await repo.claimX('ada', 'shared', tx)).toBe('ok');
      await repo.save({ ...(await repo.get('ada', tx))!, heldAt: at(0) }, tx);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await repo.get('ada')).toBeNull();
    expect(await repo.claimX('bob', 'shared')).toBe('ok');
  });
});
