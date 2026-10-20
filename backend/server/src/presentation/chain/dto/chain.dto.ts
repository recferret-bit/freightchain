import { z } from 'zod';
import { extractWebhookSignatures } from '../../../domain/economy/webhook-signatures.js';

/** `?poolId=<u32>` (optional): the pool whose accounts the purchase writes. */
export const chainFeesQuerySchema = z.object({
  poolId: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number({ message: 'poolId must be a pool id' }).int('poolId must be a pool id').min(0, 'poolId must be a pool id').max(0xffff_ffff, 'poolId must be a pool id').optional()),
}).strict();
export type ChainFeesQuery = z.infer<typeof chainFeesQuerySchema>;

/** POST /api/chain/webhook: whatever QuickNode Streams / Helius deliver – reduced to the transaction signatures it names (domain/economy/webhook-signatures.ts). forward-compat: provider payloads stay non-strict (not a z.object). */
export const chainWebhookBodySchema = z.unknown().transform((body, ctx) => {
  const signatures = extractWebhookSignatures(body);
  if (typeof signatures === 'string') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: signatures });
    return z.NEVER;
  }
  return { signatures };
});
export type ChainWebhookBody = z.infer<typeof chainWebhookBodySchema>;
