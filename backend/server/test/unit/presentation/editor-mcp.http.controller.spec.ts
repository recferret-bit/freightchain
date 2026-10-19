import { EditorMcpHttpController } from '../../../src/presentation/editor/editor-mcp.http.controller.js';
import { ListEntitiesQuery } from '../../../src/application/use-cases/entities/list-entities/list-entities.query.js';
import { GetEntityQuery } from '../../../src/application/use-cases/entities/get-entity/get-entity.query.js';
import { McpConfigsQuery } from '../../../src/application/use-cases/editor/mcp-configs/mcp-configs.query.js';
import { McpSaveDraftCommand } from '../../../src/application/use-cases/editor/mcp-save-draft/mcp-save-draft.command.js';
import { mcpDraftBodySchema } from '../../../src/presentation/editor/dto/editor.dto.js';
import { busMock } from '../../support/bus.js';

const J = '00000000-0000-4000-8000-000000000001';

describe('EditorMcpHttpController', () => {
  it('reads the catalogue for the MCP and saves drafts as the job', async () => {
    const commands = busMock(), queries = busMock([]);
    const c = new EditorMcpHttpController(commands.bus, queries.bus), job = { jobId: J, wallet: 'W', entityId: 'cactus' };
    await c.list(); expect(queries.last()).toEqual(new ListEntitiesQuery());
    await c.head({ id: 'cactus' }); expect(queries.last()).toEqual(new GetEntityQuery('cactus'));
    await c.configs(); expect(queries.last()).toEqual(new McpConfigsQuery());
    await c.draft(job, { id: 'cactus' }, mcpDraftBodySchema.parse({ source: 'export default {};' })); expect(commands.last()).toEqual(new McpSaveDraftCommand(J, 'cactus', 'export default {};', ''));
  });
});
