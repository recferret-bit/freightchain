import request from 'supertest';
import type { Agent } from 'supertest';
import { printSource, SEED_ENTITIES } from '../../src/domain/shared/entity.js';
import { bindClient, newWallet, sign } from '../support/client.js';
import { fatCactus, seedEntity } from '../support/entity-fixtures.js';
import type { Harness } from '../support/harness.js';

/* The 3D model API (docs/spec/platform_services.md): the public bundle every page loads, and the editor (EDITOR_WALLETS only) – drafts, history, restore, the signed
   publish that is the only way a change reaches the players. Same scenarios on in-memory and PostgreSQL; single origin (any host). */
export const EDITOR = newWallet();
export const EDITOR_ENV = { EDITOR_WALLETS: EDITOR.address };

export function editorScenarios(h: () => Harness): void {
  const { anon, login } = bindClient(h);
  beforeEach(() => h().reset());
  const X = 'x-fc-editor';

  async function signIn(w = EDITOR): Promise<Agent> {
    const agent = request.agent(h().server());
    const { body } = await agent.post('/api/editor/auth/nonce').set(X, '1').send({ wallet: w.address }).expect(200);
    const res = await agent.post('/api/editor/auth/verify').set(X, '1').send({ wallet: w.address, signature: sign(w.kp, body.message) }).expect(200);
    expect(res.body.wallet).toBe(w.address);
    expect(String(res.headers['set-cookie'])).toMatch(/fc_editor=.*Path=\/api\/editor.*HttpOnly.*SameSite=Strict/i);
    return agent;
  }
  const draft = (a: Agent, id: string, source: string, baseRevisionId: string | null, message = '') => a.post(`/api/editor/entities/${id}/drafts`).set(X, '1').send({ source, message, baseRevisionId });

  it('the bundle: public, every seed model, cacheable – an unchanged one is a 304', async () => {
    const res = await anon().get('/api/entities/bundle').expect(200);
    expect(res.body.entities.map((e: { id: string }) => e.id).sort()).toEqual(SEED_ENTITIES.map((e) => e.id).sort());
    expect(res.body.rev).toMatch(/^[0-9a-f]{16}$/);
    expect(res.headers['cache-control']).toBe('public, max-age=60, stale-while-revalidate=600');
    expect(res.headers['etag']).toBeTruthy();
    await anon().get('/api/entities/bundle').set('If-None-Match', String(res.headers['etag'])).expect(304);
  });

  it('the editor does not exist for anyone else: signed out, a rider, a wallet off the list → 404 everywhere', async () => {
    for (const path of ['me', 'entities', 'entities/cactus', 'entities/cactus/revisions']) await anon().get(`/api/editor/${path}`).expect(404);
    const rider = await login();
    await rider.agent.get('/api/editor/me').expect(404);
    await anon().post('/api/editor/auth/nonce').set(X, '1').send({ wallet: newWallet().address }).expect(404);
    expect((await signIn().then((a) => a.get('/api/editor/me').expect(200))).body).toEqual({ wallet: EDITOR.address, providers: [], defaultProvider: null });
  });

  it('a draft: the seed becomes #1, the edit #2 (HEAD); the list, the head and the history say so; changes need the header', async () => {
    const a = await signIn();
    await a.post('/api/editor/entities/cactus/drafts').send({ source: fatCactus(), message: '', baseRevisionId: null }).expect(403);
    const r2 = (await draft(a, 'cactus', fatCactus(), null, 'fatter').expect(200)).body;
    expect(r2).toMatchObject({ entityId: 'cactus', seq: 2, head: true, published: false, message: 'fatter', authorWallet: EDITOR.address });
    const head = (await a.get('/api/editor/entities/cactus').expect(200)).body;
    expect(head.row).toMatchObject({ source: 'db', headRevisionId: r2.id, headSeq: 2, publishedRevisionId: null });
    expect(head.source).toBe(r2.source);
    const history = (await a.get('/api/editor/entities/cactus/revisions').expect(200)).body;
    expect(history.map((r: { seq: number; authorWallet: string }) => [r.seq, r.authorWallet])).toEqual([[2, EDITOR.address], [1, 'seed']]);
    expect((await a.get(`/api/editor/revisions/${history[1].id}`).expect(200)).body.source).toBe(printSource(seedEntity('cactus')));
    expect((await a.get('/api/editor/entities').expect(200)).body.find((r: { id: string }) => r.id === 'rock')).toMatchObject({ source: 'seed', headRevisionId: null });
  });

  it('refusals: an invalid file is a 422 with the reasons, a stale base a 409, an unknown revision a 404', async () => {
    const a = await signIn();
    const bad = seedEntity('cactus'); (bad['parts'] as { s: unknown[] }[])[0]!.s[1] = 'h * nope';
    const invalid = await draft(a, 'cactus', printSource(bad), null).expect(422);
    expect(invalid.body).toMatchObject({ code: 'entity_invalid' });
    expect(invalid.body.errors.join(' ')).toMatch(/unknown name 'nope'/);
    expect((await draft(a, 'cactus', 'export default { id: "cactus", parts: alert(1) };', null).expect(422)).body.errors[0]).toMatch(/only plain data/);
    const r2 = (await draft(a, 'cactus', fatCactus(), null).expect(200)).body;
    expect((await draft(a, 'cactus', fatCactus(0.5), null).expect(409)).body.code).toBe('stale_base');
    await draft(a, 'cactus', fatCactus(0.5), r2.id).expect(200);
    await a.get('/api/editor/revisions/00000000-0000-4000-8000-000000000999').expect(404);
  });

  it('a draft never reaches the players; the signed publish does – at once', async () => {
    const a = await signIn();
    const before = (await anon().get('/api/entities/bundle').expect(200)).body;
    const r2 = (await draft(a, 'cactus', fatCactus(), null).expect(200)).body;
    expect((await anon().get('/api/entities/bundle').expect(200)).body.rev).toBe(before.rev);
    const { body } = await a.post('/api/editor/entities/cactus/publish/challenge').set(X, '1').send({ revisionId: r2.id }).expect(200);
    expect(body.message).toContain('PUBLISH 3D model cactus');
    await a.post('/api/editor/entities/cactus/publish').set(X, '1').send({ revisionId: r2.id, signature: 'bad' }).expect(401);
    const { body: again } = await a.post('/api/editor/entities/cactus/publish/challenge').set(X, '1').send({ revisionId: r2.id }).expect(200);
    const pub = (await a.post('/api/editor/entities/cactus/publish').set(X, '1').send({ revisionId: r2.id, signature: sign(EDITOR.kp, again.message) }).expect(200)).body;
    const after = (await anon().get('/api/entities/bundle').expect(200)).body;
    expect(after.rev).toBe(pub.rev);
    expect(after.rev).not.toBe(before.rev);
    expect(after.entities.find((e: { id: string }) => e.id === 'cactus')).toEqual(r2.config);
    expect((await a.get('/api/editor/entities/cactus/revisions').expect(200)).body[0]).toMatchObject({ id: r2.id, head: true, published: true });
  });

  it('restore: a NEW head that copies an older revision; the history only grows', async () => {
    const a = await signIn();
    const r2 = (await draft(a, 'cactus', fatCactus(), null).expect(200)).body;
    const seed = (await a.get('/api/editor/entities/cactus/revisions').expect(200)).body[1];
    const r3 = (await a.post('/api/editor/entities/cactus/restore').set(X, '1').send({ revisionId: seed.id, baseRevisionId: r2.id }).expect(200)).body;
    expect(r3).toMatchObject({ seq: 3, head: true, message: 'restore of #1', source: printSource(seedEntity('cactus')) });
    expect((await a.get('/api/editor/entities/cactus/revisions').expect(200)).body.map((r: { seq: number }) => r.seq)).toEqual([3, 2, 1]);
  });
}
