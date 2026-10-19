import { ListEntitiesHandler } from '../../../../../src/application/use-cases/entities/list-entities/list-entities.handler.js';
import { ListEntitiesQuery } from '../../../../../src/application/use-cases/entities/list-entities/list-entities.query.js';
import { entityContext } from '../../../../support/entity-fixtures.js';

describe('ListEntitiesHandler', () => {
  it('every seed and database entity, sorted by id', async () => {
    const { catalog } = entityContext();
    const rows = await new ListEntitiesHandler(catalog).execute(new ListEntitiesQuery());
    expect(rows.length).toBeGreaterThan(40);
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(ids.toSorted());
  });
});
