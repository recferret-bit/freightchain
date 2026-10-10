/* Where things live. On a real domain the site is split over sibling subdomains: freightchain.fun (landing + lobby), ride.freightchain.fun (the game),
   api.freightchain.fun (the API), storybook.freightchain.fun (the model viewer, viewer.html), whitepaper.freightchain.fun (the whitepaper, whitepaper.html), admin.freightchain.fun (the admin page behind basic auth – it calls
   the API on its OWN host, the only one where the server answers /api/admin/*). Anywhere else (localhost, an IP, file://, the standalone build) everything is ONE origin and all are '' (relative URLs). */
const host = typeof location === 'undefined' ? '' : location.hostname;
const root = host.replace(/^(ride|api|storybook|whitepaper|admin|www)\./, '');   // www. only 301s to the apex (deploy/nginx/www.conf.template); stripped in case a page is ever reached there
const split = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(root) && !/^\d+(\.\d+){3}$/.test(root);   // a registrable name with a dot, not an IPv4 address
const proto = typeof location === 'undefined' ? 'https:' : location.protocol;
export const API_BASE = split ? `${proto}//api.${root}` : '';
export const GAME_BASE = split ? `${proto}//ride.${root}` : '';
export const STORYBOOK_BASE = split ? `${proto}//storybook.${root}` : '';   // '' = same origin: /viewer.html
export const WHITEPAPER_BASE = split ? `${proto}//whitepaper.${root}` : '';   // '' = same origin: /whitepaper.html
export const SITE_BASE = split ? `${proto}//${root}` : '';
export const ADMIN_BASE = split ? `${proto}//admin.${root}` : '';   // the admin page AND its API (same origin there)
