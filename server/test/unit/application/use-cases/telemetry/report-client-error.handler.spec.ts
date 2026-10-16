import { Logger } from '@nestjs/common';
import { CLIENT_ERROR_DAY_LIMIT, CLIENT_ERROR_IP_LIMIT } from '../../../../../src/domain/analytics/client-error.js';
import { ReportClientErrorHandler } from '../../../../../src/application/use-cases/telemetry/report-client-error/report-client-error.handler.js';
import { ReportClientErrorCommand } from '../../../../../src/application/use-cases/telemetry/report-client-error/report-client-error.command.js';
import { FakeClock } from '../../../../support/fake-clock.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';

const ANON = 'anon_00000000-0000-4000-8000-000000000000';

const frame = (filename: string, lineno = 10) => ({ filename, function: 'boom', lineno, colno: 4 });

const setup = (on = true) => {
  const analytics = new RecordingAnalytics();
  analytics.on = on;
  const clock = new FakeClock();
  const handler = new ReportClientErrorHandler(analytics, clock);
  const run = (over: Partial<{ wallet: string | null; ip: string; anonId: string | null; name: string; value: string; surface: string; release: string | null; frames: ReturnType<typeof frame>[] }> = {}) =>
    handler.execute(new ReportClientErrorCommand(over.wallet === undefined ? null : over.wallet, over.ip ?? '203.0.113.5', over.anonId === undefined ? ANON : over.anonId, {
      surface: over.surface ?? 'landing', release: over.release === undefined ? 'abc1234' : over.release, name: over.name ?? 'TypeError', value: over.value ?? 'x is undefined',
      frames: over.frames ?? [frame('https://freightchain.fun/assets/index-abc.js', 12), frame('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', 9)],
    }));
  return { analytics, clock, run };
};

