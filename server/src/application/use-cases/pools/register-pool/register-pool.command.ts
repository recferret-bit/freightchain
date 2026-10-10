import type { PoolProps } from '../../../../domain/economy/pool.types.js';

/** Put a pool into the mirror (overwrites a row with the same id, keeping its ride seed): `pool:seed` in development, and `pool:register` once its account can be read
    from the chain. The ride seed is the server's – drawn by the handler for a new pool, never taken from the caller. */
export class RegisterPoolCommand {
  constructor(public readonly pool: Omit<PoolProps, 'rideSeed'>) {}
}
