/* Where things live. On a real domain the site is split over sibling subdomains: freightchain.fun (landing + lobby), ride.freightchain.fun (the game),
   api.freightchain.fun (the API), storybook.freightchain.fun (the model viewer, viewer.html). Anywhere else (localhost, an IP, file://, the standalone build) everything is ONE origin and both are '' (relative URLs). */
const host = typeof location === 'undefined' ? '' : location.hostname;
const root = host.replace(/^(ride|api|storybook)\./, '');
const split = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(root) && !/^\d+(\.\d+){3}$/.test(root);   // a registrable name with a dot, not an IPv4 address
const proto = typeof location === 'undefined' ? 'https:' : location.protocol;
export const API_BASE = split ? `${proto}//api.${root}` : '';
export const GAME_BASE = split ? `${proto}//ride.${root}` : '';
export const SITE_BASE = split ? `${proto}//${root}` : '';
