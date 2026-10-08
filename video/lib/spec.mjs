// Spec validation + defaults. A spec is plain JSON (see specs/intro.json and .claude/skills/gameplay-video/SKILL.md for the vocabulary).
export const ROUTES = ['route66', 'stuart', 'siberia', 'brenner', 'panamerican'];
export const TRANSITIONS = ['cut', 'flash', 'flash-red', 'glitch', 'whip', 'zoom', 'dip'];
export const LOOKS = ['classic', 'big'];   // big = no small text: no ticker / brand / badge / sub lines, one huge word per caption, a bare end card
export const EVENTS = ['gear', 'lights', 'cab', 'wipers', 'washer', 'heater', 'night', 'spawn', 'steer', 'phase'];
export function loadSpec(raw) {
  const s = { name: 'clip', look: 'classic', crop: null, ticker: 'RIDE ◆ COMPETE ◆ WIN PRIZES ◆ ON SOLANA ◆ ', fps: 24, width: 1280, height: 720, maxSeconds: 15, gif: { maxMB: 20, width: 640, fps: 15 }, ...raw };
  s.gif = { maxMB: 20, width: 640, fps: 15, ...raw.gif };
  const bad = [];
  if (!LOOKS.includes(s.look)) bad.push(`look "${s.look}" not in ${LOOKS}`);
  if (s.crop != null && s.crop !== 'square') bad.push(`crop "${s.crop}" must be "square" or absent`);
  if (!Array.isArray(s.scenes) || !s.scenes.length) bad.push('scenes[] is required');
  s.scenes = (s.scenes || []).map((sc, i) => {
    const o = { id: 'scene' + i, kind: 'drive', route: 'route66', time: 'day', speed: 18, preroll: 0, traffic: true, events: [], captions: [], ...sc };
    if (o.kind === 'drive' && !ROUTES.includes(o.route)) bad.push(`${o.id}: route "${o.route}" not in ${ROUTES}`);
    if (!(o.dur > 0)) bad.push(`${o.id}: dur must be > 0`);
    o.transition = { type: 'cut', dur: .3, ...(typeof sc.transition === 'string' ? { type: sc.transition } : sc.transition) };
    if (!TRANSITIONS.includes(o.transition.type)) bad.push(`${o.id}: transition "${o.transition.type}" not in ${TRANSITIONS}`);
    for (const c of o.captions) if (!(c.head && (s.look === 'big' || (c.sub && c.n))) || c.at + c.dur > o.dur + 1e-6) bad.push(`${o.id}: caption "${c.head}" needs head (+ n/sub unless look is big) and must end inside the scene (at+dur <= ${o.dur})`);
    if (o.card && !(o.card.title?.length && o.card.steps?.length && o.card.cta)) bad.push(`${o.id}: card needs title[], steps[], cta`);
    for (const e of o.events) if (e.t > o.dur) bad.push(`${o.id}: event "${e.do}" at ${e.t}s is after the scene ends`);
    for (const e of o.events) if (!EVENTS.includes(e.do)) bad.push(`${o.id}: event "${e.do}" not in ${EVENTS}`);
    return o;
  });
  s.total = s.scenes.reduce((a, c) => a + c.dur, 0);
  if (s.total > s.maxSeconds) bad.push(`total ${s.total.toFixed(2)} s exceeds maxSeconds ${s.maxSeconds}`);
  if (bad.length) throw new Error('Bad spec:\n  - ' + bad.join('\n  - '));
  return s;
}
