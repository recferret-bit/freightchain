/** P0 client plane. The relay forwards only these names, and only the properties listed. */
export const CLIENT_EVENTS = [
  'landing_viewed',
  'landing_chapter_viewed',
  'wallet_connect_clicked',
  'lobby_open_clicked',
  'wallet_signature_requested',
  'sign_in_failed',
  'session_restored',
  'lobby_viewed',
  'lobby_tab_viewed',
  'tier_selected',
  'ride_buy_clicked',
  'payment_submitted',
  'payment_failed',
  'payment_confirm_gave_up',
  'api_request_failed',
  'ride_page_viewed',
  'ride_load_failed',
  'ride_start_clicked',
  'ride_start_failed',
] as const;

export type ClientEventName = (typeof CLIENT_EVENTS)[number];

const CLIENT_SET: ReadonlySet<string> = new Set(CLIENT_EVENTS);

/** UUID v4: version nibble 4, variant 8/9/a/b. Anything else is ignored, not a 400. */
export const ANON_ID_PATTERN = /^anon_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Stripped even if a review allowlists them by mistake. */
export const DENIED_PROPERTIES: ReadonlySet<string> = new Set([
  'signature', 'transaction', 'seed', 'nonce', 'message', 'token', 'cookie', 'authorization', 'detail', 'secret', 'anon_id',
]);

const ALLOW: Record<ClientEventName, readonly string[]> = {
  landing_viewed: ['surface'],
  landing_chapter_viewed: ['chapter'],
  wallet_connect_clicked: ['surface', 'wallet_name'],
  lobby_open_clicked: ['surface'],
  wallet_signature_requested: ['wallet_name'],
  sign_in_failed: ['stage', 'http_status', 'code', 'wallet_name'],
  session_restored: ['surface', 'request_alias', 'is_demo'],
  lobby_viewed: ['is_demo', 'round_id'],
  lobby_tab_viewed: ['tab'],
  tier_selected: ['tier_id', 'is_free', 'price_usd', 'lamports'],
  ride_buy_clicked: ['tier_id', 'is_free', 'price_usd', 'is_demo'],
  payment_submitted: ['ride_id', 'tier_id'],
  payment_failed: ['stage', 'ride_id', 'tier_id', 'http_status', 'code'],
  payment_confirm_gave_up: ['ride_id', 'tier_id', 'attempts'],
  api_request_failed: ['route', 'http_status', 'code', 'surface'],
  ride_page_viewed: ['ride_id', 'tier_id', 'is_free', 'time_scale', 'min_ms', 'complete_dist_m'],
  ride_load_failed: ['stage', 'http_status', 'code'],
  ride_start_clicked: ['ride_id', 'route_id', 'phase'],
  ride_start_failed: ['ride_id', 'http_status', 'code'],
};

const MAX_KEYS = 20;
const MAX_STRING = 200;

export type ClientProperty = string | number | boolean | null;

export const isClientEvent = (name: string): name is ClientEventName => CLIENT_SET.has(name);

const allowedValue = (value: unknown): value is ClientProperty => {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= MAX_STRING;
  return typeof value === 'number' && Number.isInteger(value);
};

/**
 * Allowlisted properties, or null when the event must be dropped (float, oversize string, non-primitive, too many keys).
 * A bad value drops that event, not the batch. Denied keys are removed, not a drop by themselves.
 */
export function allowClientProperties(event: string, properties: unknown): Record<string, ClientProperty> | null {
  if (!isClientEvent(event)) return null;
  if (properties == null) return {};
  if (typeof properties !== 'object' || Array.isArray(properties)) return null;
  const entries = Object.entries(properties);
  if (entries.length > MAX_KEYS) return null;
  for (const [, value] of entries) if (!allowedValue(value)) return null;
  const allow = new Set(ALLOW[event]);
  const out: Record<string, ClientProperty> = {};
  for (const [key, value] of entries) {
    if (DENIED_PROPERTIES.has(key) || !allow.has(key)) continue;
    out[key] = value;
  }
  return out;
}
