import type { Pledge } from '../../../domain/economy/pledge.entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class PledgeRepositoryPort {
  abstract insert(pledge: Pledge, tx?: TransactionHandle): Promise<void>;
  abstract save(pledge: Pledge, tx?: TransactionHandle): Promise<void>;
  abstract findById(id: string, tx?: TransactionHandle): Promise<Pledge | null>;
  abstract findByPdaAddress(pdaAddress: string, tx?: TransactionHandle): Promise<Pledge | null>;
  abstract findByRideAndSponsor(rideId: string, sponsor: string, tx?: TransactionHandle): Promise<Pledge | null>;
  abstract findByRideId(rideId: string, tx?: TransactionHandle): Promise<Pledge[]>;
  abstract findByDriver(driver: string, tx?: TransactionHandle): Promise<Pledge[]>;
  abstract findBySponsor(sponsor: string, tx?: TransactionHandle): Promise<Pledge[]>;
}
