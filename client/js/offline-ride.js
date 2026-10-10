import { SITE_BASE } from './hosts.js';

/* Guest runs on play.html?offline=1 only: nothing is counted, recorded or judged, and this page makes no request. Bare play.html stays the prototype.
   Imports hosts only, so the menu can import this without a cycle. */
export const offlineRide = { on: false };

export function offlineWanted() {
  if (typeof location === 'undefined') return false;
  return new URL(location.href).searchParams.get('offline') === '1';
}

export const connectHref = () => `${SITE_BASE}/`;
