import { z } from 'zod';
import { EVIDENCE_STATUSES } from '../../../domain/trust/evidence.js';
import { bool, num, obj, str, strOrNull } from './wire.js';
export const networkEvidenceResponse = obj({ status: z.enum(EVIDENCE_STATUSES), asn: strOrNull, mobile: bool.nullable(), hosting: bool.nullable(), anonymous: bool.nullable(), excluded: z.literal('mobile').nullable() });
export const fundingEvidenceResponse = obj({ status: z.enum(EVIDENCE_STATUSES), source: z.literal('helius-wallet-api'), funder: obj({ wallet: str, type: strOrNull, amountRaw: str, signature: str, slot: num, at: num }).nullable(), transfers: z.array(obj({ counterparty: str, direction: z.enum(['in', 'out']), mint: str, amountRaw: str, signature: str, at: num })), complete: bool, excluded: z.literal('exchange').nullable() });
