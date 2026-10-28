import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { BadRequestError, ConflictError } from '../../../../domain/shared/errors.js';
import { PRESEASON_EVENT_ID, parsePrizeTable } from '../../../../domain/prize/event-settlement.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { EventSettlementRepositoryPort } from '../../../ports/prize/event-settlement.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import { SetEventPrizeTableCommand } from './set-event-prize-table.command.js';

/** `event_prize_table_cents` is a list, so it cannot be a `GameSetting` (one signed int each): it lives on `economy.EventConfig`. Refused after the lock. */
@CommandHandler(SetEventPrizeTableCommand)
export class SetEventPrizeTableHandler implements ICommandHandler<SetEventPrizeTableCommand, { prizeTableCents: number[] }> {
  constructor(
    private readonly repo: EventSettlementRepositoryPort,
    private readonly proofs: AdminProofService,
    private readonly audit: AdminActionRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ admin, cents, requestId, signature }: SetEventPrizeTableCommand): Promise<{ prizeTableCents: number[] }> {
    const table = parsePrizeTable(cents);
    if (!table) throw new BadRequestError('the prize table is 1 to 20 whole, non-negative US cents', 'bad_prize_table');
    const proof = await this.proofs.prove(admin, { action: 'event_prize_table', cents: table }, signature);
    return this.transactions.run(async (tx) => {
      const before = await this.repo.state(PRESEASON_EVENT_ID, tx);
      const at = this.clock.now();
      if (!(await this.repo.setPrizeTable(PRESEASON_EVENT_ID, table, at, tx))) throw new ConflictError('the final list is locked', 'event_locked');
      await this.audit.insert({
        wallet: admin, action: 'event.prize_table', target: PRESEASON_EVENT_ID, role: 'admin',
        beforeState: { prizeTableCents: before.prizeTableCents ? [...before.prizeTableCents] : null }, afterState: { prizeTableCents: table }, detail: { signed: proof }, requestId, at,
      }, tx);
      return { prizeTableCents: table };
    });
  }
}
