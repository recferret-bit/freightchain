import { Controller, Get, Header } from '@nestjs/common';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { entityBundleResponse } from '../common/response/editor.response.js';
import { QueryBus } from '@nestjs/cqrs';
import { GetEntityBundleQuery, type EntityBundleDto } from '../../application/use-cases/entities/get-entity-bundle/get-entity-bundle.query.js';

/**
 * The 3D models every page draws (the game, offline play, replays, the model viewer): public, cacheable (Express's weak ETag answers 304 to an unchanged
 * bundle; nginx microcaches it too), throttled per IP in its own bucket ('entities', THROTTLE_ENTITIES_LIMIT).
 */
@Controller('api/entities')
export class EntitiesHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('bundle') @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=600')
  @ZodResponse(entityBundleResponse)
  bundle(): Promise<EntityBundleDto> {
    return this.queryBus.execute<GetEntityBundleQuery, EntityBundleDto>(new GetEntityBundleQuery());
  }
}
