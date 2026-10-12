import { z } from 'zod';
import { WALLET_ADDRESS_MESSAGE, isWalletAddress } from '../../../domain/players/wallet-address.js';
import { TRANSACTION_SIGNATURE_MESSAGE, isTransactionSignature } from '../../../domain/economy/transaction-signature.js';

export const pledgeIdParamsSchema = z.object({ id: z.string().min(1).max(64) });
export type PledgeIdParams = z.infer<typeof pledgeIdParamsSchema>;

export const pledgeRideIdParamsSchema = z.object({ id: z.string().min(1).max(64) });
export type PledgeRideIdParams = z.infer<typeof pledgeRideIdParamsSchema>;

export const createPledgeBodySchema = z.object({
  rideId: z.string().min(1).max(64),
  lamportsPerKm: z.coerce.bigint().positive(),
  targetKm: z.coerce.number().int().positive(),
});
export type CreatePledgeBody = z.infer<typeof createPledgeBodySchema>;
export type CreatePledgeDto = CreatePledgeBody;

export const settlePledgeBodySchema = z.object({
  signature: z.string().refine(isTransactionSignature, TRANSACTION_SIGNATURE_MESSAGE).optional().nullable(),
  slot: z.coerce.bigint().positive().optional().nullable(),
}).default({});
export type SettlePledgeBody = z.infer<typeof settlePledgeBodySchema>;
