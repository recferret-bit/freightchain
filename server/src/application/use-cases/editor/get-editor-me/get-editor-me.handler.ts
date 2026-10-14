import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { GetEditorMeQuery, type EditorMeDto } from './get-editor-me.query.js';

/** Who is signed in to the editor, and which AI providers it may use (the AI editor's bridge fills these in). */
@QueryHandler(GetEditorMeQuery)
export class GetEditorMeHandler implements IQueryHandler<GetEditorMeQuery, EditorMeDto> {
  execute({ wallet }: GetEditorMeQuery): Promise<EditorMeDto> {
    return Promise.resolve({ wallet, providers: [], defaultProvider: null });
  }
}
