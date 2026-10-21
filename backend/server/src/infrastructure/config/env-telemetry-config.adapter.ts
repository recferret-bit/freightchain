import { Injectable } from '@nestjs/common';
import { TelemetryConfigPort, type TelemetryV21Mode } from '../../application/ports/telemetry/telemetry-config.port.js';
import { EnvService } from './env.service.js';

@Injectable()
export class EnvTelemetryConfigAdapter extends TelemetryConfigPort {
  constructor(private readonly env: EnvService) { super(); }

  mode(): TelemetryV21Mode { return this.env.telemetryV21; }
}
