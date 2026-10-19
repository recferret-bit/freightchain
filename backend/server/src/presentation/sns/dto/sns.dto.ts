import { z } from 'zod';
import { walletAddressSchema } from '../../common/dto/common.dto.js';

export const snsReverseQuerySchema = z.object({
  wallet: walletAddressSchema,
});
export type SnsReverseQuery = z.infer<typeof snsReverseQuerySchema>;

export const snsResolveQuerySchema = z.object({
  domain: z.string().trim().min(1).max(64),
});
export type SnsResolveQuery = z.infer<typeof snsResolveQuerySchema>;
