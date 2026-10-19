// Re-captures the landing's in-game media from a running server (default http://localhost:3111 – `BASE=…` to change):
//   public/media/cards/*.webp – the dash crops (rects from src/dash-scenes.js) = the posters / colour source under the live cards, 2× pixels
//   public/media/sky/*.webp   – the same Route 66 spot at dawn / day / dusk / night for the "realtime daytime" collage, 1080×372 (1×; the strip is at most 320 px tall)
//   public/media/{day,night,hero-poster}.webp – the hero cab (1280×633), with the CB and the ON CHAIN strip filled from mocked stream + pool data
// ONLY=hero skips the cards and the sky. Headless Chrome via the client's CDP harness; the game is driven through window.__game.
// Run `npm run build` afterwards – Vite copies public/ into dist/.
import { launch, sleep } from '../../client/tools/cdp.mjs';
import fs from 'node:fs'; import path from 'node:path';
import { SCENES } from '../src/dash-scenes.js';
const rect = k => { const [x, y, width, height] = SCENES[k].crop; return { x, y, width, height }; };
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'media'), BASE = process.env.BASE ?? 'http://localhost:3111';
const heroOnly = process.env.ONLY === 'hero';
const c = await launch({ port: +(process.env.PORT || 9355), shotsDir: 'fc-cap', evalProblems: true });
const { send, ev } = c;
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 633, deviceScaleFactor: heroOnly ? 1 : 2, mobile: false });
const clip = async (file, r, fmt = 'webp', quality = 82) => { const s = await send('Page.captureScreenshot', { format: fmt, quality, clip: { ...r, scale: 1 } }); fs.writeFileSync(`${OUT}/${file}`, Buffer.from(s.data, 'base64')); console.log(file, fs.statSync(`${OUT}/${file}`).size); };
const key = async (code, type) => { const map = { KeyI: 73, KeyB: 66, KeyL: 76, KeyC: 67, KeyR: 82, KeyT: 84, KeyH: 72, KeyO: 79, ShiftLeft: 16 }; await send('Input.dispatchKeyEvent', { type: type === 'up' ? 'keyUp' : 'keyDown', code, key: code.replace('Key', '').toLowerCase(), windowsVirtualKeyCode: map[code] }); };
const until = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(200); } return false; };
await send('Page.navigate', { url: `${BASE}/play.html?sim=1` }); await until('!!window.__game'); await sleep(1500);
if (!heroOnly) {
await ev(`__game.devRun(); __game.CFG.TRAFFIC=false; __game.selectTheme('route66', false); __game.setPhase('day', true, false); __game.dn.run=false; __game.startRide(); document.getElementById('overlay').classList.add('hide')`);
await sleep(800);
// 1 · key OFF (engine off, parking brake on – the start state) → key panel dark, PARK lit
await clip('cards/park.webp', rect('park'));
// 2 · start the engine: key ON + running
await key('KeyI'); if (!(await until('__game.st.engineOn', 20000))) throw new Error('engine did not start'); await sleep(1500);
await clip('cards/key-on.webp', rect('key'));
await key('KeyT'); await sleep(600);   // radio on
await clip('cards/trip-radio.webp', rect('trip'));
// 3 · driving in 3rd: hold the state so the gauges read something
await key('KeyB'); await ev(`{ const g=__game; window.__hold=setInterval(()=>{ g.st.gear=3; g.st.v=8; g.st.rpm=1900; g.st.engineOn=true; g.st.keyOn=true; g.st.hull=100; g.st.d=2.4; g.st.psi=0; g.st.park=false; },50) }`); await sleep(1500);
await clip('cards/gear.webp', rect('gear'));

// 4 · night + headlights + cab light → HEAD / CAB buttons lit
await ev(`__game.setPhase('night', true, false)`); await ev('__game.dn.head=true; __game.dn.cab=true'); await sleep(1500);
await ev('__game.st.heater=true; __game.st.heatEff=1; __game.st.cooler=true; __game.st.coolEff=1'); await sleep(400);
await clip('cards/lights.webp', rect('lights'));   // LED bars + HEAD / CAB / HEAT / COLD

// 5 · cold Siberia: COLD + STRAIN lamps lit
await ev(`{ clearInterval(window.__hold); __game.selectTheme('siberia', false); __game.setPhase('day', true, false); const g=__game; window.__hold=setInterval(()=>{ g.st.gear=2; g.st.v=6; g.st.rpm=2300; g.st.engineOn=true; g.st.keyOn=true; g.st.hull=100; g.st.d=2.4; g.st.psi=0; g.st.park=false; g.st.temp=-30; g.st.strain=.4; g.st.brakeT=.4; },50) }`); await sleep(2500);
await clip('cards/lamps.webp', rect('lamps'));
// 6 · the four times of day, same spot on Route 66, windscreen only
await ev(`{ clearInterval(window.__hold); __game.selectTheme('route66', false); const g=__game; let s0=g.net.Sm+140; while (g.net.near(s0-150, s0+260).length) s0+=40; g.st.s=s0; g.st.d=2.4; g.st.v=0; document.getElementById('toast').style.display='none'; window.__hold=setInterval(()=>{ g.st.v=0; g.st.d=2.4; g.st.psi=0; g.st.gear=0; g.st.engineOn=true; g.st.keyOn=true; g.st.rpm=620; },50) }`); 
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 633, deviceScaleFactor: 1, mobile: false }); await sleep(200);   // the cards above are 2×; the collage is not
for (const ph of ['dawn', 'day', 'dusk', 'night']) { await ev(`__game.setPhase('${ph}', true, false)`); if (ph === 'night') { await ev('__game.dn.head=true'); } await sleep(2500); await clip(`sky/${ph}.webp`, { x: 100, y: 16, width: 1080, height: 372 }); }
}
// Hero stills: the current cab, plus the driver's CB and the ticket ride's ON CHAIN strip. The numbers are a fixture
// (the program's recorded pool 1, so the seal really reads "on chain") with a made-up crowd, chat and standings.
await ev('clearInterval(window.__hold)');
if (!heroOnly) { await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 633, deviceScaleFactor: 1, mobile: false }); await sleep(500); }
await ev(`__game.devRun(); __game.CFG.TRAFFIC=false; __game.selectTheme('route66', false); __game.setPhase('day', true, false); __game.dn.run=false; __game.dn.head=false; __game.startRide(); document.getElementById('overlay').classList.add('hide')`);
await sleep(600);
await key('KeyI'); if (!(await until('__game.st.engineOn', 20000))) throw new Error('engine did not start');
await ev(`document.getElementById('toast').classList.remove('on'); document.getElementById('overlay').classList.add('hide')`);
const pool = JSON.parse(fs.readFileSync(new URL('../../../backend/server/test/fixtures/chain/pool-program.json', import.meta.url), 'utf8')).accounts.find(a => a.decoded?.seedSlotHash && a.decoded.poolId === 1);
const ME = 'Hq7mR4nK8pTs2wX3cVb6tYh1uJa5dE9x', A = '9kQm4sTp2nWx7cHb5tYe8uJa3fZ6nKpq', B = 'Wp4sTm2nX7cHb5tYe8uJa3fZ6nKpqR8v', C = 'Rn3kQ8sT2wE6yU1pL5zXc9vBn7mKj4aH';
const now = Date.now();
await ev(`(() => {
  const ride = { id: 'hero-ticket', tier: '1h', poolId: 1, seed: 1133767732, slot: 0, blockhash: 'CmpNeggWJ4JaWJeJ8YKN1Zypmk7uvQq3PECGUCAEMbky', seedCommitment: ${JSON.stringify(pool.decoded.seedCommitment)} };
  const R = { me: { wallet: ${JSON.stringify(ME)} }, 'pools/1': { id: 1, address: ${JSON.stringify(pool.address)}, buyers: 18, potLamports: 2e10 }, 'pools/1/standings': { prizeLamports: 1.42e10, ranks: [{ rank: 1, wallet: ${JSON.stringify(A)}, distance: 86400 }, { rank: 3, wallet: ${JSON.stringify(ME)}, distance: 41200 }] } };
  const pledges = [{ id: 'p1', status: 'active', sponsor: ${JSON.stringify(A)}, driver: ${JSON.stringify(ME)}, lamportsPerKm: '1000000', targetKm: 80, maxLamports: '80000000', createSignature: '${'5'.repeat(88)}' }, { id: 'p2', status: 'active', sponsor: ${JSON.stringify(B)}, driver: ${JSON.stringify(ME)}, lamportsPerKm: '500000', targetKm: 40, maxLamports: '20000000', createSignature: '${'6'.repeat(88)}' }];
  const inbox = { viewers: 14, totals: { messages: 38, donations: 6, lamports: 420000000 }, features: { chat: true, donations: true, payment: 'chain' }, muted: [], now: ${now}, events: [
    { id: 1, kind: 'message', wallet: ${JSON.stringify(A)}, text: 'clear road, nice pace', at: ${now - 20000} },
    { id: 2, kind: 'donation', effect: 'tip', wallet: ${JSON.stringify(B)}, lamports: 10000000, text: '', applied: true, at: ${now - 15000} },
    { id: 3, kind: 'message', wallet: ${JSON.stringify(C)}, text: 'truck on your right', at: ${now - 10000} } ] };
  window.__f0 = window.__f0 || window.fetch;
  window.fetch = (u, o) => { u = String(u);
    if (u.includes('solana.com')) return Promise.resolve(new Response(JSON.stringify({ result: { value: { owner: '8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p', data: [${JSON.stringify(pool.data)}, 'base64'] } } })));
    const m = u.match(/\\/api\\/(.*)$/); if (!m) return window.__f0(u, o);
    const k = m[1].split('?')[0], b = k.endsWith('/pledges') ? pledges : k.endsWith('/inbox') ? inbox : R[k];
    return Promise.resolve(new Response(JSON.stringify(b ?? {}), { status: 200, headers: { 'content-type': 'application/json' } })); };
  __game.online.ride = ride; __game.st.mode = 'drive';
  const css = document.createElement('style'); css.textContent = '#cb .cb-mute{display:none}'; document.head.append(css);   // the mute control wraps the tip line at this width; the still is the chat, not the button
  return Promise.all([import('./js/ui/cab-chain.js'), import('./js/ui/live-feed.js')]).then(([ch, lv]) => { ch.startCabChain(); lv.startLiveFeed(); });
})()`);
if (!(await until(`(document.getElementById('chain')?.innerText || '').includes('on chain') && (document.getElementById('cb')?.innerText || '').includes('watching')`, 12000))) throw new Error('overlays did not paint: ' + await ev(`JSON.stringify({chain:document.getElementById('chain')?.innerText||'',cb:document.getElementById('cb')?.innerText||''})`));
await ev(`document.getElementById('toast').classList.remove('on')`);
// A quiet stretch of the main road inside the 5 min shift, so the trip computer agrees with the speedo. Locked every frame: physics would roll it away.
await ev(`(() => { const g = __game; window.__place = (theme, phase, head, gear, v, rpm) => { g.selectTheme(theme, false); g.setPhase(phase, true, false); g.dn.head = !!head; g.dn.cab = false; g.dn.run = false; g.CFG.TRAFFIC = false;
  let best = g.net.Sm + 400, score = 1e9, s = g.net.Sm + 160;
  for (let i = 0; i < 140; i++, s += 28) { const pen = g.net.near(s - 160, s + 280).length * 10 + g.holes.holesNear(s - 20, s + 180).length * 6 + Math.abs(g.curv(s)) * 12000; if (pen < score) { score = pen; best = s; } }
  window.__s0 = best; clearInterval(window.__hold);
  const bail = document.getElementById('bail'); if (bail) bail.hidden = true;   // the walk-off buttons sit on the sky the hero crops; the still is the cab, the CB and the pool
  window.__hold = setInterval(() => { g.st.s = best; g.st.t = Math.min(270, best / Math.max(v, 1)); g.st.v = v; g.st.gear = gear; g.st.engineOn = true; g.st.keyOn = true; g.st.park = false; g.st.d = 2.4; g.st.psi = 0; g.st.hull = 100; g.st.temp = 82; g.st.strain = 0; g.st.stall = 0; if (bail) bail.hidden = true; }, 16);   // rpm is the gearbox's: v is chosen so this gear sits near 2000, under the redline
  return { s: Math.round(best), score: +score.toFixed(3) }; }; })()`);
const place = async (theme, phase, head, gear, v, rpm) => { const at = await ev(`window.__place('${theme}','${phase}',${head},${gear},${v},${rpm})`); console.log(theme, phase, at); await sleep(2400); await ev(`document.getElementById('toast').classList.remove('on')`); };
await place('route66', 'day', false, 6, 17.6, 0);
console.log('ON CHAIN', JSON.stringify(await ev(`document.getElementById('chain')?.innerText`)));
console.log('CB', JSON.stringify(await ev(`document.getElementById('cb')?.innerText`)));
await clip('day.webp', { x: 0, y: 0, width: 1280, height: 633 }, 'webp', 74);
await place('brenner', 'day', false, 5, 12.4, 0);
await clip('hero-poster.webp', { x: 0, y: 0, width: 1280, height: 633 }, 'webp', 74);
await place('route66', 'night', true, 6, 17.6, 0);
await clip('night.webp', { x: 0, y: 0, width: 1280, height: 633 }, 'webp', 74);
console.log('problems', c.filt()); c.finish(c.filt().length ? 1 : 0);
