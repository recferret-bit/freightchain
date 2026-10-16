import { GetEntityHandler } from '../../../../../src/application/use-cases/entities/get-entity/get-entity.handler.js';
import { GetEntityQuery } from '../../../../../src/application/use-cases/entities/get-entity/get-entity.query.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { entityContext, fatCactus } from '../../../../support/entity-fixtures.js';

describe('GetEntityHandler', () => {
  it('the head: the seed printed until the first edit, then the head revision; an unknown id is a 404', async () => {
    const { catalog, write } = entityContext();
    const h = new GetEntityHandler(catalog);
    const seed = await h.execute(new GetEntityQuery('cactus'));
    expect(seed.row.source).toBe('seed'); expect(seed.source).toMatch(/^export default \{/);
    const d = await write.saveDraft({ entityId: 'cactus', source: fatCactus(), message: '', baseRevisionId: null, author: 'W' });
    const head = await h.execute(new GetEntityQuery('cactus'));
    expect([head.row.headRevisionId, head.source]).toEqual([d.id, d.source]);
    await expect(h.execute(new GetEntityQuery('no-such'))).rejects.toBeInstanceOf(NotFoundError);
  });
});
