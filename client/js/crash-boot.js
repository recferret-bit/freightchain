/* First import of every page. Its body runs before the rest of that page's modules, so a throw while they load is still reported. */
import { watchCrashes } from './crash.js';
import { crashPage } from './crash-page.js';

if (typeof location !== 'undefined') {
  const found = crashPage(location.hostname, location.pathname);
  if (found) watchCrashes(found.surface, found.credentials ? { credentials: found.credentials } : undefined);
}
