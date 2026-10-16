import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { LlmProviderPort } from '../../../ports/editor/llm-provider.port.js';
import { McpClientPort } from '../../../ports/editor/mcp-client.port.js';
import { GetEditorMeQuery, type EditorMeDto } from './get-editor-me.query.js';

/** Who is signed in to the editor, and the AI providers it may use: those whose key is set – none while the MCP is not configured (EDITOR_MCP_TOKEN). */
@QueryHandler(GetEditorMeQuery)
export class GetEditorMeHandler implements IQueryHandler<GetEditorMeQuery, EditorMeDto> {
  constructor(private readonly llm: LlmProviderPort, private readonly mcp: McpClientPort) {}

  execute({ wallet }: GetEditorMeQuery): Promise<EditorMeDto> {
    const providers = this.mcp.configured ? this.llm.enabled() : [];
    const preferred = this.llm.preferred();
    return Promise.resolve({ wallet, providers, defaultProvider: providers.length ? (preferred ?? providers[0]!.id) : null });
  }
}
