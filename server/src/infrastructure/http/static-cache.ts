import type { ServerResponse } from 'node:http';

const YEAR = 31_536_000;
const DAY = 86_400;

/** Cache-Control for the static site. Vite fingerprints everything under /assets/ (the name changes with the content), so it can be cached for good;
 *  media and the icons are stable but not fingerprinted, so a day; pages (and anything unknown) are revalidated on every load – a deploy shows up immediately. */
export function cacheControlFor(path: string): string {
  const p = path.replaceAll('\\', '/');
  if (/\/assets\/[^/]+-[\w-]{8}\.\w+$/.test(p)) return `public, max-age=${YEAR}, immutable`;
  if (/\/(media|icons)\//.test(p) || /\/(favicon\.ico|manifest\.webmanifest)$/.test(p)) return `public, max-age=${DAY}`;   // not fingerprinted: a day, so a new icon shows up the next morning
  return 'no-cache';
}

/** `setHeaders` for express.static (ServeStaticModule's `serveStaticOptions`). */
export function staticHeaders(res: ServerResponse, path: string): void {
  res.setHeader('Cache-Control', cacheControlFor(path));
}
