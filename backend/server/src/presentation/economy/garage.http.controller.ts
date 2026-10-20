import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { garageResponse } from '../common/response/economy.response.js';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { GarageDto } from '../../domain/economy/garage.dto.js';
import { GetGarageQuery } from '../../application/use-cases/players/get-garage/get-garage.query.js';
import { SaveGarageCommand } from '../../application/use-cases/players/save-garage/save-garage.command.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { saveGarageBodySchema, type SaveGarageBody } from './dto/garage.dto.js';

/** The Garage (lobby → GARAGE): every part of the catalog with what the signed-in wallet owns and wears, and its collection progress; and SAVE of a whole selection. */
@Controller('api/garage')
@UseGuards(PlayerAuthGuard)
export class GarageHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ZodResponse(garageResponse)
  garage(@CurrentPlayer() player: PlayerIdentity): Promise<GarageDto> {
    return this.queryBus.execute<GetGarageQuery, GarageDto>(new GetGarageQuery(player.wallet));
  }

  /** 200 the Garage after the save · 400 an unknown part / slot / nothing picked · 409 `not_owned` (nothing was saved). */
  @Post('loadout') @HttpCode(200)
  @ZodResponse(garageResponse)
  save(@CurrentPlayer() player: PlayerIdentity, @ZodBody(saveGarageBodySchema) body: SaveGarageBody): Promise<GarageDto> {
    return this.commandBus.execute<SaveGarageCommand, GarageDto>(new SaveGarageCommand(player.wallet, body.loadout));
  }
}
