import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toGarageDto, type GarageDto } from '../../../../domain/economy/garage.dto.js';
import { CosmeticRepositoryPort } from '../../../ports/players/cosmetic.repository.port.js';
import { GetGarageQuery } from './get-garage.query.js';

@QueryHandler(GetGarageQuery)
export class GetGarageHandler implements IQueryHandler<GetGarageQuery, GarageDto> {
  constructor(private readonly cosmetics: CosmeticRepositoryPort) {}

  async execute({ wallet }: GetGarageQuery): Promise<GarageDto> {
    const [unlocked, worn] = await Promise.all([this.cosmetics.listUnlocked(wallet), this.cosmetics.listEquipped(wallet)]);
    return toGarageDto(unlocked, worn);
  }
}
