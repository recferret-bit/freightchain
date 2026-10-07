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
}

export interface RequestWithPlayer extends Request {
  player: PlayerIdentity;
}
