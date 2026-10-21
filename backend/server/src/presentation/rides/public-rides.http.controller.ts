import { Controller, Get, Header, StreamableFile } from '@nestjs/common';
import { publicRideResponse } from '../common/response/wire.js';
import { QueryBus } from '@nestjs/cqrs';
import { GetRideActionQuery } from '../../application/use-cases/actions/get-ride-action.query.js';
import { GetPublicRideQuery } from '../../application/use-cases/rides/get-public-ride/get-public-ride.query.js';
import type { PublicRideDto } from '../../domain/rides/public-ride.dto.js';
import { ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse, ZodResponseRaw } from '../../infrastructure/http/decorators/zod-response.js';
import { rideIdParamsSchema, type RideIdParams } from '../common/dto/common.dto.js';

/** 1×1 PNG. The receipt card is a cacheable image of a public replay, not a render of the road. */
const CARD_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

@Controller('api/rides')
export class PublicRidesHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  /** Same visibility as a blink. Hidden rides are 404 and never reach the bytes. */
  @Get(':id/card.png')
  @Header('Cache-Control', 'public, max-age=86400')
  @ZodResponseRaw()
  async card(@ZodParams(rideIdParamsSchema) params: RideIdParams): Promise<StreamableFile> {
    await this.queryBus.execute(new GetRideActionQuery(params.id));
    return new StreamableFile(CARD_PNG, { type: 'image/png' });
  }

  @Get(':id/public')
  @ZodResponse(publicRideResponse)
  getPublic(@ZodParams(rideIdParamsSchema) params: RideIdParams): Promise<PublicRideDto> {
    return this.queryBus.execute<GetPublicRideQuery, PublicRideDto>(new GetPublicRideQuery(params.id));
  }
}
