import { McpConfigsHandler } from '../../../../../src/application/use-cases/editor/mcp-configs/mcp-configs.handler.js';
import { McpConfigsQuery } from '../../../../../src/application/use-cases/editor/mcp-configs/mcp-configs.query.js';
import { entityContext, fatCactus, seedEntity } from '../../../../support/entity-fixtures.js';

describe('McpConfigsHandler', () => {
  it('every head config by id – the seed until an entity is edited', async () => {
    const { catalog, write } = entityContext();
    const d = await write.saveDraft({ entityId: 'cactus', source: fatCactus(), message: '', baseRevisionId: null, author: 'W' });
    const all = await new McpConfigsHandler(catalog).execute(new McpConfigsQuery());
    expect(all['cactus']).toEqual(d.config);
    expect(all['rock']).toEqual(seedEntity('rock'));
  });
});
