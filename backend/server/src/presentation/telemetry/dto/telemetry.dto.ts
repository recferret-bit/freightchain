import { z } from 'zod';

export type { TelemetryAckDto } from '../../../application/use-cases/telemetry/record-telemetry/record-telemetry.command.js';

/** Unknown keys are stripped. Property values stay `unknown` so a float drops that event in the handler instead of 400ing the batch. */
export const telemetryEventSchema = z.object({
  event: z.string().min(1).max(100),
  properties: z.unknown().optional(),
});

export const telemetryBodySchema = z.object({
  anon_id: z.string().max(80).optional(),
  events: z.array(telemetryEventSchema).max(10),
});

export type TelemetryBody = z.infer<typeof telemetryBodySchema>;
