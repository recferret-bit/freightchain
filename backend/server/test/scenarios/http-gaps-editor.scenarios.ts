import request from 'supertest';
import type { Agent } from 'supertest';
import { EditorJobRepositoryPort } from '../../src/application/ports/editor/editor-job.repository.port.js';
import { JobTokenPort } from '../../src/application/ports/editor/job-token.port.js';
import { SettingsRepositoryPort } from '../../src/application/ports/settings/settings.repository.port.js';
import { EDITOR } from './editor.scenarios.js';
import { JOB_EDITOR } from './editor-jobs.scenarios.js';
import { bindClient, sign } from '../support/client.js';
import type { Harness } from '../support/harness.js';

/* Editor routes the census still counts once: logout's only hit was a cross-origin 403.
   As-built: no editor session is 404 (not 401); a change without X-FC-Editor is 403. */

const X = 'x-fc-editor';

export function editorGapScenarios(h: () => Harness): void {
  const { anon, login } = bindClient(h);
  beforeEach(() => h().reset());

  async function signIn(): Promise<Agent> {
    const agent = request.agent(h().server());
    const { body } = await agent.post('/api/editor/auth/nonce').set(X, '1').send({ wallet: EDITOR.address }).expect(200);
    await agent.post('/api/editor/auth/verify').set(X, '1').send({ wallet: EDITOR.address, signature: sign(EDITOR.kp, body.message) }).expect(200);
    return agent;
  }

  it('logout revokes the editor session; the next /me is 404', async () => {
    const editor = await signIn();
    expect((await editor.get('/api/editor/me').expect(200)).body.wallet).toBe(EDITOR.address);
    expect((await editor.post('/api/editor/auth/logout').set(X, '1').expect(200)).body).toEqual({ ok: true });
    await editor.get('/api/editor/me').expect(404);
    await editor.get('/api/editor/entities').expect(404);
  });

  it('logout without the header is 403; a foreign Origin is 403 and does not end the session', async () => {
    const editor = await signIn();
    expect((await editor.post('/api/editor/auth/logout').expect(403)).body.code).toBe('forbidden');
    expect((await editor.post('/api/editor/auth/logout').set(X, '1').set('Origin', 'https://evil.example').expect(403)).body.code).toBe('bad_origin');
    await editor.get('/api/editor/me').expect(200);
    await anon().post('/api/editor/auth/logout').set('Origin', 'null').set(X, '1').expect(403);
  });

  it('the catalogue and the signed writes are 404 for a rider and 400/403 for a bad editor call', async () => {
    const rider = await login();
    await anon().get('/api/editor/entities').expect(404);
    await rider.agent.get('/api/editor/entities').expect(404);
    await anon().post('/api/editor/entities/cactus/restore').set(X, '1').send({ revisionId: '00000000-0000-4000-8000-000000000001', baseRevisionId: null }).expect(404);
    await anon().post('/api/editor/entities/cactus/publish/challenge').set(X, '1').send({ revisionId: '00000000-0000-4000-8000-000000000001' }).expect(404);
    await anon().post('/api/editor/entities/cactus/publish').set(X, '1').send({ revisionId: '00000000-0000-4000-8000-000000000001', signature: 'abc' }).expect(404);
    const editor = await signIn();
    await editor.post('/api/editor/entities/cactus/restore').send({ revisionId: '00000000-0000-4000-8000-000000000001', baseRevisionId: null }).expect(403);
    await editor.post('/api/editor/entities/cactus/restore').set(X, '1').send({ revisionId: 'nope', baseRevisionId: null }).expect(400);
    await editor.post('/api/editor/entities/cactus/publish/challenge').send({ revisionId: '00000000-0000-4000-8000-000000000001' }).expect(403);
    await editor.post('/api/editor/entities/cactus/publish/challenge').set(X, '1').send({ revisionId: 'nope' }).expect(400);
    await editor.post('/api/editor/entities/cactus/publish').send({ revisionId: '00000000-0000-4000-8000-000000000001', signature: 'abc' }).expect(403);
    await editor.post('/api/editor/entities/cactus/publish').set(X, '1').send({}).expect(400);
    await editor.post('/api/editor/entities/NOPE/restore').set(X, '1').send({ revisionId: '00000000-0000-4000-8000-000000000001', baseRevisionId: null }).expect(400);
  });
}

/** GET /api/editor/mcp/entities/:id had no scenario. The other MCP reads were a single it. */
export function editorMcpGapScenarios(h: () => Harness): void {
  beforeEach(() => h().reset());

  async function runningToken(): Promise<string> {
    await h().app.get(SettingsRepositoryPort, { strict: false }).upsert('editor_jobs_parallel', 0);
    const agent = request.agent(h().server());
    const { body } = await agent.post('/api/editor/auth/nonce').set(X, '1').send({ wallet: JOB_EDITOR.address }).expect(200);
    await agent.post('/api/editor/auth/verify').set(X, '1').send({ wallet: JOB_EDITOR.address, signature: sign(JOB_EDITOR.kp, body.message) }).expect(200);
    const { jobId } = (await agent.post('/api/editor/jobs').set(X, '1').send({ prompt: 'taller', entityId: 'cactus' }).expect(202)).body;
    await h().app.get(EditorJobRepositoryPort, { strict: false }).update(jobId, { status: 'running', startedAt: h().clock.now() });
    return h().app.get(JobTokenPort, { strict: false }).sign({ jobId, wallet: JOB_EDITOR.address, entityId: 'cactus' });
  }

  it('a running job token reads one entity head', async () => {
    const token = await runningToken();
    const head = await request(h().server()).get('/api/editor/mcp/entities/cactus').set('x-fc-job', token).expect(200);
    expect(head.body.row.id).toBe('cactus');
    expect(head.body.config.id).toBe('cactus');
    const list = await request(h().server()).get('/api/editor/mcp/entities').set('x-fc-job', token).expect(200);
    expect(list.body.some((row: { id: string }) => row.id === 'cactus')).toBe(true);
    expect((await request(h().server()).get('/api/editor/mcp/configs').set('x-fc-job', token).expect(200)).body.cactus.id).toBe('cactus');
  });

  it('mcp reads without a token, or from nginx, are 404', async () => {
    const token = await runningToken();
    await request(h().server()).get('/api/editor/mcp/entities/cactus').expect(404);
    await request(h().server()).get('/api/editor/mcp/entities/cactus').set('x-fc-job', 'junk').expect(404);
    await request(h().server()).get('/api/editor/mcp/entities/cactus').set('x-fc-job', token).set('X-Forwarded-For', '203.0.113.9').expect(404);
    await request(h().server()).get('/api/editor/mcp/entities').expect(404);
    await request(h().server()).get('/api/editor/mcp/entities').set('x-fc-job', 'junk').expect(404);
    await request(h().server()).get('/api/editor/mcp/configs').expect(404);
    await request(h().server()).get('/api/editor/mcp/configs').set('x-fc-job', token).set('X-Real-IP', '203.0.113.9').expect(404);
  });

  it('a bad entity id is 400; an unknown id is 404 entity_not_found', async () => {
    const token = await runningToken();
    await request(h().server()).get('/api/editor/mcp/entities/NOPE').set('x-fc-job', token).expect(400);
    const missing = await request(h().server()).get('/api/editor/mcp/entities/no-such').set('x-fc-job', token).expect(404);
    expect(missing.body.code).toBe('entity_not_found');
  });
}
