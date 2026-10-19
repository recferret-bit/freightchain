import { EntitiesHttpController } from '../../../src/presentation/entities/entities.http.controller.js';
import { GetEntityBundleQuery } from '../../../src/application/use-cases/entities/get-entity-bundle/get-entity-bundle.query.js';
import { busMock } from '../../support/bus.js';

describe('EntitiesHttpController', () => {
  it('the bundle is a query on the bus', async () => {
    const queries = busMock({ rev: 'r', entities: [] });
    expect(await new EntitiesHttpController(queries.bus).bundle()).toEqual({ rev: 'r', entities: [] });
    expect(queries.last()).toEqual(new GetEntityBundleQuery());
  });
});
