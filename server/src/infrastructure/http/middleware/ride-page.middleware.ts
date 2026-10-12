import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { EnvService } from '../../config/env.service.js';

const RIDE_PAGE_ROUTE = /^\/r\/([a-zA-Z0-9_-]{1,64})$/;
let cachedTemplate: string | null = null;

export function ridePageMiddleware(prisma: PrismaService | null, env: EnvService): (req: Request, res: Response, next: NextFunction) => void {
  const clientDir = env?.clientDir ?? '';
  const rHtmlPath = clientDir ? join(clientDir, 'r.html') : '';

  const getTemplate = (): string => {
    if (!cachedTemplate && rHtmlPath && existsSync(rHtmlPath)) {
      cachedTemplate = readFileSync(rHtmlPath, 'utf8');
    }
    return cachedTemplate ?? '<!doctype html><html><head><title>Freight Chain – Ride</title><meta property="og:url" content=""><meta property="og:title" content=""><meta property="og:description" content=""><meta name="twitter:title" content=""><meta name="twitter:description" content=""></head><body>Loading…</body></html>';
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
        include: { payment: true, verdict: true },
      })
      .then((ride) => {
        if (!ride) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.send(template);
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
        const canonical = `${origin}/r/${rideId}`;

        let html = template
          .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
          .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${canonical}">`)
          .replace(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${canonical}"`)   // X / Discord / Telegram name the shared ride, not the template's /r/
          .replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${title}"`)
          .replace(/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${desc}"`)
          .replace(/<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${title}"`)
          .replace(/<meta name="twitter:description" content="[^"]*"/, `<meta name="twitter:description" content="${desc}"`);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
      })
      .catch(() => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(template);
      });
  };
}
