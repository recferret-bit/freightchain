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
      CREATE TABLE IF NOT EXISTS rounds (       -- one global weekly prize round (UTC Monday → Monday)
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        starts_at   INTEGER NOT NULL,
        ends_at     INTEGER NOT NULL,
        carry       INTEGER NOT NULL,          -- lamports seeded in from the previous round (its 20 % "next ride start")
        status      TEXT NOT NULL              -- open | closed (settlement / draw is not built yet)
      );
      CREATE TABLE IF NOT EXISTS payments (
        signature  TEXT PRIMARY KEY,           -- a transaction can pay for exactly one ride
        ride_id    TEXT NOT NULL UNIQUE REFERENCES rides(id),
        wallet     TEXT NOT NULL,
        lamports   INTEGER NOT NULL,           -- what was ordered (the verified transfer was at least this)
        usd        REAL NOT NULL,
        round_id   INTEGER NOT NULL REFERENCES rounds(id),
        at         INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS payments_round ON payments(round_id);
    `);
    // additive migration: CREATE TABLE IF NOT EXISTS never adds columns to a database made by an earlier version
    this.addColumns('rides', {
      time_scale: 'REAL NOT NULL DEFAULT 1',   // demo wallets run paid rides ×N faster (the shift length is divided by it)
      price_usd: 'REAL NOT NULL DEFAULT 0', lamports: 'INTEGER NOT NULL DEFAULT 0', sol_usd: 'REAL', quote_expires_at: 'INTEGER',
      round_id: 'INTEGER', paid_at: 'INTEGER',
    });
  }

  private addColumns(table: string, cols: Record<string, string>) {
    const have = new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map(c => c.name));
    for (const [name, ddl] of Object.entries(cols)) if (!have.has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }

  onModuleDestroy() { this.db.close(); }
}
