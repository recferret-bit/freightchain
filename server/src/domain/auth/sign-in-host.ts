/** Phantom injects only on https, or when the host is exactly `localhost` or `127.0.0.1` (docs.phantom.com FAQ).
 *  A challenge whose domain is not the page's host is dropped with no window. Production names the app or the game.
 *  Outside production, a page on localhost / 127.0.0.1 / ::1 / *.localhost is named instead, so that window can open. */

export function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

/** `domain` is the SIWS authority (`host`, port included). True only for the same local names. */
export function isLocalSignInDomain(domain: string): boolean {
  try { return isLocalHostname(new URL(`http://${domain}`).hostname); }
  catch { return false; }
}

export function signInHost(origin: string | null, rules: { gameOrigin: string | null; gameDomain: string | null; appDomain: string; appOrigin: string; localSignIn: boolean }): { domain: string; uri: string } {
  if (origin && rules.gameOrigin && rules.gameDomain && origin === rules.gameOrigin) return { domain: rules.gameDomain, uri: rules.gameOrigin };
  if (origin && rules.localSignIn) {
    try {
      const url = new URL(origin);
      if (isLocalHostname(url.hostname)) return { domain: url.host, uri: url.origin };
    } catch { /* not a URL: the app domain */ }
  }
  return { domain: rules.appDomain, uri: rules.appOrigin };
}
