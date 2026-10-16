import { Injectable, Logger, Optional, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { PoolChainPort } from '../../application/ports/economy/pool-chain.port.js';
import { CachePort } from '../../application/ports/shared/cache.port.js';
import { PollProgramCommand, type PollProgramResultDto } from '../../application/use-cases/chain/poll-program/poll-program.command.js';
import { SyncPoolsCommand, type SyncPoolsResultDto } from '../../application/use-cases/chain/sync-pools/sync-pools.command.js';
import { SECOND_MS } from '../../domain/shared/time.js';
import { EnvService } from '../config/env.service.js';

/** a burst of websocket notifications (one per transaction) becomes one poll */
export const LOGS_DEBOUNCE_MS = SECOND_MS;
export const POOL_SYNC_MS = 60 * SECOND_MS;
const POLL_LOCK_KEY = 'sched:program-poll';
const SYNC_LOCK_KEY = 'sched:program-sync';

/**
 * The program-log watcher (docs/agents/escrow.md), registered in AppModule only – the admin CLI boots the application layer without timers or sockets.
 * With WATCH_INTERVAL_MS > 0: on boot and every interval it dispatches PollProgramCommand (settle new program transactions + the finality pass); the program's
 * log subscription (websocket, when SOLANA_WS is set) triggers an early poll, debounced. Polls never overlap in this process: a poll asked for while one runs
 * is coalesced into ONE more right after it (across instances settling is idempotent anyway). On boot and every 60 s it also dispatches SyncPoolsCommand –
 * every live pool re-read from chain, a drift logged (the chain wins). WATCH_INTERVAL_MS = 0 (the tests' default) = all of it off.
 * Plain timers like DailyFreeRideScheduler, unref'd so they never keep the process alive; a failed run is logged and the next one tries again.
 */
@Injectable()
export class ProgramWatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(ProgramWatcher.name);
  private pollTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private syncing = false;
  private stopped = false;

  constructor(
    private readonly commands: CommandBus,
    private readonly chain: PoolChainPort,
    private readonly env: EnvService,
    @Optional() private readonly cache?: CachePort,
  ) {}

  /** WATCH_INTERVAL_MS > 0 AND the ticket program is what money goes through (PAYMENT_MODE=program): in transfer mode there is no program to watch –
      polling it only logged "the pool program is not configured" every interval */
  get enabled(): boolean { return this.env.watchIntervalMs > 0 && this.env.paymentMode === 'program'; }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    try {
      this.unsubscribe = this.chain.subscribeLogs(() => this.soon());
    } catch (error) {
      this.log.warn(`program log subscription failed (polling only): ${message(error)}`);
    }
    void this.poll();
    void this.sync();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    for (const t of [this.pollTimer, this.debounceTimer, this.syncTimer]) if (t) clearTimeout(t);
    this.pollTimer = this.debounceTimer = this.syncTimer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** The websocket saw a program transaction: poll shortly (one poll per burst). */
  soon(): void {
    if (this.stopped || this.debounceTimer) return;
    this.debounceTimer = this.arm(() => { this.debounceTimer = null; void this.poll(); }, LOGS_DEBOUNCE_MS);
  }

  /** One poll now – or, while one runs, one more right after it. Resolves when the polling it joined is over. */
  poll(): Promise<void> {
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      do {
        this.again = false;
        await this.pollOnce();
      } while (this.again && !this.stopped);
    })().finally(() => {
      this.running = null;
      if (this.pollTimer) clearTimeout(this.pollTimer);
      this.pollTimer = this.stopped ? null : this.arm(() => void this.poll(), this.env.watchIntervalMs);
    });
    return this.running;
  }

  /** Every live pool re-read from chain; skipped while the previous sync still runs. */
  async sync(): Promise<void> {
    if (this.syncing || this.stopped) return;
    this.syncing = true;
    try {
      if (!this.cache || await this.cache.tryLock(SYNC_LOCK_KEY, Math.floor(POOL_SYNC_MS * 0.8))) {
        const r = await this.commands.execute<SyncPoolsCommand, SyncPoolsResultDto>(new SyncPoolsCommand());
        for (const d of r.drifted) this.log.warn(`pool ${d.poolId} drifted from its account (the chain wins): ${d.changes.join(', ')}`);
        if (r.missing.length) this.log.debug(`pools not on chain: ${r.missing.join(', ')}`);
      }
    } catch (error) {
      await this.cache?.releaseLock(SYNC_LOCK_KEY);
      this.log.error(`pool sync failed: ${message(error)}`);
    } finally {
      this.syncing = false;
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = this.stopped ? null : this.arm(() => void this.sync(), POOL_SYNC_MS);
    }
  }

  private async pollOnce(): Promise<void> {
    if (this.cache && !(await this.cache.tryLock(POLL_LOCK_KEY, Math.max(500, Math.min(10_000, Math.floor(this.env.watchIntervalMs * 0.8)))))) return;
    try {
      const r = await this.commands.execute<PollProgramCommand, PollProgramResultDto>(new PollProgramCommand());
      if (r.settled || r.finality.finalized || r.finality.dropped) {
        this.log.log(`program: ${r.settled} settled, ${r.finality.finalized} finalized, ${r.finality.dropped} dropped${r.pendingAt ? `, waiting for ${r.pendingAt}` : ''}`);
      }
      for (const e of r.errors) this.log.error(`program transaction ${e.signature} passed over: ${e.message}`);
    } catch (error) {
      this.log.error(`program poll failed: ${message(error)}`);
    } finally {
      await this.cache?.releaseLock(POLL_LOCK_KEY);
    }
  }

  private arm(fn: () => void, ms: number): NodeJS.Timeout {
    const t = setTimeout(fn, ms);
    t.unref(); // never keeps the process (or a test run) alive
    return t;
  }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
