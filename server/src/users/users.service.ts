import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { ClockService } from '../clock.service.js';
import { config } from '../config.js';

export interface User { wallet: string; created_at: number; free_rides: number; free_day: string }
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

@Injectable()
export class UsersService {
  constructor(private readonly store: DbService, private readonly clock: ClockService) {}

  /** The user (created on first sight with the signup free rides). Applies the daily grant: +1 free ride once per UTC day, no backlog. */
  touch(wallet: string): User {
    const { db } = this.store, now = this.clock.now(), today = utcDay(now);
    db.prepare('INSERT OR IGNORE INTO users (wallet, created_at, free_rides, free_day) VALUES (?, ?, ?, ?)').run(wallet, now, config.freeOnSignup, today);
    db.prepare('UPDATE users SET free_rides = free_rides + 1, free_day = ? WHERE wallet = ? AND free_day < ?').run(today, wallet, today);
    return db.prepare('SELECT * FROM users WHERE wallet = ?').get(wallet) as unknown as User;
  }
}
