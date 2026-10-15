// A vertical 9 s clip (1080×1920, 30 fps) of the REAL pitch deck, slide 3: four donations rain SOL coins, a coin is grabbed and thrown, the WEB3 ADOPTION goal sucks the pile in.
// Not a gameplay-video spec: the harness there boots play.html. This one serves a landing build (landing/dist or DECK=<dir>), drives pitchdeck.html through real CDP mouse events
// on a virtual clock (rAF, timers, WAAPI / CSS animations all follow one video frame = one step), films it with a keyframed camera (Page.captureScreenshot clip + scale)
// and puts the captions / finger / end card in a screen-space overlay. Sound: make.mjs specs/pitchdeck-donate.json --add-audio <mp4> (the cue times below are the spec's).
//   node media/video/pitchdeck.mjs [out dir]   (needs `npm --prefix landing run build`, or DECK=<a vite --outDir>; GPU=0 for software GL)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { launch, sleep } from '../../client/tools/cdp.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const DECK = process.env.DECK || path.resolve(here, '../../landing/dist'), OUT = path.resolve(process.argv[2] || path.join(here, '../out/video/pitchdeck-donate'));
const FPS = 30, W = 1080, H = 1920, TOTAL = 9, N = FPS * TOTAL, Y0 = 656, K = 1080 / 1920;   // Y0: the 16:9 stage (1080×607 on this width) sits mid-frame; K: stage px → page px
const CLICKS = [0.45, 0.85, 1.25, 1.65], GRAB = 3.1, THROW = 4.3, ADOPT = 5.6, CARD = 8.25;   // seconds: the audio cues in specs/pitchdeck-donate.json follow these
const SLOW = [4.3, 5.0, 0.5], FAST = [5.7, 8.25, 3.0];   // [from, to, game seconds per video second]

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
const serve = () => new Promise(r => { const s = http.createServer((q, res) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/') p = '/index.html'; const f = path.join(DECK, p);
  if (!f.startsWith(DECK) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404).end(); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }); s.listen(0, '127.0.0.1', () => r(s)); });

/* injected before the deck: virtual time for rAF, setTimeout / setInterval, performance.now, Date.now and Math.random (mulberry32); the slide's <video> is seeked per frame (RIG.seek) */
const CLOCK = `(() => { let t = 1000, id = 0, seed = 7, raf = [], tm = [];
  performance.now = () => t; Date.now = () => 1.7e12 + t;
  window.requestAnimationFrame = cb => { raf.push([++id, cb]); return id; }; window.cancelAnimationFrame = i => { raf = raf.filter(e => e[0] !== i); };
  window.__realTimeout = window.setTimeout.bind(window);
  window.setTimeout = (cb, ms = 0, ...a) => { tm.push({ id: ++id, at: t + ms, cb: () => cb(...a) }); return id; };
  window.setInterval = (cb, ms = 0, ...a) => { tm.push({ id: ++id, at: t + ms, every: Math.max(1, ms), cb: () => cb(...a) }); return id; };
  window.clearTimeout = window.clearInterval = i => { tm = tm.filter(e => e.id !== i); };
  Math.random = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  Object.defineProperty(window, 'devicePixelRatio', { get: () => 3 });   // the coin canvas is as sharp as it gets (coinK 2 at most)
  window.__vstep = ms => {   // advance the clock, fire due timers, then the frame callbacks, then put every CSS / WAAPI animation at its virtual age
    t += ms; for (let i = 0; i < 50; i++) { const due = tm.filter(e => e.at <= t).sort((a, b) => a.at - b.at)[0]; if (!due) break; if (due.every) due.at += due.every; else tm = tm.filter(e => e !== due); due.cb(); }
    const run = raf; raf = []; for (const [, cb] of run) cb(t);
    for (const a of document.getAnimations()) { if (a.__v0 === undefined) { a.__v0 = t - (a.currentTime || 0); a.pause(); } a.currentTime = t - a.__v0; }
  };
})();`;

