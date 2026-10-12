import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replayHeld, replayOver, REPLAY_END_GAP } from '../js/replay-end.js';

const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/* The old dialog gate. A 1× replay never meets it: the last frame is buffering, and wt is snapped back short of t1. */
const oldAtEnd = (playing, buffering, wt, end) => !playing && !buffering && wt >= end - 0.5;

const base = (over = {}) => ({
  live: false, status: 'failed', seeking: false, rows: true, hasLast: true, playing: true,
  wt: 100, end: 100.08, lastT: 100, lastSeq: 4, sampleT: 100, nextT: null, ...over,
});

test('the last frame of a failed, abandoned, or completed ride is over — including the 1× hold short of t1', () => {
  for (const status of ['failed', 'abandoned', 'completed']) {
    const s = base({ status });
    assert.equal(replayHeld(s), true, status);
    assert.equal(replayOver(s), true, status);
    assert.equal(oldAtEnd(true, true, s.wt, s.end), false);   // playing still true, buffering, wt short of end: the bug
  }
});

test('a 1× frame loop stops on the last sample and stays there (t1 a hair past the sample, dt capped at 0.05)', () => {
  const samples = [];
  for (let t = 99; t <= 100.0001; t += 0.1) samples.push(Math.round(t * 10) / 10);
  const end = 100.08;   // batch t1, sealed just after the last 10 Hz sample
  let wt = 99.5, playing = true, over = false, buffering = false;
  for (let n = 0; n < 40; n++) {
    if (playing) { wt += 0.05; if (wt > end) { wt = end; playing = false; } }
    let i = 0; while (i + 1 < samples.length && samples[i + 1] <= wt + 1e-9) i++;
    const sampleT = samples[i], nextT = i + 1 < samples.length ? samples[i + 1] : null;
    buffering = nextT == null || nextT - sampleT > REPLAY_END_GAP;
    if (buffering) wt = sampleT;
    const s = base({ status: 'abandoned', wt, end, lastT: samples.at(-1), sampleT, nextT, playing });
    if (replayOver(s)) playing = false;
    over = replayOver(s);
  }
  assert.equal(over, true);
  assert.equal(playing, false);
  assert.equal(buffering, true);
  assert.ok(wt <= 100.001, String(wt));
  assert.equal(oldAtEnd(playing, buffering, wt, end), false);
});

test('a completed ride cut at the finish line + 3 s opens on that cutoff, not on the parked tail', () => {
  const samples = [];
  for (let t = 50; t <= 80.001; t += 0.1) samples.push(Math.round(t * 10) / 10);
  const end = 53;
  let wt = 52.7, playing = true, over = false;
  for (let n = 0; n < 30 && !over; n++) {
    if (playing) { wt += 0.05; if (wt > end) { wt = end; playing = false; } }
    let i = 0; while (i + 1 < samples.length && samples[i + 1] <= wt + 1e-9) i++;
    const sampleT = samples[i], nextT = samples[i + 1] ?? null;
    const buffering = nextT == null || nextT - sampleT > REPLAY_END_GAP;
    if (buffering) wt = sampleT;
    const s = base({ status: 'completed', wt, end, lastT: samples.at(-1), sampleT, nextT, playing });
    over = replayOver(s);
    if (over) playing = false;
  }
  assert.equal(over, true);
  assert.ok(wt <= end + 1e-6, String(wt));
  assert.ok(wt > end - 0.2, String(wt));
});

test('a completed ride whose recording stops at the line (no 3 s tail) is still over', () => {
  const s = base({ status: 'completed', wt: 100, end: 100.05, lastT: 100, sampleT: 100, nextT: null });
  assert.equal(replayOver(s), true);
});

test('a completed cutoff opens while the parked tail past it was never downloaded', () => {
  const samples = [];
  for (let t = 0; t <= 40.001; t += 0.1) samples.push(Math.round(t * 10) / 10);
  const end = 5;   // finT + 3 s; the recording keeps going, and wantFrom never fetches its last batch
  let wt = 4.6, playing = true, over = false, buffering = true;
  for (let n = 0; n < 40 && !over; n++) {
    if (playing) { wt += 0.05; if (wt > end) { wt = end; playing = false; } }
    let i = 0; while (i + 1 < samples.length && samples[i + 1] <= wt + 1e-9) i++;
    const sampleT = samples[i], nextT = samples[i + 1] ?? null;
    buffering = nextT == null || nextT - sampleT > REPLAY_END_GAP;
    if (buffering) wt = sampleT;
    const s = base({ status: 'completed', hasLast: false, lastSeq: 80, wt, end, lastT: samples.at(-1), sampleT, nextT, playing });
    over = replayOver(s);
    if (over) playing = false;
  }
  assert.equal(over, true);
  assert.equal(playing, false);
  assert.equal(buffering, false);   // the next sample is the parked tail, already loaded, past the cutoff
  assert.ok(wt <= end + 1e-6 && wt > end - 0.2, String(wt));
});

