/** Client plane (P0, P1, P2). The relay forwards only these names, and only the properties listed.
 *  Pause-menu resume is `ride_unpaused`. `ride_resumed` is the server event for an existing open ride, and the relay drops it. */
export const CLIENT_EVENTS = [
  'landing_viewed',
  'landing_chapter_viewed',
  'whitepaper_viewed',
  'wallet_connect_clicked',
  'lobby_open_clicked',
  'wallet_signature_requested',
  'sign_in_failed',
  'session_restored',
  'lobby_viewed',
  'lobby_tab_viewed',
  'ride_buy_clicked',
  'payment_submitted',
  'payment_failed',
  'payment_confirm_gave_up',
  'api_request_failed',
  'ride_page_viewed',
  'ride_load_failed',
  'ride_start_clicked',
  'ride_start_failed',
  'hero_video_started',
  'hero_video_failed',
  'demo_dialog_opened',
  'play_top_clicked',
  'leaderboard_filtered',
  'pending_ride_shown',
  'pending_ride_start_clicked',
  'ride_paused',
  'ride_unpaused',
  'ride_end_requested',
  'player_signed_out',
  'offline_practice_clicked',
  'storybook_link_clicked',
  'social_clicked',
  'promo_invite_viewed',
  'promo_invite_submitted',
  'promo_redeem_clicked',
  'garage_part_clicked',
  'web_vital',
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
  whitepaper_viewed: ['surface'],
  wallet_connect_clicked: ['surface', 'wallet_name'],
  lobby_open_clicked: ['surface'],
  wallet_signature_requested: ['wallet_name'],
  sign_in_failed: ['stage', 'http_status', 'code', 'wallet_name'],
  session_restored: ['surface', 'request_alias', 'is_demo'],
  lobby_viewed: ['is_demo', 'round_id'],
  lobby_tab_viewed: ['tab'],
  ride_buy_clicked: ['tier_id', 'is_free', 'price_usd', 'is_demo'],
  payment_submitted: ['ride_id', 'tier_id'],
  payment_failed: ['stage', 'ride_id', 'tier_id', 'http_status', 'code'],
  payment_confirm_gave_up: ['ride_id', 'tier_id', 'attempts'],
  api_request_failed: ['route', 'http_status', 'code', 'surface'],
  ride_page_viewed: ['ride_id', 'tier_id', 'is_free', 'time_scale', 'min_ms', 'complete_dist_m'],
  ride_load_failed: ['stage', 'http_status', 'code'],
  ride_start_clicked: ['ride_id', 'route_id', 'phase'],
  ride_start_failed: ['ride_id', 'http_status', 'code'],
  hero_video_started: [],
  hero_video_failed: [],
  demo_dialog_opened: ['has_video'],
  play_top_clicked: ['signed_in'],
  leaderboard_filtered: ['board'],
  pending_ride_shown: ['ride_id', 'tier_id'],
  pending_ride_start_clicked: ['ride_id'],
  ride_paused: ['source'],
  ride_unpaused: ['source'],
  ride_end_requested: ['outcome', 'client_complete', 'fail_code'],
  player_signed_out: [],
  offline_practice_clicked: [],
  storybook_link_clicked: [],
  social_clicked: ['net'],
  promo_invite_viewed: ['code'],
  promo_invite_submitted: ['code', 'signed_in', 'from_link'],
  promo_redeem_clicked: ['surface', 'prefilled'],
  garage_part_clicked: ['slot', 'item', 'owned'],
  /* value is ms, except CLS where it is the score × 1000 (0.1 → 100). The relay only accepts integers. */
  web_vital: ['surface', 'metric', 'value', 'rating', 'navigation'],
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
