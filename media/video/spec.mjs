import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
// Spec validation + defaults. A spec is plain JSON (see specs/intro.json and .claude/skills/gameplay-video/SKILL.md for the vocabulary).
export const ROUTES = ['route66', 'stuart', 'siberia', 'brenner', 'panamerican'];
export const TRANSITIONS = ['cut', 'flash', 'flash-red', 'glitch', 'whip', 'zoom', 'dip', 'punch', 'spin'];   // punch / spin: the meme cuts (a hard zoom-in with an RGB split, a tilt-whip)
export const LOOKS = ['classic', 'big', 'meme'];   // big = no small text: no ticker / brand / badge / sub lines, one huge word per caption, a bare end card · meme = the TikTok layout (crop: vertical): the game in a square window, impact-font captions in the bands, an LCD clock, speed lines, beat pulses
export const SHOT_FX = ['pop', 'slide-l', 'slide-r', 'slide-u', 'slide-d', 'drop', 'flip', 'zoom'];   // how a collage tile lands (scene.shots)
export const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
export const MEME_FX = ['slam', 'type', 'words', 'shake', 'glitch', 'bubble', 'stamp'];   // how a meme caption lands (scene.captions[].fx)
export const EVENTS = ['gear', 'lights', 'cab', 'wipers', 'washer', 'heater', 'night', 'spawn', 'steer', 'phase'];
export function loadSpec(raw) {
  const vert = raw.crop === 'vertical';   // 1080×1920 CSS px; the game itself still renders at 1280×720 inside the window (capture.mjs, page.js)
  const s = { name: 'clip', look: vert ? 'meme' : 'classic', crop: null, ticker: 'RIDE ◆ COMPETE ◆ WIN PRIZES ◆ ON SOLANA ◆ ', fps: 24, width: vert ? 1080 : 1280, height: vert ? 1920 : 720, maxSeconds: 15, dsf: 1, gif: { maxMB: 20, width: vert ? 360 : 640, fps: 15 }, ...raw };
  s.gif = { maxMB: 20, width: vert ? 360 : 640, fps: 15, ...raw.gif };
  const bad = [];
  if (!LOOKS.includes(s.look)) bad.push(`look "${s.look}" not in ${LOOKS}`);
  if (s.crop != null && !['square', 'vertical'].includes(s.crop)) bad.push(`crop "${s.crop}" must be "square", "vertical" or absent`);
  if ((s.look === 'meme') !== vert) bad.push('look "meme" and crop "vertical" go together');
  if (!Array.isArray(s.scenes) || !s.scenes.length) bad.push('scenes[] is required');
  s.scenes = (s.scenes || []).map((sc, i) => {
    const o = { id: 'scene' + i, kind: 'drive', route: 'route66', time: 'day', speed: 18, preroll: 0, traffic: true, events: [], captions: [], ...sc };
    if (o.kind === 'drive' && !ROUTES.includes(o.route)) bad.push(`${o.id}: route "${o.route}" not in ${ROUTES}`);
    if (!(o.dur > 0)) bad.push(`${o.id}: dur must be > 0`);
    o.transition = { type: 'cut', dur: .3, ...(typeof sc.transition === 'string' ? { type: sc.transition } : sc.transition) };
    if (!TRANSITIONS.includes(o.transition.type)) bad.push(`${o.id}: transition "${o.transition.type}" not in ${TRANSITIONS}`);
    for (const c of o.captions) if (!(c.head && (s.look !== 'classic' || c.sub)) || c.at + c.dur > o.dur + 1e-6) bad.push(`${o.id}: caption "${c.head}" needs head (+ sub unless look is big) and must end inside the scene (at+dur <= ${o.dur})`);
    for (const c of o.captions) if (c.fx && !MEME_FX.includes(c.fx)) bad.push(`${o.id}: caption fx "${c.fx}" not in ${MEME_FX}`);
    if (o.clock && !(Number.isFinite(o.clock.from) && Number.isFinite(o.clock.to))) bad.push(`${o.id}: clock needs from and to (seconds)`);
    if (o.card && !o.card.cta) bad.push(`${o.id}: card needs cta`);
    for (const e of o.events) if (e.t > o.dur) bad.push(`${o.id}: event "${e.do}" at ${e.t}s is after the scene ends`);
    o.shots = (o.shots ?? []).map(sh => ({ at: 0, fx: 'pop', ...sh }));
    for (const sh of o.shots) {
      const nm = sh.src ?? sh.stat?.[1];
      if (!sh.src === !sh.stat || (sh.stat && !(Array.isArray(sh.stat) && sh.stat.length === 2))) bad.push(`${o.id}: a shot needs src (a file in media/assets) or stat [big, small], not both`);
      else if (sh.src && !fs.existsSync(path.join(ASSETS, sh.src))) bad.push(`${o.id}: shot ${sh.src} is not in media/assets`);
      if (![sh.x, sh.y, sh.w].every(Number.isFinite)) bad.push(`${o.id}: shot ${nm} needs x, y, w (1280×720 frame pixels)`);
      if (!SHOT_FX.includes(sh.fx)) bad.push(`${o.id}: shot ${nm} fx "${sh.fx}" not in ${SHOT_FX}`);
      if (sh.at + (sh.dur ?? 0) > o.dur + 1e-6) bad.push(`${o.id}: shot ${nm} must end inside the scene`);
    }
    if (o.bg != null && o.bg !== 'sol') bad.push(`${o.id}: bg "${o.bg}" must be "sol" or absent`);
    for (const e of o.events) if (!EVENTS.includes(e.do)) bad.push(`${o.id}: event "${e.do}" not in ${EVENTS}`);
    return o;
  });
  s.total = s.scenes.reduce((a, c) => a + c.dur, 0);
  if (s.total > s.maxSeconds) bad.push(`total ${s.total.toFixed(2)} s exceeds maxSeconds ${s.maxSeconds}`);
  if (bad.length) throw new Error('Bad spec:\n  - ' + bad.join('\n  - '));
  return s;
}
