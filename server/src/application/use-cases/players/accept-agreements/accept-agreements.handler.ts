import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toAgreementsDto, type AgreementsDto } from '../../../../domain/players/player.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { agreementsAccepted } from '../../../services/analytics-events.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import { withVersionRetry } from '../../../services/version-retry.js';
import { AcceptAgreementsCommand } from './accept-agreements.command.js';

/** Stamps or clears the two boxes under the player row lock. The event fires only on the transition into both-on, after the commit. */
@CommandHandler(AcceptAgreementsCommand)
export class AcceptAgreementsHandler implements ICommandHandler<AcceptAgreementsCommand, AgreementsDto> {
  constructor(
    private readonly sessions: PlayerSessionService,
    private readonly players: PlayerRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly analytics: AnalyticsPort,
  ) {}

  async execute({ wallet, age18, loss }: AcceptAgreementsCommand): Promise<AgreementsDto> {
    await this.sessions.touch(wallet);
    const now = this.clock.now();
    const { dto, becameAccepted } = await withVersionRetry(() => this.transactions.run(async (tx) => {
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      if (!player) throw new NotFoundError('player not found');
      const { changed, becameAccepted: accepted } = player.setAgreements({ age18, loss }, now);
      if (changed) await this.players.save(player, tx);
      return { dto: toAgreementsDto(player), becameAccepted: accepted };
    }));
    if (becameAccepted && dto.age18At !== null && dto.lossAt !== null) {
      const age18At = dto.age18At, lossAt = dto.lossAt;
      emitAnalytics(this.analytics, () => agreementsAccepted(wallet, age18At, lossAt, now));
    }
    return dto;
  }
}
