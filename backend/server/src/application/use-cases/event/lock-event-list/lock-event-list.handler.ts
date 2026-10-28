import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ConflictError } from '../../../../domain/shared/errors.js';
import { PRESEASON_EVENT_ID } from '../../../../domain/prize/event-settlement.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { EventSettlementRepositoryPort, type EventWinnerRecord } from '../../../ports/prize/event-settlement.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import { EventSettlementService } from '../../../services/event-settlement.service.js';
import { LockEventListCommand, type EventLockedDto } from './lock-event-list.command.js';

/** Freezes places and cents into `EventWinner` rows. Not before `event_appeals_end_utc` (and never without a valid schedule); a second lock is a 409. */
@CommandHandler(LockEventListCommand)
export class LockEventListHandler implements ICommandHandler<LockEventListCommand, EventLockedDto> {
  constructor(
    private readonly event: EventSettlementService,
    private readonly repo: EventSettlementRepositoryPort,
    private readonly proofs: AdminProofService,
    private readonly audit: AdminActionRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ admin, requestId, signature }: LockEventListCommand): Promise<EventLockedDto> {
    const proof = await this.proofs.prove(admin, { action: 'event_lock', eventId: PRESEASON_EVENT_ID }, signature);
    return this.transactions.run(async (tx) => {
      const at = this.clock.now();
      const view = await this.event.view(PRESEASON_EVENT_ID, tx);
      if (!view.schedule) throw new ConflictError('set the event end, review end and appeals end (in that order) first', 'event_schedule_missing');
      if (at < view.schedule.appealsEnd) throw new ConflictError('appeals are still open', 'event_appeals_open');
      if (view.state.lockedAt) throw new ConflictError('the final list is already locked', 'event_locked');
      const winners: EventWinnerRecord[] = view.settlement.rows.filter((r) => r.prizeEligible && r.amountCents > 0 && r.place !== null)
        .map((r) => ({ wallet: r.wallet, place: r.place as number, amountCents: r.amountCents, bps: r.bps, rideId: r.rideId, lockedAt: at, txSignature: null, paidAt: null, recordedBy: null }));
      if (!(await this.repo.lock(PRESEASON_EVENT_ID, admin, at, winners, tx))) throw new ConflictError('the final list is already locked', 'event_locked');
      const dto: EventLockedDto = { eventId: PRESEASON_EVENT_ID, lockedAt: at.getTime(), winners: winners.length, paidCents: view.settlement.paidCents, organizerCents: view.settlement.organizerCents };
      await this.audit.insert({
        wallet: admin, action: 'event.lock', target: PRESEASON_EVENT_ID, role: 'admin', beforeState: { locked: false }, afterState: { locked: true },
        detail: { winners: winners.map((w) => ({ wallet: w.wallet, place: w.place, amountCents: w.amountCents })), paidCents: dto.paidCents, organizerCents: dto.organizerCents, signed: proof }, requestId, at,
      }, tx);
      return dto;
    });
  }
}
