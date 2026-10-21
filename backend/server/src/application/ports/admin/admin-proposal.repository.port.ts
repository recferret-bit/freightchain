import type { AdminProposalRecord } from '../../../domain/admin/privileged-records.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class AdminProposalRepositoryPort {
  abstract insert(row: AdminProposalRecord, tx?: TransactionHandle): Promise<void>;
  abstract find(id: string): Promise<AdminProposalRecord | null>;
  /** pending → applying, for this approver. False when it was not pending. */
  abstract claim(id: string, approver: string, at: Date): Promise<boolean>;
  abstract markApplied(id: string, at: Date): Promise<void>;
  abstract release(id: string): Promise<void>;
}
