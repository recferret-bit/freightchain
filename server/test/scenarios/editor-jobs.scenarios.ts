import request from 'supertest';
import type { Agent } from 'supertest';
import { printSource } from '../../src/domain/shared/entity.js';
import { SettingsRepositoryPort } from '../../src/application/ports/settings/settings.repository.port.js';
import { EditorJobRepositoryPort } from '../../src/application/ports/editor/editor-job.repository.port.js';
import { JobTokenPort } from '../../src/application/ports/editor/job-token.port.js';
import { newWallet, sign } from '../support/client.js';
import { seedEntity } from '../support/entity-fixtures.js';
import type { Harness } from '../support/harness.js';

/* The AI model editor's jobs (docs/editor-api.md "jobs" + "MCP callbacks"): the scripted fake model (NODE_ENV=test) drives a real job through the
   in-process MCP (support/test-mcp.ts), which reads and writes through /api/editor/mcp/* with the job's token – the real callback path.
   Same scenarios on in-memory and PostgreSQL. */
export const JOB_EDITOR = newWallet();
export const EDITOR_JOBS_ENV = { EDITOR_WALLETS: JOB_EDITOR.address, EDITOR_MCP_TOKEN: 'test-mcp-token-'.padEnd(32, 'x') };

export function editorJobScenarios(h: () => Harness): void {
  beforeEach(() => h().reset());
  const X = 'x-fc-editor';

  async function signIn(): Promise<Agent> {
    const agent = request.agent(h().server());
    const { body } = await agent.post('/api/editor/auth/nonce').set(X, '1').send({ wallet: JOB_EDITOR.address }).expect(200);
    await agent.post('/api/editor/auth/verify').set(X, '1').send({ wallet: JOB_EDITOR.address, signature: sign(JOB_EDITOR.kp, body.message) }).expect(200);
    return agent;
  }
  const setting = (key: string, value: number) => h().app.get(SettingsRepositoryPort, { strict: false }).upsert(key, value);
  const ask = (a: Agent, body: Record<string, unknown>) => a.post('/api/editor/jobs').set(X, '1').send(body);
  const events = async (a: Agent, jobId: string) => (await a.get(`/api/editor/jobs/${jobId}/events?after=0`).expect(200)).body as { status: string; events: { seq: number; type: string; payload: Record<string, unknown> }[] };

  it('/me offers the providers whose key is set – here the scripted fake (tests)', async () => {
    const a = await signIn();
    expect((await a.get('/api/editor/me').expect(200)).body).toEqual({ wallet: JOB_EDITOR.address, providers: [{ id: 'fake', label: 'Fake (tests)', models: ['scripted'], default: 'scripted' }], defaultProvider: 'fake' });
  });

  it('a job, end to end: read → check → save a draft through the MCP callbacks → the draft event, the result, the history with its prompt', async () => {
    const a = await signIn();
    const { body } = await ask(a, { prompt: 'make it a little taller', entityId: 'cactus', baseRevisionId: null }).expect(202);
    await h().jobSettled(body.jobId);
    const ev = await events(a, body.jobId);
    expect(ev.status).toBe('done');
    expect(ev.events.map((e) => e.seq)).toEqual(ev.events.map((_, i) => i + 1));
    expect(ev.events.filter((e) => e.type === 'tool_call').map((e) => e.payload['name'])).toEqual(['get_entity', 'check_entity', 'save_draft']);
    expect(ev.events.filter((e) => e.type === 'tool_result').every((e) => e.payload['ok'] === true)).toBe(true);
    const draft = ev.events.find((e) => e.type === 'draft')!.payload;
    expect(draft).toMatchObject({ entityId: 'cactus', seq: 2 });
    expect(ev.events.at(-1)).toMatchObject({ type: 'done' });
    expect(ev.events.filter((e) => e.type === 'status').map((e) => e.payload['status'])).toEqual(['queued', 'running', 'done']);
    const job = (await a.get(`/api/editor/jobs/${body.jobId}`).expect(200)).body;
    expect(job).toMatchObject({ status: 'done', provider: 'fake', model: 'scripted', entityId: 'cactus', resultRevisionId: draft['revisionId'], wallet: JOB_EDITOR.address });
    const rev = (await a.get(`/api/editor/revisions/${String(draft['revisionId'])}`).expect(200)).body;
    expect(rev).toMatchObject({ authorWallet: JOB_EDITOR.address, jobId: body.jobId, prompt: 'make it a little taller', head: true, published: false });
    expect(rev.source).toContain("note: 'fake edit: make it a little taller',");
    expect((await a.get('/api/editor/jobs?entityId=cactus').expect(200)).body.map((j: { id: string }) => j.id)).toEqual([body.jobId]);
    expect(h().mcp.specCalls).toBe(1);
  });

  it('the spec gate: an impossible car is a 422 spec_invalid with the validator\'s errors – no job, no model call', async () => {
    const a = await signIn();
    const res = await ask(a, { prompt: 'a car with 2 wheels', entityId: 'sedan' }).expect(422);
    expect(res.body.code).toBe('spec_invalid');
    expect(res.body.errors.join(' ')).toMatch(/wheel/i);
    expect((await a.get('/api/editor/jobs').expect(200)).body).toEqual([]);
    expect(h().mcp.calls).toEqual([]);
  });

  it('one open job per editor and per model (409 job_running); cancel ends a queued one; a stale base is a 409', async () => {
    await setting('editor_jobs_parallel', 0);   // the runner holds jobs: they stay queued
    const a = await signIn();
    const first = (await ask(a, { prompt: 'taller', entityId: 'cactus' }).expect(202)).body;
    expect((await ask(a, { prompt: 'wider', entityId: 'rock' }).expect(409)).body.code).toBe('job_running');
    await a.post(`/api/editor/jobs/${first.jobId}/cancel`).set(X, '1').expect(200);
    const ev = await events(a, first.jobId);
    expect(ev.status).toBe('cancelled');
    expect(ev.events.at(-1)).toMatchObject({ type: 'error', payload: { status: 'cancelled' } });
    await ask(a, { prompt: 'wider', entityId: 'rock' }).expect(202);
    expect((await ask(a, { prompt: 'x', entityId: 'birch', baseRevisionId: '00000000-0000-4000-8000-000000000999' }).expect(409)).body.code).toBe('stale_base');
    await a.post('/api/editor/jobs').send({ prompt: 'x', entityId: 'birch' }).expect(403);   // no X-FC-Editor
  });

  it('the daily cap per editor (editor_jobs_per_day) is a 429 job_cap', async () => {
    await setting('editor_jobs_parallel', 0); await setting('editor_jobs_per_day', 1);
    const a = await signIn();
    const first = (await ask(a, { prompt: 'taller', entityId: 'cactus' }).expect(202)).body;
    await a.post(`/api/editor/jobs/${first.jobId}/cancel`).set(X, '1').expect(200);
    expect((await ask(a, { prompt: 'wider', entityId: 'rock' }).expect(429)).body.code).toBe('job_cap');
  });

  it('the MCP callbacks: only a running job\'s token, never through nginx; a job writes its own model or a new part – nothing else', async () => {
    await setting('editor_jobs_parallel', 0);
    const a = await signIn();
    const { jobId } = (await ask(a, { prompt: 'taller', entityId: 'cactus' }).expect(202)).body;
    const tokens = h().app.get(JobTokenPort, { strict: false }), jobs = h().app.get(EditorJobRepositoryPort, { strict: false });
    const token = await tokens.sign({ jobId, wallet: JOB_EDITOR.address, entityId: 'cactus' });
    const mcp = () => request(h().server());
    await mcp().get('/api/editor/mcp/entities').set('x-fc-job', token).expect(404);   // the job is only queued
    await jobs.update(jobId, { status: 'running' });
    await mcp().get('/api/editor/mcp/entities').set('x-fc-job', token).expect(200);
    await mcp().get('/api/editor/mcp/entities').set('x-fc-job', 'junk').expect(404);
    await mcp().get('/api/editor/mcp/entities').expect(404);
    await mcp().get('/api/editor/mcp/configs').set('x-fc-job', token).set('X-Forwarded-For', '203.0.113.9').expect(404);
    await mcp().get('/api/editor/mcp/configs').set('x-fc-job', token).set('X-Real-IP', '203.0.113.9').expect(404);
    const configs = (await mcp().get('/api/editor/mcp/configs').set('x-fc-job', token).expect(200)).body;
    expect(configs['cactus']).toEqual(seedEntity('cactus'));
    const rock = printSource({ ...seedEntity('rock'), note: 'no' });
    expect((await mcp().post('/api/editor/mcp/entities/rock/drafts').set('x-fc-job', token).send({ source: rock, message: 'm' }).expect(403)).body.code).toBe('job_scope');
    const part = printSource({ id: 'job-crate', kind: 'part', v: 1, slots: { m: {} }, parts: [{ geo: 'box', mat: 'm', s: [1, 1, 1], at: [0, 0.5, 0] }] });
    await mcp().post('/api/editor/mcp/entities/job-crate/drafts').set('x-fc-job', token).send({ source: part, message: 'a crate' }).expect(200);
    const own = (await mcp().post('/api/editor/mcp/entities/cactus/drafts').set('x-fc-job', token).send({ source: printSource({ ...seedEntity('cactus'), note: 'mcp' }), message: 'note' }).expect(200)).body;
    const job = (await a.get(`/api/editor/jobs/${jobId}`).expect(200)).body;
    expect(job.resultRevisionId).toBe(own.id);
    expect((await events(a, jobId)).events.filter((e) => e.type === 'draft').map((e) => e.payload['entityId'])).toEqual(['job-crate', 'cactus']);
    h().clock.advance(600 + 61);   // the token outlives the job timeout by a minute only
    await mcp().get('/api/editor/mcp/entities').set('x-fc-job', token).expect(404);
  });
}
