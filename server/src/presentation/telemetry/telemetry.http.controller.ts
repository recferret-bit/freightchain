import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { RecordTelemetryCommand, type TelemetryAckDto } from '../../application/use-cases/telemetry/record-telemetry/record-telemetry.command.js';
import { OptionalSession } from '../../infrastructure/http/decorators/optional-session.js';
import { ZodBody } from '../../infrastructure/http/decorators/zod.js';
import { OptionalSessionGuard } from '../../infrastructure/http/guards/optional-session.guard.js';
import { telemetryBodySchema, type TelemetryBody } from './dto/telemetry.dto.js';

/** Anonymous-ok client batch. The session cookie, when it verifies, names the distinct id. A missing cookie is 200. */
@Controller('api')
export class TelemetryHttpController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('telemetry')
  @HttpCode(200)
  @UseGuards(OptionalSessionGuard)
  record(@OptionalSession() wallet: string | null, @ZodBody(telemetryBodySchema) body: TelemetryBody): Promise<TelemetryAckDto> {
    return this.commandBus.execute<RecordTelemetryCommand, TelemetryAckDto>(new RecordTelemetryCommand(wallet, body.anon_id ?? null, body.events));
  }
}
