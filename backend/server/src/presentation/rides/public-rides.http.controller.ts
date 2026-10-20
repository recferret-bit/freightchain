import { Controller, Get } from '@nestjs/common';
import { publicRideResponse } from '../common/response/wire.js';
import { QueryBus } from '@nestjs/cqrs';
import { GetPublicRideQuery } from '../../application/use-cases/rides/get-public-ride/get-public-ride.query.js';
import type { PublicRideDto } from '../../domain/rides/public-ride.dto.js';
import { ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { rideIdParamsSchema, type RideIdParams } from '../common/dto/common.dto.js';

@Controller('api/rides')
export class PublicRidesHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get(':id/public')
  @ZodResponse(publicRideResponse)
  getPublic(@ZodParams(rideIdParamsSchema) params: RideIdParams): Promise<PublicRideDto> {
    return this.queryBus.execute<GetPublicRideQuery, PublicRideDto>(new GetPublicRideQuery(params.id));
  }
}
