import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { PRESEASON_EVENT_ID } from '../../../../domain/prize/event-settlement.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { EventSettlementRepositoryPort, type EventReviewRecord } from '../../../ports/prize/event-settlement.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import { EventSettlementService } from '../../../services/event-settlement.service.js';
import { ReviewEventWalletCommand } from './review-event-wallet.command.js';

/** Sets the flags of a wallet that really has a qualifying attempt. Refused once the final list is locked. Sanctions evidence on the row is kept. */
@CommandHandler(ReviewEventWalletCommand)
export class ReviewEventWalletHandler implements ICommandHandler<ReviewEventWalletCommand, EventReviewRecord> {
  constructor(
    private readonly event: EventSettlementService,
    private readonly repo: EventSettlementRepositoryPort,
    private readonly proofs: AdminProofService,
    private readonly audit: AdminActionRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ admin, wallet, disqualified, prizeEligible, note, requestId, signature }: ReviewEventWalletCommand): Promise<EventReviewRecord> {
    const proof = await this.proofs.prove(admin, { action: 'event_review', wallet, disqualified, prizeEligible, note }, signature);
    return this.transactions.run(async (tx) => {
      const view = await this.event.view(PRESEASON_EVENT_ID, tx);
      if (view.state.lockedAt) throw new ConflictError('the final list is locked', 'event_locked');
      if (!view.candidates.some((c) => c.wallet === wallet)) throw new NotFoundError('this wallet has no qualifying event attempt', 'event_candidate_not_found');
      const before = await this.repo.review(PRESEASON_EVENT_ID, wallet, tx);
      const next: EventReviewRecord = {
        sanctionsCheckedAt: null, sanctionsClean: null, sanctionsRef: null, ...before, wallet, disqualified, prizeEligibleOverride: prizeEligible, note, updatedBy: admin, updatedAt: this.clock.now(),
      };
      await this.repo.saveReview(PRESEASON_EVENT_ID, next, tx);
      await this.audit.insert({
        wallet: admin, action: 'event.review', target: wallet, role: 'admin',
        beforeState: { disqualified: before?.disqualified ?? false, prizeEligibleOverride: before?.prizeEligibleOverride ?? null, note: before?.note ?? null },
        afterState: { disqualified, prizeEligibleOverride: prizeEligible, note }, detail: { signed: proof }, requestId, at: next.updatedAt,
      }, tx);
      return next;
    });
  }
}
