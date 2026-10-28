import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { TermsAcceptanceRepositoryPort } from '../../../ports/players/terms-acceptance.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { assertTermsCurrent, termsStatus, type TermsStatusDto } from '../../../../domain/players/terms.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { AcceptTermsCommand } from './accept-terms.command.js';
@CommandHandler(AcceptTermsCommand)
export class AcceptTermsHandler implements ICommandHandler<AcceptTermsCommand, TermsStatusDto> {
  constructor(private readonly players: PlayerRepositoryPort, private readonly acceptances: TermsAcceptanceRepositoryPort, private readonly transactions: TransactionPort, private readonly clock: ClockPort) {}
  async execute({ wallet, termsVersion, privacyVersion }: AcceptTermsCommand): Promise<TermsStatusDto> {
    assertTermsCurrent(termsVersion, privacyVersion);
    return this.transactions.run(async tx => {
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      if (!player) throw new NotFoundError('player not found');
      const now = this.clock.now();
      await this.acceptances.insert({ wallet, termsVersion, privacyVersion, acceptedAt: now, age18: true }, tx);
      if (termsStatus(player).required || !player.age18At) {
        player.acceptTerms(termsVersion, privacyVersion, now);
        await this.players.save(player, tx);
      }
      return termsStatus(player);
    });
  }
}
