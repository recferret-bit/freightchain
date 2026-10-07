// Re-captures the landing's in-game media from a running server (default http://localhost:3111 – `BASE=…` to change):
//   public/media/cards/*.png  – dash crops for the 3D cards (key, gear, lamps lit, lights, park, trip/radio), 2× pixels
//   public/media/sky/*.jpg    – the same Route 66 spot at dawn / day / dusk / night for the "realtime daytime" collage
// Headless Chrome via the client's CDP harness; the game is driven through window.__game. Run `npm run build` afterwards – Vite copies public/ into dist/.
import { launch, sleep } from '../../client/tools/cdp.mjs';
import fs from 'node:fs'; import path from 'node:path';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'media'), BASE = process.env.BASE ?? 'http://localhost:3111';
const c = await launch({ port: 9355, shotsDir: 'fc-cap', evalProblems: true });
const { send, ev } = c;
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 633, deviceScaleFactor: 2, mobile: false });
const clip = async (file, r, fmt = 'png') => { const s = await send('Page.captureScreenshot', { format: fmt, quality: 88, clip: { ...r, scale: 1 } }); fs.writeFileSync(`${OUT}/${file}`, Buffer.from(s.data, 'base64')); };
const key = async (code, type) => { const map = { KeyI: 73, KeyB: 66, KeyL: 76, KeyC: 67, KeyR: 82, KeyT: 84, KeyH: 72, KeyO: 79, ShiftLeft: 16 }; await send('Input.dispatchKeyEvent', { type: type === 'up' ? 'keyUp' : 'keyDown', code, key: code.replace('Key', '').toLowerCase(), windowsVirtualKeyCode: map[code] }); };
const until = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(200); } return false; };
await send('Page.navigate', { url: `${BASE}/play.html` }); await until('!!window.__game'); await sleep(1500);
await ev(`__game.CFG.TRAFFIC=false; __game.selectTheme('route66', false); __game.setPhase('day', true, false); __game.dn.run=false; __game.Wallet.credit(100); __game.startRide(); document.getElementById('overlay').classList.add('hide')`);
await sleep(800);
// 1 · key OFF (engine off, parking brake on – the start state) → key panel dark, PARK lit
await clip('cards/key-off.png', { x: 794, y: 536, width: 164, height: 97 });
await clip('cards/park.png', { x: 944, y: 470, width: 160, height: 118 });
// 2 · start the engine: key ON + running
await key('KeyI'); if (!(await until('__game.st.engineOn', 20000))) throw new Error('engine did not start'); await sleep(1500);
await clip('cards/key-on.png', { x: 794, y: 536, width: 164, height: 97 });
await key('KeyT'); await sleep(600);   // radio on
await clip('cards/trip-radio.png', { x: 798, y: 398, width: 304, height: 160 });
// 3 · driving in 3rd: hold the state so the gauges read something
await key('KeyB'); await ev(`{ const g=__game; window.__hold=setInterval(()=>{ g.st.gear=3; g.st.v=8; g.st.rpm=1900; g.st.engineOn=true; g.st.keyOn=true; g.st.hull=100; g.st.d=2.4; g.st.psi=0; g.st.park=false; },50) }`); await sleep(1500);
await clip('cards/gear.png', { x: 598, y: 403, width: 226, height: 158 });

await key('KeyR'); await sleep(400); await clip('cards/wiper.png', { x: 956, y: 476, width: 140, height: 44 });
// 4 · night + headlights + cab light → HEAD / NIGHT buttons lit
await ev(`__game.setPhase('night', true, false)`); await ev('__game.dn.head=true; __game.dn.cab=true'); await sleep(1500);
await clip('cards/lights.png', { x: 176, y: 526, width: 252, height: 107 });   // LED bars + HEAD / NIGHT / HEAT

// 5 · cold Siberia: COLD + STRAIN lamps lit
await ev(`{ clearInterval(window.__hold); __game.selectTheme('siberia', false); __game.setPhase('day', true, false); const g=__game; window.__hold=setInterval(()=>{ g.st.gear=2; g.st.v=6; g.st.rpm=2300; g.st.engineOn=true; g.st.keyOn=true; g.st.hull=100; g.st.d=2.4; g.st.psi=0; g.st.park=false; g.st.temp=-30; g.st.strain=.4; g.st.brakeT=.4; },50) }`); await sleep(2500);
await clip('cards/lamps.png', { x: 176, y: 396, width: 164, height: 134 });
await clip('cards/lamps-leds.png', { x: 176, y: 396, width: 164, height: 237 }); await key('KeyR'); await key('KeyR');   // wipers slow → fast → off before the sky shots
// 6 · the four times of day, same spot on Route 66, windscreen only
await ev(`{ clearInterval(window.__hold); __game.selectTheme('route66', false); const g=__game; let s0=g.net.Sm+140; while (g.net.near(s0-150, s0+260).length) s0+=40; g.st.s=s0; g.st.d=2.4; g.st.v=0; document.getElementById('toast').style.display='none'; window.__hold=setInterval(()=>{ g.st.v=0; g.st.d=2.4; g.st.psi=0; g.st.gear=0; g.st.engineOn=true; g.st.keyOn=true; g.st.rpm=620; },50) }`); 
for (const ph of ['dawn', 'day', 'dusk', 'night']) { await ev(`__game.setPhase('${ph}', true, false)`); if (ph === 'night') { await ev('__game.dn.head=true'); } await sleep(2500); await clip(`sky/${ph}.jpg`, { x: 100, y: 16, width: 1080, height: 372 }, 'jpeg'); }
console.log('problems', c.filt()); c.finish(0);
