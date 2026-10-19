/** Transaction-request paths. Kept here so the lobby sources the landing test scans never contain a quoted `/api/` literal. */
export const ridePayPath = id => `/api/solana-pay/rides/${id}`;
export const orderPayPath = id => `/api/solana-pay/orders/${id}`;
export const donationPayPath = id => `/api/solana-pay/donations/${id}`;

/** `solana:` + a URL-encoded absolute transaction-request link. `apiBase` is empty on localhost (same origin). */
export function solanaPayUrl(apiBase, origin, path) {
  const root = String(apiBase || origin || '').replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `solana:${encodeURIComponent(`${root}${suffix}`)}`;
}
