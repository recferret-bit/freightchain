/** Where the finish gantry stands. `trip.finish` is the trips.js flag; the distance is the server's `completeDist`. */
export function finishGantry(trip, completeDist, chunkIndex, chunkLen) {
  if (!trip?.finish || !(completeDist > 0) || !(chunkLen > 0)) return null;
  const chunk = Math.floor(completeDist / chunkLen);
  if (chunk !== chunkIndex) return null;
  return { s: completeDist, chunk, finish: true };
}
