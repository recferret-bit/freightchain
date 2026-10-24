import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EnvService } from '../../../src/infrastructure/config/env.service.js';
import { pauseVerdict, slowMotionVerdict } from '../../../src/domain/rides/pause-bounds.js';
import { BadRequestError, NotFoundError } from '../../../src/domain/shared/errors.js';
import { isPublicReplay, replayDenial, type ReplaySubject } from '../../../src/domain/live/replay-visibility.js';
import { LiveDonationService } from '../../../src/application/live/live-donation.service.js';
import { BurnHonkTimeCommand, BurnHonkTimeHandler } from '../../../src/application/use-cases/honk/burn-honk-time.handler.js';
import { BurnHonkWeatherCommand, BurnHonkWeatherHandler } from '../../../src/application/use-cases/honk/burn-honk-weather.handler.js';

/** EnvService reads process.env at construction. Restore it before the assertion. */
const withEnv = (vars: Record<string, string | undefined>) => {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return new EnvService(); } finally { process.env = saved; }
};

const root = join(import.meta.dirname, '../../../../../');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const docs = {
  product: read('docs/spec/PRODUCT.md'),
  status: read('docs/plan/spec-compliance/STATUS.md'),
  issue: read('docs/plan/spec-compliance/issues/SPC-04-replays-streams-donations-and-i18n.md'),
  coverage: read('docs/testing/COVERAGE_CONTRACT.md'),
  logout: read('backend/server/test/scenarios/http-gaps-editor.scenarios.ts'),
  history: read('backend/server/src/infrastructure/prisma/repositories/ride-query.prisma.repository.ts'),
};
const verdict = read('backend/server/src/application/services/verdict.service.ts');

/** Text of one `###` section, through the next heading of the same level. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`missing heading ${heading}`);
  const rest = markdown.slice(start + heading.length);
  const next = rest.search(/\n### /);
  return next < 0 ? rest : rest.slice(0, next);
}

/** The shipped cell of one conflicts-table row. */
function conflictRow(markdown: string, topic: string): string {
  const row = markdown.split('\n').find((line) => line.startsWith(`| ${topic} |`));
  if (!row) throw new Error(`missing conflict row ${topic}`);
  const cells = row.split('|').map((cell) => cell.trim()).filter((cell) => cell.length > 0);
  const shipped = cells[1];
  if (!shipped) throw new Error(`missing shipped cell ${topic}`);
  return shipped;
}

function tableRow(markdown: string, firstCell: string): string {
  const row = markdown.split('\n').find((line) => line.startsWith(`| ${firstCell} |`));
  if (!row) throw new Error(`missing row ${firstCell}`);
  return row;
}

/** The span must carry the code result, and must not carry a different outcome for that subject. */
function expectSpan(span: string, must: string[], mustNot: string[]): void {
  for (const token of must) expect(span).toContain(token);
  for (const token of mustNot) expect(span).not.toContain(token);
}

const base = {
  DATABASE_URL: 'postgresql://x/db', NODE_ENV: 'development', JWT_SECRET: undefined, TREASURY_PUBKEY: undefined,
  DEMO_WALLETS: undefined, TRUST_PROXY: undefined, CLIENT_DIR: undefined, COOKIE_DOMAIN: undefined, CORS_ORIGINS: undefined,
  ADMIN_JWT_SECRET: undefined, ADMIN_SESSION_TTL_MINUTES: undefined, PLEDGES_ENABLED: undefined,
};

const unused = undefined as never;
const timeHandler = new BurnHonkTimeHandler(unused, unused, unused, unused, unused, unused, unused, unused);
const weatherHandler = new BurnHonkWeatherHandler(unused, unused, unused, unused, unused, unused, unused, unused);

const ride = (over: Partial<ReplaySubject>): ReplaySubject => ({
  status: 'completed', tier: '1h', tutorial: false, assist: false, guest: false,
  wallet: 'driver', poolId: null, payoutAt: null, verdict: 'verified', ...over,
});

