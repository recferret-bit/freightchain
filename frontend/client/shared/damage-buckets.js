/* Hull lost, split the way the ranking stores it. The client `hurt` and the server ReplayEngine both add through here. */

export const DAMAGE_SOURCES = ['holes', 'vehicles', 'props', 'cold', 'other'];

export function emptyBuckets() {
  return { holes: 0, vehicles: 0, props: 0, cold: 0, other: 0 };
}

export function addBucket(buckets, source, amount) {
  const n = Number(amount);
  if (!(n > 0) || !buckets) return buckets;
  const key = DAMAGE_SOURCES.includes(source) ? source : 'other';
  buckets[key] += n;
  return buckets;
}

export function bucketTotal(buckets) {
  return DAMAGE_SOURCES.reduce((sum, key) => sum + (buckets?.[key] ?? 0), 0);
}

/** Hole and vehicle charges, then whatever hull is still missing goes to `other`, so the five buckets sum to the hull lost. */
export function bucketsFromCharges(holeAmounts, vehicleAmounts, hullAtFinish) {
  const buckets = emptyBuckets();
  for (const n of holeAmounts) addBucket(buckets, 'holes', n);
  for (const n of vehicleAmounts) addBucket(buckets, 'vehicles', n);
  const charged = bucketTotal(buckets);
  const total = Math.max(charged, Math.max(0, 100 - (Number(hullAtFinish) || 0)));
  if (total - charged > 1e-9) addBucket(buckets, 'other', total - charged);
  return buckets;
}

/** Label from `hurt` / a contact. An explicit source argument wins at the call. */
export function sourceOfLabel(label) {
  if (label === 'POTHOLE') return 'holes';
  if (label === 'IMPACT') return 'props';
  if (label === 'COLD') return 'cold';
  if (label === 'COLLISION' || label === 'SCRATCH' || label === 'BUMP') return 'vehicles';
  return 'other';
}

/** How many main-road stop lines `stopLine(j, +1)` were crossed on red between s0 and s1. */
export function crossedRed(net, s0, s1) {
  if (!(s1 > s0)) return 0;
  let n = 0;
  for (const j of net.near(s0 - 40, s1 + 40)) {
    if (!j.signal || j.kind === 'start') continue;
    const line = net.stopLine(j, 1);
    if (s0 < line && s1 >= line && net.signal(j, 'main') === 'R') n += 1;
  }
  return n;
}

/** `samples` are `{ s, t }` in order. The signal clock is the sample's game time. */
export function countRedLights(net, samples) {
  let n = 0;
  let prev = null;
  for (const row of samples) {
    if (prev && row.s > prev.s) {
      net.clock = row.t;
      n += crossedRed(net, prev.s, row.s);
    }
    prev = row;
  }
  return n;
}
