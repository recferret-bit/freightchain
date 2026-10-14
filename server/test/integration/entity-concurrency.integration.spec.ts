import { EntityWriteService } from '../../src/application/services/entity-write.service.js';
import { EntityRepositoryPort } from '../../src/application/ports/entities/entity.repository.port.js';
import { fatCactus } from '../support/entity-fixtures.js';
import { createHarness, type Harness } from '../support/harness.js';

/* The one critical section of the 3D model history: drafts racing on one entity. The row lock serialises them; the base check lets exactly one win
   per base, and seq stays gap-free and unique. */
const PARALLEL = 8;

describe('entity drafts under concurrency (PostgreSQL)', () => {
  let h: Harness, write: EntityWriteService, entities: EntityRepositoryPort;
  beforeAll(async () => { h = await createHarness('postgres'); write = h.app.get(EntityWriteService, { strict: false }); entities = h.app.get(EntityRepositoryPort, { strict: false }); });
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
});
