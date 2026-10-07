import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service.js';
import { ClockService } from '../clock.service.js';
import { UsersService } from '../users/users.service.js';
import { MAX_SPEED, completeDist, config } from '../config.js';

export interface RideRow {
  id: string; wallet: string; tier: string; seed: number; min_seconds: number; complete_dist: number; status: string; created_at: number;
  started_at: number | null; last_hb_at: number | null; last_s: number; last_t: number; drive_seconds: number; hull: number | null; ended_at: number | null; reason: string | null;
}
export interface Progress { s?: unknown; t?: unknown; hull?: unknown; paused?: unknown }   // s = metres along the road, t = the game's own driven-seconds clock (st.t)
export type Outcome = 'shift' | 'failed';

const view = (r: RideRow) => ({
  id: r.id, tier: r.tier, seed: r.seed, status: r.status, minSeconds: r.min_seconds, completeDist: r.complete_dist,
  driveSeconds: Math.round(r.drive_seconds * 10) / 10, distance: Math.round(r.last_s), reason: r.reason,
});

/* Ride lifecycle. The CLIENT does not decide whether a ride counts: it reports progress (heartbeats) and the server judges it –
   complete = driven ≥ minSeconds (server wall clock, minus honest pauses) AND last reported s ≥ completeDist, where s may only grow at ≤ MAX_SPEED.
   This is server-timed telemetry, not a replay: a modified client can still lie within those bounds (see docs/hackathon-plan.md). */
@Injectable()
export class RidesService {
  constructor(private readonly store: DbService, private readonly clock: ClockService, private readonly users: UsersService) {}

  private row(id: string, wallet: string): RideRow {
    const r = this.store.db.prepare('SELECT * FROM rides WHERE id = ? AND wallet = ?').get(id, wallet) as unknown as RideRow | undefined;
    if (!r) throw new NotFoundException('ride not found');
    return r;
  }
  private fail(r: RideRow, reason: string, status = 'failed') {
    this.store.db.prepare('UPDATE rides SET status = ?, reason = ?, ended_at = ? WHERE id = ?').run(status, reason, this.clock.now(), r.id);
  }

  create(wallet: string, tier: unknown) {
    if (tier !== 'free') throw new BadRequestException('only the free tier is available yet (paid rides arrive with payments)');
    const { db } = this.store, now = this.clock.now();
    this.users.touch(wallet);
    // a tab that vanished mid-ride must not block the wallet forever
    db.prepare("UPDATE rides SET status = 'failed', reason = 'heartbeat lost', ended_at = ? WHERE wallet = ? AND status = 'running' AND last_hb_at < ?").run(now, wallet, now - config.hbTimeoutMs);
    const open = db.prepare("SELECT * FROM rides WHERE wallet = ? AND status IN ('created','running') ORDER BY created_at DESC").get(wallet) as unknown as RideRow | undefined;
    if (open?.status === 'running') throw new ConflictException('a ride is already in progress');
    if (open) return view(open);   // created but never started: hand the same ride (and its free credit) back
    // atomic: the decrement only succeeds while a credit is left
    if (db.prepare('UPDATE users SET free_rides = free_rides - 1 WHERE wallet = ? AND free_rides > 0').run(wallet).changes !== 1) throw new ConflictException('no free rides left');
    const minSeconds = config.freeRideSeconds, id = randomUUID(), seed = randomBytes(4).readUInt32BE();
    db.prepare("INSERT INTO rides (id, wallet, tier, seed, min_seconds, complete_dist, status, created_at) VALUES (?, ?, 'free', ?, ?, ?, 'created', ?)").run(id, wallet, seed, minSeconds, completeDist(minSeconds), now);
    return view(this.row(id, wallet));
  }

  get(wallet: string, id: string) { return view(this.row(id, wallet)); }

  start(wallet: string, id: string) {
    const r = this.row(id, wallet), now = this.clock.now();
    if (r.status !== 'created') throw new ConflictException(`ride is ${r.status}`);
    this.store.db.prepare("UPDATE rides SET status = 'running', started_at = ?, last_hb_at = ? WHERE id = ?").run(now, now, id);
    return view(this.row(id, wallet));
  }

  heartbeat(wallet: string, id: string, p: Progress) {
    const r = this.row(id, wallet);
    if (r.status !== 'running') throw new ConflictException(`ride is ${r.status}`);
    if (this.clock.now() - (r.last_hb_at ?? 0) < config.hbMinIntervalMs) return view(r);   // too soon: ignored (no free progress by spamming)
    return view(this.advance(r, p));
  }

  end(wallet: string, id: string, outcome: unknown, p: Progress & { reason?: unknown }) {
    const r = this.row(id, wallet);
    if (r.status !== 'running') throw new ConflictException(`ride is ${r.status}`);
    if (outcome !== 'shift' && outcome !== 'failed') throw new BadRequestException("outcome must be 'shift' or 'failed'");
    const cur = this.advance(r, p, false);   // lenient: a garbled final report must not leave the ride stuck 'running' (and the wallet blocked)
    if (cur.status !== 'running') return view(cur);   // implausible progress already failed it
    const ok = cur.drive_seconds >= cur.min_seconds && cur.last_s >= cur.complete_dist;
    if (outcome === 'failed') this.fail(cur, (typeof p.reason === 'string' ? p.reason : 'failed').slice(0, 200));
    else if (ok) this.fail(cur, 'shift complete', 'completed');
    else this.fail(cur, 'shift abandoned before it was complete', 'abandoned');
    return view(this.row(id, wallet));
  }

  /** Applies one progress report: time accrues from the server clock; a report that moves faster than the truck can fails the ride.
      Drive time = how far the game's own clock `t` moved since the last report, capped by the wall time that passed (so it can't outrun the server's clock) –
      a pause mid-window or the stretch after the last beat is credited correctly. strict = false (the final /end) falls back to the last good values instead of rejecting. */
  private advance(r: RideRow, p: Progress, strict = true): RideRow {
    let s = Number(p.s), hull = p.hull === undefined || p.hull === null ? r.hull : Number(p.hull), t = Number(p.t);
    if (!Number.isFinite(s) || s < 0 || s > 1e7) { if (strict) throw new BadRequestException('bad progress values'); s = r.last_s; }
    if (hull !== null && !Number.isFinite(hull)) { if (strict) throw new BadRequestException('bad progress values'); hull = r.hull; }
    if (hull !== null) hull = Math.min(100, Math.max(0, hull));   // the game can overshoot below 0 on the hit that wrecks it
    const now = this.clock.now(), dt = (now - (r.last_hb_at ?? now)) / 1000;
    if (dt * 1000 > config.hbTimeoutMs) { this.fail(r, 'heartbeat lost'); return this.row(r.id, r.wallet); }
    if (Math.abs(s - r.last_s) > MAX_SPEED * dt * config.speedSlack + config.slackMetres) {
      this.fail(r, `implausible progress (${Math.round(s - r.last_s)} m in ${dt.toFixed(1)} s)`);
      return this.row(r.id, r.wallet);
    }
    const hasT = Number.isFinite(t) && t >= r.last_t;
    const credit = hasT ? Math.min(t - r.last_t, dt * 1.05 + 1) : (p.paused ? 0 : dt);   // no usable t (old client): fall back to the paused flag
    this.store.db.prepare('UPDATE rides SET last_s = ?, last_t = ?, hull = ?, last_hb_at = ?, drive_seconds = drive_seconds + ? WHERE id = ?').run(s, hasT ? t : r.last_t, hull, now, credit, r.id);
    return this.row(r.id, r.wallet);
  }
}
