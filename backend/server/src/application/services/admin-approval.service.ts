import { Injectable, Optional } from '@nestjs/common';
import { PROPOSAL_TTL_MS, type AdminProposalRecord } from '../../domain/admin/privileged-records.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../domain/shared/errors.js';
import { AdminActionRepositoryPort } from '../ports/admin/admin-action.repository.port.js';
import { AdminProposalRepositoryPort } from '../ports/admin/admin-proposal.repository.port.js';
import { RulesConfigPort } from '../ports/config/rules-config.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { EntropyPort } from '../ports/shared/entropy.port.js';
import { TransactionPort, type TransactionHandle } from '../ports/shared/transaction.port.js';

/** Dual approval: the first admin opens a proposal; a different admin applies it within 30 minutes. */
@Injectable()
export class AdminApprovalService {
  constructor(
    private readonly proposals: AdminProposalRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
    @Optional() private readonly transactions?: TransactionPort,
    @Optional() private readonly audit?: AdminActionRepositoryPort,
  ) {}

  dual(): boolean { return (this.rules.get().approvalMode ?? 'single') === 'dual'; }

  async open(action: string, target: string, proposer: string, payload: Record<string, unknown>, requestId: string | null): Promise<string> {
    const now = this.clock.now();
    const id = this.entropy.uuid();
    const row: AdminProposalRecord = {
      id, action, target, proposerWallet: proposer, approverWallet: null, payload, status: 'pending',
      createdAt: now, expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS), appliedAt: null, requestId,
    };
    const write = async (tx?: TransactionHandle): Promise<void> => {
      await this.proposals.insert(row, tx);
      if (!this.audit) return;
      await this.audit.insert({
        wallet: proposer, action: 'pending_approval', target, role: 'admin', requestId, at: now,
        beforeState: null, afterState: { action, status: 'pending' }, detail: { path: payload.path ?? null },
      }, tx);
    };
    if (this.transactions) await this.transactions.run(write);
    else await write();
    return id;
  }

  async approve(id: string, wallet: string): Promise<AdminProposalRecord> {
    const row = await this.proposals.find(id);
    if (!row) throw new NotFoundError('no such proposal');
    if (row.proposerWallet === wallet) throw new ForbiddenError('a second admin must approve', 'dual_approval_distinct_wallet_required');
    if (row.expiresAt.getTime() <= this.clock.now().getTime()) throw new UnauthorizedError('proposal expired', 'expired');
    if (row.status !== 'pending') throw new ConflictError('proposal is not pending', 'conflict');
    const claimed = await this.proposals.claim(id, wallet, this.clock.now());
    if (!claimed) throw new ConflictError('proposal is not pending', 'conflict');
    return { ...row, approverWallet: wallet, status: 'applying' };
  }

  async applied(id: string): Promise<void> {
    await this.proposals.markApplied(id, this.clock.now());
  }

  async release(id: string): Promise<void> {
    await this.proposals.release(id);
  }
}
