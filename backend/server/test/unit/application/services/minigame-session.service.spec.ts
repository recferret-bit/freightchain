import { HeartbeatRideHandler } from '../../../../src/application/use-cases/rides/heartbeat-ride/heartbeat-ride.handler.js';
import { HeartbeatRideCommand } from '../../../../src/application/use-cases/rides/heartbeat-ride/heartbeat-ride.command.js';
import { AnswerMinigameCommand, OpenMinigameCommand } from '../../../../src/application/use-cases/rides/minigames/minigames.command.js';
import { GetMinigameAssetQuery } from '../../../../src/application/use-cases/rides/minigames/minigames.command.js';
import { MinigameConfigPort } from '../../../../src/application/ports/minigames/minigame-config.port.js';
import { RideMiniGameRepositoryPort } from '../../../../src/application/ports/minigames/ride-minigame.repository.port.js';
import { MinigameRateService } from '../../../../src/application/services/minigame-rate.service.js';
import { MinigameSessionService } from '../../../../src/application/services/minigame-session.service.js';
import type { MgLang, MgMode, MgRunMode } from '../../../../src/domain/minigames/kinds.js';
import { mgSaltBytes } from '../../../../src/domain/minigames/mac.js';
import { buildPhoneSms } from '../../../../src/domain/minigames/phone-sms.js';
import { RideMiniGame } from '../../../../src/domain/minigames/ride-minigame.js';
import { Ride } from '../../../../src/domain/rides/ride.entity.js';
import type { RideReport } from '../../../../src/domain/rides/ride-report.js';
import { svgLeaksText } from '../../../../src/domain/minigames/svg.js';
import { NodeMinigameCrypto } from '../../../../src/infrastructure/crypto/node.minigame-crypto.js';
import { RecordingAnalytics } from '../../../support/recording-analytics.js';
import { unitContext, unitRules, type UnitContext } from '../../../support/unit-context.js';

const SECRET = 's'.repeat(32);
const MAC = 'A'.repeat(43);
const crypto = new NodeMinigameCrypto();

class FixedMg extends MinigameConfigPort {
  constructor(private readonly m: MgRunMode, private readonly key?: string) { super(); }
  mode(): MgRunMode { return this.m; }
  saltVersion(): string { return 'mg:v1'; }
  secret(): string | undefined { return this.key; }
}

class MemoryMinigames extends RideMiniGameRepositoryPort {
  rows: RideMiniGame[] = [];
  private copy(row: RideMiniGame): RideMiniGame { return RideMiniGame.restore(row.snapshot()); }
  async listByRide(rideId: string): Promise<RideMiniGame[]> { return this.rows.filter((r) => r.rideId === rideId).map((r) => this.copy(r)); }
  async findById(id: string): Promise<RideMiniGame | null> { const hit = this.rows.find((r) => r.id === id); return hit ? this.copy(hit) : null; }
  async insert(row: RideMiniGame): Promise<RideMiniGame> {
    const existing = this.rows.find((r) => r.rideId === row.rideId && r.ordinal === row.ordinal);
    if (existing) return this.copy(existing);
    this.rows.push(this.copy(row));
    return this.copy(row);
  }
  async save(row: RideMiniGame): Promise<void> {
    const i = this.rows.findIndex((r) => r.id === row.id);
    this.rows[i] = this.copy(row);
  }
}

const report = (over: Partial<RideReport>): RideReport => ({ s: 40, t: null, hull: 100, paused: false, night: false, crashesVehicle: null, crashesBuilding: null, ...over });
const wrongOf = (code: string): string => code.replace(/./g, (ch) => (ch === '1' ? '2' : '1'));

function sessionFor(ctx: UnitContext, mode: MgRunMode, secret: string | null = SECRET) {
  const rows = new MemoryMinigames();
  const session = new MinigameSessionService(new FixedMg(mode, secret === null ? undefined : secret), crypto, rows, ctx.rides, ctx.players, ctx.lookup, ctx.transactions, ctx.clock, new MinigameRateService());
  return { rows, session };
}

