import { printSource } from '../../../../src/domain/shared/entity.js';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../../../src/domain/shared/errors.js';
import { entityContext, fatCactus, seedEntity } from '../../../support/entity-fixtures.js';

describe('EntityWriteService', () => {
  it('the first edit of a seed entity records the seed as #1 and the draft as #2 (HEAD); the next one bases on it', async () => {
    const { write, entities } = entityContext();
    const r2 = await write.saveDraft({ entityId: 'cactus', source: fatCactus(), message: 'fatter', baseRevisionId: null, author: 'W' });
    expect(r2).toMatchObject({ seq: 2, head: true, published: false, authorWallet: 'W', message: 'fatter' });
    const history = await entities.revisions('cactus');
    expect(history.map((r) => [r.seq, r.authorWallet])).toEqual([[2, 'W'], [1, 'seed']]);
    expect(r2.parentId).toBe(history[1]!.id);
    const r3 = await write.saveDraft({ entityId: 'cactus', source: fatCactus(0.5), message: '', baseRevisionId: r2.id, author: 'W' });
    expect([r3.seq, r3.parentId]).toEqual([3, r2.id]);
  });

  it('a stale base is a 409 stale_base, and nothing is written', async () => {
    const { write, entities } = entityContext();
    const r2 = await write.saveDraft({ entityId: 'cactus', source: fatCactus(), message: '', baseRevisionId: null, author: 'W' });
    await expect(write.saveDraft({ entityId: 'cactus', source: fatCactus(0.5), message: '', baseRevisionId: null, author: 'X' })).rejects.toMatchObject({ errorCode: 'stale_base' });
    await expect(write.saveDraft({ entityId: 'cactus', source: fatCactus(0.5), message: '', baseRevisionId: '00000000-0000-4000-8000-000000000999', author: 'X' })).rejects.toBeInstanceOf(ConflictError);
    expect((await entities.find('cactus'))!.headRevisionId).toBe(r2.id);
  });

  it('an invalid file is a 422 with the validator\'s reasons, before any write', async () => {
    const { write, entities } = entityContext();
    const bad = seedEntity('cactus'); (bad['parts'] as { s: unknown[] }[])[0]!.s[1] = 'h * nope';
    await expect(write.saveDraft({ entityId: 'cactus', source: printSource(bad), message: '', baseRevisionId: null, author: 'W' })).rejects.toBeInstanceOf(UnprocessableEntityError);
    expect(await entities.find('cactus')).toBeNull();
  });

  it('a brand-new entity (no seed) starts at #1; its kind is then fixed', async () => {
    const { write } = entityContext();
    const part = { id: 'my-crate', kind: 'part', v: 1, slots: { m: {} }, parts: [{ geo: 'box', mat: 'm', s: [1, 1, 1], at: [0, 0.5, 0] }] };
    const r1 = await write.saveDraft({ entityId: 'my-crate', source: printSource(part), message: 'new', baseRevisionId: null, author: 'W' });
    expect(r1.seq).toBe(1);
    await expect(write.saveDraft({ entityId: 'my-crate', source: printSource({ ...part, kind: 'prop', label: 'crate' }), message: '', baseRevisionId: r1.id, author: 'W' })).rejects.toBeInstanceOf(UnprocessableEntityError);
  });

  it('restore = a NEW head copying an older revision (append-only); another entity\'s revision is a 404', async () => {
    const { write, entities } = entityContext();
    const r2 = await write.saveDraft({ entityId: 'cactus', source: fatCactus(), message: '', baseRevisionId: null, author: 'W' });
    const seed = (await entities.revisions('cactus')).find((r) => r.seq === 1)!;
    const r3 = await write.restore('cactus', seed.id, r2.id, 'W');
    expect(r3).toMatchObject({ seq: 3, head: true, message: 'restore of #1', parentId: r2.id });
    expect(r3.source).toBe((await entities.revision(seed.id))!.source);
    const rock = await write.saveDraft({ entityId: 'rock', source: printSource(seedEntity('rock')), message: '', baseRevisionId: null, author: 'W' });
    await expect(write.restore('cactus', rock.id, r3.id, 'W')).rejects.toBeInstanceOf(NotFoundError);
  });
});
