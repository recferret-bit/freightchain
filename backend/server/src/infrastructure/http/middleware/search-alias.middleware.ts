import type { NextFunction, Request, Response } from 'express';
import type { EnvService } from '../../config/env.service.js';

const hostOf = (req: Request): string => String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
const queryOf = (req: Request): string => { const url = req.url || ''; const i = url.indexOf('?'); return i === -1 ? '' : url.slice(i); };

/** One public URL per page. These paths are the same bytes as another page, or a URL that 404s, so a crawler that
 *  already has them should land on the page we want indexed. `/whitepaper.html` and `/pitchdeck.html` stay: nginx
 *  fetches that host's `/` as that file, so redirecting it back to `/` loops. */
export function searchAliasMiddleware(env: EnvService): (req: Request, res: Response, next: NextFunction) => void {
  const apex = (env?.appOrigin || '').replace(/\/$/, '');
  const home = apex ? `${apex}/` : '/';
  return function searchAliasMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return; }
    const path = req.path || '';
    const host = hostOf(req);
    const otherHost = host.startsWith('whitepaper.') || host.startsWith('pitchdeck.') || host.startsWith('storybook.') || host.startsWith('ride.') || host.startsWith('admin.') || host.startsWith('api.');
    if (path === '/r' || path === '/r/') { res.redirect(301, home); return; }   // the receipt shell used to name this URL; it has never been a page
    if (path === '/index.html') { res.redirect(301, otherHost ? `${home}${queryOf(req)}` : `/${queryOf(req)}`); return; }   // the file is the landing; a host whose / is another page sends people to the apex
    next();
  };
}
