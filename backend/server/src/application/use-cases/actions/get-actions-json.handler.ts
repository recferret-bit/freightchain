import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ACTIONS_JSON, type ActionsJson } from '../../../domain/actions/action-card.js';
import { GetActionsJsonQuery } from './get-actions-json.query.js';

@QueryHandler(GetActionsJsonQuery)
export class GetActionsJsonHandler implements IQueryHandler<GetActionsJsonQuery, ActionsJson> {
  async execute(_query: GetActionsJsonQuery): Promise<ActionsJson> {
    return ACTIONS_JSON;
  }
}
