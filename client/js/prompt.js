/* Ride-challenge handler (verified play). online.js feeds it whatever the heartbeat's `challenge` field is (label, key, codes, window).
   It does not know the kinds – those live in server/src/domain/rides/ride-challenge.ts (CHALLENGE_KINDS). The cockpit draws promptView()
   (cockpit/index.js); input.js calls answerPrompt(code) on a press. A LEAF: nothing offline ever sets it, so the offline game, the
   headless trace and the viewer never see a prompt. Replays and live watch do not call showPrompt. */

export const prompt = { cur: null, seen: new Set(), onShow: () => {}, onAnswer: () => {} };   // cur: { id, label, key, codes, until (performance.now() ms), answered (ms or 0) }

/** A heartbeat answered with the open challenge (or null): show a new one once; the same id again changes nothing. */
export function showPrompt(c) {
  if (!c || prompt.seen.has(c.id)) return;
  prompt.seen.add(c.id);
  const left = Math.max(3000, c.deadlineMs - c.issuedMs - 1500);   // the server's window minus the network trip; never under 3 s on screen
  prompt.cur = { id: c.id, label: c.label, key: c.key, codes: c.codes, until: performance.now() + left, answered: 0 };
  prompt.onShow(prompt.cur);
}

/** input.js: a key or dash button went down – did it answer the open challenge? */
export function answerPrompt(code) {
  const p = prompt.cur;
  if (!p || p.answered || !p.codes.includes(code)) return false;
  p.answered = performance.now();
  prompt.onAnswer(p);
  return true;
}

/** What the cockpit draws right now, or null: the open challenge with its seconds left, or the thanks for ~1.5 s after it was answered. */
export function promptView(now = performance.now()) {
  const p = prompt.cur;
  if (!p) return null;
  if (p.answered) { if (now - p.answered > 1500) { prompt.cur = null; return null; } return { ...p, left: 0, done: true }; }
  if (now > p.until) { prompt.cur = null; return null; }
  return { ...p, left: (p.until - now) / 1000, done: false };
}

export function resetPrompts() { prompt.cur = null; prompt.seen.clear(); }
