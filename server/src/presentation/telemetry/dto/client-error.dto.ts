import { z } from 'zod';
import { CLIENT_ERROR_MAX_FRAMES, CLIENT_ERROR_SURFACES } from '../../../domain/analytics/client-error.js';

export type { ClientErrorAckDto } from '../../../application/use-cases/telemetry/report-client-error/report-client-error.command.js';

const frameSchema = z.object({
  filename: z.string().max(200),
  function: z.string().max(200),
  lineno: z.number().int().nonnegative().max(10_000_000),
  colno: z.number().int().nonnegative().max(1_000_000),
});

/** Unknown keys are stripped. A bad surface or a non-integer line is 400 for that one report. */
export const clientErrorBodySchema = z.object({
  anon_id: z.string().max(80).optional(),
  surface: z.enum(CLIENT_ERROR_SURFACES),
  release: z.string().max(64).nullable().optional(),
  name: z.string().min(1).max(80),
  value: z.string().max(200),
  frames: z.array(frameSchema).max(CLIENT_ERROR_MAX_FRAMES),
});

export type ClientErrorBody = z.infer<typeof clientErrorBodySchema>;
