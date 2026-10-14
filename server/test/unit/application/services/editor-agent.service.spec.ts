import { summarize, userMessage } from '../../../../src/application/services/editor-agent.service.js';
import { ScriptedLlm, ScriptedMcp, aJob, jobContext, turn } from '../../../support/editor-job-fixtures.js';

describe('EditorAgentService', () => {
  it('the MCP prompt is the system prompt, its tools the model\'s; each turn\'s text, calls, results and usage become events; ends on the model\'s end', async () => {
    const llm = new ScriptedLlm([turn({ text: 'checking', stop: 'tool', toolCalls: [{ id: 'c1', name: 'check_entity', input: { source: 'SRC' } }], usage: { in: 10, out: 2 } }), turn({ stop: 'tool', toolCalls: [{ id: 'c2', name: 'save_draft', input: { id: 'cactus', source: 'SRC', message: 'm' } }] }), turn({ text: 'saved' })]);
    const mcp = new ScriptedMcp({ check_entity: { text: '{"ok":true}', isError: false } });
    const { agent, jobs } = jobContext(undefined, llm, mcp);
    const job = aJob(); await jobs.insert(job);
    expect(await agent.run(job, new AbortController().signal)).toEqual({ status: 'done', text: 'saved' });
    expect(llm.opened[0]).toMatchObject({ provider: 'fake', model: 'scripted', system: 'SYSTEM cactus', maxOutputTokens: 32000, job: { prompt: 'taller', entityId: 'cactus' } });
    expect(llm.sent[1]).toEqual([{ id: 'c1', content: '{"ok":true}', isError: false }]);
    expect(mcp.tokens).toEqual([`token:${job.id}`]);
    expect(mcp.closed).toBe(1);
    const ev = await jobs.events(job.id, 0, 100);
    expect(ev.map((e) => e.type)).toEqual(['usage', 'text', 'tool_call', 'tool_result', 'tool_call', 'tool_result', 'text']);
    expect(ev[4]!.payload).toEqual({ name: 'save_draft', summary: 'id: "cactus", source: "SRC", message: "m"', ok: true });   // checked first: no `unchecked`
    expect((await jobs.find(job.id))!.tokensIn).toBe(10);
  });

  it('a save of a source never checked is recorded as unchecked (the MCP still validates it)', async () => {
    const llm = new ScriptedLlm([turn({ stop: 'tool', toolCalls: [{ id: 'c', name: 'save_draft', input: { id: 'cactus', source: 'X', message: 'm' } }] }), turn()]);
    const { agent, jobs } = jobContext(undefined, llm);
    const job = aJob(); await jobs.insert(job);
    await agent.run(job, new AbortController().signal);
    expect((await jobs.events(job.id, 0, 10)).find((e) => e.type === 'tool_call')!.payload['unchecked']).toBe(true);
  });

  it('refusal, provider error, output limit and the step limit fail the job; an abort is thrown to the runner', async () => {
    const run = async (turns: ReturnType<typeof turn>[], signal = new AbortController().signal) => { const c = jobContext(undefined, new ScriptedLlm(turns)); const j = aJob(); await c.jobs.insert(j); return c.agent.run(j, signal); };
    expect(await run([turn({ stop: 'refusal', detail: 'declined (cyber)' })])).toEqual({ status: 'failed', error: 'declined (cyber)' });
    expect(await run([turn({ stop: 'error', detail: 'rate limited' })])).toEqual({ status: 'failed', error: 'rate limited' });
    expect((await run([turn({ stop: 'max_tokens' })])).status).toBe('failed');
    const loop = Array.from({ length: 30 }, () => turn({ stop: 'tool', toolCalls: [{ id: 'c', name: 'check_entity', input: {} }] }));
    expect(await run(loop)).toEqual({ status: 'failed', error: 'the step limit (24 model turns) was reached' });
    const c = new AbortController(); c.abort('cancel');
    await expect(run([turn({ stop: 'tool', toolCalls: [{ id: 'c', name: 'x', input: {} }] })], c.signal)).rejects.toBeDefined();
  });

  it('the user message names the entity; a long argument is summarised by its size', () => {
    expect(userMessage({ prompt: 'taller', entityId: 'cactus' })).toMatch(/^taller\n\n\(entity: cactus/);
    expect(userMessage({ prompt: 'a crate', entityId: null })).toMatch(/no entity selected/);
    expect(summarize({ id: 'cactus', source: 'x'.repeat(500) })).toBe('id: "cactus", source: (500 chars)');
  });
});
