import type { PoolProps } from '../../../../domain/economy/pool.types.js';

/** Put a pool into the mirror (overwrites a row with the same id): `pool:seed` in development, and `pool:register` once its account can be read from the chain. */
export class RegisterPoolCommand {
  constructor(public readonly pool: PoolProps) {}
}
