import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toWardrobeDto, type WardrobeDto } from '../../../../domain/economy/wardrobe.dto.js';
import { CosmeticRepositoryPort } from '../../../ports/players/cosmetic.repository.port.js';
import { GetWardrobeQuery } from './get-wardrobe.query.js';

@QueryHandler(GetWardrobeQuery)
export class GetWardrobeHandler implements IQueryHandler<GetWardrobeQuery, WardrobeDto> {
  constructor(private readonly cosmetics: CosmeticRepositoryPort) {}

  async execute({ wallet }: GetWardrobeQuery): Promise<WardrobeDto> {
    const [unlocked, worn] = await Promise.all([this.cosmetics.listUnlocked(wallet), this.cosmetics.listEquipped(wallet)]);
    return toWardrobeDto(unlocked, worn);
  }
}
