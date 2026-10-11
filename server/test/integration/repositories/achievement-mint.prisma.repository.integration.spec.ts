import { AchievementMintPrismaRepository } from '../../../src/infrastructure/prisma/repositories/achievement-mint.prisma.repository.js';
import { AchievementPrismaRepository } from '../../../src/infrastructure/prisma/repositories/achievement.prisma.repository.js';
import { AchievementUnlock } from '../../../src/domain/achievements/achievement-unlock.entity.js';
import { MAX_MINT_ATTEMPTS } from '../../../src/domain/achievements/achievement-mint.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('AchievementMintPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: AchievementMintPrismaRepository, unlocks: AchievementPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new AchievementMintPrismaRepository(prisma); unlocks = new AchievementPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await wipe(prisma);
    await seedPlayer(prisma, 'w');
    await unlocks.insertAll([new AchievementUnlock('w', 'first-mile', at(10), 'r1'), new AchievementUnlock('w', 'century', at(20), null), new AchievementUnlock('w', 'top-20', at(5), null)]);
  });
  const row = async (id = 'first-mile') => (await repo.listByWallet('w')).find((m) => m.achievementId === id);

  it('listUnqueued: old enough, an allowed id, no mint row yet – oldest first', async () => {
    expect((await repo.listUnqueued(at(15), ['first-mile', 'century'], 10)).map((u) => u.achievementId)).toEqual(['first-mile']);
    expect((await repo.listUnqueued(at(99), ['first-mile', 'century'], 10)).map((u) => u.achievementId)).toEqual(['first-mile', 'century']);
    expect(await repo.listUnqueued(at(99), [], 10)).toEqual([]);
    expect((await repo.listUnqueued(at(99), ['first-mile', 'century'], 1)).map((u) => u.achievementId)).toEqual(['first-mile']);
  });

  it('enqueue: one row per unlock (planned, or skipped with the reason); an existing row is left alone', async () => {
    expect(await repo.enqueue([{ wallet: 'w', achievementId: 'first-mile', skip: null }, { wallet: 'w', achievementId: 'century', skip: 'demo-wallet' }], T0)).toBe(2);
    expect(await row('first-mile')).toMatchObject({ status: 'planned', attempts: 0, error: null });
    expect(await row('century')).toMatchObject({ status: 'skipped', error: 'demo-wallet' });
    expect(await repo.enqueue([{ wallet: 'w', achievementId: 'first-mile', skip: 'demo-wallet' }], at(50))).toBe(0);
    expect((await row('first-mile'))?.status).toBe('planned');
    expect(await repo.listUnqueued(at(99), ['first-mile', 'century'], 10)).toEqual([]); // queued unlocks are not offered again
    expect(await repo.enqueue([], T0)).toBe(0);
  });

  it('claimSent is conditional: one of two concurrent claims wins; markMinted needs the claimed signature', async () => {
    await repo.enqueue([{ wallet: 'w', achievementId: 'first-mile', skip: null }], T0);
    const claims = await Promise.all([repo.claimSent('w', 'first-mile', 'sigA', 11, at(1)), repo.claimSent('w', 'first-mile', 'sigB', 12, at(1))]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const won = claims[0] ? 'sigA' : 'sigB';
    expect(await row()).toMatchObject({ status: 'sent', signature: won, attempts: 1 });
    expect((await repo.listWork(10)).map((m) => m.status)).toEqual(['sent']);
    expect(await repo.markMinted('w', 'first-mile', 'other', 'asset', at(2))).toBe(false);
    expect(await repo.markMinted('w', 'first-mile', won, 'asset1', at(2))).toBe(true);
    expect(await row()).toMatchObject({ status: 'minted', assetId: 'asset1' });
    expect(await repo.listWork(10)).toEqual([]);
    expect(await repo.claimSent('w', 'first-mile', 'sigC', 13, at(3))).toBe(false); // a minted badge is never claimed again
  });

  it('release: sent → planned with the signature cleared (a new transaction may reuse the unique index); failed once the attempts ran out; retryFailed puts it back', async () => {
    await repo.enqueue([{ wallet: 'w', achievementId: 'first-mile', skip: null }], T0);
    for (let n = 1; n <= MAX_MINT_ATTEMPTS; n++) {
      expect(await repo.claimSent('w', 'first-mile', `sig${n}`, 10 + n, at(n))).toBe(true);
      expect(await repo.release('w', 'first-mile', 'wrong', 'x', at(n))).toBe(false);
      expect(await repo.release('w', 'first-mile', `sig${n}`, 'expired', at(n))).toBe(true);
      expect(await row()).toMatchObject({ status: n < MAX_MINT_ATTEMPTS ? 'planned' : 'failed', signature: null, lastValidBlockHeight: null, attempts: n, error: 'expired' });
    }
    expect(await repo.retryFailed(at(60))).toBe(1);
    expect(await row()).toMatchObject({ status: 'planned', attempts: 0 });
  });

  it('markSkipped and noteError act on planned rows only; a mint row goes with its unlock (cascade) – the unlock itself is never removed by the mint', async () => {
    await repo.enqueue([{ wallet: 'w', achievementId: 'first-mile', skip: null }], T0);
    await repo.noteError('w', 'first-mile', 'simulation failed', at(1));
    expect((await row())?.error).toBe('simulation failed');
    expect(await repo.markSkipped('w', 'first-mile', 'no-longer-earned', at(2))).toBe(true);
    expect(await repo.markSkipped('w', 'first-mile', 'again', at(3))).toBe(false);
    expect(await row()).toMatchObject({ status: 'skipped', error: 'no-longer-earned' });
    expect((await unlocks.listByWallet('w')).map((u) => u.achievementId).sort()).toEqual(['century', 'first-mile', 'top-20']);
  });
});
