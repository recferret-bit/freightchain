import { ListRevisionsHandler } from '../../../../../src/application/use-cases/entities/list-revisions/list-revisions.handler.js';
import { ListRevisionsQuery } from '../../../../../src/application/use-cases/entities/list-revisions/list-revisions.query.js';
import { entityContext, fatCactus } from '../../../../support/entity-fixtures.js';

describe('ListRevisionsHandler', () => {
  it('newest first, flags for head / published, the job prompt; [] for an entity never edited', async () => {
    const { entities, write, db } = entityContext();
    const h = new ListRevisionsHandler(entities);
    expect(await h.execute(new ListRevisionsQuery('cactus'))).toEqual([]);
    const d = await write.saveDraft({ entityId: 'cactus', source: fatCactus(), message: 'm', baseRevisionId: null, author: 'W', jobId: '00000000-0000-4000-8000-0000000000aa' });
    db.editorJobPrompts.set('00000000-0000-4000-8000-0000000000aa', 'make it fatter');
    const list = await h.execute(new ListRevisionsQuery('cactus'));
    expect(list.map((r) => [r.seq, r.head, r.published, r.prompt])).toEqual([[2, true, false, 'make it fatter'], [1, false, false, null]]);
    expect(list[0]!.id).toBe(d.id);
    expect(list[0]).not.toHaveProperty('source');
  });
});
