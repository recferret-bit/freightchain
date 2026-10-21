import { AdminActionPrismaRepository } from '../../../src/infrastructure/prisma/repositories/admin-action.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, inTx, testPrisma, wipe } from '../../support/db.js';

describe('AdminActionPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: AdminActionPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new AdminActionPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('appends audit rows (JSON detail round-trips) and lists them newest first', async () => {
    await repo.insert({ wallet: 'A', action: 'verdict.override', target: 'r1', detail: { from: 'flagged', to: 'verified', note: null }, requestId: 'req-1', at: T0 });
    await repo.insert({ wallet: 'A', action: 'verdict.override', target: 'r2', detail: { to: 'rejected' }, requestId: null, at: at(5) });
    const rows = await repo.recent(10);
    expect(rows.map((r) => r.target)).toEqual(['r2', 'r1']);
    expect(rows[1]).toEqual({ wallet: 'A', action: 'verdict.override', target: 'r1', detail: { from: 'flagged', to: 'verified', note: null }, requestId: 'req-1', at: T0, role: null, beforeState: null, afterState: null, ipSubnet: null, sigHash: null });
    expect(await repo.recent(1)).toHaveLength(1);
  });

  it('joins the caller\'s transaction: a rolled-back override leaves no audit row', async () => {
    await expect(inTx(prisma, async (tx) => {
      await repo.insert({ wallet: 'A', action: 'x', target: 't', detail: {}, requestId: null, at: T0 }, tx);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await repo.recent(10)).toEqual([]);
  });

  it('a critical audit and its alert commit or roll back together', async () => {
    await repo.insert({ wallet: 'A', action: 'auth.signin', target: 'A', detail: {}, requestId: null, at: T0, role: 'admin' });
    expect(await prisma.alertOutbox.count({ where: { kind: 'auth.signin' } })).toBe(1);
    await expect(inTx(prisma, async (tx) => {
      await repo.insert({ wallet: 'A', action: 'auth.logout', target: 'A', detail: {}, requestId: null, at: at(1), role: 'admin' }, tx);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await prisma.alertOutbox.count({ where: { kind: 'auth.logout' } })).toBe(0);
    expect(await prisma.adminAction.count({ where: { action: 'auth.logout' } })).toBe(0);
  });
});
