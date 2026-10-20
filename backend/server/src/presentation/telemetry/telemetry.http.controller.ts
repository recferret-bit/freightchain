import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { telemetryAckResponse, clientErrorAckResponse } from '../common/response/rest.response.js';
import { CommandBus } from '@nestjs/cqrs';
import { ReportClientErrorCommand, type ClientErrorAckDto } from '../../application/use-cases/telemetry/report-client-error/report-client-error.command.js';
import { RecordTelemetryCommand, type TelemetryAckDto } from '../../application/use-cases/telemetry/record-telemetry/record-telemetry.command.js';
import type { ClientInfo } from '../../domain/auth/sign-in.js';
import { CurrentClient } from '../../infrastructure/http/decorators/client-info.js';
import { OptionalSession } from '../../infrastructure/http/decorators/optional-session.js';
import { ZodBody } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { OptionalSessionGuard } from '../../infrastructure/http/guards/optional-session.guard.js';
import { clientErrorBodySchema, type ClientErrorBody } from './dto/client-error.dto.js';
import { telemetryBodySchema, type TelemetryBody } from './dto/telemetry.dto.js';

/** Anonymous-ok client batch. The session cookie, when it verifies, names the distinct id. A missing cookie is 200. */
@Controller('api')
export class TelemetryHttpController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('telemetry')
  @HttpCode(200)
  @UseGuards(OptionalSessionGuard)
  @ZodResponse(telemetryAckResponse)
  record(@OptionalSession() wallet: string | null, @ZodBody(telemetryBodySchema) body: TelemetryBody): Promise<TelemetryAckDto> {
    return this.commandBus.execute<RecordTelemetryCommand, TelemetryAckDto>(new RecordTelemetryCommand(wallet, body.anon_id ?? null, body.events));
  }

  /** One unhandled crash. The wallet is the session cookie. The body cannot name one. */
  @Post('client-error')
  @HttpCode(200)
  @UseGuards(OptionalSessionGuard)
  @ZodResponse(clientErrorAckResponse)
  report(@OptionalSession() wallet: string | null, @CurrentClient() client: ClientInfo, @ZodBody(clientErrorBodySchema) body: ClientErrorBody): Promise<ClientErrorAckDto> {
    return this.commandBus.execute<ReportClientErrorCommand, ClientErrorAckDto>(new ReportClientErrorCommand(
      wallet, client.ip || 'unknown', body.anon_id ?? null,
      { surface: body.surface, release: body.release ?? null, name: body.name, value: body.value, frames: body.frames },
    ));
  }
}
