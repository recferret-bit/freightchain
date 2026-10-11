/* 𝕏 web intents. The driver still posts from their own account; `url` is a page Solana Actions can unfurl (the shift blink, or /r/:id), never an explorer link. No DOM. */

export const xIntent = (text, url) => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
/** `base` is SITE_BASE ('' on one origin). Fall back to the page origin so a relative site still has an absolute blink. */
export const siteOrigin = (base, origin) => (base || origin || '').replace(/\/$/, '');
export const homeBlinkUrl = (base, origin) => `${siteOrigin(base, origin)}/`;
export const ridePageUrl = (base, origin, id) => `${siteOrigin(base, origin)}/r/${encodeURIComponent(id)}`;

/** `tickets` and `amount` are already words (`2 tickets`, `0.100 SOL` or ''). The link buys one ticket into a pool on sale. */
export const ticketShareText = ({ shift, tickets, amount, poolId }) =>
  `Ride paid 🚛 ${tickets} for a ${shift} shift in @FreightChainSol${amount ? ` – ${amount}` : ''} in pool #${poolId}’s escrow on @solana devnet. The link buys one ticket into a pool on sale (18+ and loss terms on the site).`;

/** Outcome is only COMPLETE, ABANDONED or FAILED – never the verdict line (that can say VERIFIED). */
export const rideShareText = ({ phase, route, tier, km, time, outcome, free }) => {
  const road = route || 'the road';
  return phase === 'finished'
    ? `Finished a ${tier} shift on ${road} in @FreightChainSol. ${km} km · ${outcome}. Watch the replay or buy a ticket from the link. @solana devnet.`
    : `Driving ${road} in @FreightChainSol. ${km} in (${time}). ${free ? 'Watch along from the link.' : 'Watch the shift, or buy a ticket, from the link.'} @solana devnet.`;
};