describe('ReportClientErrorHandler', () => {
  beforeEach(() => { vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('disabled answers enabled false and does not queue', async () => {
    const { analytics, run } = setup(false);
    expect(await run()).toEqual({ enabled: false, accepted: 0 });
    expect(analytics.exceptions).toEqual([]);
    expect(analytics.events).toEqual([]);
  });

  it('sends one exception for the session wallet, throw site last, third-party frames out of app', async () => {
    const { analytics, clock, run } = setup();
    expect(await run({ wallet: 'WALLET', value: 'failed https://x.test/a?sig=1 ' + '1'.repeat(50) })).toEqual({ enabled: true, accepted: 1 });
    expect(analytics.exceptions).toHaveLength(1);
    const row = analytics.exceptions[0]!;
    expect(row.distinctId).toBe('WALLET');
    expect(row.timestamp).toEqual(clock.now());
    expect(row.surface).toBe('landing');
    expect(row.release).toBe('abc1234');
    expect(row.value).not.toContain('sig=');
    expect(row.value).toContain('[redacted]');
    expect(row.frames.map((f) => f.filename)).toEqual([
      'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
      'https://freightchain.fun/assets/index-abc.js',
    ]);
    expect(row.frames[0]?.inApp).toBe(false);
    expect(row.frames[1]?.inApp).toBe(true);
    expect(analytics.named('client_crashed')).toEqual([expect.objectContaining({
      event: 'client_crashed', distinctId: 'WALLET', uuid: null, dedupeKey: null, timestamp: clock.now(),
      properties: { source: 'client', surface: 'landing', error: 'TypeError', in_app: true, release: 'abc1234' },
    })]);
    expect(JSON.stringify(analytics.named('client_crashed')[0]?.properties)).not.toContain('sig=');
  });

  it('drops a hidden cross-origin error, an extension frame, and a bad anon with no wallet', async () => {
    const { analytics, run } = setup();
    expect(await run({ name: 'Error', value: 'Script error.' })).toEqual({ enabled: true, accepted: 0 });
    expect(await run({ value: 'ResizeObserver loop limit exceeded' })).toEqual({ enabled: true, accepted: 0 });
    expect(await run({ name: 'Error', value: 'Uncaught AbortError: The operation was aborted' })).toEqual({ enabled: true, accepted: 0 });
    expect(await run({ frames: [frame('chrome-extension://abc/page.js')] })).toEqual({ enabled: true, accepted: 0 });
    expect(await run({ anonId: 'not-an-anon', wallet: null })).toEqual({ enabled: true, accepted: 0 });
    expect(analytics.exceptions).toEqual([]);
    expect(analytics.events).toEqual([]);
  });

  it('a blank wallet is not the distinct id, a browser Uncaught prefix is peeled, and url userinfo is cut', async () => {
    const { analytics, run } = setup();
    expect(await run({
      wallet: '', name: 'Error', value: 'Uncaught TypeError: bad https://user:secret@freightchain.fun/a.js?sig=1',
      frames: [frame('https://user:secret@freightchain.fun/js/main.js?x=1', 4)],
    })).toEqual({ enabled: true, accepted: 1 });
    expect(await run({ wallet: '   ', value: 'spaces' })).toEqual({ enabled: true, accepted: 1 });
    const row = analytics.exceptions[0]!;
    expect(row.distinctId).toBe(ANON);
    expect(row.type).toBe('TypeError');
    expect(row.value).toBe('bad https://freightchain.fun/a.js');
    expect(row.frames[0]?.filename).toBe('https://freightchain.fun/js/main.js');
    expect(analytics.exceptions[1]?.distinctId).toBe(ANON);
    expect(analytics.named('client_crashed').map((event) => event.distinctId)).toEqual([ANON, ANON]);
    expect(analytics.named('client_crashed')[0]?.properties['error']).toBe('TypeError');
    expect(JSON.stringify(analytics.named('client_crashed')[0]?.properties)).not.toContain('secret');
    expect(JSON.stringify(analytics.named('client_crashed')[0]?.properties)).not.toContain('bad https');
  });

  it('a release that is not a sha is omitted, and the anon id is the distinct id when no wallet is signed in', async () => {
    const { analytics, run } = setup();
    expect(await run({ release: '../secret', wallet: null, frames: [] })).toEqual({ enabled: true, accepted: 1 });
    expect(analytics.exceptions[0]).toMatchObject({ distinctId: ANON, release: null });
    expect(analytics.named('client_crashed')[0]?.properties).toEqual({ source: 'client', surface: 'landing', error: 'TypeError', in_app: null });
  });

  it('ten reports per IP per minute, then silence until the window moves', async () => {
    const { analytics, clock, run } = setup();
    for (let i = 0; i < CLIENT_ERROR_IP_LIMIT; i++) expect((await run({ ip: '198.51.100.9', value: `e${i}` })).accepted).toBe(1);
    expect((await run({ ip: '198.51.100.9', value: 'over' })).accepted).toBe(0);
    expect(analytics.exceptions).toHaveLength(CLIENT_ERROR_IP_LIMIT);
    expect(analytics.named('client_crashed')).toHaveLength(CLIENT_ERROR_IP_LIMIT);
    expect(vi.mocked(Logger.prototype.warn).mock.calls.some((c) => c[0] === 'client-error dropped ip-cap')).toBe(true);
    clock.advance(61);
    expect((await run({ ip: '198.51.100.9', value: 'later' })).accepted).toBe(1);
  });

  it('stops at the daily cap and starts again on the next UTC day', async () => {
    const { analytics, clock, run } = setup();
    for (let i = 0; i < CLIENT_ERROR_DAY_LIMIT; i++) await run({ ip: `203.0.113.${i % 200}`, value: `d${i}` });
    expect(analytics.exceptions).toHaveLength(CLIENT_ERROR_DAY_LIMIT);
    expect(analytics.named('client_crashed')).toHaveLength(CLIENT_ERROR_DAY_LIMIT);
    expect((await run({ ip: '198.51.100.40', value: 'over-day' })).accepted).toBe(0);
    expect(analytics.named('client_crashed')).toHaveLength(CLIENT_ERROR_DAY_LIMIT);
    expect(vi.mocked(Logger.prototype.warn).mock.calls.some((c) => c[0] === 'client-error dropped day-cap')).toBe(true);
    clock.advance(24 * 60 * 60);
    expect((await run({ ip: '198.51.100.40', value: 'next-day' })).accepted).toBe(1);
  });

  it('a throwing capture still answers accepted 1 and does not burn the daily slot', async () => {
    const { analytics, run } = setup();
    analytics.throwOnCapture = true;
    expect(await run({ ip: '198.51.100.77' })).toEqual({ enabled: true, accepted: 1 });
    expect(analytics.exceptions).toEqual([]);
    expect(analytics.events).toEqual([]);
    analytics.throwOnCapture = false;
    for (let i = 0; i < CLIENT_ERROR_DAY_LIMIT; i++) expect((await run({ ip: `203.0.113.${i % 200}`, value: `t${i}` })).accepted).toBe(1);
    expect(analytics.exceptions).toHaveLength(CLIENT_ERROR_DAY_LIMIT);
    expect(analytics.named('client_crashed')).toHaveLength(CLIENT_ERROR_DAY_LIMIT);
    expect((await run({ ip: '198.51.100.40', value: 'over-day' })).accepted).toBe(0);
  });

  it('a throw from the product event still answers accepted 1 and does not burn the daily slot', async () => {
    const { analytics, run } = setup();
    analytics.throwOnEvent = true;
    expect(await run({ ip: '198.51.100.77' })).toEqual({ enabled: true, accepted: 1 });
    expect(analytics.exceptions).toHaveLength(1);
    expect(analytics.events).toEqual([]);
    analytics.throwOnEvent = false;
    for (let i = 0; i < CLIENT_ERROR_DAY_LIMIT; i++) expect((await run({ ip: `203.0.113.${i % 200}`, value: `p${i}` })).accepted).toBe(1);
    expect(analytics.exceptions).toHaveLength(CLIENT_ERROR_DAY_LIMIT + 1);
    expect(analytics.named('client_crashed')).toHaveLength(CLIENT_ERROR_DAY_LIMIT);
    expect((await run({ ip: '198.51.100.40', value: 'over-day' })).accepted).toBe(0);
  });
});
