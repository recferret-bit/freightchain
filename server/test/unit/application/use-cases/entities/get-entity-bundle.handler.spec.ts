import { GetEntityBundleHandler } from '../../../../../src/application/use-cases/entities/get-entity-bundle/get-entity-bundle.handler.js';
import { GetEntityBundleQuery } from '../../../../../src/application/use-cases/entities/get-entity-bundle/get-entity-bundle.query.js';
import { entityContext } from '../../../../support/entity-fixtures.js';

describe('GetEntityBundleHandler', () => {
  it('answers the catalogue\'s bundle (seed ⊕ published)', async () => {
    const { catalog } = entityContext();
    expect(await new GetEntityBundleHandler(catalog).execute(new GetEntityBundleQuery())).toEqual(await catalog.bundle());
  });
});
