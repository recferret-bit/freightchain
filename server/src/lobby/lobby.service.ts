import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { ClockService } from '../clock.service.js';
import { UsersService } from '../users/users.service.js';
import { AchievementsService } from '../achievements/achievements.service.js';
import { PoolService } from '../pool/pool.service.js';
import { config } from '../config.js';

@Injectable()
export class LobbyService {
  constructor(private readonly store: DbService, private readonly clock: ClockService, private readonly users: UsersService, private readonly achievements: AchievementsService, private readonly pool: PoolService) {}

  /** Public feed of rides on the road right now. A ride only leaves `running` when its wallet starts another, so a vanished tab would stay forever –
      hence the heartbeat-age filter. No ride ids, no free-text reason. */
  live() {
    const now = this.clock.now();
    const rows = this.store.db.prepare(`SELECT wallet, tier, route, min_seconds, complete_dist, drive_seconds, last_s, hull, paused, time_scale, started_at, last_hb_at FROM rides
      WHERE status = 'running' AND last_hb_at >= ? ORDER BY started_at DESC LIMIT 50`).all(now - config.hbTimeoutMs) as unknown as {
      wallet: string; tier: string; route: string | null; min_seconds: number; complete_dist: number; drive_seconds: number; last_s: number; hull: number | null; paused: number; time_scale: number; started_at: number; last_hb_at: number }[];
    // Landing boards: paid shifts bought but not started yet ("next up"), the last finishes (ticker) and all-time totals. Same privacy rule: no ids, no reasons.
    const upcoming = this.store.db.prepare(`SELECT wallet, tier, min_seconds, paid_at FROM rides WHERE status = 'created' AND tier != 'free' AND paid_at IS NOT NULL ORDER BY paid_at DESC LIMIT 20`)
      .all() as unknown as { wallet: string; tier: string; min_seconds: number; paid_at: number }[];
    const recent = this.store.db.prepare(`SELECT wallet, tier, route, status, last_s, ended_at FROM rides WHERE status IN ('completed','abandoned','failed') AND started_at IS NOT NULL ORDER BY ended_at DESC LIMIT 12`)
      .all() as unknown as { wallet: string; tier: string; route: string | null; status: string; last_s: number; ended_at: number }[];
    const totals = this.store.db.prepare(`SELECT COUNT(*) AS shifts, COALESCE(SUM(last_s), 0) AS metres, COUNT(DISTINCT wallet) AS drivers FROM rides WHERE status = 'completed'`).get() as unknown as { shifts: number; metres: number; drivers: number };
    return {
      now, rides: rows.map(r => ({
        wallet: r.wallet, tier: r.tier, route: r.route, timeScale: r.time_scale, paused: !!r.paused, hull: r.hull === null ? null : Math.round(r.hull),
        driveSeconds: Math.round(r.drive_seconds), minSeconds: r.min_seconds, distance: Math.round(r.last_s), completeDist: r.complete_dist,
        progress: Math.min(1, r.drive_seconds / r.min_seconds, r.last_s / r.complete_dist),
        sinceBeat: Math.round((now - r.last_hb_at) / 1000), startedAt: r.started_at,
      })),
      upcoming: upcoming.map(r => ({ wallet: r.wallet, tier: r.tier, minSeconds: r.min_seconds, paidAt: r.paid_at })),
      recent: recent.map(r => ({ wallet: r.wallet, tier: r.tier, route: r.route, status: r.status, distance: Math.round(r.last_s), endedAt: r.ended_at })),
      totals: { shifts: totals.shifts, metres: Math.round(totals.metres), drivers: totals.drivers },
    };
  }

  profile(wallet: string) {
    const u = this.users.touch(wallet), { db } = this.store;
    this.achievements.evaluate(wallet);   // catch-up (rides that ended by timeout never went through /end)
    const st = db.prepare(`SELECT COUNT(CASE WHEN started_at IS NOT NULL THEN 1 END) AS started, COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed,
      COALESCE(SUM(CASE WHEN started_at IS NOT NULL THEN last_s END), 0) AS metres, COALESCE(MAX(CASE WHEN status = 'completed' THEN last_s END), 0) AS best FROM rides WHERE wallet = ?`).get(wallet) as unknown as { started: number; completed: number; metres: number; best: number };
    const spent = db.prepare('SELECT COALESCE(SUM(lamports), 0) AS l, COUNT(*) AS n FROM payments WHERE wallet = ?').get(wallet) as unknown as { l: number; n: number };
    const recent = db.prepare(`SELECT tier, status, last_s, hull, route, time_scale, ended_at, started_at FROM rides WHERE wallet = ? AND started_at IS NOT NULL ORDER BY started_at DESC LIMIT 10`).all(wallet) as unknown as {
      tier: string; status: string; last_s: number; hull: number | null; route: string | null; time_scale: number; ended_at: number | null; started_at: number }[];
    return {
      wallet, createdAt: u.created_at, freeRides: u.free_rides, demo: config.demoWallets.has('*') || config.demoWallets.has(wallet), demoScale: config.demoScale,
      stats: { rides: st.started, completed: st.completed, metres: Math.round(st.metres), bestMetres: Math.round(st.best), paidRides: spent.n, spentLamports: spent.l },
      recent: recent.map(r => ({ tier: r.tier, status: r.status, distance: Math.round(r.last_s), hull: r.hull === null ? null : Math.round(r.hull), route: r.route, timeScale: r.time_scale, startedAt: r.started_at, endedAt: r.ended_at })),
      achievements: this.achievements.list(wallet),
    };
  }
}
