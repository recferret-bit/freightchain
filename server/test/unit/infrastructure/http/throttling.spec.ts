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
});