describe('as-built docs match the shipped defaults', () => {
  const env = withEnv(base);

  it('admin session, pledges, and RideResult sentences follow the code', () => {
    expect(env.adminSessionTtlMinutes).toBeLessThanOrEqual(60);
    expect(env.pledgesEnabled).toBe(false);
    expect(verdict).toContain('rideResults.upsert');
    const ttl = String(env.adminSessionTtlMinutes);
    const admin = [conflictRow(docs.product, 'Admin power'), section(docs.product, '### Admin')];
    for (const span of admin) expectSpan(span, [ttl, 'revoked:jti'], ['120 minutes', 'does not revoke']);
    const pledges = [conflictRow(docs.product, 'Pledges'), section(docs.product, '### Escrow program')];
    for (const span of pledges) expectSpan(span, ['pledges_disabled', '403'], ['pledges stay on']);
    const results = [conflictRow(docs.product, '`RideResult`'), section(docs.product, '### Statistics')];
    for (const span of results) expectSpan(span, ['stats.RideResult'], ['There is no RideResult', 'there is no RideResult', 'no per-ride']);
    expect(docs.product).not.toContain('e8f338ad');
  });

  it('pause and slow-motion status follows pauseVerdict and slowMotionVerdict', () => {
    const over = { count: 4, seconds: 301 };
    expect(pauseVerdict('off', over)).toEqual([]);
    expect(slowMotionVerdict('off', 30, 120_000)).toEqual([]);
    expect(pauseVerdict('shadow', over).every((reason) => reason.severity === 'flag')).toBe(true);
    expect(slowMotionVerdict('shadow', 30, 120_000).every((reason) => reason.severity === 'flag')).toBe(true);
    expect(pauseVerdict('enforce', over).every((reason) => reason.severity === 'reject')).toBe(true);
    expect(slowMotionVerdict('enforce', 30, 120_000).every((reason) => reason.severity === 'reject')).toBe(true);
    const span = section(docs.product, '### Verified play') + tableRow(docs.status, '`SPC-06.3`');
    expectSpan(span, ['off` adds no reasons', 'shadow` flags', 'enforce` rejects'], []);
  });

  it('honk time and weather status follows the handler throw', async () => {
    const time = await timeHandler.execute(new BurnHonkTimeCommand('w', 'r', 'day')).then(() => null, (error: unknown) => error);
    const weather = await weatherHandler.execute(new BurnHonkWeatherCommand('w', 'r', 'snow')).then(() => null, (error: unknown) => error);
    expect(time).toBeInstanceOf(NotFoundError);
    expect(weather).toBeInstanceOf(NotFoundError);
    const timeError = time as NotFoundError;
    const weatherError = weather as NotFoundError;
    expect(timeError.statusCode).toBe(weatherError.statusCode);
    expect(timeError.errorCode).toBe(weatherError.errorCode);
    const donations = new LiveDonationService(unused, unused, unused, unused, unused);
    const refused = await donations.prepare('w', 'r', 'night', null, 'order').then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(BadRequestError);
    const donationCode = (refused as BadRequestError).errorCode;
    const spans = [
      conflictRow(docs.product, 'Spectator effects'),
      section(docs.product, '### Live board, watch, chat, donations, replays'),
      tableRow(docs.status, '`SPC-04.4`'),
      section(docs.issue, '### `SPC-04.4`'),
    ];
    expectSpan(spans[0], [donationCode], []);
    expectSpan(spans[1], [donationCode], []);
    expectSpan(tableRow(docs.coverage, 'Live and replay'), [donationCode], []);
    for (const span of spans) {
      expectSpan(span, [String(timeError.statusCode), timeError.errorCode, 'before any TEN4 debit'], ['are `200` and burn TEN4', 'answer `200`, burn TEN4', '10 day/night, 25 snow or clear']);
    }
    expect(section(docs.product, '### TEN4')).toContain(timeError.message);
    expect(section(docs.product, '### TEN4')).toContain(weatherError.message);
  });

  it('the coverage contract keeps the 2026-10-23 green gate figures', () => {
    const gates = section(docs.coverage, '**Gates green on 2026-10-23**');
    expectSpan(gates, ['11668 objects compared against golden.txt: identical', '20/20', 'zero-scenario routes: 0', 'single-scenario routes: 0', '178/178'], ['18/20', '21 `veh|medic`', '57 routes', 'Three gates are red']);
  });

  it('a finished free ride and editor logout follow the shipped result', () => {
    const now = new Date();
    const finishedFree = ride({ tier: 'free' });
    const denial = replayDenial(finishedFree, null, now);
    const running = replayDenial(ride({ status: 'running', tier: '1h', verdict: null }), 'driver', now);
    expect(isPublicReplay(finishedFree, now, null)).toBe(false);
    expect(denial?.code).toBe(running?.code);
    const history = docs.history.slice(docs.history.indexOf('async history'), docs.history.indexOf('async staleRunning'));
    expect(history).toContain("tier: '1h'");
    const code = denial?.code ?? '';
    const live = section(docs.product, '### Live board, watch, chat, donations, replays');
    const listSentences = live.split(/(?<=\.)\s+/).filter((sentence) => sentence.includes('GET /api/replays') || sentence.includes('public replay list'));
    expect(listSentences.some((sentence) => sentence.includes('omits'))).toBe(true);
    for (const sentence of listSentences) expect(sentence).not.toContain(code);
    const watch = [conflictRow(docs.product, 'Live watch'), live, tableRow(docs.coverage, 'Live and replay')];
    for (const span of watch) expectSpan(span, [code, 'omits'], ['Finished free rides stay in replays', 'including a finished free ride', 'stay in replays', 'on the public replay list']);
    const success = docs.logout.split('\n').find((line) => line.includes("'/api/editor/auth/logout'") && line.includes(".set(X, '1').expect("));
    const status = success?.match(/\.expect\((\d+)\)/)?.[1] ?? '';
    expect(status.length).toBeGreaterThan(0);
    const editor = section(docs.product, '### Entity editor');
    const logoutBullet = docs.coverage.split('\n').find((line) => line.includes('/api/editor/auth/logout')) ?? '';
    expectSpan(editor, [status], ['has no successful HTTP scenario', 'no successful HTTP scenario']);
    expectSpan(logoutBullet, [status], ['is only a cross-origin 403', 'has no successful HTTP scenario']);
    const pages = docs.product + docs.coverage;
    for (const phrase of ['Finished free rides stay in replays', 'including a finished free ride', 'has no successful HTTP scenario']) {
      expect(pages).not.toContain(phrase);
    }
  });
});
