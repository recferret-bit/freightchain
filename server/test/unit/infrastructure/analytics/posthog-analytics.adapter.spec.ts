import { Logger } from '@nestjs/common';
import { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { PostHogAnalyticsAdapter } from '../../../../src/infrastructure/analytics/posthog-analytics.adapter.js';
import type { AnalyticsEvent } from '../../../../src/application/ports/analytics/analytics.port.js';

const KNOWN = 'd3641cb2-da2e-5f46-aacf-ef1652eabf75';

const boot = (extra: Record<string, string | undefined> = {}) => {
  const saved = { ...process.env };
  for (const key of ['JWT_SECRET', 'TREASURY_PUBKEY', 'POSTHOG_KEY', 'POSTHOG_HOST', 'POSTHOG_ENABLED', 'POSTHOG_DISABLED', 'POSTHOG_PROJECT_ID', 'DEMO_WALLETS']) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: 'postgresql://x/db', ...extra });
  for (const [key, value] of Object.entries(extra)) if (value === undefined) delete process.env[key];
  try {
    return new PostHogAnalyticsAdapter(new EnvService());
  } finally {
    process.env = saved;
  }
};

const sample = (over: Partial<AnalyticsEvent> = {}): AnalyticsEvent => ({
  event: 'ride_ordered', distinctId: 'w', uuid: null, dedupeKey: 'ride:1:ordered', timestamp: new Date('2036-10-08T12:00:00.000Z'),
  properties: { source: 'server', ride_id: '1' }, ...over,
});

describe('PostHogAnalyticsAdapter', () => {
  beforeEach(() => { vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('is disabled with no key, an empty key, or a key that is not phc_', () => {
    expect(boot().enabled()).toBe(false);
    expect(boot({ POSTHOG_KEY: '' }).enabled()).toBe(false);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const bad = boot({ POSTHOG_KEY: 'phx_pasted' });
    expect(bad.enabled()).toBe(false);
    bad.capture(sample());
    expect(warn.mock.calls.some((c) => c[0] === 'analytics disabled: POSTHOG_KEY is not a project token')).toBe(true);
  });

  it('stays off unless POSTHOG_ENABLED is 1 or true, and the kill switch still wins', () => {
    expect(boot({ POSTHOG_KEY: 'phc_test' }).enabled()).toBe(false);
    expect(boot({ POSTHOG_KEY: 'phc_test', POSTHOG_ENABLED: '0' }).enabled()).toBe(false);
    expect(boot({ POSTHOG_KEY: 'phc_test', POSTHOG_ENABLED: 'false' }).enabled()).toBe(false);
    expect(boot({ POSTHOG_KEY: 'phc_test', POSTHOG_ENABLED: '1' }).enabled()).toBe(true);
    expect(boot({ POSTHOG_KEY: 'phc_test', POSTHOG_ENABLED: 'true', POSTHOG_DISABLED: 'false' }).enabled()).toBe(true);
    expect(boot({ POSTHOG_KEY: 'phc_test', POSTHOG_ENABLED: '1', POSTHOG_DISABLED: '0' }).enabled()).toBe(true);
    expect(boot({ POSTHOG_KEY: 'phc_test', POSTHOG_ENABLED: '1', POSTHOG_DISABLED: 'true' }).enabled()).toBe(false);
    expect(boot({ POSTHOG_KEY: 'phc_test', POSTHOG_ENABLED: '1', POSTHOG_DISABLED: '1' }).enabled()).toBe(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    boot({ POSTHOG_KEY: 'phc_test' }).capture(sample());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a full queue posts uuid, dedupe_key and source, and omits $insert_id, sent_at and $groups', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      bodies.push(`${url}\n${String(init?.body)}`);
      return { ok: true, status: 200, body: { cancel: async () => undefined } };
    });
    const adapter = boot({ POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'https://posthog.test/', POSTHOG_PROJECT_ID: 'proj-not-sent', POSTHOG_ENABLED: '1' });
    for (let i = 0; i < 18; i++) adapter.capture(sample({ dedupeKey: `ride:${i}:ordered` }));
    adapter.capture(sample({ event: 'landing_viewed', dedupeKey: null, uuid: null, properties: { source: 'client', surface: 'hero' } }));
    adapter.capture(sample());
    const okLine = 'analytics flush ok status=200 events=20 name='
      + `${Array.from({ length: 18 }, () => 'ride_ordered').join(',')},landing_viewed,ride_ordered`;
    await vi.waitFor(() => {
      expect(bodies).toHaveLength(1);
      const logged = vi.mocked(Logger.prototype.log).mock.calls.map((call) => String(call[0]));
      expect(logged).toContain(okLine);
    });
    expect(okLine).not.toContain('phc_test');
    expect(okLine).not.toContain('api_key');
    const [url, raw] = bodies[0]!.split('\n');
    expect(url).toBe('https://posthog.test/batch/');
    const body = JSON.parse(raw!) as { api_key: string; batch: Record<string, unknown>[]; sent_at?: string; $groups?: unknown };
    expect(body.api_key).toBe('phc_test');
    expect(body.sent_at).toBeUndefined();
    expect(body.$groups).toBeUndefined();
    expect(raw).not.toContain('$insert_id');
    expect(raw).not.toContain('proj-not-sent');
    expect(raw).not.toContain('$groups');
    const deduped = body.batch.find((row) => (row['properties'] as { dedupe_key?: string }).dedupe_key === 'ride:1:ordered')!;
    expect(deduped['uuid']).toBe(KNOWN);
    expect(deduped['uuid']).not.toBe('ride:1:ordered');
    expect(deduped['properties']).toMatchObject({ source: 'server', $lib: 'freightchain-server', dedupe_key: 'ride:1:ordered' });
    expect(deduped).not.toHaveProperty('$insert_id');
    expect(deduped).not.toHaveProperty('$groups');
    const client = body.batch.find((row) => row['event'] === 'landing_viewed')!;
    expect(client).not.toHaveProperty('uuid');
    expect(client['properties']).toMatchObject({ source: 'client', $lib: 'freightchain-web' });
  });

  it('flushes a short queue after 1s', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(String(init?.body));
      return { ok: true, status: 200, body: null };
    });
    vi.useFakeTimers();
    const adapter = boot({ POSTHOG_KEY: 'phc_test', POSTHOG_ENABLED: '1' });
    adapter.capture(sample());
    expect(bodies).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(bodies).toHaveLength(1);
  });

  it('an HTTP 500 is swallowed and logged without the body', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, body: { cancel: async () => undefined } }));
    const adapter = boot({ POSTHOG_KEY: 'phc_test', POSTHOG_ENABLED: '1' });
    expect(() => { for (let i = 0; i < 20; i++) adapter.capture(sample({ dedupeKey: `k${i}` })); }).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    const line = String(warn.mock.calls.at(-1)?.[0]);
    expect(line).toContain('status=500');
    expect(line).toContain('events=20');
    expect(line).toContain('name=');
    expect(line).not.toContain('phc_test');
    expect(line).not.toContain('api_key');
  });

  it('a throwing fetch is swallowed', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', async () => { throw new Error('network down'); });
    const adapter = boot({ POSTHOG_KEY: 'phc_test', POSTHOG_ENABLED: '1' });
    expect(() => { for (let i = 0; i < 20; i++) adapter.capture(sample()); }).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(String(warn.mock.calls.at(-1)?.[0])).toContain('status=0');
  });
});
