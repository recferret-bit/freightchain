import { Injectable } from '@nestjs/common';
import { Pool } from '../../domain/economy/pool.entity.js';
import { PoolChainPort } from '../ports/economy/pool-chain.port.js';
import { PoolRepositoryPort } from '../ports/economy/pool.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { EntropyPort } from '../ports/shared/entropy.port.js';

/** Brings the mirror of one pool in line with its account on chain (the chain wins): `pool:register`, a purchase into a pool the server has not seen, the periodic sync. */
@Injectable()
export class PoolRegistryService {
  constructor(
    private readonly chain: PoolChainPort,
    private readonly pools: PoolRepositoryPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
  ) {}

  /** null = no such pool on chain. A label given here replaces the stored one; otherwise the stored label and ranking round are kept. A pool seen for the first
      time draws its ride seed here (the one road all its riders drive); a known pool keeps the one it has. */
  async syncFromChain(poolId: number, label: string | null = null): Promise<Pool | null> {
    const state = await this.chain.readPool(poolId);
    if (!state) return null;
    const existing = await this.pools.findById(poolId);
    const pool = Pool.fromChain(state, this.clock.now(), existing, existing?.rideSeed ?? this.entropy.seed31());
    if (label) pool.relabel(label);
    await this.pools.upsert(pool);
    return pool;
  }
}
