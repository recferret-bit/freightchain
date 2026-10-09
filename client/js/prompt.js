/* Dispatch prompts (verified play): during an online ride the server asks, through the heartbeat response, for one small thing in the cab – "FLASH YOUR
   HEADLIGHTS" – and the recording must show that key pressed within the window (server/src/domain/rides/ride-challenge.ts). This is the one piece of
   state the cockpit draws (cockpit/index.js) and input.js marks as answered; online.js feeds it. A LEAF module: nothing offline ever sets it, so the
   offline game, the headless trace and the viewer never see a prompt. */

export const prompt = { cur: null, seen: new Set(), onShow: () => {}, onAnswer: () => {} };   // cur: { id, label, key, codes, until (performance.now() ms), answered (ms or 0) }

/** A heartbeat answered with the open prompt (or null): show a new one once; the same id again changes nothing. */
export function showPrompt(c) {
  if (!c || prompt.seen.has(c.id)) return;
  prompt.seen.add(c.id);
  const left = Math.max(3000, c.deadlineMs - c.issuedMs - 1500);   // the server's window minus the network trip; never under 3 s on screen
  prompt.cur = { id: c.id, label: c.label, key: c.key, codes: c.codes, until: performance.now() + left, answered: 0 };
  prompt.onShow(prompt.cur);
}

/** input.js: a key or dash button went down – did it answer the open prompt? */
export function answerPrompt(code) {
  const p = prompt.cur;
  if (!p || p.answered || !p.codes.includes(code)) return false;
  p.answered = performance.now();
  prompt.onAnswer(p);
  return true;
}

/** What the cockpit draws right now, or null: the open prompt with its seconds left, or the thanks for ~1.5 s after it was answered. */
export function promptView(now = performance.now()) {
  const p = prompt.cur;
  if (!p) return null;
  if (p.answered) { if (now - p.answered > 1500) { prompt.cur = null; return null; } return { ...p, left: 0, done: true }; }
  if (now > p.until) { prompt.cur = null; return null; }
  return { ...p, left: (p.until - now) / 1000, done: false };
}

export function resetPrompts() { prompt.cur = null; prompt.seen.clear(); }
