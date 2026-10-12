import type { PaidTierId } from '../rides/ride-tier.js';

/** CAIP-2 devnet genesis prefix. The deployment refuses mainnet, so a blink must not advertise it. */
export const DEVNET_BLOCKCHAIN_ID = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export const ACTION_VERSION = '2.4';

export const TIER_LABEL: Record<PaidTierId, string> = { '1h': '1 HOUR', '4h': '4 HOURS', '8h': '8 HOURS' };
const PAID: PaidTierId[] = ['1h', '4h', '8h'];

export const SHIFT_DESCRIPTION = 'Buy one ticket into an escrowed skill-prize pool on Solana devnet. You drive the shift. Distance on the board splits the pool. Not a wager. Devnet SOL has no value. The buyer pays the network fee. Accept the 18+ and loss terms on the site before a buy button will build a transaction.';
const NO_SALE = ' No paid pool is on sale right now.';

export interface ActionRule { pathPattern: string; apiPath: string }
export interface ActionsJson { rules: ActionRule[] }
/** `href` is always an action API path: a blink client POSTs `{ account, type }` to it, also for an external link (it answers `ActionLink`), never to a web page. */
export interface LinkedAction { type: 'transaction' | 'external-link'; label: string; href: string }
export interface ActionCard { type: 'action'; icon: string; title: string; description: string; label: string; links: { actions: LinkedAction[] } }
export interface ActionTx {
  type: 'transaction';
  transaction: string;
  message: string;
  links: { next: { type: 'inline'; action: { type: 'completed'; icon: string; title: string; description: string; label: string } } };
}
export interface ActionLink { type: 'external-link'; externalLink: string; message: string }
export interface SellableTier { tier: PaidTierId; poolId: number; lamports: number }
export interface OfferPool {
  id: number;
  tier: string;
  priceLamports: number;
  prepDeadline: Date;
  whyNotSellable(now: Date, qty: number, walletBought: number): string | null;
}

/** The website URLs a blink client maps onto this API. Relative api paths stay on the apex (nginx proxies /api/). */
export const ACTIONS_JSON: ActionsJson = {
  rules: [
    { pathPattern: '/', apiPath: '/api/actions/shift' },
    { pathPattern: '/r/**', apiPath: '/api/actions/ride/**' },
    { pathPattern: '/api/actions/**', apiPath: '/api/actions/**' },
  ],
};

export const originOf = (origin: string): string => origin.replace(/\/$/, '');
export const actionIcon = (origin: string): string => `${originOf(origin)}/icons/icon-512.png`;

/** Three decimal places, integer lamports (`100000000` → `0.100 SOL`). */
export function solLabel(lamports: number): string {
  const whole = Math.trunc(lamports / 1_000_000_000);
  const frac = String(Math.abs(lamports % 1_000_000_000)).padStart(9, '0').slice(0, 3);
  return `${whole}.${frac} SOL`;
}

/** One sellable pool per paid tier: the sale that ends soonest. `only` keeps a single tier. A registered selling pool counts; the tier `onSale` flag does not. */
export function sellableOffers(pools: readonly OfferPool[], now: Date, only?: PaidTierId | null): SellableTier[] {
  const tiers = only ? [only] : PAID;
  const out: SellableTier[] = [];
  for (const tier of tiers) {
    const candidates = pools.filter((p) => p.tier === tier && p.whyNotSellable(now, 1, 0) === null);
    candidates.sort((a, b) => a.prepDeadline.getTime() - b.prepDeadline.getTime() || a.id - b.id);
    const pool = candidates[0];
    if (pool) out.push({ tier, poolId: pool.id, lamports: pool.priceLamports });
  }
  return out;
}

/** The spec's button rule: a verb first, at most five words (`Buy 1 HOUR · 0.050 SOL`). */
const buyLink = (o: SellableTier): LinkedAction => ({ type: 'transaction', label: `Buy ${TIER_LABEL[o.tier]} · ${solLabel(o.lamports)}`, href: `/api/actions/shift/${o.tier}` });

