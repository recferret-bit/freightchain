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
  'achievement_nft_clicked',
  'ride_buy_clicked',
  'agreement_toggled',
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
  'cab_chain_link_clicked',
  'ride_share_clicked',
  'blink_link_clicked',
  'player_signed_out',
  'offline_practice_clicked',
  'storybook_link_clicked',
  'chain_card_flipped',
  'faq_item_opened',
  'social_clicked',
  'promo_invite_viewed',
  'promo_invite_submitted',
  'promo_redeem_clicked',
  'garage_part_clicked',
  'web_vital',
  'pitchdeck_link_clicked',
  'pitchdeck_viewed',
  'pitchdeck_slide_viewed',
  'pitchdeck_slide_time',
  'pitchdeck_interaction',
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
  achievement_nft_clicked: ['achievement_id', 'tier', 'link'],
  ride_buy_clicked: ['tier_id', 'is_free', 'price_usd', 'is_demo', 'level'],
  agreement_toggled: ['kind', 'on'],
  payment_submitted: ['ride_id', 'tier_id'],
  payment_failed: ['stage', 'ride_id', 'tier_id', 'http_status', 'code'],
  payment_confirm_gave_up: ['ride_id', 'tier_id', 'attempts'],
  api_request_failed: ['route', 'http_status', 'code', 'surface'],
  ride_page_viewed: ['ride_id', 'tier_id', 'is_free', 'time_scale', 'min_ms', 'complete_dist_m', 'level'],
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
  ride_paused: ['via'],
  ride_unpaused: ['via'],
  ride_end_requested: ['outcome', 'client_complete', 'fail_code'],
  cab_chain_link_clicked: ['link'],
  ride_share_clicked: ['surface', 'link', 'ride_id'],
  blink_link_clicked: [],
  player_signed_out: [],
  offline_practice_clicked: [],
  storybook_link_clicked: [],
  chain_card_flipped: ['card'],
  faq_item_opened: ['item', 'via'],
  social_clicked: ['net'],
  promo_invite_viewed: ['code'],
  promo_invite_submitted: ['code', 'signed_in', 'from_link'],
  promo_redeem_clicked: ['surface', 'prefilled'],
  garage_part_clicked: ['slot', 'item', 'owned'],
  /* value is ms, except CLS where it is the score × 1000 (0.1 → 100). The relay only accepts integers. */
  web_vital: ['surface', 'metric', 'value', 'rating', 'navigation'],
  /* the pitch deck (pitchdeck.<apex>): the landing footer's link click; one open per load (from = landing / whitepaper / homescreen / direct / other — `source` is the relay's client/server plane — src = the link's own ?src= tag); the FIRST view of each slide per load (via = load / key / button / swipe / hash);
     the visible time on a slide in ms (sent when the slide changes or the page is left); the first use of each toy per load (what = donate / adopt / tier / coin_drag / split / exit_sign / honk / lane / card / plan_bar / fullscreen / install_hint) */
  pitchdeck_link_clicked: ['surface'],
  pitchdeck_viewed: ['surface', 'from', 'src', 'touch', 'standalone'],
  pitchdeck_slide_viewed: ['slide', 'index', 'via'],
  pitchdeck_slide_time: ['slide', 'index', 'ms'],
  pitchdeck_interaction: ['slide', 'what'],
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
