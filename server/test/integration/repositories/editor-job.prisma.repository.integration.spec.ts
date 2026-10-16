import { SETTING_DEFAULTS } from '../../../src/domain/settings/game-settings.js';
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
  it('independent replicas admit only one job per wallet or entity, and the daily cap survives completion races', async () => {
    const secondDb = await testPrisma(), other = new EditorJobPrismaRepository(secondDb);
    try {
      const rows = Array.from({ length: 12 }, (_, i) => aJob({ wallet: 'same-wallet', entityId: `entity-${i}`, createdAt: T(0) }));
      const results = await Promise.all(rows.map((j,i) => (i % 2 ? other : repo).admit(j, T(0), 100)));
      expect(results.filter(r => r === 'accepted')).toHaveLength(1);
      expect(results.filter(r => r === 'job_running')).toHaveLength(11);
      const winner = rows[results.indexOf('accepted')]!;
      await other.conclude(winner.id, 'done', null, T(1));
      expect(await repo.admit(aJob({ wallet: winner.wallet, createdAt: T(1) }), T(0), 1)).toBe('job_cap');
      const sameEntity = Array.from({ length: 8 }, (_, i) => aJob({ wallet: `W${i}`, entityId: 'shared-entity', createdAt: T(1) }));
      const entityResults = await Promise.all(sameEntity.map((j,i) => (i % 2 ? other : repo).admit(j, T(0), 100)));
      expect(entityResults.filter(r => r === 'accepted')).toHaveLength(1);
      expect((await repo.events(winner.id, 0, 50)).map(e => e.type)).toEqual(['status', 'status', 'done']);
    } finally { await secondDb.$disconnect(); }
  });

  it('replicas share the parallel budget and claim a durable job exactly once, without local enqueue', async () => {
    const secondDb = await testPrisma(), other = new EditorJobPrismaRepository(secondDb);
    try {
      const parallel = SETTING_DEFAULTS.editor_jobs_parallel;
      expect(parallel).toBe(5);
      const rows = Array.from({ length: 10 }, (_, i) => aJob({ wallet: `W${i}`, entityId: `entity-${i}`, createdAt: T(i) }));
      for (const row of rows) await repo.admit(row, T(0), 100);
      const claims = (await Promise.all(Array.from({ length: 16 }, (_, i) => (i % 2 ? other : repo).claim(parallel, T(10), 60000)))).filter(j => j !== null);
      expect(claims).toHaveLength(5);
      expect(new Set(claims.map(j => j.id)).size).toBe(5);
      expect(new Set(claims.map(j => j.id))).toEqual(new Set(rows.slice(0, 5).map(j => j.id)));
      expect((await other.open()).filter(j => j.status === 'queued')).toHaveLength(5);
      expect(await other.expire(T(11), 60000)).toBe(0); // another replica starting is harmless
      await repo.conclude(claims[0]!.id, 'cancelled', null, T(12));
      const next = await other.claim(parallel, T(12), 60000);
      expect(next!.id).toBe(rows[5]!.id);
      expect(claims.map(j => j.id)).not.toContain(next!.id);
      const endings = await Promise.all([repo.conclude(next!.id, 'done', null, T(13)), other.conclude(next!.id, 'cancelled', null, T(13))]);
      expect(endings.sort()).toEqual([false, true]);
      expect((await repo.events(next!.id, 0, 20)).map(e => e.type)).toEqual(['status', 'status', 'status', expect.stringMatching(/done|error/)]);
    } finally { await secondDb.$disconnect(); }
  });

  it('a dead owner expires without replay; racing expiry and claim cannot start an expired queue item', async () => {
    const secondDb = await testPrisma(), other = new EditorJobPrismaRepository(secondDb);
    try {
      const dead = aJob({ createdAt: T(0) }); await repo.admit(dead, T(0), 100);
      expect((await other.claim(1, T(1), 10000))!.id).toBe(dead.id);
      const queued = aJob({ wallet: 'Q', entityId: 'rock', createdAt: T(0) }); await repo.admit(queued, T(0), 100);
      const [expired, claim] = await Promise.all([repo.expire(T(20), 10000), other.claim(2, T(20), 10000)]);
      expect(expired).toBe(2); expect(claim).toBeNull();
      expect(await repo.claim(2, T(21), 10000)).toBeNull();
      expect(await other.conclude(dead.id, 'done', null, T(21))).toBe(false);
      expect((await repo.events(dead.id, 0, 50)).filter(e => e.type === 'error')).toHaveLength(1);
    } finally { await secondDb.$disconnect(); }
  });

});
