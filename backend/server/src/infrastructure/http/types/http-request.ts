import type { Request } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export interface RequestWithId extends Request {
  requestId: string;
}

export const getRequestId = (req: Request): string => (req as Partial<RequestWithId>).requestId ?? 'unknown';

/** The signed-in rider, set by PlayerAuthGuard. */
export interface PlayerIdentity {
  wallet: string;
  termsVersion?: number | null;
  privacyVersion?: number | null;
}
export type PlayerAuthPayload = PlayerIdentity;

export interface RequestWithPlayer extends Request {
  player: PlayerIdentity;
  /** Internal route-policy result from authenticated guard, never client-controlled. */
  termsExempt?: boolean;
}

/** Set by OptionalSessionGuard. Null when the cookie is missing or does not verify. */
export interface RequestWithOptionalSession extends Request {
  optionalWallet: string | null;
}
