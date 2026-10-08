import { z } from 'zod';
import { TRANSACTION_SIGNATURE_MESSAGE, isTransactionSignature } from '../../../domain/economy/transaction-signature.js';

/** A pool id is the on-chain u32. */
export const poolIdParamsSchema = z.object({ id: z.coerce.number().int().min(0).max(4_294_967_295) });
export type PoolIdParams = z.infer<typeof poolIdParamsSchema>;

/** Typed by people: case and spaces are forgiven later (PromoCode.normalize); the length bound only keeps junk out. */
export const redeemPromoBodySchema = z.object({ code: z.string().trim().min(1).max(64) });
export type RedeemPromoBody = z.infer<typeof redeemPromoBodySchema>;

export const createTicketOrderBodySchema = z.object({ poolId: z.number().int().min(0).max(4_294_967_295), qty: z.number().int().min(1).max(100) });
export type CreateTicketOrderBody = z.infer<typeof createTicketOrderBodySchema>;

export const orderIdParamsSchema = z.object({ id: z.string().uuid() });
export type OrderIdParams = z.infer<typeof orderIdParamsSchema>;

/** `?selfPaid=1` – the client pays its own network fee. */
export const ticketPaymentQuerySchema = z.object({ selfPaid: z.unknown().transform((v) => v === '1' || v === 'true') });
export type TicketPaymentQuery = z.infer<typeof ticketPaymentQuerySchema>;

export const confirmTicketOrderBodySchema = z.object({ signature: z.string().refine(isTransactionSignature, TRANSACTION_SIGNATURE_MESSAGE) });
export type ConfirmTicketOrderBody = z.infer<typeof confirmTicketOrderBodySchema>;

/** A signed transaction in base64 (a Solana transaction is at most 1232 bytes). */
export const submitTicketOrderBodySchema = z.object({ signedTransaction: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, 'signedTransaction must be base64').max(2_000) });
export type SubmitTicketOrderBody = z.infer<typeof submitTicketOrderBodySchema>;
