import { GetRevisionHandler } from '../../../../../src/application/use-cases/entities/get-revision/get-revision.handler.js';
import { GetRevisionQuery } from '../../../../../src/application/use-cases/entities/get-revision/get-revision.query.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { entityContext, fatCactus } from '../../../../support/entity-fixtures.js';

describe('GetRevisionHandler', () => {
  it('a revision with its file text and config; an unknown id is a 404', async () => {
    const { entities, write } = entityContext();
    const d = await write.saveDraft({ entityId: 'cactus', source: fatCactus(), message: '', baseRevisionId: null, author: 'W' });
    const r = await new GetRevisionHandler(entities).execute(new GetRevisionQuery(d.id));
    expect([r.seq, r.head, r.source, r.config?.id]).toEqual([2, true, d.source, 'cactus']);
    await expect(new GetRevisionHandler(entities).execute(new GetRevisionQuery('00000000-0000-4000-8000-000000000999'))).rejects.toBeInstanceOf(NotFoundError);
  });
});
