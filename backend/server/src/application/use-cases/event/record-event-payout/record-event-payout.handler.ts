import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { sanctionsFresh, solscanTxUrl, trustBlocked } from '../../../../domain/prize/event-dto.js';
import { PRESEASON_EVENT_ID } from '../../../../domain/prize/event-settlement.js';
import { eventReviewSchedule } from '../../../../domain/settings/preseason-event.js';
import { ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { EventSettlementRepositoryPort } from '../../../ports/prize/event-settlement.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import { GameSettingsService } from '../../../services/game-settings.service.js';
import { RecordEventPayoutCommand, type EventPayoutDto } from './record-event-payout.command.js';

/**
 * Records the transaction of one winner's manual USDC payout. Under the player row lock (the repository's one conditional UPDATE is the real guard):
 * the list must be locked and the appeals window closed, the sanctions check clean and under 24 h old, and the wallet's Trust at least 50 (a payout block only).
 * The amount and the place come from the locked list, never from the request.
 */
@CommandHandler(RecordEventPayoutCommand)
export class RecordEventPayoutHandler implements ICommandHandler<RecordEventPayoutCommand, EventPayoutDto> {
  constructor(
    private readonly repo: EventSettlementRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly settings: GameSettingsService,
    private readonly proofs: AdminProofService,
    private readonly audit: AdminActionRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ admin, wallet, txSignature, requestId, signature }: RecordEventPayoutCommand): Promise<EventPayoutDto> {
    const proof = await this.proofs.prove(admin, { action: 'event_payout', wallet, txSignature }, signature);
    return this.transactions.run(async (tx) => {
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      const at = this.clock.now();
      const state = await this.repo.state(PRESEASON_EVENT_ID, tx);
      const schedule = eventReviewSchedule(await this.settings.current(tx));
      if (!state.lockedAt || !schedule) throw new ConflictError('lock the final list first', 'event_not_locked');
      if (at < schedule.appealsEnd) throw new ConflictError('appeals are still open', 'event_appeals_open');
      const winner = (await this.repo.winners(PRESEASON_EVENT_ID, tx)).find((w) => w.wallet === wallet);
      if (!player || !winner) throw new NotFoundError('this wallet is not on the final list', 'event_winner_not_found');
      if (winner.txSignature) throw new ConflictError('this winner is already paid', 'event_already_paid');
      if (!sanctionsFresh(await this.repo.review(PRESEASON_EVENT_ID, wallet, tx), at)) throw new ConflictError('run a clean sanctions check less than 24 hours old first', 'event_sanctions_stale');
      if (trustBlocked(player.trustScore)) throw new ConflictError('the wallet\'s Trust score blocks the payout', 'event_trust_low');
      const outcome = await this.repo.recordPayout(PRESEASON_EVENT_ID, wallet, txSignature, admin, at, tx);
      if (outcome === 'signature_used') throw new ConflictError('this transaction is already recorded for another winner', 'event_signature_used');
      if (outcome !== 'recorded') throw new ConflictError('this winner is already paid', 'event_already_paid');
      await this.audit.insert({
        wallet: admin, action: 'event.payout', target: wallet, role: 'admin', beforeState: { txSignature: null }, afterState: { txSignature },
        detail: { place: winner.place, amountCents: winner.amountCents, txSignature, signed: proof }, requestId, at,
      }, tx);
      return { wallet, place: winner.place, amountCents: winner.amountCents, txSignature, solscanUrl: solscanTxUrl(txSignature) };
    });
  }
}
