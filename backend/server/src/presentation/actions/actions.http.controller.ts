import { Controller, Get, HttpCode, Post, UseFilters } from '@nestjs/common';
import { actionsJsonResponse, actionCardResponse, actionPostResponse, actionTxResponse, actionLinkResponse } from '../common/response/rest.response.js';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { ActionCard, ActionLink, ActionPost, ActionsJson, ActionTx } from '../../domain/actions/action-card.js';
import { GetActionsJsonQuery } from '../../application/use-cases/actions/get-actions-json.query.js';
import { GetHelloActionQuery } from '../../application/use-cases/actions/get-hello-action.query.js';
import { GetRideActionQuery } from '../../application/use-cases/actions/get-ride-action.query.js';
import { OpenRideActionCommand } from '../../application/use-cases/actions/open-ride-action.command.js';
import { OpenSiteActionCommand } from '../../application/use-cases/actions/open-site-action.command.js';
import { GetShiftActionQuery } from '../../application/use-cases/actions/get-shift-action.query.js';
import { PrepareShiftActionCommand } from '../../application/use-cases/actions/prepare-shift-action.command.js';
import { SayHelloActionCommand } from '../../application/use-cases/actions/say-hello-action.command.js';
import { ZodBody, ZodParams, ZodQuery } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { ActionErrorFilter } from '../../infrastructure/http/filters/action-error.filter.js';
import { rideIdParamsSchema, type RideIdParams } from '../common/dto/common.dto.js';
import { actionAccountBodySchema, actionSiteParamsSchema, actionTierParamsSchema, actionTierQuerySchema, type ActionAccountBody, type ActionSiteParams, type ActionTierParams, type ActionTierQuery } from './action.dto.js';
import { CrossOriginPublic } from '../../infrastructure/http/guards/origin.guard.js';

/** Public Solana Actions. No session. Errors are `{ message }` (ActionErrorFilter), not problem+json.
    Every link button is a POST route here: blink clients POST to an external-link href too and open the `externalLink` it answers. */
@CrossOriginPublic()   // any site may POST here without a session (audit H7: the Origin guard skips it)
@Controller()
@UseFilters(ActionErrorFilter)
export class ActionsHttpController {
  constructor(private readonly commandBus: CommandBus, private readonly queryBus: QueryBus) {}

  @Get('actions.json')
  @ZodResponse(actionsJsonResponse)
  json(): Promise<ActionsJson> {
    return this.queryBus.execute<GetActionsJsonQuery, ActionsJson>(new GetActionsJsonQuery());
  }

  @Get('api/actions/hello')
  @ZodResponse(actionCardResponse)
  hello(): Promise<ActionCard> {
    return this.queryBus.execute<GetHelloActionQuery, ActionCard>(new GetHelloActionQuery());
  }

  @Post('api/actions/hello')
  @HttpCode(200)
  @ZodResponse(actionPostResponse)
  helloPost(@ZodBody(actionAccountBodySchema) body: ActionAccountBody): Promise<ActionPost> {
    return this.commandBus.execute<SayHelloActionCommand, ActionPost>(new SayHelloActionCommand(body.account));
  }

  @Get('api/actions/shift')
  @ZodResponse(actionCardResponse)
  shift(): Promise<ActionCard> {
    return this.queryBus.execute<GetShiftActionQuery, ActionCard>(new GetShiftActionQuery(null));
  }

  @Get('api/actions/shift/:tier')
  @ZodResponse(actionCardResponse)
  shiftTier(@ZodParams(actionTierParamsSchema) params: ActionTierParams): Promise<ActionCard> {
    return this.queryBus.execute<GetShiftActionQuery, ActionCard>(new GetShiftActionQuery(params.tier));
  }

  @Post('api/actions/shift')
  @HttpCode(200)
  @ZodResponse(actionTxResponse)
  buyQuery(@ZodQuery(actionTierQuerySchema) query: ActionTierQuery, @ZodBody(actionAccountBodySchema) body: ActionAccountBody): Promise<ActionTx> {
    return this.commandBus.execute<PrepareShiftActionCommand, ActionTx>(new PrepareShiftActionCommand(body.account, query.tier));
  }

  @Post('api/actions/shift/:tier')
  @HttpCode(200)
  @ZodResponse(actionTxResponse)
  buyPath(@ZodParams(actionTierParamsSchema) params: ActionTierParams, @ZodBody(actionAccountBodySchema) body: ActionAccountBody): Promise<ActionTx> {
    return this.commandBus.execute<PrepareShiftActionCommand, ActionTx>(new PrepareShiftActionCommand(body.account, params.tier));
  }

  @Post('api/actions/go/:to')
  @HttpCode(200)
  @ZodResponse(actionLinkResponse)
  site(@ZodParams(actionSiteParamsSchema) params: ActionSiteParams, @ZodBody(actionAccountBodySchema) body: ActionAccountBody): Promise<ActionLink> {
    return this.commandBus.execute<OpenSiteActionCommand, ActionLink>(new OpenSiteActionCommand(params.to, body.account));
  }

  @Get('api/actions/ride/:id')
  @ZodResponse(actionCardResponse)
  ride(@ZodParams(rideIdParamsSchema) params: RideIdParams): Promise<ActionCard> {
    return this.queryBus.execute<GetRideActionQuery, ActionCard>(new GetRideActionQuery(params.id));
  }

  @Post('api/actions/ride/:id')
  @HttpCode(200)
  @ZodResponse(actionLinkResponse)
  ridePost(@ZodParams(rideIdParamsSchema) params: RideIdParams, @ZodBody(actionAccountBodySchema) body: ActionAccountBody): Promise<ActionLink> {
    return this.commandBus.execute<OpenRideActionCommand, ActionLink>(new OpenRideActionCommand(params.id, body.account));
  }

  @Post('api/actions/ride/:id/watch')
  @HttpCode(200)
  @ZodResponse(actionLinkResponse)
  rideWatch(@ZodParams(rideIdParamsSchema) params: RideIdParams, @ZodBody(actionAccountBodySchema) body: ActionAccountBody): Promise<ActionLink> {
    return this.commandBus.execute<OpenRideActionCommand, ActionLink>(new OpenRideActionCommand(params.id, body.account, 'watch'));
  }
}
