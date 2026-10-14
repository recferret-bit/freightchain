import { GetEditorMeHandler } from '../../../../../src/application/use-cases/editor/get-editor-me/get-editor-me.handler.js';
import { GetEditorMeQuery } from '../../../../../src/application/use-cases/editor/get-editor-me/get-editor-me.query.js';

describe('GetEditorMeHandler', () => {
  it('the signed-in editor; no AI provider until the bridge exists', async () => {
    expect(await new GetEditorMeHandler().execute(new GetEditorMeQuery('W'))).toEqual({ wallet: 'W', providers: [], defaultProvider: null });
  });
});
