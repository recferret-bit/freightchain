import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { PoolProps } from '../../../../domain/economy/pool.types.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { PoolRegistryService } from '../../../services/pool-registry.service.js';
import { SyncPoolsCommand, type PoolDriftDto, type SyncPoolsResultDto } from './sync-pools.command.js';

/** what the events keep in line – anything else differing is a rule change the program cannot make */
const WATCHED: (keyof PoolProps)[] = ['status', 'ticketsSold', 'buyers', 'vaultLamports', 'sponsored'];

/**
 * Re-reads every live (open | active) pool from its account through PoolRegistryService.syncFromChain – the chain wins – and reports what differed from the
 * mirror (the watcher logs it: a drift means an event was missed or mis-applied). A pool with no account is reported as missing and left alone. An RPC failure
 * stops the run (503) – the next run starts over.
 */
@CommandHandler(SyncPoolsCommand)
export class SyncPoolsHandler implements ICommandHandler<SyncPoolsCommand, SyncPoolsResultDto> {
  constructor(
    private readonly pools: PoolRepositoryPort,
    private readonly registry: PoolRegistryService,
  ) {}

  async execute(): Promise<SyncPoolsResultDto> {
    const result: SyncPoolsResultDto = { synced: 0, drifted: [], missing: [] };
    for (const before of await this.pools.listLive()) {
      const after = await this.registry.syncFromChain(before.id);
      if (!after) { result.missing.push(before.id); continue; }
      result.synced++;
      const drift = diff(before.id, before.snapshot(), after.snapshot());
      if (drift) result.drifted.push(drift);
    }
    return result;
  }
}

const diff = (poolId: number, mirror: PoolProps, chain: PoolProps): PoolDriftDto | null => {
  const changes = WATCHED.filter((k) => mirror[k] !== chain[k]).map((k) => `${k}: ${String(mirror[k])} → ${String(chain[k])}`);
  return changes.length ? { poolId, changes } : null;
};
