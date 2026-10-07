import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { ClockService } from '../clock.service.js';
import { config } from '../config.js';
import { splitPool, weekBounds } from '../economy.js';

export interface Round { id: number; starts_at: number; ends_at: number; carry: number; status: string }

/* ONE global weekly round: every paid entry feeds the same pool, so the landing page has a single number (the draw will weight by tier).
   Accounting only – settlement (draw, top-20 payouts, moving the 20 % seed) is not built; the grand prize shown is what has ACCRUED. */
@Injectable()
export class PoolService {
  constructor(private readonly store: DbService, private readonly clock: ClockService) {}

  private entriesOf(roundId: number) {
    return this.store.db.prepare('SELECT COALESCE(SUM(lamports), 0) AS lamports, COUNT(*) AS n FROM payments WHERE round_id = ?').get(roundId) as unknown as { lamports: number; n: number };
  }

  /** The round containing `now`; the first call of a new week closes the previous round and seeds this one with its 20 % (an empty week passes its carry on). */
  ensureRound(now = this.clock.now()): Round {
    const { db } = this.store;
    const cur = db.prepare('SELECT * FROM rounds WHERE starts_at <= ? AND ends_at > ? ORDER BY id DESC').get(now, now) as unknown as Round | undefined;
    if (cur) return cur;
    const prev = db.prepare('SELECT * FROM rounds ORDER BY starts_at DESC').get() as unknown as Round | undefined;
    let carry = config.initialSeedLamports;
    if (prev) {
      const e = this.entriesOf(prev.id);
      carry = splitPool(e.lamports).nextSeed + (e.n === 0 ? prev.carry : 0);
      db.prepare("UPDATE rounds SET status = 'closed' WHERE id = ?").run(prev.id);
    }
    const { start, end } = weekBounds(now);
    const id = Number(db.prepare("INSERT INTO rounds (starts_at, ends_at, carry, status) VALUES (?, ?, ?, 'open')").run(start, end, carry).lastInsertRowid);
    return db.prepare('SELECT * FROM rounds WHERE id = ?').get(id) as unknown as Round;
  }

  summary() {
    const r = this.ensureRound(), e = this.entriesOf(r.id), split = splitPool(e.lamports, r.carry);
    return { round: { id: r.id, startsAt: r.starts_at, endsAt: r.ends_at }, entries: e.n, split, settled: false };
  }

  /** board 'round' = paid rides completed in the current round, 'all' = paid rides, all time, 'free' = free rides, all time. Ranked by total distance of COMPLETED rides. */
  leaderboard(board: string) {
    const { db } = this.store, where = board === 'free' ? "tier = 'free'" : board === 'all' ? "tier != 'free'" : "tier != 'free' AND round_id = ?";
    const rows = db.prepare(`SELECT wallet, SUM(last_s) AS distance, COUNT(*) AS rides, MIN(ended_at) AS first_at FROM rides
      WHERE status = 'completed' AND ${where} GROUP BY wallet ORDER BY distance DESC, rides DESC, first_at ASC LIMIT 20`)
      .all(...(board === 'free' || board === 'all' ? [] : [this.ensureRound().id])) as unknown as { wallet: string; distance: number; rides: number }[];
    return rows.map((r, i) => ({ rank: i + 1, wallet: r.wallet, distance: Math.round(r.distance), rides: r.rides }));
  }
}
