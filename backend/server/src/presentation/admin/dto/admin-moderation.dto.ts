import { z } from 'zod';
import { walletAddressSchema } from '../../common/dto/common.dto.js';

export const eventIdParamsSchema = z.object({ eventId: z.coerce.number().int().positive() }).strict();
export type EventIdParams = z.infer<typeof eventIdParamsSchema>;

export const chatBanBodySchema = z.object({ ban: z.boolean() }).strict();
export type ChatBanBody = z.infer<typeof chatBanBodySchema>;

export const proposalIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
export type ProposalIdParams = z.infer<typeof proposalIdParamsSchema>;

export const poolRulesBodySchema = z.object({ poolId: z.number().int().positive(), note: z.string().max(200).nullable() }).strict();
export type PoolRulesBody = z.infer<typeof poolRulesBodySchema>;

export const programConfigBodySchema = z.object({ note: z.string().max(200).nullable() }).strict();
export type ProgramConfigBody = z.infer<typeof programConfigBodySchema>;

export { walletAddressSchema };