test('not over: paused mid-ride, a gap, still loading, the cutoff batch still out, live, seeking, still running', () => {
  assert.equal(replayOver(base({ wt: 10, sampleT: 10, nextT: 10.1, playing: false })), false);          // paused
  assert.equal(replayOver(base({ wt: 20, sampleT: 20, nextT: 40, lastT: 100, end: 100 })), false);       // hole in the middle (next is > GAP ahead, wt is not the end)
  assert.equal(replayOver(base({ hasLast: false })), false);                                            // last sample is the seal gap short of t1, last batch not in
  assert.equal(replayOver(base({ status: 'failed', hasLast: false, wt: 99.2, end: 100.08, lastT: 99.2, sampleT: 99.2, nextT: null })), false);
  assert.equal(replayOver(base({ status: 'completed', hasLast: false, lastSeq: 80, wt: 4.5, end: 5, lastT: 4.5, sampleT: 4.5, nextT: null, playing: false })), false); // cutoff batch not loaded yet
  assert.equal(replayOver(base({ status: 'completed', hasLast: false, lastSeq: 80, wt: 40, end: 53, lastT: 140, sampleT: 40, nextT: 40.1, playing: true })), false); // tail is loaded, playhead is not there
  assert.equal(replayOver(base({ live: true })), false);
  assert.equal(replayOver(base({ seeking: true })), false);
  assert.equal(replayOver(base({ status: 'running', live: false })), false);                            // stale, not ended yet
  assert.equal(replayOver(base({ rows: false, hasLast: false, lastSeq: 2, wt: 0, sampleT: 0, nextT: null })), false);   // recording exists, nothing loaded yet
  assert.equal(replayHeld(base({ wt: 10, sampleT: 10, nextT: 10.1 })), false);
});

test('a finished ride with no recording kept is over; seeking back from the end is not', () => {
  assert.equal(replayOver({ live: false, status: 'failed', seeking: false, rows: false, lastSeq: null }), true);
  assert.equal(replayOver({ live: false, status: 'abandoned', seeking: false, rows: false, lastSeq: null }), true);
  assert.equal(replayOver({ live: false, status: 'completed', seeking: false, rows: false, lastSeq: null }), true);
  assert.equal(replayOver(base({ wt: 1, sampleT: 1, nextT: 1.1, playing: false })), false);              // seeked away
  assert.equal(replayOver({ live: false, status: 'running', seeking: false, rows: false, lastSeq: null }), false);
});

test('finT + 3 can fall an ulp under the next hundredth; that sample is past the clamp, so the ride is over', () => {
  const finT = 5.22, end = finT + 3;   // 8.219999999999999 — the sample at 8.22 is the hundredth of the cutoff and is not reachable
  assert.ok(8.22 > end && 8.22 <= end + 1e-6);
  const s = base({ status: 'completed', hasLast: false, lastSeq: 40, wt: end, end, lastT: 80.02, sampleT: 8.12, nextT: 8.22, playing: false });
  assert.equal(replayOver(s), true);
  assert.equal(replayOver(base({ status: 'completed', wt: 8.12, end: 8.22, lastT: 80, sampleT: 8.12, nextT: 8.22, playing: true })), false); // 8.22 is still inside this cutoff
});

test('a finished ride whose last batch has no truck samples is over once that batch is in', () => {
  for (const status of ['failed', 'abandoned', 'completed']) {
    assert.equal(replayOver({ live: false, status, seeking: false, rows: false, lastSeq: 0, hasLast: true }), true, status);
  }
  assert.equal(replayOver({ live: false, status: 'abandoned', seeking: false, rows: false, lastSeq: 0, hasLast: false }), false);
  assert.equal(replayOver({ live: false, status: 'abandoned', seeking: true, rows: false, lastSeq: 0, hasLast: true }), false);
});

test('stepWatch settles the end after the last-frame snap, and the dialog no longer requires !buffering', () => {
  const watch = src('js/watch.js');
  const snap = watch.indexOf('if (watch.buffering) watch.wt = a[0]');
  const settle = watch.indexOf('settleEnd(a[0], b ? b[0] : null)');
  assert.ok(snap > 0 && settle > snap, 'settleEnd must run after the snap back onto the last sample');
  const step = watch.slice(watch.indexOf('export function stepWatch'));
  const clearSeek = step.indexOf('watch.batches.has(watch.rec.lastSeq))) watch.seeking = false');
  const settleEmpty = step.indexOf('settleEnd(0, null)');
  assert.ok(clearSeek > 0 && settleEmpty > clearSeek, 'an empty recording must drop seeking before it settles, or a seek hides the dialog for good');
  assert.match(watch, /REPLAY_END_GAP/);
  const panel = src('js/ui/watch-panel.js');
  assert.match(panel, /watch\.atEnd/);
  assert.match(panel, /SHIFT COMPLETE/);
  assert.match(panel, /SHIFT ABANDONED/);
  assert.match(panel, /RIDE FAILED/);
  assert.equal(panel.includes('!watch.buffering'), false);
});
