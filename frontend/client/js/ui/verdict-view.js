import { online, rideNow } from '../online.js';
import { paintHonkInto } from './honk-hud.js';

/* Server verdict & review status component for the ride completion panel. */

const REVIEW_TEXT = { under_review: 'UNDER REVIEW', accepted: 'ACCEPTED', rejected: 'REJECTED' };
const REVIEW_CLASS = { under_review: 'warn', accepted: 'good', rejected: 'bad' };
const REVIEW_POLL_MS = 3000, REVIEW_POLL_MAX = 10;

export function verdictText(v) {
  const outcome = `${v.status.toUpperCase()}${v.status === 'completed' ? '' : ` – ${v.reason ?? ''}`}`;
  if (v.review) return `${outcome} · ${REVIEW_TEXT[v.review] ?? v.review.toUpperCase()}${v.review === 'under_review' ? ' – an admin checks this ride before prizes are paid' : ''}`;
  if (!v.verdict) return outcome;
  const why = v.verdict.reasons.map(r => r.detail).join('; ');
  return `${outcome} · ${v.verdict.status.toUpperCase()}${why ? ` – ${why}` : ''}`;
}

/** paint the answer into the end panel; true while a paid ride is still under review (worth asking again) */
export function showVerdict(v) {
  const el = document.getElementById('verdict');
  if (!el || !v) return false;
  el.textContent = verdictText(v);
  if (v.review) el.className = REVIEW_CLASS[v.review] ?? '';
  if ('honk' in v) { if (online.ride) online.ride.honk = v.honk; paintHonkInto('honk-end', 'honk-end-more', v.honk); }
  return v.review === 'under_review';
}

export function watchReview(left = REVIEW_POLL_MAX) {
  if (left <= 0) return;
  setTimeout(async () => {
    if (!document.getElementById('verdict')) return;
    const v = await rideNow();   // null = a network hiccup: keep the last answer and ask again
    if (!v || showVerdict(v)) watchReview(left - 1);
  }, REVIEW_POLL_MS);
}
