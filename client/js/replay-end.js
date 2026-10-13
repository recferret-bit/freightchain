/* When a spectator's replay is over. stepWatch holds the last frame with buffering set (no next sample), and a
   batch's t1 sits a little past that sample, so a 1× frame (dt ≤ 0.05) never walks wt past replayEnd() — it is
   snapped back first. The result dialog used to wait for !buffering && wt >= end, which that hold never is.
   REPLAY_END_GAP is watch.js's GAP: a bigger hole is recording not loaded yet, not the end.
   A completed ride stops at the finish line + 3 s. wantFrom stops fetching a parked tail once a loaded batch
   starts more than ~90 s past the playhead, so the recording's last batch is often never downloaded — the
   cutoff is still the end once a sample at or past it is loaded. */
export const REPLAY_END_GAP = 2;

/** The playhead is on the last frame a finished replay will ever show. `playing` may still be true. */
export function replayHeld(s) {
  if (!s || s.live || s.status === 'running' || s.seeking || !s.rows) return false;
  const atCutoff = s.lastT >= s.end - 1e-6;                                                // a sample at or past where this replay ends is already loaded
  if (!atCutoff && !s.hasLast) return false;                                               // still short of the end, and the recording's last batch is not in yet
  if (!atCutoff && s.lastT < s.end - REPLAY_END_GAP) return false;                         // loaded samples stop short of the end: a batch is still out
  if (s.wt < Math.min(s.end, s.lastT) - 0.05) return false;                                // paused, or held in a gap earlier in the ride
  if (s.nextT != null && s.nextT <= s.end && s.nextT - s.sampleT <= REPLAY_END_GAP) return false; // a sample the playhead can still reach. finT+3 can fall an ulp under the hundredth it rounds to, and that sample is past the clamp — 1e-6 of slack called it still inside the ride and the dialog never opened
  return true;
}

/** Open the result dialog. Nothing to play is over too: no batch, or the last batch is in and it has no truck samples (an inputs-only flush). */
export function replayOver(s) {
  if (!s || s.live || !s.status || s.status === 'running' || s.seeking) return false;
  if (!s.rows) return s.lastSeq === null || !!s.hasLast;
  return replayHeld(s);
}