/* the page's own half: clean frame, the overlay (screen space: it is counter-scaled by the camera), a coin finder */
const RIG = `(() => {
  const css = document.createElement('style'); css.textContent = \`
    #help,.nav,#fs,#fs-hint,#turn{display:none!important}
    html,body{user-select:none;-webkit-user-select:none;background:radial-gradient(900px 700px at 15% 12%,#9945ff40,#0000 70%),radial-gradient(900px 800px at 90% 95%,#14f19538,#0000 70%),#06040c!important}
    #stage{top:${Y0}px!important;box-shadow:0 0 0 3px #14f195aa,0 0 90px #9945ff99,0 0 220px #14f19540}
    #ov{position:fixed;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;z-index:99;pointer-events:none;overflow:hidden;font-family:Anton,Impact,sans-serif}
    #ov .cap{position:absolute;left:0;right:0;text-align:center;transform-origin:50% 50%}
    #ov .cap b{display:block;white-space:nowrap;width:max-content;margin:0 auto;font:400 150px/.95 Anton,Impact,sans-serif;letter-spacing:2px;color:#fff;text-shadow:0 6px 0 #000,0 0 40px #000c;text-transform:uppercase}
    #ov .cap b i{font-style:normal;background:linear-gradient(90deg,#9945ff,#14f195);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none;filter:drop-shadow(0 5px 0 #000)}
    #ov .cap span{display:inline-block;margin-top:18px;padding:10px 22px;border-radius:12px;background:#000c;border:2px solid #ffcf5a;color:#ffcf5a;font:700 34px/1 'JetBrains Mono',monospace;letter-spacing:4px;text-transform:uppercase}
    #ov .fin{position:absolute;width:72px;height:72px;margin:-36px 0 0 -36px;border-radius:50%;background:#ffffff55;border:5px solid #fff;box-shadow:0 0 30px #14f195,0 0 0 2px #0008}
    #ov .rip{position:absolute;width:72px;height:72px;margin:-36px 0 0 -36px;border-radius:50%;border:6px solid #14f195}
    #ov .brand{position:absolute;left:0;right:0;top:1790px;text-align:center;font:700 30px/1 'JetBrains Mono',monospace;letter-spacing:7px;color:#ffffffaa;text-transform:uppercase}
    #ov .brand i{font-style:normal;color:#14f195}
    #ov .flash{position:absolute;inset:0;background:#fff}
    #ov .vig{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 50%,#0000 55%,#000a 100%)}
    #ov .card{position:absolute;inset:0;display:grid;place-content:center;gap:26px;text-align:center;background:radial-gradient(900px 900px at 50% 40%,#9945ff55,#06040cf2 70%)}
    #ov .card h1{margin:0;font:400 230px/.9 Anton,Impact,sans-serif;color:#fff;text-transform:uppercase;text-shadow:0 8px 0 #000}
    #ov .card h1 i{font-style:normal;display:block;background:linear-gradient(90deg,#9945ff,#14f195);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none}
    #ov .card p{margin:0;font:700 42px/1.3 'JetBrains Mono',monospace;color:#ffcf5a;letter-spacing:5px;text-transform:uppercase}
    #ov .card p.s{color:#fff;font-size:34px;letter-spacing:4px;opacity:.85}\`; document.head.append(css);
  const ov = document.createElement('div'); ov.id = 'ov'; ov.innerHTML = '<div class="vig"></div><div class="cap"></div><div class="brand"><i>●</i> FREIGHT CHAIN · PITCH DECK · 03/08</div><div class="rip"></div><div class="fin"></div><div class="flash"></div><div class="card"></div>'; document.body.append(ov);
  const $ = s => ov.querySelector(s), cap = $('.cap'), fin = $('.fin'), rip = $('.rip'), flash = $('.flash'), card = $('.card'); let capKey = '';
  const ease = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3), back = x => { x = Math.min(1, Math.max(0, x)); const c = 2.2; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  card.innerHTML = '<h1>FREIGHT<i>CHAIN</i></h1><p>Desert Bus · on Solana</p><p class="s">freightchain.fun · devnet</p>';
  window.__rig = {
    set: o => {
      ov.style.transform = \`translate(\${o.cx}px,\${o.cy}px) scale(\${1 / o.z})\`;
      if (o.cap) { const k = o.cap.head + o.cap.sub; if (k !== capKey) { capKey = k; cap.innerHTML = \`<b>\${o.cap.head}</b><span>\${o.cap.sub}</span>\`; const h = cap.firstChild; h.style.fontSize = '150px'; for (let n = 0; n < 12 && h.scrollWidth > 1000; n++) h.style.fontSize = parseFloat(h.style.fontSize) * .9 + 'px'; } cap.style.top = o.cap.y + 'px'; cap.style.opacity = o.cap.age < 0 ? 0 : 1; cap.style.transform = \`scale(\${.55 + .45 * back(o.cap.age / .28)}) rotate(\${(1 - ease(o.cap.age / .28)) * -4}deg)\`; } else cap.style.opacity = 0;
      if (o.fin) { fin.style.display = 'block'; fin.style.left = o.fin.x + 'px'; fin.style.top = o.fin.y + 'px'; fin.style.transform = \`scale(\${o.fin.down ? .78 : 1})\`; } else fin.style.display = 'none';
      if (o.rip) { rip.style.display = 'block'; rip.style.left = o.rip.x + 'px'; rip.style.top = o.rip.y + 'px'; rip.style.opacity = 1 - o.rip.a; rip.style.transform = \`scale(\${.6 + 2.4 * o.rip.a})\`; } else rip.style.display = 'none';
      ov.querySelector('.brand').style.opacity = 1 - (o.card || 0); flash.style.opacity = o.flash || 0; card.style.opacity = o.card || 0;
    },
    coin: () => {   // the topmost coin of the pile ON THE FLOOR (not the ones resting on a card), in page px: scan the coin canvas (the physics' own array is private to the deck's module)
      const c = document.getElementById('coins'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data, r = c.getBoundingClientRect(), s = r.width / c.width;
      let y0 = -1; for (let y = Math.floor(c.height * .8); y < c.height && y0 < 0; y += 2) for (let x = 0; x < c.width; x += 2) if (d[(y * c.width + x) * 4 + 3] > 200) { y0 = y; break; }
      if (y0 < 0) return null;
      let sx = 0, n = 0; for (let y = y0; y < y0 + 6; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 200) { sx += x; n++; }
      return [r.left + sx / n * s, r.top + (y0 + 10) * s + 4];
    },
    seek: sec => Promise.all([...document.querySelectorAll('#s-insight video')].map(v => new Promise(res => {   // the slide's promo clip, pinned to the video time (it would run on the wall clock)
      if (!v.duration) { res(); return; }
      v.pause(); window.__realTimeout(res, 400); v.addEventListener('seeked', () => res(), { once: true }); v.currentTime = sec % v.duration;
    }))),
    rect: sel => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; },
  };
})();`;

