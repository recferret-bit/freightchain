import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { PRESEASON_EVENT_ID } from '../../../../domain/prize/event-settlement.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { EventSettlementRepositoryPort, type EventReviewRecord } from '../../../ports/prize/event-settlement.repository.port.js';
import { SanctionsCheckPort } from '../../../ports/prize/sanctions-check.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import { EventSettlementService } from '../../../services/event-settlement.service.js';
import { CheckEventSanctionsCommand } from './check-event-sanctions.command.js';

/** Screens a candidate (before the lock) or a winner (after it: the payout needs a check under 24 h old). The port call is outside the transaction; only the result is stored. */
@CommandHandler(CheckEventSanctionsCommand)
export class CheckEventSanctionsHandler implements ICommandHandler<CheckEventSanctionsCommand, EventReviewRecord> {
  constructor(
    private readonly event: EventSettlementService,
    private readonly repo: EventSettlementRepositoryPort,
    private readonly sanctions: SanctionsCheckPort,
    private readonly proofs: AdminProofService,
    private readonly audit: AdminActionRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ admin, wallet, requestId, signature }: CheckEventSanctionsCommand): Promise<EventReviewRecord> {
    const proof = await this.proofs.prove(admin, { action: 'event_sanctions', wallet }, signature);
    const known = await this.event.view(PRESEASON_EVENT_ID);
    const allowed = known.state.lockedAt ? known.winners.some((w) => w.wallet === wallet) : known.candidates.some((c) => c.wallet === wallet);
    if (!allowed) throw new NotFoundError('this wallet is not a candidate or a winner of the event', 'event_candidate_not_found');
    const result = await this.sanctions.check(wallet);
    return this.transactions.run(async (tx) => {
      const before = await this.repo.review(PRESEASON_EVENT_ID, wallet, tx);
      const at = this.clock.now();
      const next: EventReviewRecord = { disqualified: false, prizeEligibleOverride: null, note: null, ...before, wallet, sanctionsCheckedAt: at, sanctionsClean: result.clean, sanctionsRef: result.ref, updatedBy: admin, updatedAt: at };
      await this.repo.saveReview(PRESEASON_EVENT_ID, next, tx);
      await this.audit.insert({
        wallet: admin, action: 'event.sanctions', target: wallet, role: 'admin',
        beforeState: { clean: before?.sanctionsClean ?? null, checkedAt: before?.sanctionsCheckedAt?.getTime() ?? null }, afterState: { clean: result.clean, checkedAt: at.getTime(), ref: result.ref },
        detail: { clean: result.clean, ref: result.ref, signed: proof }, requestId, at,
      }, tx);
      return next;
    });
  }
}
