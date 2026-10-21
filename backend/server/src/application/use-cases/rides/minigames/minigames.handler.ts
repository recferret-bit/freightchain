import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { MinigameOpenDto } from '../../../../domain/minigames/phone-sms.js';
import { MinigameSessionService, type MinigameAnswerDto } from '../../../services/minigame-session.service.js';
import { AnswerMinigameCommand, GetMinigameAssetQuery, OpenMinigameCommand } from './minigames.command.js';

export { AnswerMinigameCommand, GetMinigameAssetQuery, OpenMinigameCommand };

@CommandHandler(OpenMinigameCommand)
export class OpenMinigameHandler implements ICommandHandler<OpenMinigameCommand, MinigameOpenDto> {
  constructor(private readonly minigames: MinigameSessionService) {}
  execute(cmd: OpenMinigameCommand): Promise<MinigameOpenDto> { return this.minigames.open(cmd); }
}

@CommandHandler(AnswerMinigameCommand)
export class AnswerMinigameHandler implements ICommandHandler<AnswerMinigameCommand, MinigameAnswerDto> {
  constructor(private readonly minigames: MinigameSessionService) {}
  execute(cmd: AnswerMinigameCommand): Promise<MinigameAnswerDto> { return this.minigames.answer(cmd); }
}

@QueryHandler(GetMinigameAssetQuery)
export class GetMinigameAssetHandler implements IQueryHandler<GetMinigameAssetQuery, string> {
  constructor(private readonly minigames: MinigameSessionService) {}
  execute(q: GetMinigameAssetQuery): Promise<string> { return this.minigames.asset(q); }
}
