import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { myPromosResponse, wardrobeResponse } from '../common/response/economy.response.js';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { WardrobeDto } from '../../domain/economy/wardrobe.dto.js';
import { EquipCosmeticCommand } from '../../application/use-cases/players/equip-cosmetic/equip-cosmetic.command.js';
import { GetMyPromosQuery, type MyPromosDto } from '../../application/use-cases/players/get-my-promos/get-my-promos.query.js';
import { GetWardrobeQuery } from '../../application/use-cases/players/get-wardrobe/get-wardrobe.query.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import { TermsGuard } from '../common/guards/terms.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { equipCosmeticBodySchema, type EquipCosmeticBody } from './dto/promos.dto.js';

/** The signed-in wallet's side of promo codes: what it redeemed, and the cosmetics (visuals) it owns and wears. Redeeming itself is `POST /api/promo/redeem` (pools controller). */
@Controller('api')
@UseGuards(PlayerAuthGuard, TermsGuard)
export class PromosHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('promo/mine')
  @ZodResponse(myPromosResponse)
  mine(@CurrentPlayer() player: PlayerIdentity): Promise<MyPromosDto> {
    return this.queryBus.execute<GetMyPromosQuery, MyPromosDto>(new GetMyPromosQuery(player.wallet));
  }

  /** Owned + worn, every slot set – the lobby's wardrobe, and what the game reads at the start of an online ride. */
  @Get('wardrobe')
  @ZodResponse(wardrobeResponse)
  wardrobe(@CurrentPlayer() player: PlayerIdentity): Promise<WardrobeDto> {
    return this.queryBus.execute<GetWardrobeQuery, WardrobeDto>(new GetWardrobeQuery(player.wallet));
  }

  /** 200 the wardrobe · 400 no such item · 409 not owned. */
  @Post('wardrobe/equip') @HttpCode(200)
  @ZodResponse(wardrobeResponse)
  equip(@CurrentPlayer() player: PlayerIdentity, @ZodBody(equipCosmeticBodySchema) body: EquipCosmeticBody): Promise<WardrobeDto> {
    return this.commandBus.execute<EquipCosmeticCommand, WardrobeDto>(new EquipCosmeticCommand(player.wallet, body.slot, body.item));
  }
}
