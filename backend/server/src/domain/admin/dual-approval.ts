/** GameSetting keys that move money. A dual-approval deploy holds these for a second admin. */
export const MONEY_SETTING_KEYS = new Set([
  'referral_referrer_part_bps',
  'referral_ride_cap_lamports',
  'referral_donation_share_bps',
  'referral_donation_cap_lamports',
]);

const RIDE_CHANGE = /^\/api\/admin\/rides\/[^/]+\/(verdict|rejudge)$/;
const POOL_HOLD = /^\/api\/admin\/pools\/[^/]+\/hold$/;

/** True when this admin POST is on the dual-approval list (money or a chain-shaped change). */
export function needsDualApproval(method: string, path: string, body: unknown): boolean {
  if (method !== 'POST') return false;
  if (RIDE_CHANGE.test(path) || POOL_HOLD.test(path)) return true;
  if (path === '/api/admin/pools/rules' || path === '/api/admin/config') return true;
  if (path === '/api/admin/settings') {
    const key = body && typeof body === 'object' ? (body as { key?: unknown }).key : undefined;
    return typeof key === 'string' && MONEY_SETTING_KEYS.has(key);
  }
  if (path === '/api/admin/promos') {
    const kind = body && typeof body === 'object' ? (body as { promo?: { effect?: { kind?: unknown } } }).promo?.effect?.kind : undefined;
    return kind === 'tickets';
  }
  return false;
}
