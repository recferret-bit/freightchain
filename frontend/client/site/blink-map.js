/* Which Solana Action a URL means, the way the reference blink client (@dialectlabs/blinks-core 0.20.7, BlinksURLMapper) decides it. Pure – no DOM, no fetch.
   An input is one of: `solana-action:<api url>`, an interstitial `https://dial.to/?action=solana-action:<api url>`, or a site page that the site's
   /actions.json maps onto its action API. */
const PREFIX = /^solana-action:/;

/** → { api } when the input names the action API itself, { site } when /actions.json has to map it, null when it is no http(s) URL. */
export function unwrap(input) {
  const s = String(input ?? '').trim();
  if (PREFIX.test(s)) return httpUrl(decodeURIComponent(s.replace(PREFIX, '')), 'api');
  const url = httpUrl(s, 'site');
  if (!url) return null;
  const action = new URL(url.site).searchParams.get('action');
  if (action && PREFIX.test(decodeURIComponent(action))) return httpUrl(decodeURIComponent(action).replace(PREFIX, ''), 'api');
  return url;
}

function httpUrl(s, key) {
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? { [key]: u.toString() } : null; } catch { return null; }
}

/** The first rule of an actions.json `{ rules: [{ pathPattern, apiPath }] }` that matches `pageUrl` → the absolute action API URL, or null.
    `*` = one path segment, `**` = the rest; the page's query string is kept (the spec: "query parameters are always preserved"). */
export function mapRule(rules, pageUrl) {
  const page = new URL(pageUrl);
  for (const { pathPattern, apiPath } of rules ?? []) {
    if (typeof pathPattern !== 'string' || typeof apiPath !== 'string') continue;
    if (pathPattern === `${page.origin}${page.pathname}`) return absolute(apiPath, page.origin) + page.search;
    const re = new RegExp(`^${pathPattern.replace(/\*\*/g, '(.*)').replace(/\/(\*)/g, '/([^/]+)')}$`);
    const match = (pathPattern.startsWith('http') ? page.toString() : page.pathname).match(re);
    if (!match) continue;
    let mapped = apiPath;
    for (const group of match.slice(1)) mapped = mapped.replace(/\*+/, group);
    if (mapped.startsWith('http')) { const u = new URL(mapped); return `${u.origin}${u.pathname}${page.search}`; }
    return `${page.origin}${mapped}${page.search}`;
  }
  return null;
}

const absolute = (path, origin) => (path.startsWith('http') ? path : `${origin}${path}`);

/** A linked action's href against the action API it came from (relative hrefs are on the API's origin). */
export const resolveHref = (href, apiUrl) => (href.startsWith('http') ? href : new URL(apiUrl).origin + href);
