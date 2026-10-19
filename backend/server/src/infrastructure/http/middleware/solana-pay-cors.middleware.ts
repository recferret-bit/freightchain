import type { NextFunction, Request, Response } from 'express';
import { apiPath } from '../api-path.js';

/** Solana Pay wallets POST from their own origin. Only this path is open; the session API stays on the origin allowlist. */
export function solanaPayCors(req: Request, res: Response, next: NextFunction): void {
  const path = apiPath(req.originalUrl ?? req.url ?? '');
  if (!path.startsWith('/api/solana-pay')) { next(); return; }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Solana-Client');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
}
