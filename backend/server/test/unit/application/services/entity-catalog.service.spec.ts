import { BUNDLE_RECHECK_MS } from '../../../../src/application/services/entity-catalog.service.js';
import { SEED_ENTITIES } from '../../../../src/domain/shared/entity.js';
import { entityContext, fatCactus } from '../../../support/entity-fixtures.js';

describe('EntityCatalogService', () => {
  it('a fresh database serves the seed: every entity, a stable short rev', async () => {
    const { catalog } = entityContext();
    const a = await catalog.bundle(), b = await catalog.bundle();
    expect(a.entities.map((e) => e.id).sort()).toEqual(SEED_ENTITIES.map((e) => e.id).sort());
    expect(a.rev).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toBe(a);   // held in memory
  });

  it('a draft changes the heads, never the bundle; a published revision replaces the seed of its id', async () => {
    const { catalog, write, entities, clock } = entityContext();
    const before = await catalog.bundle();
    const draft = await write.saveDraft({ entityId: 'cactus', source: fatCactus(), message: 'fat', baseRevisionId: null, author: 'W' });
    expect((await catalog.heads()).get('cactus')!.revision!.id).toBe(draft.id);
    catalog.invalidate();
    expect((await catalog.bundle()).rev).toBe(before.rev);
    await entities.setPointers('cactus', { publishedRevisionId: draft.id }, clock.now());   // a publish by another process
    expect((await catalog.bundle()).rev).toBe(before.rev);   // still cached: another process' publish shows within BUNDLE_RECHECK_MS
    clock.advance(BUNDLE_RECHECK_MS / 1000 + 1);
    const after = await catalog.bundle();
    expect(after.rev).not.toBe(before.rev);
    expect(after.entities.find((e) => e.id === 'cactus')).toEqual(draft.config);
  });

  it('rows: seed-only entities say so; edited ones carry their head / published numbers', async () => {
    const { catalog, write } = entityContext();
    await write.saveDraft({ entityId: 'cactus', source: fatCactus(), message: '', baseRevisionId: null, author: 'W' });
    const rows = await catalog.rows();
    expect(rows.find((r) => r.id === 'rock')).toMatchObject({ source: 'seed', headSeq: null });
    expect(rows.find((r) => r.id === 'cactus')).toMatchObject({ source: 'db', headSeq: 2, publishedSeq: null, kind: 'prop' });
  });
});
