import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';

/* node:sqlite (built into Node ≥ 22.5) – no native addon to compile. Synchronous, fine for a single-process server. */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly db: DatabaseSync;

  constructor() {
    if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });
    this.db = new DatabaseSync(config.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        wallet     TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        free_rides INTEGER NOT NULL,
        free_day   TEXT NOT NULL           -- UTC day (YYYY-MM-DD) of the last daily grant
      );
      CREATE TABLE IF NOT EXISTS nonces (
        wallet     TEXT PRIMARY KEY,       -- one pending challenge per wallet
        message    TEXT NOT NULL,          -- the exact text the wallet must sign (built server-side)
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rides (
        id            TEXT PRIMARY KEY,
        wallet        TEXT NOT NULL REFERENCES users(wallet),
        tier          TEXT NOT NULL,
        seed          INTEGER NOT NULL,
        min_seconds   REAL NOT NULL,
        complete_dist REAL NOT NULL,
        status        TEXT NOT NULL,       -- created | running | completed | abandoned | failed
        created_at    INTEGER NOT NULL,
        started_at    INTEGER,
        last_hb_at    INTEGER,
        last_s        REAL NOT NULL DEFAULT 0,
        last_t        REAL NOT NULL DEFAULT 0,   -- the game's own driven-seconds clock at the last report
        drive_seconds REAL NOT NULL DEFAULT 0,
        hull          REAL,
        ended_at      INTEGER,
        reason        TEXT
      );
      CREATE INDEX IF NOT EXISTS rides_wallet ON rides(wallet, status);
    `);
  }

  onModuleDestroy() { this.db.close(); }
}
