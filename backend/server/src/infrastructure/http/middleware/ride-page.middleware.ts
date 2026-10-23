import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { EnvService } from '../../config/env.service.js';

const RIDE_PAGE_ROUTE = /^\/r\/([a-zA-Z0-9_-]{1,64})$/;
const templates = new Map<string, string>();

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function ridePageMiddleware(prisma: PrismaService | null, env: EnvService, now: () => number = () => Number.NEGATIVE_INFINITY): (req: Request, res: Response, next: NextFunction) => void {
  const clientDir = env?.clientDir ?? '';
  const rHtmlPath = clientDir ? join(clientDir, 'r.html') : '';

  const getTemplate = (): string => {
    if (!rHtmlPath || !existsSync(rHtmlPath)) return '<!doctype html><html><head><title>Freight Chain – Ride</title><meta property="og:url" content=""><meta property="og:title" content=""><meta property="og:description" content=""><meta name="twitter:title" content=""><meta name="twitter:description" content=""></head><body>Loading…</body></html>';
    const hit = templates.get(rHtmlPath);
    if (hit !== undefined) return hit;
    const text = readFileSync(rHtmlPath, 'utf8');
    templates.set(rHtmlPath, text);
    return text;
  };

  return function ridePageMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (req.method !== 'GET') { next(); return; }
    const match = req.path.match(RIDE_PAGE_ROUTE);
    if (!match) { next(); return; }

    const rideId = match[1];
    const template = getTemplate();

    if (!prisma) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(template);
      return;
    }

    prisma.ride
      .findUnique({
        where: { id: rideId },
        select: {
          lastS: true, route: true, wallet: true, status: true, tier: true, tutorial: true, assist: true, poolId: true,
          player: { select: { guest: true } }, pool: { select: { payoutAt: true } }, verdict: { select: { status: true } },
        },
      })
      .then((ride) => {
        if (!ride) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.send(template);
          return;
        }
        const lockedPool = ride.poolId != null && (ride.pool == null || ride.pool.payoutAt.getTime() > now());
        const hidden = ride.status === 'running' || ride.status === 'created' || ride.tier === 'free' || ride.tutorial || ride.assist || ride.player?.guest === true || ride.verdict?.status === 'rejected' || lockedPool;
        if (hidden) {
          res.status(404).type('text/plain').send('Not found');
          return;
        }

        const km = (ride.lastS / 1000).toFixed(1);
        const route = ride.route ? ride.route.replace(/[-_]/g, ' ').toUpperCase() : 'HIGHWAY';
        const walletShort = ride.wallet.length > 8 ? `${ride.wallet.slice(0, 4)}…${ride.wallet.slice(-4)}` : ride.wallet;

        let title = `Freight Chain · ${route}`;
        let desc = `View shift telemetry, seed proof and devnet Solana explorer records on Freight Chain.`;

        if (ride.status === 'running' || ride.status === 'created') {
          title = `Freight Chain · ${route} [LIVE · ${km} km]`;
          desc = ride.tier === 'free'
            ? `Driver ${walletShort} is driving on ${route}. View live telemetry on Freight Chain.`
            : `Driver ${walletShort} is driving on ${route}. Watch live stream or tip on @solana devnet!`;
        } else if (ride.status === 'completed') {
          const verified = ride.verdict?.status === 'verified';
          title = `Freight Chain · ${km} km on ${route} · COMPLETED${verified ? ' (VERIFIED)' : ''}`;
          desc = `Shift completed by ${walletShort}. Verified distance, seed commitment, and devnet Solana proof.`;
        } else {
          title = `Freight Chain · ${km} km on ${route} · ${ride.status.toUpperCase()}`;
          desc = `Shift ended on ${route}. View replay and telemetry on Freight Chain.`;
        }

        const origin = env?.appOrigin || `https://${env?.appDomain ?? 'freightchain.fun'}`;
        const safeCanonical = escapeHtml(`${origin}/r/${rideId}`);
        const safeTitle = escapeHtml(title);
        const safeDesc = escapeHtml(desc);

        res.setHeader('Cache-Control', 'public, max-age=86400');
        const html = template
          .replace(/<meta name="robots" content="noindex">\s*/, '')   // the shell is noindex; a public ride is its own page
          .replace(/<title>[^<]*<\/title>/, () => `<title>${safeTitle}</title>`)
          .replace(/<link rel="canonical"[^>]*>/, () => `<link rel="canonical" href="${safeCanonical}">`)
          .replace(/<meta property="og:url" content="[^"]*"/, () => `<meta property="og:url" content="${safeCanonical}"`)
          .replace(/<meta property="og:title" content="[^"]*"/, () => `<meta property="og:title" content="${safeTitle}"`)
          .replace(/<meta property="og:description" content="[^"]*"/, () => `<meta property="og:description" content="${safeDesc}"`)
          .replace(/<meta name="twitter:title" content="[^"]*"/, () => `<meta property="og:title" content="${safeTitle}"`)
          .replace(/<meta name="twitter:description" content="[^"]*"/, () => `<meta name="twitter:description" content="${safeDesc}"`);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
      })
      .catch(() => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(template);
      });
  };
}
