import { EntityPrismaRepository } from '../../../src/infrastructure/prisma/repositories/entity.prisma.repository.js';
import { TransactionPrismaAdapter } from '../../../src/infrastructure/prisma/transaction.prisma.adapter.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { EntityRecord, RevisionRecord } from '../../../src/domain/entities/entity.js';
import { seedEntity } from '../../support/entity-fixtures.js';
import { testPrisma, wipe } from '../../support/db.js';

const T0 = new Date('2026-10-29T10:00:00.000Z');
const row = (id: string): EntityRecord => ({ id, kind: 'prop', label: id, headRevisionId: null, publishedRevisionId: null, version: 0, createdBy: 'seed', createdAt: T0, updatedAt: T0 });
const rev = (entityId: string, seq: number, n: number, jobId: string | null = null): RevisionRecord => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, entityId, seq, parentId: null, source: `export default { n: ${n} };\n`, config: seedEntity('cactus'), hash: `h${n}`, authorWallet: 'W', jobId, message: `m${n}`, createdAt: T0,
});

describe('EntityPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: EntityPrismaRepository, tx: TransactionPrismaAdapter;
  beforeAll(async () => { prisma = await testPrisma(); repo = new EntityPrismaRepository(prisma); tx = new TransactionPrismaAdapter(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('ensure inserts once; lock reads the row FOR UPDATE; revisions append with seq; pointers move and bump the version', async () => {
    await tx.run(async (t) => { await repo.ensure(row('cactus'), t); await repo.ensure({ ...row('cactus'), label: 'other' }, t); });
    expect(await repo.find('cactus')).toMatchObject({ id: 'cactus', label: 'cactus', version: 0, headRevisionId: null });
    await tx.run(async (t) => {
      expect(await repo.lock('cactus', t)).toMatchObject({ id: 'cactus' });
      expect(await repo.nextSeq('cactus', t)).toBe(1);
      await repo.appendRevision(rev('cactus', 1, 1), t);
      await repo.appendRevision(rev('cactus', 2, 2), t);
      expect(await repo.nextSeq('cactus', t)).toBe(3);
      await repo.setPointers('cactus', { headRevisionId: rev('cactus', 2, 2).id }, new Date('2026-10-29T11:00:00.000Z'), t);
    });
    const e = await repo.find('cactus');
    expect([e!.headRevisionId, e!.publishedRevisionId, e!.version, e!.updatedAt.toISOString()]).toEqual([rev('cactus', 2, 2).id, null, 1, '2026-10-29T11:00:00.000Z']);
    expect(await tx.run((t) => repo.lock('nope', t))).toBeNull();
    await expect(tx.run((t) => repo.appendRevision({ ...rev('cactus', 2, 3) }, t))).rejects.toThrow();   // (entityId, seq) is unique
  });

  it('revisions newest first without the source, with the job prompt; one revision in full; seqs by id', async () => {
    await tx.run(async (t) => { await repo.ensure(row('cactus'), t); await repo.appendRevision(rev('cactus', 1, 1), t); await repo.appendRevision(rev('cactus', 2, 2, '00000000-0000-4000-8000-0000000000aa'), t); });
    await prisma.editorJob.create({ data: { id: '00000000-0000-4000-8000-0000000000aa', wallet: 'W', prompt: 'fatter please', provider: 'anthropic', model: 'm', status: 'done', createdAt: T0 } });
    const list = await repo.revisions('cactus');
    expect(list.map((r) => [r.seq, r.prompt])).toEqual([[2, 'fatter please'], [1, null]]);
    expect(list[0]).not.toHaveProperty('source');
    expect((await repo.revision(rev('cactus', 1, 1).id))!.config).toEqual(seedEntity('cactus'));
    expect([...(await repo.seqs([rev('cactus', 1, 1).id, rev('cactus', 2, 2).id])).values()].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('heads, published and the publish fingerprint', async () => {
    await tx.run(async (t) => {
      for (const [id, n] of [['cactus', 1], ['rock', 2]] as const) { await repo.ensure(row(id), t); await repo.appendRevision(rev(id, 1, n), t); await repo.setPointers(id, { headRevisionId: rev(id, 1, n).id }, T0, t); }
    });
    expect((await repo.heads()).map((r) => r.entityId).sort()).toEqual(['cactus', 'rock']);
    expect(await repo.published()).toEqual([]);
    const s0 = await repo.publishedStamp();
    await tx.run((t) => repo.setPointers('rock', { publishedRevisionId: rev('rock', 1, 2).id }, new Date('2026-10-29T12:00:00.000Z'), t));
    expect((await repo.published()).map((r) => r.entityId)).toEqual(['rock']);
    expect(await repo.publishedStamp()).not.toBe(s0);
    expect((await repo.list()).map((e) => e.id)).toEqual(['cactus', 'rock']);
  });
});