async function armed(mode: MgMode = 'normal', lang: MgLang = 'en') {
  const ctx = unitContext(unitRules({ hbTimeoutMs: 10_000_000 }));
  const { rows, session } = sessionFor(ctx, 'shadow');
  let ride = await ctx.paidOrder('w');
  ride.markPaid(1, ctx.now());
  await session.stamp(ride, mode, lang);
  ride.start(ctx.now());
  ride = await ctx.rides.save(ride);
  const beat = new HeartbeatRideHandler(ctx.lookup, ctx.rides, ctx.rules, ctx.clock, new RecordingAnalytics(), ctx.entropy, ctx.transactions, ctx.players, ctx.stats, session);
  ctx.clock.advance(3419.999);
  const dto = await beat.execute(new HeartbeatRideCommand('w', ride.id, report({ t: 3419.999 })));
  const events = dto.minigames ?? [];
  const salt = mgSaltBytes(crypto, SECRET, 'mg:v1', ride.id, 'w');
  const built = (ordinal: number, variant = 0) => buildPhoneSms(crypto, salt, ordinal, variant, lang, mode);
  const open = (eventId: string, variantSeq: 0 | 1, safe: boolean | null = true) => session.open(new OpenMinigameCommand('w', ride.id, eventId, MAC, variantSeq, safe));
  const answer = (eventId: string, nonce: string, attempt: number, value: string) => session.answer(new AnswerMinigameCommand('w', ride.id, eventId, MAC, nonce, attempt, value, null));
  return { ctx, rows, session, ride, beat, events, built, open, answer };
}

