import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { GameSettingsService } from '../../../services/game-settings.service.js';
import { GetSettingsQuery, type GameSettingsDto } from './get-settings.query.js';

/** The resolved knobs, including code defaults for any row that is missing. */
@QueryHandler(GetSettingsQuery)
export class GetSettingsHandler implements IQueryHandler<GetSettingsQuery, GameSettingsDto> {
  constructor(private readonly settings: GameSettingsService) {}

  execute(_query: GetSettingsQuery): Promise<GameSettingsDto> {
    return this.settings.current();
  }
}
