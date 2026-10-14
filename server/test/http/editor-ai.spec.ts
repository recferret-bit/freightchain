import request from 'supertest';
import { newWallet, sign } from '../support/client.js';
import { createHarness, type Harness } from '../support/harness.js';
import { validateEnv } from '../../src/infrastructure/config/env.schema.js';

/* The AI editor's switches: /me offers exactly the providers whose key is set (and none without the MCP token), the default provider, the 256 KB
   body limit of /api/editor/* (only there), and the fake provider never in production. */
const ED = newWallet(), MCP = { EDITOR_MCP_TOKEN: 'x'.repeat(32) };
async function me(h: Harness) {
  const agent = request.agent(h.server());
  const { body } = await agent.post('/api/editor/auth/nonce').set('x-fc-editor', '1').send({ wallet: ED.address }).expect(200);
  await agent.post('/api/editor/auth/verify').set('x-fc-editor', '1').send({ wallet: ED.address, signature: sign(ED.kp, body.message) }).expect(200);
  return { agent, me: (await agent.get('/api/editor/me').expect(200)).body as { providers: { id: string; models: string[]; default: string }[]; defaultProvider: string | null } };
}

describe('HTTP · the AI editor\'s providers and limits', () => {
  let h: Harness;
  afterEach(() => h.close());

  it('the providers with a key (+ the test fake), their models and the default; EDITOR_DEFAULT_PROVIDER picks it', async () => {
    h = await createHarness('memory', { ...MCP, EDITOR_WALLETS: ED.address, ANTHROPIC_API_KEY: 'sk-test-anthropic', GEMINI_API_KEY: 'test-gemini-key', EDITOR_MODEL_GEMINI: 'gemini-x', EDITOR_DEFAULT_PROVIDER: 'gemini' });
    const { me: m } = await me(h);
    expect(m.providers.map((p) => p.id)).toEqual(['anthropic', 'gemini', 'fake']);
    expect(m.providers[0]).toMatchObject({ models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1'], default: 'claude-opus-5-5' });
    expect(m.providers[1]).toMatchObject({ models: ['gemini-x'], default: 'gemini-x' });
    expect(m.defaultProvider).toBe('gemini');
    expect(JSON.stringify(m)).not.toMatch(/sk-test|test-gemini-key/);
  });

  it('without EDITOR_MCP_TOKEN there is no AI editor: no providers, a job is a 503', async () => {
    h = await createHarness('memory', { EDITOR_WALLETS: ED.address, ANTHROPIC_API_KEY: 'sk-test-anthropic' });
    const { agent, me: m } = await me(h);
    expect([m.providers, m.defaultProvider]).toEqual([[], null]);
    await agent.post('/api/editor/jobs').set('x-fc-editor', '1').send({ prompt: 'taller', entityId: 'cactus' }).expect(503);
  });

  it('/api/editor/* takes bodies up to 256 KB (a whole entity file, escaped); every other route keeps 100 KB', async () => {
    h = await createHarness('memory', { ...MCP, EDITOR_WALLETS: ED.address });
    const { agent } = await me(h);
    const big = `export default {${'\n'.repeat(60_000)}};`;   // ~120 KB as JSON: not a valid entity, but not too large
    const res = await agent.post('/api/editor/entities/cactus/drafts').set('x-fc-editor', '1').send({ source: big, message: '', baseRevisionId: null });
    expect(res.status).toBe(422);
    expect((await request(h.server()).post('/api/auth/nonce').send({ wallet: ED.address, pad: 'x'.repeat(120_000) })).status).toBe(413);
  });

  it('EDITOR_FAKE_LLM=1 is refused in production', () => {
    expect(() => validateEnv({ DATABASE_URL: 'postgresql://x/y', NODE_ENV: 'production', JWT_SECRET: 'j'.repeat(40), TREASURY_PUBKEY: ED.address, TRUST_PROXY: '1', EDITOR_FAKE_LLM: '1' })).toThrow(/EDITOR_FAKE_LLM/);
  });
});
