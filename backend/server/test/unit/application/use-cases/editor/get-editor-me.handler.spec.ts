import { GetEditorMeHandler } from '../../../../../src/application/use-cases/editor/get-editor-me/get-editor-me.handler.js';
import { GetEditorMeQuery } from '../../../../../src/application/use-cases/editor/get-editor-me/get-editor-me.query.js';
import { ScriptedLlm, ScriptedMcp } from '../../../../support/editor-job-fixtures.js';

const P = [{ id: 'anthropic' as const, label: 'A', models: ['m'], default: 'm' }, { id: 'gemini' as const, label: 'G', models: ['g'], default: 'g' }];

describe('GetEditorMeHandler', () => {
  it('the providers with a key and the default (the preferred one, else the first); none while the MCP is off', async () => {
    expect(await new GetEditorMeHandler(new ScriptedLlm([], P), new ScriptedMcp()).execute(new GetEditorMeQuery('W'))).toEqual({ wallet: 'W', providers: P, defaultProvider: 'anthropic' });
    expect((await new GetEditorMeHandler(new ScriptedLlm([], P, 'gemini'), new ScriptedMcp()).execute(new GetEditorMeQuery('W'))).defaultProvider).toBe('gemini');
    const off = new ScriptedMcp(); off.configured = false;
    expect(await new GetEditorMeHandler(new ScriptedLlm([], P), off).execute(new GetEditorMeQuery('W'))).toEqual({ wallet: 'W', providers: [], defaultProvider: null });
  });
});
