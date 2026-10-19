import { z } from 'zod';
import { walletAddressSchema } from '../common/dto/common.dto.js';

export const solanaPayIdParamsSchema = z.object({ id: z.string().min(1).max(64) });
export type SolanaPayIdParams = z.infer<typeof solanaPayIdParamsSchema>;

export const solanaPayAccountSchema = z.object({ account: walletAddressSchema });
export type SolanaPayAccount = z.infer<typeof solanaPayAccountSchema>;
