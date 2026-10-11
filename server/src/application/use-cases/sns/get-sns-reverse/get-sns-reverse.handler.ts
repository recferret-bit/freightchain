import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { parseWalletAddress } from '../../../../domain/players/wallet-address.js';
import type { SnsReverseDto } from '../../../../domain/sns/sns.dto.js';
import { NameServicePort } from '../../../ports/sns/name-service.port.js';
import { GetSnsReverseQuery } from './get-sns-reverse.query.js';

@QueryHandler(GetSnsReverseQuery)
export class GetSnsReverseHandler implements IQueryHandler<GetSnsReverseQuery, SnsReverseDto> {
  constructor(private readonly nameService: NameServicePort) {}

  async execute(query: GetSnsReverseQuery): Promise<SnsReverseDto> {
    const wallet = parseWalletAddress(query.wallet);
    const domain = await this.nameService.reverse(wallet);
    return { wallet, domain };
  }
}
