/* Live streams: what a spectator's donation does – mirrors EFFECTS in server/src/domain/live/live-rules.ts (prices are MOCK: shown, never charged).
   hole = the HOLES type (world/holes.js) the driver's game puts on the road ahead. Shared by the driver's feed and the watch page; imports only the site's pure pools.js. */
export const EFFECT_INFO = {
  tip:      { label: 'TIP',      icon: '💰', sol: 0.01, says: 'tipped the driver' },
  night:    { label: 'NIGHT',    icon: '🌙', sol: 0.02, says: 'turned the day into night' },
  day:      { label: 'DAY',      icon: '☀', sol: 0.02, says: 'brought the sun back' },
  potholes: { label: 'POTHOLES', icon: '🕳\uFE0F', sol: 0.02, says: 'dug potholes ahead', hole: 'cluster' },
  trench:   { label: 'TRENCH',   icon: '🚧', sol: 0.03, says: 'cut a trench across the lane', hole: 'trench' },
  sinkhole: { label: 'SINKHOLE', icon: '⚠', sol: 0.05, says: 'opened a sinkhole ahead', hole: 'sinkhole' },
};
export { shortAddr as short } from '../site/pools.js';   // the site's one wallet shortener
export const solText = lamports => `${(lamports / 1e9).toFixed(lamports % 1e7 ? 3 : 2)} SOL`;
/* The feed cursor: ids are numbered by the database on insert, and a slow insert can commit after a faster later one – so only move the cursor past events
   that are a few seconds old (anything that could still appear below them has committed by then), and drop repeats by id. */
export function advanceCursor(cursor, events, serverNow, settleMs = 3000) {
  let c = cursor;
  for (const e of events) { if (e.at > serverNow - settleMs) break; if (e.id > c) c = e.id; }   // events come in id order
  return c;
}
