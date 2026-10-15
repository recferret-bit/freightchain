import { CommandBus } from '@nestjs/cqrs';
import request from 'supertest';
import { EntityWriteService } from '../../src/application/services/entity-write.service.js';
import { EntityRepositoryPort } from '../../src/application/ports/entities/entity.repository.port.js';
import { EditorJobRepositoryPort } from '../../src/application/ports/editor/editor-job.repository.port.js';
import { McpSaveDraftCommand } from '../../src/application/use-cases/editor/mcp-save-draft/mcp-save-draft.command.js';
import { printSource, validateEntity, type EntityConfig } from '../../src/domain/shared/entity.js';
import { aJob } from '../support/editor-job-fixtures.js';
import { fatCactus, seedEntity } from '../support/entity-fixtures.js';
import { newWallet, sign } from '../support/client.js';
import { createHarness, type Harness } from '../support/harness.js';

/* The one critical section of the 3D model history: drafts racing on one entity. The row lock serialises them; the base check lets exactly one win
   per base, and seq stays gap-free and unique. */
const PARALLEL = 8;
const ED = newWallet(), ED2 = newWallet();

describe('entity drafts under concurrency (PostgreSQL)', () => {
  let h: Harness, write: EntityWriteService, entities: EntityRepositoryPort, jobs: EditorJobRepositoryPort, bus: CommandBus;
  beforeAll(async () => {
    h = await createHarness('postgres', { EDITOR_WALLETS: `${ED.address},${ED2.address}` });
    write = h.app.get(EntityWriteService, { strict: false });
    entities = h.app.get(EntityRepositoryPort, { strict: false });
    jobs = h.app.get(EditorJobRepositoryPort, { strict: false });
    bus = h.app.get(CommandBus, { strict: false });
  });
  afterAll(() => h.close());
  beforeEach(() => h.reset());

  it(`${PARALLEL} first edits of one seed entity at once: exactly one wins, the rest are stale_base; the history is seed #1 + that draft #2`, async () => {
    const results = await Promise.allSettled(Array.from({ length: PARALLEL }, (_, i) => write.saveDraft({ entityId: 'cactus', source: fatCactus(0.33 + i / 100), message: `try ${i}`, baseRevisionId: null, author: 'W' })));
    const won = results.filter((r) => r.status === 'fulfilled'), lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost.map((r) => (r.reason as { errorCode?: string }).errorCode)).toEqual(Array(PARALLEL - 1).fill('stale_base'));
    expect((await entities.revisions('cactus')).map((r) => r.seq)).toEqual([2, 1]);
  });

  it(`${PARALLEL} drafts on the same head: exactly one wins and becomes #3`, async () => {
    const base = await write.saveDraft({ entityId: 'cactus', source: fatCactus(), message: '', baseRevisionId: null, author: 'W' });
    const same = await Promise.allSettled(Array.from({ length: PARALLEL }, (_, i) => write.saveDraft({ entityId: 'cactus', source: fatCactus(0.5 + i / 100), message: '', baseRevisionId: base.id, author: 'W' })));
    expect(same.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const seqs = (await entities.revisions('cactus')).map((r) => r.seq);
    expect(seqs).toEqual([3, 2, 1]);
  });

  it('parallel MCP save_draft calls on the same running job serialize under the job row lock without stale_base conflicts', async () => {
    const job = aJob({ status: 'running', entityId: 'cactus', wallet: ED.address });
    await jobs.insert(job);
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => bus.execute(new McpSaveDraftCommand(job.id, 'cactus', fatCactus(0.35 + i / 100), `step ${i}`))));
    expect(results.map((r: { seq: number }) => r.seq).sort()).toEqual([2, 3, 4, 5]);
    expect((await entities.revisions('cactus')).map((r) => r.seq)).toEqual([5, 4, 3, 2, 1]);
  });

  it('two publishes that each fit the old catalogue cannot both commit when together they do not build', async () => {
    const X = 'x-fc-editor';
    const signIn = async (who: typeof ED) => {
      const agent = request.agent(h.server());
      const { body: nonce } = await agent.post('/api/editor/auth/nonce').set(X, '1').send({ wallet: who.address }).expect(200);
      await agent.post('/api/editor/auth/verify').set(X, '1').send({ wallet: who.address, signature: sign(who.kp, nonce.message) }).expect(200);
      return agent;
    };
    const a = await signIn(ED), b = await signIn(ED2);
    const crate = (tag?: string) => printSource({ id: 'job-crate', kind: 'part', v: 1, slots: { m: {} }, parts: [{ geo: 'box', ...(tag ? { tag } : {}), mat: 'm', s: [0.2, 0.2, 0.2], at: [0, 0.1, 0] }] });
    const first = (await a.post('/api/editor/entities/job-crate/drafts').set(X, '1').send({ source: crate(), message: 'v1', baseRevisionId: null }).expect(200)).body;
    const challenge = async (agent: ReturnType<typeof request.agent>, who: typeof ED, id: string, revisionId: string) => {
      const message = (await agent.post(`/api/editor/entities/${id}/publish/challenge`).set(X, '1').send({ revisionId }).expect(200)).body.message as string;
      return sign(who.kp, message);
    };
    const firstSig = await challenge(a, ED, 'job-crate', first.id);
    await a.post('/api/editor/entities/job-crate/publish').set(X, '1').send({ revisionId: first.id, signature: firstSig }).expect(200);
    const birch = seedEntity('birch'); (birch.parts as unknown[]).push({ use: 'job-crate' });
    const birchRev = (await a.post('/api/editor/entities/birch/drafts').set(X, '1').send({ source: printSource(birch), message: 'uses the crate', baseRevisionId: null }).expect(200)).body;
    const crate2 = (await a.post('/api/editor/entities/job-crate/drafts').set(X, '1').send({ source: crate('trunk'), message: 'trunk', baseRevisionId: first.id }).expect(200)).body;
    const [birchSig, crateSig] = await Promise.all([challenge(a, ED, 'birch', birchRev.id), challenge(b, ED2, 'job-crate', crate2.id)]);
    const results = await Promise.all([
      a.post('/api/editor/entities/birch/publish').set(X, '1').send({ revisionId: birchRev.id, signature: birchSig }),
      b.post('/api/editor/entities/job-crate/publish').set(X, '1').send({ revisionId: crate2.id, signature: crateSig }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    const bundle = (await request(h.server()).get('/api/entities/bundle').expect(200)).body as { entities: EntityConfig[] };
    const byId = new Map(bundle.entities.map((e) => [e.id, e]));
    for (const e of bundle.entities) expect(validateEntity(e, { lookup: (id: string) => byId.get(id) ?? null }).ok, e.id).toBe(true);
  });
});
