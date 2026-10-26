import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { termsStatus, type TermsStatusDto } from '../../../../domain/players/terms.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { GetTermsQuery } from './get-terms.query.js';
@QueryHandler(GetTermsQuery)
export class GetTermsHandler implements IQueryHandler<GetTermsQuery, TermsStatusDto> {
  constructor(private readonly players: PlayerRepositoryPort) {}
  async execute({ wallet }: GetTermsQuery): Promise<TermsStatusDto> {
    const player = await this.players.findByWallet(wallet);
    if (!player) throw new NotFoundError('player not found');
    return termsStatus(player);
  }
}
