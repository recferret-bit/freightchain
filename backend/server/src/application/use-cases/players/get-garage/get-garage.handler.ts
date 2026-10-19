import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toGarageDto, type GarageDto } from '../../../../domain/economy/garage.dto.js';
import { formatHonk } from '../../../../domain/honk/tokenomics.js';
import type { HonkPartSeed } from '../../../../domain/honk/parts-catalog.js';
import { HonkRepositoryPort } from '../../../ports/honk/honk.repository.port.js';
import { CosmeticRepositoryPort } from '../../../ports/players/cosmetic.repository.port.js';
import { GetGarageQuery } from './get-garage.query.js';

const catalogCopy = (parts: readonly HonkPartSeed[]) => new Map(parts.map((p) => [`${p.slot}:${p.item}`, { name: p.name, description: p.description, price: p.price === null ? null : formatHonk(p.price) }]));

@QueryHandler(GetGarageQuery)
export class GetGarageHandler implements IQueryHandler<GetGarageQuery, GarageDto> {
  constructor(private readonly cosmetics: CosmeticRepositoryPort, private readonly honk: HonkRepositoryPort) {}

  async execute({ wallet }: GetGarageQuery): Promise<GarageDto> {
    const [unlocked, worn, parts] = await Promise.all([this.cosmetics.listUnlocked(wallet), this.cosmetics.listEquipped(wallet), this.honk.listParts()]);
    return toGarageDto(unlocked, worn, catalogCopy(parts));
  }
}
