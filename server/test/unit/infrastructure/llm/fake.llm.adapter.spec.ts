import { FakeLlmSession, fakeEdit } from '../../../../src/infrastructure/llm/fake.llm.adapter.js';
import type { LlmOpenOptions } from '../../../../src/application/ports/editor/llm-provider.port.js';

const opts = (entityId: string | null, prompt = 'make it "taller"'): LlmOpenOptions => ({ provider: 'fake', model: 'scripted', system: '', tools: [], maxOutputTokens: 1, signal: new AbortController().signal, job: { prompt, entityId } });
const SRC = "export default {\n  id: 'cactus',\n  kind: 'prop',\n  v: 1,\n  label: 'cactus',\n  parts: [],\n};\n";

describe('FakeLlmSession (the scripted test model)', () => {
  it('get_entity → check_entity of the edited source → save_draft → done', async () => {
    const s = new FakeLlmSession(opts('cactus'));
    expect((await s.send('x')).toolCalls).toEqual([{ id: 'fake-1', name: 'get_entity', input: { id: 'cactus' } }]);
    const t2 = await s.sendToolResults([{ id: 'fake-1', content: JSON.stringify({ source: SRC }), isError: false }]);
    expect(t2.toolCalls[0]).toMatchObject({ name: 'check_entity' });
    expect(t2.toolCalls[0]!.input['source']).toContain("  note: 'fake edit: make it taller',");
    const t3 = await s.sendToolResults([{ id: 'fake-2', content: JSON.stringify({ ok: true }), isError: false }]);
    expect(t3.toolCalls[0]).toMatchObject({ name: 'save_draft', input: { id: 'cactus', message: 'fake: make it "taller"' } });
    expect(await s.sendToolResults([{ id: 'fake-3', content: '{}', isError: false }])).toMatchObject({ text: 'done (fake)', stop: 'end' });
  });

  it('a failed check ends with its errors; no entity ends at once', async () => {
    const s = new FakeLlmSession(opts('cactus'));
    await s.send('x'); await s.sendToolResults([{ id: '1', content: JSON.stringify({ source: SRC }), isError: false }]);
    expect(await s.sendToolResults([{ id: '2', content: JSON.stringify({ ok: false, errors: ['bad'] }), isError: false }])).toMatchObject({ stop: 'end', toolCalls: [] });
    expect(await new FakeLlmSession(opts(null)).send('x')).toMatchObject({ stop: 'end', toolCalls: [] });
  });

  it('fakeEdit: after label, else after v: 1; an existing top-level note is replaced; quotes stripped, ≤ 60 chars', () => {
    expect(fakeEdit(SRC, 'a').split('\n')[5]).toBe("  note: 'fake edit: a',");
    expect(fakeEdit(SRC.replace("  label: 'cactus',\n", ''), 'b').split('\n')[4]).toBe("  note: 'fake edit: b',");
    const withNote = fakeEdit(SRC, 'first'), again = fakeEdit(withNote, `it's ${'y'.repeat(80)}`);
    expect(again.match(/note:/g)).toHaveLength(1);
    expect(again).toContain(`  note: 'fake edit: its ${'y'.repeat(56)}',`);
  });
});
