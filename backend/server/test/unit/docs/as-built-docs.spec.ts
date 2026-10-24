import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EnvService } from '../../../src/infrastructure/config/env.service.js';
import { pauseVerdict, slowMotionVerdict } from '../../../src/domain/rides/pause-bounds.js';

/** EnvService reads process.env at construction. Restore it before the assertion. */
const withEnv = (vars: Record<string, string | undefined>) => {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return new EnvService(); } finally { process.env = saved; }
};

const root = join(import.meta.dirname, '../../../../../');
const docs = {
  product: readFileSync(join(root, 'docs/spec/PRODUCT.md'), 'utf8'),
  status: readFileSync(join(root, 'docs/plan/spec-compliance/STATUS.md'), 'utf8'),
  coverage: readFileSync(join(root, 'docs/testing/COVERAGE_CONTRACT.md'), 'utf8'),
};
const honk = readFileSync(join(root, 'backend/server/src/presentation/honk/honk.http.controller.ts'), 'utf8');
const verdict = readFileSync(join(root, 'backend/server/src/application/services/verdict.service.ts'), 'utf8');

const base = {
  DATABASE_URL: 'postgresql://x/db', NODE_ENV: 'development', JWT_SECRET: undefined, TREASURY_PUBKEY: undefined,
  DEMO_WALLETS: undefined, TRUST_PROXY: undefined, CLIENT_DIR: undefined, COOKIE_DOMAIN: undefined, CORS_ORIGINS: undefined,
  ADMIN_JWT_SECRET: undefined, ADMIN_SESSION_TTL_MINUTES: undefined, PLEDGES_ENABLED: undefined,
};

/** The decorator on the route method. The status sentence has to follow this, not a remembered 404. */
function httpCodeFor(source: string, route: string): string {
  const at = source.indexOf(`'${route}'`);
  const window = source.slice(at, at + 80);
  const code = window.match(/@HttpCode\((\d+)\)/);
  if (!code) throw new Error(`no @HttpCode above ${route}`);
  return code[1];
}

describe('as-built docs match the shipped defaults', () => {
  const env = withEnv(base);
  const over = { count: 4, seconds: 301 };
  const off = pauseVerdict('off', over);
  const shadow = pauseVerdict('shadow', over);
  const enforce = pauseVerdict('enforce', over);
  const slowOff = slowMotionVerdict('off', 30, 120_000);
  const slowShadow = slowMotionVerdict('shadow', 30, 120_000);
  const slowEnforce = slowMotionVerdict('enforce', 30, 120_000);

  it('admin session, pledges, and RideResult sentences follow the code', () => {
    expect(env.adminSessionTtlMinutes).toBeLessThanOrEqual(60);
    expect(env.pledgesEnabled).toBe(false);
    expect(verdict).toContain('rideResults.upsert');
    const shipped = docs.product + docs.status;
    expect(shipped).toContain(String(env.adminSessionTtlMinutes));
    expect(shipped).toContain('revoked:jti');
    expect(docs.product).toContain('pledges_disabled');
    expect(docs.product).toContain('403');
    expect(docs.product).toContain('stats.RideResult');
    expect(docs.product).not.toContain('e8f338ad');
    for (const banned of ['120 minutes', 'logout does not revoke', 'There is no RideResult', 'there is no RideResult', 'pledges stay on', 'no per-ride']) {
      expect(shipped).not.toContain(banned);
    }
  });

  it('pause and slow-motion status follows pauseVerdict and slowMotionVerdict', () => {
    expect(off).toEqual([]);
    expect(slowOff).toEqual([]);
    expect(shadow.every((reason) => reason.severity === 'flag')).toBe(true);
    expect(slowShadow.every((reason) => reason.severity === 'flag')).toBe(true);
    expect(enforce.every((reason) => reason.severity === 'reject')).toBe(true);
    expect(slowEnforce.every((reason) => reason.severity === 'reject')).toBe(true);
    const text = docs.product + docs.status;
    expect(text).toContain('off` adds no reasons');
    expect(text).toContain('shadow` flags');
    expect(text).toContain('enforce` rejects');
  });

  it('honk time and weather status follows the controller status code', () => {
    const time = httpCodeFor(honk, 'watch/:id/honk/time');
    const weather = httpCodeFor(honk, 'watch/:id/honk/weather');
    expect(time).toBe(weather);
    const text = docs.product + docs.status;
    expect(text).toContain(`\`${time}\``);
    expect(text).toContain('honk/time');
    expect(text).toContain('honk/weather');
    expect(text).not.toContain('honk/weather` are `404`');
    expect(text).not.toContain('honk/time` and `honk/weather` are `404`');
    expect(docs.status).toContain('burn TEN4');
    expect(docs.status).toContain('LIVE_EFFECTS');
  });

  it('the coverage contract keeps the 2026-10-23 green gate figures', () => {
    expect(docs.coverage).toContain('11668 objects compared against golden.txt: identical');
    expect(docs.coverage).toContain('20/20');
    expect(docs.coverage).toContain('zero-scenario routes: 0');
    expect(docs.coverage).toContain('single-scenario routes: 0');
    expect(docs.coverage).toContain('178/178');
    for (const banned of ['18/20', '21 `veh|medic`', '21 ambulance', '57 routes', '57-route', 'Three gates are red']) {
      expect(docs.coverage + docs.product).not.toContain(banned);
    }
  });
});
