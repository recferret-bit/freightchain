import type { RideTierId } from './ride-tier.js';

/* The ROAD a ride is driven on – an id of client/js/trips.js TRIPS: how much it bends, how much traffic, the free run's straight start and its ending at
   the line. The game draws and drives it; the server judges none of it (the layout and the holes are the seed's – domain/road). Stamped on the ride when
   it is CREATED (Ride.trip), so a replay rebuilds the road the driver had however the table is tuned later: a trip id is FROZEN once rides carry it –
   retune by adding a new id (here and in trips.js) and pointing the tier at it. null on a ride = one from before trips: the 'classic' road.
   test/unit/domain/ride-trip.spec.ts holds this list and the client's table together. */
export const TRIP_IDS = ['classic', 'free', '1h', '4h', '8h'] as const;
export type TripId = (typeof TRIP_IDS)[number];

/** the trip a NEW ride of this tier is driven on */
export const TRIP_OF_TIER: Readonly<Record<RideTierId, TripId>> = { free: 'free', '1h': '1h', '4h': '4h', '8h': '8h' };
export const tripOf = (tier: RideTierId): TripId => TRIP_OF_TIER[tier];
