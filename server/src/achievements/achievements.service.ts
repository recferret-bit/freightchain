import { Global, Injectable, Module } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { ClockService } from '../clock.service.js';
import { ACHIEVEMENTS, earnedIds, type Facts } from './achievements.js';

@Injectable()
export class AchievementsService {
  constructor(private readonly store: DbService, private readonly clock: ClockService) {}

  facts(wallet: string): Facts {
    const q = this.store.db.prepare(`SELECT
      COUNT(CASE WHEN started_at IS NOT NULL THEN 1 END) AS started,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed,
      COALESCE(SUM(CASE WHEN started_at IS NOT NULL THEN last_s END), 0) AS metres,
      COALESCE(MAX(CASE WHEN status = 'completed' AND night_seconds >= 0.5 * drive_seconds AND drive_seconds > 0 THEN 1 END), 0) AS night,   -- most of the shift in the dark: pressing N just before the end doesn't count
      COALESCE(MAX(CASE WHEN status = 'completed' AND hull >= 99.5 THEN 1 END), 0) AS clean,
      COALESCE(MAX(CASE WHEN status = 'completed' AND route = 'siberia' THEN 1 END), 0) AS siberia
      FROM rides WHERE wallet = ?`).get(wallet) as unknown as { started: number; completed: number; metres: number; night: number; clean: number; siberia: number };
    return { started: q.started, completed: q.completed, totalMetres: q.metres, completedAtNight: !!q.night, cleanRun: !!q.clean, completedSiberia: !!q.siberia };
  }

  /** Persist every unlock the wallet has earned (idempotent, never removes). Returns the NEW ids. */
  evaluate(wallet: string, rideId: string | null = null): string[] {
    const { db } = this.store, now = this.clock.now(), fresh: string[] = [];
    for (const id of earnedIds(this.facts(wallet))) {
      if (db.prepare('INSERT OR IGNORE INTO achievements (wallet, id, earned_at, ride_id) VALUES (?, ?, ?, ?)').run(wallet, id, now, rideId).changes === 1) fresh.push(id);
    }
    return fresh;
  }

  /** the whole catalogue with the wallet's unlocks (earnedAt null = locked) */
  list(wallet: string) {
    const got = new Map((this.store.db.prepare('SELECT id, earned_at FROM achievements WHERE wallet = ?').all(wallet) as unknown as { id: string; earned_at: number }[]).map(r => [r.id, r.earned_at]));
    return ACHIEVEMENTS.map(a => ({ id: a.id, name: a.name, desc: a.desc, icon: a.icon, earnedAt: got.get(a.id) ?? null, awardedAtRoundClose: a.rule === null }));
  }
}

@Global()
@Module({ providers: [AchievementsService], exports: [AchievementsService] })
export class AchievementsModule {}
