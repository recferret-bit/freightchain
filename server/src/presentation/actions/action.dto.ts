import bs58 from 'bs58';
import { z } from 'zod';

/** A blink account has to be 32 bytes. The character check alone lets a string through that the chain adapter then 500s on. */
const solanaAccount = (value: string): boolean => {
  try { return bs58.decode(value).length === 32; } catch { return false; }
};

export const actionTierParamsSchema = z.object({ tier: z.enum(['1h', '4h', '8h']) });
export type ActionTierParams = z.infer<typeof actionTierParamsSchema>;
export const actionTierQuerySchema = actionTierParamsSchema;
export type ActionTierQuery = ActionTierParams;

/** Blink POST body. `type` and `data` are the spec’s extras; a buy never reads a quantity from them. */
export const actionAccountBodySchema = z.object({
  account: z.string().refine(solanaAccount, 'Send the buyer’s Solana account (base58).'),
  type: z.string().optional(),
  data: z.unknown().optional(),
});
export type ActionAccountBody = z.infer<typeof actionAccountBodySchema>;
