import { Injectable } from '@nestjs/common';
import type { ChainEventRow } from '../../../src/domain/economy/chain-events.js';
import { ChainCursorRepositoryPort, ChainEventRepositoryPort, type ChainCursorRow } from '../../../src/application/ports/economy/chain-event.repository.port.js';
import { MemoryDb } from './memory-db.js';

/* In-memory twins of the chain context's Prisma repositories (re-exported by memory-repositories.ts): same keys, orderings and duplicate rules. */
const byTime = (a: ChainEventRow, b: ChainEventRow) => a.at.getTime() - b.at.getTime() || a.signature.localeCompare(b.signature) || a.index - b.index;

@Injectable()
export class MemoryChainEventRepository extends ChainEventRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async find(signature: string, index: number): Promise<ChainEventRow | null> {
    const row = this.db.chainEvents.find((e) => e.signature === signature && e.index === index);
    return row ? { ...row } : null;
  }

  async record(row: ChainEventRow): Promise<boolean> {
    if (this.db.chainEvents.some((e) => e.signature === row.signature && e.index === row.index)) return false;
    this.db.chainEvents.push({ ...row });
    return true;
  }

  async recentOfPool(poolId: number, limit: number): Promise<ChainEventRow[]> {
    return this.db.chainEvents.filter((e) => e.poolId === poolId).sort((a, b) => byTime(b, a)).slice(0, limit).map((e) => ({ ...e }));
  }

  async listUnfinalized(limit: number): Promise<ChainEventRow[]> {
    return this.db.chainEvents.filter((e) => (e.outcome === 'settled' || e.outcome === 'applied') && e.finalizedAt === null).sort(byTime).slice(0, limit).map((e) => ({ ...e }));
  }

  async markFinalized(signature: string, at: Date): Promise<void> {
    for (const e of this.db.chainEvents) if (e.signature === signature && e.finalizedAt === null) e.finalizedAt = at;
  }

  async markDropped(signature: string, detail: string): Promise<void> {
    for (const e of this.db.chainEvents) if (e.signature === signature) Object.assign(e, { outcome: 'dropped', detail });
  }
}

@Injectable()
export class MemoryChainCursorRepository extends ChainCursorRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async get(key: string): Promise<ChainCursorRow | null> {
    const row = this.db.chainCursors.get(key);
    return row ? { ...row } : null;
  }

  async set(row: ChainCursorRow): Promise<void> { this.db.chainCursors.set(row.key, { ...row }); }
}
