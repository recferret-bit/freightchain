import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { helloCard, helloReply, type ActionCard, type ActionPost } from '../../../domain/actions/action-card.js';
import { RulesConfigPort } from '../../ports/config/rules-config.port.js';
import { GetHelloActionQuery } from './get-hello-action.query.js';
import { SayHelloActionCommand } from './say-hello-action.command.js';

@QueryHandler(GetHelloActionQuery)
export class GetHelloActionHandler implements IQueryHandler<GetHelloActionQuery, ActionCard> {
  constructor(private readonly rules: RulesConfigPort) {}

  async execute(_query: GetHelloActionQuery): Promise<ActionCard> {
    return helloCard(this.rules.get().appOrigin);
  }
}

@CommandHandler(SayHelloActionCommand)
export class SayHelloActionHandler implements ICommandHandler<SayHelloActionCommand, ActionPost> {
  constructor(private readonly rules: RulesConfigPort) {}

  async execute(_command: SayHelloActionCommand): Promise<ActionPost> {
    return helloReply(this.rules.get().appOrigin);
  }
}
