import { ChainCursorPrismaRepository } from '../../../src/infrastructure/prisma/repositories/chain-cursor.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { at, inTx, testPrisma, wipe } from '../../support/db.js';

describe('ChainCursorPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: ChainCursorPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new ChainCursorPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('no cursor yet → null; set inserts, set again moves it (one row per key)', async () => {
    expect(await repo.get('program')).toBeNull();
    await repo.set({ key: 'program', signature: 'sig1', slot: 9_007_199_254, at: at(0) });
    expect(await repo.get('program')).toEqual({ key: 'program', signature: 'sig1', slot: 9_007_199_254, at: at(0) });
    await repo.set({ key: 'program', signature: 'sig2', slot: 10, at: at(5) });
    expect(await repo.get('program')).toEqual({ key: 'program', signature: 'sig2', slot: 10, at: at(5) });
    await repo.set({ key: 'other', signature: null, slot: null, at: at(1) });
    expect(await repo.get('other')).toEqual({ key: 'other', signature: null, slot: null, at: at(1) });
    expect(await prisma.chainCursor.count()).toBe(2);
  });

  it('moves inside a transaction (the watcher commits the cursor with the events it handled)', async () => {
    await expect(inTx(prisma, async (tx) => {
      await repo.set({ key: 'program', signature: 'sigX', slot: 1, at: at(0) }, tx);
      expect((await repo.get('program', tx))?.signature).toBe('sigX');
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await repo.get('program')).toBeNull();
  });
});