const sm = x => x * x * (3 - 2 * x), lerp = (a, b, x) => a + (b - a) * x;
/** keyframed camera: [t, centre x, centre y, zoom] in page px; each hop eases (smoothstep) from the previous key. The clip stays inside the page. */
function camAt(keys, t) {
  let i = 0; while (i < keys.length - 1 && keys[i + 1][0] <= t) i++;
  const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)], x = b[0] > a[0] ? sm(Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])))) : 1;
  return { x: lerp(a[1], b[1], x), y: lerp(a[2], b[2], x), z: lerp(a[3], b[3], x) };
}
const bump = (t, at, len = .22) => (t >= at && t < at + len ? Math.sin(Math.PI * (t - at) / len) : 0);   // 0 → 1 → 0 pulse (a click's punch)

fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
const srv = await serve(), port = srv.address().port;
const GPU = process.env.GPU !== '0' && process.platform === 'darwin' ? ['--use-angle=metal'] : [];
const { send, ev, finish, filt } = await launch({ port: +process.env.PORT || 9601, shotsDir: 'fc-pitchdeck', args: ['--mute-audio', ...GPU, `--window-size=${W},${H}`], evalProblems: true });
try {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/pitchdeck.html#3` });
  for (let i = 0; i < 100 && await ev('document.querySelectorAll("#deck .slide").length') < 3; i++) await sleep(100);
  await sleep(2500);   // images / fonts are real-time loads
  await ev(RIG);
  for (let i = 0; i < 30; i++) await ev('__vstep(33.3)');
  const don = await ev('__rig.rect(".pts li.don")'), adopt = await ev('__rig.rect(".pts li.adopt")');
  if (!don || !adopt) throw new Error('slide 3 bullets not found');
  const mid = (r, f) => [r[0] + r[2] * f, r[1] + r[3] / 2], D = mid(don, .78), A = mid(adopt, .7);   // where a finger lands on the bullets (page px)
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const KEYS = [[0, 270, 985, 2.0], [.45, 270, 985, 2.1], [1.05, 420, 960, 1.55], [1.7, 540, 960, 1.3], [2.5, 540, 1010, 1.45], [GRAB - .1, 540, 1060, 1.9]];   // the grab's keys are added once the coin is known
  const caps = [[0, 1.25, 'TAP <i>DONATE</i>', 'slide 03 · the game is the door'], [1.25, 2.9, 'SOL <i>RAINS</i> DOWN', 'every tap drops real coins'], [2.9, 5.05, 'GRAB IT. <i>THROW</i> IT.', 'real physics · in the browser'], [5.05, CARD, 'HIT THE <i>GOAL</i>', 'web3 adoption sucks it in']];
  const flashes = [GRAB - .25, ADOPT - .5, CARD - .1];   // the camera cuts get a white blink
  let g = null, path2 = [], held = false, clicked = new Set(), clickAt = new Map(), game = 0, guess = [540, 1215];
  for (let f = 0; f < N; f++) {
    const T = f / FPS;
    // ---- input (page px) ----
    for (const c of CLICKS) if (T >= c && !clicked.has(c)) { clicked.add(c); clickAt.set(c, T); await mouse('mousePressed', D[0], D[1]); await mouse('mouseReleased', D[0], D[1]); }
    if (T >= ADOPT && !clicked.has('a')) { clicked.add('a'); clickAt.set('a', T); await mouse('mousePressed', A[0], A[1]); await mouse('mouseReleased', A[0], A[1]); }
    let fin = null;
    if (!g && T >= GRAB - .6 && T < GRAB) guess = await ev('__rig.coin()') ?? guess;   // the pile is settling: aim at the topmost coin of the moment
    if (!g && T >= GRAB) {   // the pile is at rest: lock on, plan the swing + the camera
      g = guess; const [gx, gy] = g, dir = gx > 540 ? -1 : 1;
      path2 = [[GRAB, gx, gy], [GRAB + .35, gx + dir * 20, gy - 190], [GRAB + .75, gx + dir * 190, gy - 70], [GRAB + 1.05, gx + dir * 120, gy - 200], [THROW, gx - dir * 300, gy - 420]];
      KEYS.push([GRAB, gx, Math.min(1060, gy - 100), 1.95], [GRAB + 1.1, gx + dir * 60, Math.min(1040, gy - 120), 1.7], [THROW + .4, 540, 1020, 1.4], [ADOPT - .75, 330, 1010, 1.5], [ADOPT - .3, 250, 1030, 2.2], [ADOPT + .35, 250, 1030, 2.2],
        [ADOPT + 1.1, 540, 1030, 1.25], [CARD - .4, 540, 1000, 1.2], [CARD, 540, 960, 1.0], [TOTAL, 540, 960, 1.0]);
    }
    if (g && T <= THROW + .12 && T >= GRAB) {   // the grab: press on the coin, follow the path, release at its end (a flick: the last hop is linear)
      let i = 0; while (i < path2.length - 1 && path2[i + 1][0] <= T) i++;
      const a = path2[i], b = path2[Math.min(i + 1, path2.length - 1)], x = b[0] > a[0] ? Math.min(1, (T - a[0]) / (b[0] - a[0])) : 1, e = i === path2.length - 2 ? x : sm(x);
      const px = lerp(a[1], b[1], e), py = lerp(a[2], b[2], e); fin = { x: px, y: py, down: true };
      if (!held && T < THROW) { held = true; await mouse('mousePressed', g[0], g[1]); }
      else if (held && T < THROW) await mouse('mouseMoved', px, py, { button: 'left', buttons: 1 });
      else if (held) { held = false; await mouse('mouseMoved', px, py, { button: 'left', buttons: 1 }); await mouse('mouseReleased', px, py); fin.down = false; }
    }
    // ---- one video frame of game time (slow motion on the throw, fast forward while the pile is sucked in) ----
    const rate = T >= SLOW[0] && T < SLOW[1] ? SLOW[2] : T >= FAST[0] && T < FAST[1] ? FAST[2] : 1;
    await ev(`__vstep(${(1000 / FPS * rate).toFixed(3)})`); game += rate / FPS;
    await ev(`__rig.seek(${game.toFixed(3)})`);
    // ---- camera + overlay ----
    const tap = [...clickAt.entries()].find(([, t]) => T - t < .35), tapping = tap && T - tap[1] < .12;
    if (!fin && T < GRAB) { const ph = sm(Math.min(1, Math.max(0, (T - (CLICKS.at(-1) + .35)) / (GRAB - CLICKS.at(-1) - .35)))); fin = { x: lerp(D[0], guess[0], ph), y: lerp(D[1], guess[1] - 24 * ph, ph), down: tapping }; }
    if (!fin && T >= THROW) { const ph = sm(Math.min(1, Math.max(0, (T - THROW - .12) / (ADOPT - THROW - .12 - .15)))); fin = { x: lerp(path2.at(-1)[1], A[0], ph), y: lerp(path2.at(-1)[2], A[1], ph), down: tapping }; }
    if (fin && T >= CARD) fin = null;
    const cs = camAt(KEYS, T), pulse = CLICKS.reduce((s, c) => s + bump(T, c, .2), 0) + bump(T, ADOPT, .3), sh = Math.max(...CLICKS.concat(ADOPT).map(c => (T >= c && T < c + .3 ? 1 - (T - c) / .3 : 0)));
    const z = cs.z * (1 + .05 * pulse), jx = Math.sin(f * 2.7) * 7 * sh / z, jy = Math.cos(f * 3.9) * 7 * sh / z;
    const cx = Math.min(W - W / 2 / z, Math.max(W / 2 / z, cs.x + jx)), cy = Math.min(H - H / 2 / z, Math.max(H / 2 / z, cs.y + jy));
    const screen = (x, y) => ({ x: (x - (cx - W / 2 / z)) * z, y: (y - (cy - H / 2 / z)) * z });
    const cp = caps.find(c => T >= c[0] && T < c[1]), fl = Math.max(...flashes.map(t => Math.max(0, 1 - Math.abs(T - t) / .09))) * .8;
    const o = { cx: cx - W / 2 / z, cy: cy - H / 2 / z, z, cap: cp ? { head: cp[2], sub: cp[3], y: 110, age: T - cp[0] } : null, flash: fl, card: T >= CARD ? Math.min(1, (T - CARD) / .22) : 0 };
    if (fin) o.fin = { ...screen(fin.x, fin.y), down: fin.down };
    if (tap && fin) o.rip = { ...screen(fin.x, fin.y), a: (T - tap[1]) / .35 };
    await ev(`__rig.set(${JSON.stringify(o)})`);
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true, clip: { x: cx - W / 2 / z, y: cy - H / 2 / z, width: W / z, height: H / z, scale: z } });
    fs.writeFileSync(path.join(OUT, 'frames', String(f + 1).padStart(5, '0') + '.jpg'), Buffer.from(shot.data, 'base64'));
    if (f % FPS === 0) console.log(`t=${T.toFixed(1)}s cam=(${cx | 0},${cy | 0}) z=${z.toFixed(2)} game=${game.toFixed(2)}s`);
  }
  const mp4 = path.join(OUT, 'pitchdeck-donate.silent.mp4'), r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(OUT, 'frames', '%05d.jpg'), '-c:v', 'libx264', '-crf', '17', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
  if (r.status) throw new Error(r.stderr); console.log('wrote', mp4);
  const probs = filt().filter(p => !/telemetry|icons\//.test(p)); if (probs.length) console.log('page problems:\n  ' + probs.slice(0, 6).join('\n  '));
} finally { srv.close(); setTimeout(() => finish(0), 50); }
