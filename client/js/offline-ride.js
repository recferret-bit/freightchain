import { SITE_BASE } from './hosts.js';

/* The GUEST run – what play.html is without ?ride= (a ticket / free ride) or ?watch= (a spectator): nothing is counted, recorded or judged, and this page makes no request.
   `dev` = a console / tool run (__game.devRun): the guest's menu and no-network rules, but the caller picks the trip and the helpers.
   Imports hosts only, so the menu can import this without a cycle. */
export const offlineRide = { on: false, dev: false };

export function offlineWanted() {
  if (typeof location === 'undefined') return false;   // no page (the headless test): the plain sim
  const q = new URL(location.href).searchParams;
  return !q.has('ride') && !q.has('watch');
}

export const connectHref = () => `${SITE_BASE}/`;