describe('MinigameSessionService', () => {
  it('stamps a 64-hex commit on a paid 1h ride and null on training, a short tier, off, or a missing secret', async () => {
    const ctx = unitContext();
    const { session } = sessionFor(ctx, 'shadow');
    let ride = await ctx.paidOrder('w');
    await session.stamp(ride, 'normal', 'en');
    expect(ride.mgCommit).toMatch(/^[0-9a-f]{64}$/);
    const again = ride.mgCommit;
    await session.stamp(ride, 'more-time', 'ru');
    expect(ride.mgCommit).toBe(again);
    expect(ride.mgMode).toBe('more-time');
    const other = Ride.createPaidOrder({ id: 'other', wallet: 'w2', tier: '1h', seed: ride.snapshot().seed, minSeconds: 3600, timeScale: 1, priceUsd: 1, lamports: 1, solUsd: 1, now: ctx.now(), quoteTtlMs: 1000 });
    await session.stamp(other, 'normal', 'en');
    expect(other.mgCommit).not.toBe(ride.mgCommit);
    const free = Ride.createFree({ id: 'free', wallet: 'w', seed: 3, minSeconds: 10, now: ctx.now(), tutorial: true, assist: true });
    await session.stamp(free, 'normal', 'en');
    expect(free.mgCommit).toBeNull();
    const four = Ride.createPaidOrder({ id: '4h', wallet: 'w', tier: '4h', seed: 4, minSeconds: 14_400, timeScale: 1, priceUsd: 1, lamports: 1, solUsd: 1, now: ctx.now(), quoteTtlMs: 1000 });
    await session.stamp(four, 'normal', 'en');
    expect(four.mgCommit).toBeNull();
    const off = sessionFor(ctx, 'off').session;
    ride.stampMinigames('x', 'normal', 'en', 'mg:v1');
    await off.stamp(ride, 'normal', 'en');
    expect(ride.mgCommit).toBeNull();
    const nosecret = sessionFor(ctx, 'shadow', null).session;
    await nosecret.stamp(other, 'normal', 'en');
    expect(other.mgCommit).toBeNull();
  });

  it('arms on a heartbeat and cancels whatever is still armed in the last 3 minutes', async () => {
    const { ctx, rows, beat, ride, events } = await armed();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.length).toBeLessThanOrEqual(4);
    expect(events.every((e) => e.kind === 'phone-sms' && e.state === 'armed' && e.trigger === 'stop')).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/nonce|layout|asset/);
    ctx.clock.advance(0.2);
    const early = await beat.execute(new HeartbeatRideCommand('w', ride.id, report({ t: 3419.999 })));
    expect(early.minigames?.map((e) => e.state)).toEqual(events.map(() => 'armed'));
    ctx.clock.advance(200);
    const late = await beat.execute(new HeartbeatRideCommand('w', ride.id, report({ t: 3620 })));
    expect(late.minigames?.every((e) => e.state === 'cancelled')).toBe(true);
    expect((await rows.listByRide(ride.id)).every((row) => row.status === 'cancelled' && row.outcome === null)).toBe(true);
  });

  it('opens without the code, defers once, and scores phone-sms attempts', async () => {
    const { rows, events, built, open, answer } = await armed();
    const ev = events[0]!;
    const v0 = built(ev.ordinal, 0);
    expect(ev.id).toBe(v0.id);
    const opened = await open(ev.id, 0, false);
    expect(opened.revealedAt).toBeGreaterThan(0);
    expect(JSON.stringify(opened).includes(v0.code)).toBe(false);
    expect((await rows.findById(ev.id))?.clientSafe).toBe(false);
    const same = await open(ev.id, 0, true);
    expect(same).toEqual(opened);
    const v1 = built(ev.ordinal, 1);
    const deferred = await open(ev.id, 1, true);
    expect(deferred.revealedAt).toBe(opened.revealedAt);
    expect(deferred.nonce).toBe(v1.nonce);
    expect(deferred.nonce).not.toBe(opened.nonce);
    expect(JSON.stringify(deferred).includes(v1.code)).toBe(false);
    const distractor = v1.distractors[0]!;
    expect(await answer(ev.id, v1.nonce, 1, distractor)).toMatchObject({ outcome: 'pending', penaltyS: 0, attempts: 1, status: 'revealed' });
    expect(await answer(ev.id, v1.nonce, 2, wrongOf(v1.code))).toMatchObject({ outcome: 'pending', penaltyS: 0, attempts: 2 });
    expect(await answer(ev.id, v1.nonce, 3, v1.code)).toMatchObject({ outcome: 'passed', penaltyS: 0, attempts: 3, status: 'answered' });
    const second = events[1]!;
    const code = built(second.ordinal).code;
    const revealed = await open(second.id, 0);
    expect(await answer(second.id, revealed.nonce, 1, code)).toMatchObject({ outcome: 'passed', penaltyS: 0, attempts: 1, status: 'answered' });
    expect(await answer(second.id, revealed.nonce, 1, code)).toMatchObject({ outcome: 'passed', penaltyS: 0, attempts: 1 });
    await expect(answer(second.id, revealed.nonce, 1, wrongOf(code))).rejects.toMatchObject({ errorCode: 'mg_already_answered', statusCode: 409 });
  });

  it('three wrong codes cost 20s, a late answer expires, and assets die once the event closes', async () => {
    const { ctx, rows, events, built, open, answer, session, ride } = await armed();
    const ev = events[0]!;
    const v0 = built(ev.ordinal);
    const opened = await open(ev.id, 0);
    const bad = wrongOf(v0.code);
    expect(await answer(ev.id, opened.nonce, 1, bad)).toMatchObject({ outcome: 'pending', penaltyS: 0 });
    expect(await answer(ev.id, opened.nonce, 2, bad)).toMatchObject({ outcome: 'pending', penaltyS: 0 });
    expect(await answer(ev.id, opened.nonce, 3, bad)).toMatchObject({ outcome: 'failed', penaltyS: 20, attempts: 3, status: 'answered' });
    const assetId = opened.layout.cab[0]!.assetId;
    await expect(session.asset(new GetMinigameAssetQuery('w', ride.id, ev.id, assetId))).rejects.toMatchObject({ errorCode: 'mg_unknown', statusCode: 404 });
    const second = events[1]!;
    const fresh = await open(second.id, 0);
    const svg = await session.asset(new GetMinigameAssetQuery('w', ride.id, second.id, fresh.layout.threads[0]!.bubbles[0]!.assetId));
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svgLeaksText(svg)).toBe(false);
    expect(svg.includes(built(second.ordinal).code)).toBe(false);
    ctx.clock.advance(31);
    await expect(answer(second.id, fresh.nonce, 1, '9999')).rejects.toMatchObject({ errorCode: 'mg_expired', statusCode: 410 });
    expect((await rows.findById(second.id))?.status).toBe('expired');
  });

  it('repeats the same attempt after the window and rejects a different answer', async () => {
    const { ctx, rows, events, built, open, answer } = await armed();
    const ev = events[0]!;
    const opened = await open(ev.id, 0);
    const bad = wrongOf(built(ev.ordinal).code);
    expect(await answer(ev.id, opened.nonce, 1, bad)).toMatchObject({ outcome: 'pending', penaltyS: 0, status: 'revealed' });
    ctx.clock.advance(31);
    expect(await answer(ev.id, opened.nonce, 1, bad)).toMatchObject({ outcome: 'pending', penaltyS: 0, status: 'revealed' });
    await expect(answer(ev.id, opened.nonce, 1, '000000')).rejects.toMatchObject({ errorCode: 'mg_already_answered', statusCode: 409 });
    expect((await rows.findById(ev.id))?.status).toBe('revealed');
  });

  it('more-time opens a 60s window and a single thread', async () => {
    const { events, built, open } = await armed('more-time', 'ru');
    const opened = await open(events[0]!.id, 0);
    expect(opened.windowMs).toBe(60_000);
    expect(opened.layout.threads).toHaveLength(1);
    expect(opened.layout.cab.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(opened).includes(built(events[0]!.ordinal).code)).toBe(false);
  });

  it('refuses a stranger, a bad mac, a foreign nonce, an armed answer, a stopped ride, and the 11th request', async () => {
    const { ctx, session, ride, events, open, answer, built } = await armed();
    const ev = events[0]!;
    await ctx.player('other');
    await expect(session.open(new OpenMinigameCommand('other', ride.id, ev.id, MAC, 0, true))).rejects.toMatchObject({ statusCode: 404 });
    await expect(session.open(new OpenMinigameCommand('w', ride.id, ev.id, 'A'.repeat(42), 0, true))).rejects.toMatchObject({ errorCode: 'mg_bad_mac', statusCode: 400 });
    await expect(answer(ev.id, 'ab', 1, '1234')).rejects.toMatchObject({ errorCode: 'mg_not_revealed', statusCode: 409 });
    const opened = await open(ev.id, 0);
    await expect(answer(ev.id, 'not-the-nonce', 1, built(ev.ordinal).code)).rejects.toMatchObject({ errorCode: 'mg_nonce_foreign', statusCode: 400 });
    await expect(answer(ev.id, opened.nonce, 1, '----')).rejects.toMatchObject({ errorCode: 'mg_bad_body', statusCode: 400 });
    for (let i = 0; i < 6; i++) await open(ev.id, 0);
    await expect(open(ev.id, 0)).rejects.toMatchObject({ errorCode: 'mg_rate_limited', statusCode: 429 });
    const stored = await ctx.reload(ride.id);
    stored.finish('failed', 'crash', ctx.now());
    await ctx.rides.save(stored);
    await expect(open(ev.id, 0)).rejects.toMatchObject({ errorCode: 'ride_not_running', statusCode: 409 });
  });
});
