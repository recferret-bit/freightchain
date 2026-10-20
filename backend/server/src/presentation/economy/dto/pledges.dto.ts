import { z } from 'zod';
import { TRANSACTION_SIGNATURE_MESSAGE, isTransactionSignature } from '../../../domain/economy/transaction-signature.js';

export const pledgeIdParamsSchema = z.object({ id: z.string().min(1).max(64) }).strict();
export type PledgeIdParams = z.infer<typeof pledgeIdParamsSchema>;

export const pledgeRideIdParamsSchema = z.object({ id: z.string().min(1).max(64) }).strict();
export type PledgeRideIdParams = z.infer<typeof pledgeRideIdParamsSchema>;

/** at least 1 000 lamports a km, at most 1 SOL a km; the cap (rate × km) is what leaves the sponsor's wallet */
export const createPledgeBodySchema = z.object({
  rideId: z.string().uuid(),
  lamportsPerKm: z.coerce.bigint().min(1_000n).max(1_000_000_000n),
  targetKm: z.coerce.number().int().min(1).max(10_000),
}).strict();
export type CreatePledgeBody = z.infer<typeof createPledgeBodySchema>;
export type CreatePledgeDto = CreatePledgeBody;

export const confirmPledgeBodySchema = z.object({
  signature: z.string().refine(isTransactionSignature, TRANSACTION_SIGNATURE_MESSAGE),
}).strict();
export type ConfirmPledgeBody = z.infer<typeof confirmPledgeBodySchema>;
