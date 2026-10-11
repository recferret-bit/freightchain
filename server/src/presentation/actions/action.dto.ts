import { z } from 'zod';
import { isWalletAddress } from '../../domain/players/wallet-address.js';

export const actionTierParamsSchema = z.object({ tier: z.enum(['1h', '4h', '8h']) });
export type ActionTierParams = z.infer<typeof actionTierParamsSchema>;
export const actionTierQuerySchema = actionTierParamsSchema;
export type ActionTierQuery = ActionTierParams;

/** Blink POST body. `type` and `data` are the spec’s extras; a buy never reads a quantity from them. */
export const actionAccountBodySchema = z.object({
  account: z.string().refine(isWalletAddress, 'Send the buyer’s Solana account (base58).'),
  type: z.string().optional(),
  data: z.unknown().optional(),
});
export type ActionAccountBody = z.infer<typeof actionAccountBodySchema>;
