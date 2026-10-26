import { SgtPrismaRepository } from '../../../src/infrastructure/prisma/repositories/sgt.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { at, inTx, testPrisma, wipe } from '../../support/db.js';
describe('SgtPrismaRepository durable device uniqueness', () => {
  let db: PrismaService, repo: SgtPrismaRepository;
  beforeAll(async () => { db = await testPrisma(); repo = new SgtPrismaRepository(db); });
  afterAll(() => db.$disconnect());
  beforeEach(() => wipe(db));
  it('persists across connections and refuses both transferred mint and second award to the same wallet', async () => {
    const row = { mint: 'device', wallet: 'a', slot: 100, at: at(0) };
    expect(await inTx(db, tx => repo.claim(row, tx))).toBe(true);
    const other = await testPrisma();
    try { expect(await new SgtPrismaRepository(other).byWallet('a')).toEqual(row); } finally { await other.$disconnect(); }
    expect(await inTx(db, tx => repo.claim({ ...row, wallet: 'b' }, tx))).toBe(false);
    expect(await inTx(db, tx => repo.claim({ ...row, mint: 'another' }, tx))).toBe(false);
  });
  it('rolls back a reserved mint if its containing award transaction fails', async () => {
    await expect(inTx(db, async tx => { await repo.claim({ mint: 'device', wallet: 'a', slot: 100, at: at(0) }, tx); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await repo.byWallet('a')).toBeNull();
  });
});
