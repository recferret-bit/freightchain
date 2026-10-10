import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { ChallengeDto } from '../../application/use-cases/auth/request-challenge/request-challenge.command.js';
import { AdjustFreeRidesCommand, type FreeRidesAdjustedDto } from '../../application/use-cases/admin/adjust-free-rides/adjust-free-rides.command.js';
import { GetSettingsQuery, type GameSettingsDto } from '../../application/use-cases/admin/get-settings/get-settings.query.js';
import { RequestActionChallengeCommand } from '../../application/use-cases/admin/request-action-challenge/request-action-challenge.command.js';
import { UpdateSettingCommand, type SettingUpdatedDto } from '../../application/use-cases/admin/update-setting/update-setting.command.js';
import { CurrentRequestId } from '../../infrastructure/http/decorators/client-info.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody } from '../../infrastructure/http/decorators/zod.js';
import { AdminGuard } from '../../infrastructure/http/guards/admin.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import {
  adjustFreeRidesBodySchema, freeRidesChallengeBodySchema, settingChallengeBodySchema, updateSettingBodySchema,
  type AdjustFreeRidesBody, type FreeRidesChallengeBody, type SettingChallengeBody, type UpdateSettingBody,
} from './dto/admin-settings.dto.js';

/** Signed changes of the settings table and of one wallet's free rides. Same guard as the rest of /api/admin. */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminSettingsHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('settings')
  settings(): Promise<GameSettingsDto> {
    return this.queryBus.execute<GetSettingsQuery, GameSettingsDto>(new GetSettingsQuery());
  }

  @Post('settings/challenge') @HttpCode(200)
  settingChallenge(@CurrentPlayer() admin: PlayerIdentity, @ZodBody(settingChallengeBodySchema) body: SettingChallengeBody): Promise<ChallengeDto> {
    return this.commandBus.execute<RequestActionChallengeCommand, ChallengeDto>(new RequestActionChallengeCommand(admin.wallet, { action: 'setting_update', key: body.key, value: body.value }));
  }

  @Post('settings') @HttpCode(200)
  updateSetting(@CurrentPlayer() admin: PlayerIdentity, @ZodBody(updateSettingBodySchema) body: UpdateSettingBody, @CurrentRequestId() requestId: string): Promise<SettingUpdatedDto> {
    return this.commandBus.execute<UpdateSettingCommand, SettingUpdatedDto>(new UpdateSettingCommand(admin.wallet, body.key, body.value, requestId, body.signature));
  }

  @Post('players/free-rides/challenge') @HttpCode(200)
  freeRidesChallenge(@CurrentPlayer() admin: PlayerIdentity, @ZodBody(freeRidesChallengeBodySchema) body: FreeRidesChallengeBody): Promise<ChallengeDto> {
    return this.commandBus.execute<RequestActionChallengeCommand, ChallengeDto>(new RequestActionChallengeCommand(admin.wallet, { action: 'free_rides_adjust', wallet: body.wallet, delta: body.delta }));
  }

  @Post('players/free-rides') @HttpCode(200)
  adjustFreeRides(@CurrentPlayer() admin: PlayerIdentity, @ZodBody(adjustFreeRidesBodySchema) body: AdjustFreeRidesBody, @CurrentRequestId() requestId: string): Promise<FreeRidesAdjustedDto> {
    return this.commandBus.execute<AdjustFreeRidesCommand, FreeRidesAdjustedDto>(new AdjustFreeRidesCommand(admin.wallet, body.wallet, body.delta, requestId, body.signature));
  }
}
