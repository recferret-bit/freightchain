import type { ExecutionContext } from '@nestjs/common';
import { throttlerOptions, THROTTLE_WINDOW_MS } from '../../../../src/infrastructure/http/throttling.js';
import { TokenSignerPort } from '../../../../src/application/ports/auth/token-signer.port.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

class Tokens extends TokenSignerPort {
  async sign() { return { token: 't', expiresAt: new Date(0) }; }
  async verify(token: string) { return token === 'good' ? 'WALLET' : null; }
}
const at = (path: string) => ({ switchToHttp: () => ({ getRequest: () => ({ path }) }) }) as unknown as ExecutionContext;
type Throttler = { name: string; ttl: number; limit: number; skipIf: (c: ExecutionContext) => boolean; getTracker?: (req: Record<string, unknown>, c: ExecutionContext) => Promise<string> };

describe('throttlerOptions', () => {
  const [general, auth] = throttlerOptions({ throttleLimit: 600, throttleAuthLimit: 30 } as EnvService, new Tokens()) as unknown as Throttler[];

  it('two per-minute budgets from the environment', () => {
    expect([general?.name, general?.limit, general?.ttl]).toEqual(['default', 600, THROTTLE_WINDOW_MS]);
    expect([auth?.name, auth?.limit, auth?.ttl]).toEqual(['auth', 30, THROTTLE_WINDOW_MS]);
  });

  it("'default' covers everything but health; 'auth' covers only /api/auth/*", () => {
    expect(general?.skipIf(at('/api/rides'))).toBe(false);
    expect(general?.skipIf(at('/api/health/ready'))).toBe(true);
    expect(auth?.skipIf(at('/api/auth/nonce'))).toBe(false);
    expect(auth?.skipIf(at('/api/rides'))).toBe(true);
  });

  it('counts a signed-in rider per wallet, everyone else (incl. a forged cookie) per IP', async () => {
    const track = (cookie?: string) => general?.getTracker?.({ headers: { cookie }, ip: '10.0.0.7' }, at('/api/live'));
    expect(await track('fc_session=good')).toBe('wallet:WALLET');
    expect(await track('fc_session=forged')).toBe('ip:10.0.0.7');
    expect(await track()).toBe('ip:10.0.0.7');
  });

  it("'entities' (per IP) and 'editor' (per editor session, else per IP) cover only their paths; 'default' skips both; the editor sign-in also counts in 'auth'", async () => {
    const editorTokens = { verify: async (t: string) => (t === 'ed' ? 'ED' : null) } as never;
    const all = throttlerOptions({ throttleLimit: 600, throttleAuthLimit: 30, throttleEntitiesLimit: 120, throttleEditorLimit: 240 } as EnvService, new Tokens(), editorTokens) as unknown as Throttler[];
    const [def, au, ent, ed] = all;
    expect([ent?.name, ent?.limit, ed?.name, ed?.limit]).toEqual(['entities', 120, 'editor', 240]);
    expect([def?.skipIf(at('/api/entities/bundle')), def?.skipIf(at('/api/editor/me')), ent?.skipIf(at('/api/entities/bundle')), ent?.skipIf(at('/api/rides'))]).toEqual([true, true, false, true]);
    expect([ed?.skipIf(at('/api/editor/entities')), ed?.skipIf(at('/api/rides')), au?.skipIf(at('/api/editor/auth/nonce')), au?.skipIf(at('/api/editor/me'))]).toEqual([false, true, false, true]);
    expect(await ed?.getTracker?.({ headers: { cookie: 'fc_editor=ed' }, ip: '10.0.0.7' }, at('/api/editor/me'))).toBe('editor:ED');
    expect(await ed?.getTracker?.({ headers: { cookie: 'fc_editor=x' }, ip: '10.0.0.7' }, at('/api/editor/me'))).toBe('ip:10.0.0.7');
  });
});
