import { EditorJobPrismaRepository } from '../../../src/infrastructure/prisma/repositories/editor-job.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { aJob } from '../../support/editor-job-fixtures.js';
import { testPrisma, wipe } from '../../support/db.js';

const T = (s: number) => new Date(Date.UTC(2026, 9, 29, 10, 0, s));

describe('EditorJobPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: EditorJobPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new EditorJobPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('insert / find / list newest first by wallet or entity; open = queued + running; count since', async () => {
    const a = aJob({ createdAt: T(1) }), b = aJob({ createdAt: T(2), entityId: 'rock', status: 'running' }), c = aJob({ createdAt: T(3), wallet: 'X', status: 'done' });
    for (const j of [a, b, c]) await repo.insert(j);
    expect(await repo.find(a.id)).toEqual(a);
    expect((await repo.list({ limit: 10 })).map((j) => j.id)).toEqual([c.id, b.id, a.id]);
    expect((await repo.list({ wallet: 'W', entityId: 'cactus', limit: 10 })).map((j) => j.id)).toEqual([a.id]);
    expect((await repo.open()).map((j) => j.id)).toEqual([a.id, b.id]);
    expect(await repo.countSince('W', T(2))).toBe(1);
  });

  it('update only from the given statuses; usage adds up', async () => {
    const j = aJob(); await repo.insert(j);
    expect(await repo.update(j.id, { status: 'running', startedAt: T(5) }, ['queued'])).toBe(true);
    expect(await repo.update(j.id, { status: 'cancelled' }, ['queued'])).toBe(false);
    await repo.addUsage(j.id, 10, 3); await repo.addUsage(j.id, 5, 1);
    expect(await repo.find(j.id)).toMatchObject({ status: 'running', startedAt: T(5), tokensIn: 15, tokensOut: 4 });
  });

  it('events: seq 1, 2, … per job even when appended at once (the runner and the MCP callbacks); read after a seq', async () => {
    const j = aJob(), k = aJob({ wallet: 'X' }); await repo.insert(j); await repo.insert(k);
    await Promise.all(Array.from({ length: 12 }, (_, i) => repo.appendEvent(j.id, 'text', { i }, T(i))));
    await repo.appendEvent(k.id, 'status', { status: 'queued' }, T(0));
    const ev = await repo.events(j.id, 0, 100);
    expect(ev.map((e) => e.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect((await repo.events(j.id, 10, 100)).map((e) => e.seq)).toEqual([11, 12]);
    expect(await repo.events(k.id, 0, 5)).toEqual([{ jobId: k.id, seq: 1, type: 'status', payload: { status: 'queued' }, at: T(0) }]);
  });
});