export function shiftCard(origin: string, offers: readonly SellableTier[]): ActionCard {
  const site = originOf(origin);
  return {
    type: 'action', icon: actionIcon(site), title: 'Freight Chain', label: 'Buy a ticket',
    description: SHIFT_DESCRIPTION + (offers.length ? '' : NO_SALE),
    links: { actions: [...offers.map(buyLink), { type: 'external-link', label: 'Drive free', href: '/api/actions/go/home' }, { type: 'external-link', label: 'Watch live', href: '/api/actions/go/live' }] },
  };
}

export interface RideBlink {
  id: string;
  route: string | null;
  tier: string;
  status: string;
  km: number;
  reason: string | null;
  verdictRejected: boolean;
}

const ridePhase = (status: string, reason: string | null): string => {
  if (status === 'running' || status === 'created') return 'On the road';
  if (status === 'completed') return 'Finished';
  if (status === 'abandoned' || (status === 'failed' && (reason ?? '').toLowerCase().includes('abandon'))) return 'Abandoned';
  if (status === 'failed') return 'Failed';
  return 'Recorded';
};

/** Created and running free rides have no watch page (the public ride page hides it too). */
const showWatch = (ride: Pick<RideBlink, 'tier' | 'status'>): boolean => !((ride.status === 'running' || ride.status === 'created') && ride.tier === 'free');

/** As the ride page writes it (ride-page.middleware): `route-66` → `ROUTE 66`. */
const routeName = (route: string | null): string => (route ? route.replace(/[-_]/g, ' ').toUpperCase() : 'the road');

export function rideCard(origin: string, ride: RideBlink, offers: readonly SellableTier[]): ActionCard {
  const site = originOf(origin), road = routeName(ride.route), path = `/api/actions/ride/${encodeURIComponent(ride.id)}`;
  const tier = (TIER_LABEL as Record<string, string>)[ride.tier] ?? (ride.tier === 'free' ? 'FREE' : ride.tier.toUpperCase());
  const actions: LinkedAction[] = [{ type: 'external-link', label: 'Open the ride', href: path }];
  if (showWatch(ride)) actions.push({ type: 'external-link', label: 'Watch', href: `${path}/watch` });
  actions.push(...offers.map(buyLink));
  const counted = ride.verdictRejected ? ' The server did not count this shift.' : '';
  return {
    type: 'action', icon: actionIcon(site), label: 'Open', title: `${ride.km} km on ${road}`,
    description: `${ridePhase(ride.status, ride.reason)}. ${ride.km} km on ${road}. ${tier}. Solana devnet. Not a wager.${counted}`,
    links: { actions },
  };
}

export function buyTx(origin: string, tier: PaidTierId, poolId: number, transaction: string): ActionTx {
  const icon = actionIcon(origin);
  return {
    type: 'transaction', transaction, message: `One ${TIER_LABEL[tier]} ticket into pool #${poolId}. You pay the network fee. Devnet.`,
    links: { next: { type: 'inline', action: { type: 'completed', icon, label: 'Done', title: 'Sign and send, then start the shift', description: 'Open the site and sign in with this wallet to start. Devnet SOL has no value.' } } },
  };
}

export const rideLink = (origin: string, id: string): ActionLink => ({ type: 'external-link', externalLink: `${originOf(origin)}/r/${encodeURIComponent(id)}`, message: 'Opens the ride page. Devnet.' });

/** The watch page on the game host; a ride with no watch page (a live free ride) opens its ride page instead. */
export function watchLink(origin: string, gameOrigin: string, ride: Pick<RideBlink, 'id' | 'tier' | 'status'>): ActionLink {
  if (!showWatch(ride)) return rideLink(origin, ride.id);
  return { type: 'external-link', externalLink: `${originOf(gameOrigin || origin)}/play.html?watch=${encodeURIComponent(ride.id)}`, message: 'Opens the stream or its replay. Devnet.' };
}

export type SiteLinkTarget = 'home' | 'live';
const SITE_LINK: Record<SiteLinkTarget, { path: string; message: string }> = {
  home: { path: '/', message: 'Opens Freight Chain. The free drive needs no ticket. Devnet.' },
  live: { path: '/#economy', message: 'Opens the boards: next up, this round, recent rides to watch. Devnet.' },
};
export const siteLink = (origin: string, to: SiteLinkTarget): ActionLink => ({ type: 'external-link', externalLink: `${originOf(origin)}${SITE_LINK[to].path}`, message: SITE_LINK[to].message });
