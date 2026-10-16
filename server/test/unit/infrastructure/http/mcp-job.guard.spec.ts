import type { ExecutionContext } from '@nestjs/common';
import { McpJobGuard } from '../../../../src/infrastructure/http/guards/mcp-job.guard.js';
import { JobTokenPort } from '../../../../src/application/ports/editor/job-token.port.js';
import { NotFoundError } from '../../../../src/domain/shared/errors.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { MemoryEditorJobRepository } from '../../../support/in-memory/memory-editor-jobs.js';
import { MemoryDb } from '../../../support/in-memory/memory-db.js';

const clock = { now: () => new Date(0) };
const J = '00000000-0000-4000-8000-000000000001';
class Tokens extends JobTokenPort {
  async sign() { return 't'; }
  async verify(t: string) { return t === 'good' ? { jobId: J, wallet: 'ED', entityId: 'cactus' } : null; }
}
const ctx = (headers: Record<string, string>) => { const request: Record<string, unknown> = { headers }; return { request, ctx: { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext }; };

describe('McpJobGuard', () => {
  const setup = async (status: 'running' | 'queued' = 'running', editors = ['ED']) => {
    const db = new MemoryDb(), jobs = new MemoryEditorJobRepository(db);
    await jobs.insert({ id: J, wallet: 'ED', prompt: 'p', provider: 'fake', model: 'scripted', entityId: 'cactus', baseRevisionId: null, resultRevisionId: null, status, error: null, tokensIn: 0, tokensOut: 0, createdAt: new Date(0), startedAt: new Date(0), finishedAt: null });
    return new McpJobGuard(new Tokens(), jobs, { editorWallets: new Set(editors), editorJobTimeoutMs: 600000 } as unknown as EnvService, clock);
  };

  it('a valid token of a RUNNING job of a listed wallet passes; the claims and the wallet go on the request', async () => {
    const { request, ctx: c } = ctx({ 'x-fc-job': 'good' });
    expect(await (await setup()).canActivate(c)).toBe(true);
    expect(request['job']).toEqual({ jobId: J, wallet: 'ED', entityId: 'cactus' });
    expect(request['player']).toEqual({ wallet: 'ED' });
  });

  it('404: no / bad token, a job not running, a wallet off the list, anything that came through nginx', async () => {
    const no = async (g: McpJobGuard, h: Record<string, string>) => expect(g.canActivate(ctx(h).ctx)).rejects.toBeInstanceOf(NotFoundError);
    await no(await setup(), {});
    await no(await setup(), { 'x-fc-job': 'bad' });
    await no(await setup('queued'), { 'x-fc-job': 'good' });
    await no(await setup('running', []), { 'x-fc-job': 'good' });
    await no(await setup(), { 'x-fc-job': 'good', 'x-forwarded-for': '1.2.3.4' });
    await no(await setup(), { 'x-fc-job': 'good', 'x-real-ip': '1.2.3.4' });
    const mismatched = new McpJobGuard(new (class extends Tokens { override async verify() { return { jobId: J, wallet: 'ED', entityId: 'rock' }; } })(), (await (async () => { const db = new MemoryDb(), jobs = new MemoryEditorJobRepository(db); await jobs.insert({ id: J, wallet: 'ED', prompt: 'p', provider: 'fake', model: 'scripted', entityId: 'cactus', baseRevisionId: null, resultRevisionId: null, status: 'running', error: null, tokensIn: 0, tokensOut: 0, createdAt: new Date(0), startedAt: new Date(0), finishedAt: null }); return jobs; })()), { editorWallets: new Set(['ED']), editorJobTimeoutMs: 600000 } as unknown as EnvService, clock);
    await no(mismatched, { 'x-fc-job': 'good' });
  });
  it('a token cannot keep an expired running claim alive until the next sweep', async () => {
    const g = await setup();
    const now = vi.spyOn(clock, 'now').mockReturnValue(new Date(600000));
    try { await expect(g.canActivate(ctx({ 'x-fc-job': 'good' }).ctx)).rejects.toBeInstanceOf(NotFoundError); }
    finally { now.mockRestore(); }
  });

});
