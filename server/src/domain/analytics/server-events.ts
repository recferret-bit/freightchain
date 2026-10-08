/** Server plane. The relay drops every one of these. Disjoint from CLIENT_EVENTS (a unit test fails if they meet). */
export const SERVER_EVENTS = [
  'player_signed_in',
  'ride_ordered',
  'payment_confirmed',
  'payment_rejected',
  'ride_started',
  'ride_progressed',
  'ride_completed',
  'ride_abandoned',
  'ride_failed',
  'ride_resumed',
  'ride_expired',
  'ride_cancelled',
  'payment_reconcile_missed',
  'payment_conflict',
  'free_rides_granted',
  'free_ride_granted',
  'promo_redeemed',
  'cosmetic_equipped',
  'garage_saved',
  'promo_created',
  'promo_disabled',
  'achievement_unlocked',
  'round_opened',
  'round_closed',
] as const;

export type ServerEventName = (typeof SERVER_EVENTS)[number];

export const SERVER_EVENT_SET: ReadonlySet<string> = new Set(SERVER_EVENTS);
