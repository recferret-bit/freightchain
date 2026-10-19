/** Which document this is, from the host and the path the browser shows.
 * whitepaper / pitchdeck / storybook / admin are `/` on their own host. The game is always `play.html`. */

const page = (surface, credentials) => (credentials ? { surface, credentials } : { surface });

export function crashPage(hostname, pathname) {
  const host = String(hostname || '').replace(/:\d+$/, '').toLowerCase();
  const path = String(pathname || '/');
  if (path.endsWith('/play.html') || path.endsWith('/freightchain.html')) return page('game');
  if (path.endsWith('/lobby.html')) return page('lobby');
  if (host.startsWith('whitepaper.') || path.endsWith('/whitepaper.html')) return page('whitepaper');
  if (host.startsWith('pitchdeck.') || path.endsWith('/pitchdeck.html')) return page('pitchdeck', 'omit');
  if (host.startsWith('storybook.') || path.endsWith('/viewer.html')) return page('viewer', 'omit');
  if (host.startsWith('admin.') || path.endsWith('/admin.html')) return page('admin');
  if (path.endsWith('/blink.html')) return page('blink');
  if (path === '/r' || path.startsWith('/r/') || path.endsWith('/r.html')) return page('receipt');
  if (path === '/' || path.endsWith('/index.html')) return page('landing');
  return null;
}
