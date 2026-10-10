// Real-Chrome end-to-end check: launches headless Chrome (software WebGL), drives the game over the DevTools protocol
// (start ride, engine start, gears, washer, off-road, a screenshot of every route), records JS exceptions / console errors, and saves screenshots.
//   node tools/e2e-chrome.mjs [url]       default url http://localhost:8765/play.html (run ./serve.sh first)
//   env: CHROME=/path/to/chrome  SHOTS=/dir/for/screenshots (default: <tmp>/fc-shots)
// Exits 1 if anything threw. Needs Node >= 22 (global WebSocket/fetch). Look at the screenshots – the script can't judge visuals.
import { launch, sleep } from './cdp.mjs';
const PORT=+process.env.PORT||9333, URL=process.argv[2]||'http://localhost:8765/play.html';
const { send, ev, shot, filt, problems, SHOTS, finish } = await launch({ port: PORT, shotsDir: 'fc-shots', args: ['--autoplay-policy=no-user-gesture-required'], evalProblems: true });
const key=async(code,type)=>{ const map={KeyW:87,KeyS:83,KeyA:65,KeyD:68,KeyE:69,KeyQ:81,KeyI:73,KeyB:66,KeyR:82,KeyX:88,KeyV:86,KeyN:78,KeyL:76,KeyG:71,KeyC:67,KeyH:72,ShiftLeft:16}; await send('Input.dispatchKeyEvent',{type:type==='up'?'keyUp':'keyDown',code,key:code.replace('Key','').toLowerCase(),windowsVirtualKeyCode:map[code]}); };
await send('Page.navigate',{url:URL}); await sleep(3500);
console.log('title:',await ev('document.title'),'| __game:',await ev('typeof window.__game'));
await shot('01-menu');
if(await ev('typeof window.__game')==='object'){
  await ev('window.__game.startRide()');
  // the scripted driver pops the clutch: use the pre-weight handling and a warm engine, or the truck stalls on launch (cold engine / MASS 2.5 are exercised by the climate checks below)
  await ev('Object.assign(__game.CFG.TRUCK,{MASS:1,BRAKE:9,STEER_RATE:1.8,STEER_RETURN:3.5,YAW_LAG:0,CENTRIF:.03}); __game.st.temp=__game.CFG.ENGINE_WARM+5');
  await sleep(500); await key('KeyI'); await sleep(3500); if(await ev('__game.st.park')) await key('KeyB'); await shot('02-engine-running');
  console.log('after start:',await ev('JSON.stringify({eng:__game.st.engineOn,rpm:Math.round(__game.st.rpm),mode:__game.st.mode})'));
  // sound effects: the samples (client/audio/sfx, manifest + fingerprinted mp3) download + decode in the background and then play; a failed one stays silent
  { const man=JSON.parse(await ev(`fetch('audio/sfx/manifest.json').then(r=>r.text())`)).items, n=Object.keys(man).length;
    for(let i=0;i<40&&(await ev('Object.keys(__game.audio.bufs).length'))<n;i++) await sleep(250);
    const got=await ev('Object.keys(__game.audio.bufs).length'); console.log('sfx samples decoded:',got,'/',n);
    if(got!==n) problems.push('sfx: '+got+' of '+n+' samples decoded');
    const cc=await ev(`fetch('audio/sfx/'+${JSON.stringify(Object.values(man)[0].file)}).then(r=>r.headers.get('content-type')+' '+r.headers.get('cache-control'))`); console.log('sfx headers:',cc);
    if(!await ev(`__game.audio.play('switch')`)) problems.push('sfx: play(switch) did not play'); }
  await key('ShiftLeft'); await sleep(300); await key('KeyE'); await key('KeyW'); await sleep(300); await key('ShiftLeft','up'); await sleep(4000);
  console.log('moving:',await ev('JSON.stringify({v:+__game.st.v.toFixed(1),gear:__game.st.gear,d:+__game.st.d.toFixed(1),s:Math.round(__game.st.s)})')); await shot('03-driving');
  await key('KeyR'); await key('KeyX'); await sleep(1500); await shot('04-washer'); await key('KeyX','up'); await sleep(1500);
  await key('KeyN'); await key('KeyL'); await key('KeyC'); console.log('N/L/C keys ->',await ev('JSON.stringify({night:__game.dn.night,head:__game.dn.head,cab:__game.dn.cab})')); await key('KeyN'); await key('KeyL'); await key('KeyC');
  await ev('__game.st.d=8.5'); await sleep(2500); await shot('05-offroad');
  console.log('final:',await ev('JSON.stringify({v:+__game.st.v.toFixed(1),hull:+__game.st.hull.toFixed(1),mode:__game.st.mode,d:+__game.st.d.toFixed(1)})'));
}
// reverse: stop on the road, clutch in, G = reverse, gas, ease the clutch out -> the truck must roll BACKWARDS (s decreases), slowly
if(await ev('typeof window.__game')==='object'){
  await ev('__game.st.mode="drive"; __game.st.s=__game.net.Sm+300; __game.st.d=2.4; __game.st.psi=0; document.getElementById("overlay").classList.add("hide")');
  if(await ev('__game.st.park')) await key('KeyB');
  await key('KeyW','up'); await key('ShiftLeft'); await key('KeyS'); await sleep(3000); await key('KeyS','up'); await key('ShiftLeft','up');
  if(!(await ev('__game.st.engineOn'))){ await key('ShiftLeft'); await key('KeyI'); await sleep(3500); await key('ShiftLeft','up'); }
  await key('ShiftLeft'); await sleep(600); await key('KeyG'); await key('KeyW'); await sleep(300); await key('ShiftLeft','up'); await sleep(3500);
  console.log('reverse:',await ev('JSON.stringify({gear:__game.st.gear,rev:__game.st.rev,v:+__game.st.v.toFixed(2),vel:+__game.st.vel.toFixed(2),s:Math.round(__game.st.s),eng:__game.st.engineOn,tyaw:+__game.st.tyaw.toFixed(2)})'));
  await shot('reverse'); await key('KeyW','up'); await key('KeyS'); await sleep(1500); await key('KeyS','up');
}
// route tour: every theme, one screenshot each (route-<id>.png) – look at them, the script can't judge visuals
if(await ev('typeof window.__game')==='object' && await ev('Array.isArray(__game.THEMES)')){
  for(const t of await ev('__game.THEMES.map(t=>t.id)')){
    await ev(`__game.selectTheme('${t}', false); __game.st.mode='drive'; __game.st.s=__game.net.Sm+260; __game.st.d=2.6; __game.st.v=14; document.getElementById('overlay').classList.add('hide')`);
    await sleep(1800); await shot('route-'+t);
  }
}
// cosmetics (promo wardrobe): every colour of the wheel, the truck paint and the shifter (cosmetic-<slot>-<item>.png; the wheel is cut off by the 1280x633 viewport but its ring shows) – look at them
if(await ev('typeof window.__game')==='object' && await ev('typeof __game.cosmetics')==='object'){
  await ev(`__game.selectTheme('route66', false); __game.st.mode='drive'; __game.st.s=__game.net.Sm+260; __game.st.d=2.6; __game.st.v=0; __game.st.gear=3; document.getElementById('overlay').classList.add('hide')`);
  const C=await ev('__game.cosmetics.COSMETICS');
  for(const slot of Object.keys(C)) for(const id of C[slot]){ await ev(`__game.cosmetics.setLoadout({${slot}:${JSON.stringify(id)}})`); await sleep(450); await shot(`cosmetic-${slot}-${id}`); }
  await ev(`__game.cosmetics.setLoadout({wheel:'gold',truck_color:'black',gearbox:'gold'})`); await sleep(500); await shot('cosmetic-set-gold-black');
  await ev(`__game.cosmetics.setLoadout({wheel:'ocean',truck_color:'blue',gearbox:'chrome'}); __game.setNight(true,true,false)`); await sleep(1200); await shot('cosmetic-set-blue-night');
  await ev(`__game.setNight(false,true,false); __game.cosmetics.setLoadout(null)`);
  console.log('cosmetics worn:',await ev('JSON.stringify(__game.cosmetics.loadout)'));
}
// road network: the depot (start), waiting at the depot exit with main-road traffic, a signalled crossroads, a multi-lane stretch (net-*.png) – look at them
if(await ev('typeof window.__game')==='object' && await ev('typeof __game.net')==='object'){
  const hold=s=>`clearInterval(window.__hold2); window.__hold2=setInterval(()=>{ const g=__game; g.st.v=0; g.st.hull=100; g.st.offT=0; ${s} },50)`;
  await ev(`__game.CFG.TRAFFIC=true; __game.selectTheme('route66', false); __game.setNight(false,true,false); __game.st.mode='done'; __game.startRide(); document.getElementById('overlay').classList.add('hide')`);
  await sleep(1500); await shot('net-depot');
  await ev(`${hold("")}; __game.st.s=__game.net.sA-2; __game.st.d=2.4; __game.st.psi=-0.35`); await sleep(2500); await shot('net-depot-exit');
  console.log('depot exit:',await ev('JSON.stringify({road:__game.roads.status().road, cars:__game.traffic.filter(a=>a.road.main).length, off:__game.st.off})'));
  const j=await ev('(()=>{ const j=__game.net.nextJunction(__game.net.Sm,1,40000,q=>q.signal&&q.kind==="cross"); return j&&{s:j.s,id:j.id}; })()');
  if(j){ await ev(`__game.st.s=${j.s}-70; __game.st.d=2.4; __game.st.psi=0`); await sleep(3000); await shot('net-crossroads');
    console.log('crossroads',j.id,':',await ev(`JSON.stringify({sig:__game.net.signal(__game.net.nextJunction(__game.st.s,1,200,q=>q.signal),'main'), cross:__game.traffic.filter(a=>a.road.j&&a.road.j.id==='${j.id}').length, heads:__game.roads.status()})`));
    await ev('__game.setNight(true,true,false)'); await sleep(1500); await shot('net-crossroads-night'); await ev('__game.setNight(false,true,false)'); }
  const h=await ev('(()=>{ const s=__game.net.segs.find(q=>q.nR>=3&&q.s0>__game.net.Sm); return s&&s.s0+200; })()');
  if(h){ await ev(`__game.st.s=${h}; __game.st.d=2.4; __game.st.psi=0`); await sleep(2500); await shot('net-multilane'); console.log('multi-lane:',await ev('__game.roads.status().road')); }
  await ev('clearInterval(window.__hold2)');
}
// cold tour: Siberia (-22 °C, heavy snow) – frosted glass with the heater off, then a warm engine + heater on (cold-frost.png / cold-heater.png / cold-night.png) – look at them
if(await ev('typeof window.__game')==='object'){
  await ev(`__game.selectTheme('siberia', false); __game.setNight(false,true,false); __game.CFG.TRAFFIC=false; __game.startRide(); const g=__game; g.st.engineOn=true; g.st.keyOn=true; g.st.rpm=1500; g.st.v=14; g.st.s=g.net.Sm+260; window.__hold=setInterval(()=>{ g.st.v=14; g.st.rpm=1500; g.st.engineOn=true; g.st.hull=100; g.st.d=2.4; g.st.psi=0; },50); document.getElementById('overlay').classList.add('hide')`);
  await sleep(14000); await shot('cold-frost');
  console.log('cold, heater off:',await ev('JSON.stringify({temp:Math.round(__game.st.temp),eff:+__game.st.heatEff.toFixed(2),amb:__game.weather.ambient})'));
  await ev('__game.st.temp=80'); await key('KeyH'); await sleep(9000); await shot('cold-heater');
  console.log('warm, heater on:',await ev('JSON.stringify({temp:Math.round(__game.st.temp),eff:+__game.st.heatEff.toFixed(2),heater:__game.st.heater})'));
  await ev('__game.setNight(true,true,false)'); await ev('__game.st.temp=-20; __game.st.heater=false'); await sleep(9000); await shot('cold-night'); await ev('__game.setNight(false,true,false)');
  await ev('clearInterval(window.__hold)');
}
// night tour: every theme at night with the instant switch (night-<id>.png), then the cab light + a menu shot – look at them
if(await ev('typeof window.__game')==='object' && await ev('typeof __game.setNight')==='function'){
  await ev('__game.setNight(true,true,false)');
  for(const t of await ev('__game.THEMES.map(t=>t.id)')){
    await ev(`__game.selectTheme('${t}', false); __game.st.mode='drive'; __game.st.s=__game.net.Sm+260; __game.st.d=2.6; __game.st.v=14; document.getElementById('overlay').classList.add('hide')`);
    await sleep(1800); await shot('night-'+t);
  }
  await ev(`__game.selectTheme('route66', false); __game.st.s=__game.net.Sm+260; __game.st.v=14; __game.spawn('sedan','cruise','oncoming',70); __game.spawn('sedan','cruise','oncoming',130); __game.spawn('truck','cruise','ahead',45); __game.spawn('sedan','overtake','ahead',30)`); await sleep(1200); await shot('night-traffic'); await sleep(1500); await shot('night-traffic2');
  await ev('__game.dn.cab=true'); await sleep(500); await shot('night-cablight'); await ev('__game.dn.cab=false');
  await ev("__game.st.mode='menu'; document.getElementById('overlay').classList.remove('hide')"); await ev('__game.setNight(true,true,false)'); await sleep(300); await shot('night-menu');
  await ev('__game.setNight(false,true,false)');
  // dark-night tour: no lights (must be black), then headlights on, then at a lamp post; dusk + dawn on two routes; the clock must advance by itself
  await ev(`__game.CFG.TRAFFIC=false; __game.setNight(true,true,false); __game.dn.run=false; __game.selectTheme('route66', false); __game.st.mode='drive'; document.getElementById('overlay').classList.add('hide'); __game.st.s=__game.net.Sm+250; __game.st.d=2.4; __game.st.v=14; __game.dn.head=false`);
  await sleep(1200); await shot('dark-nolights'); await ev('__game.dn.head=true'); await sleep(1200); await shot('dark-headlights');
  await ev(`__game.selectTheme('siberia', false); __game.st.s=__game.net.Sm+300`); await sleep(1500); await shot('dark-siberia-lamps');
  for(const r of ['route66','brenner']) for(const ph of ['dusk','dawn']){ await ev(`__game.selectTheme('${r}', false); __game.setPhase('${ph}',true,false); __game.st.s=__game.net.Sm+260`); await sleep(1200); await shot(ph+'-'+r); }
  await ev(`__game.dn.run=true; __game.dn.scale=600; __game.setClock(5.5,true,false)`); const t0=await ev('__game.dn.t'); await sleep(2500); console.log('clock x600 5.5 ->',t0,await ev('__game.dn.t'),await ev('__game.dn.phase')); await ev('__game.dn.scale=60; __game.setNight(false,true,false)');
  // menu cards: click NIGHT, check the state flipped and the .sel class followed; then the N key must move it back
  await ev("__game.st.mode='menu'; document.getElementById('overlay').classList.remove('hide'); __game.startRide&&0"); 
}
console.log('PROBLEMS ('+problems.length+'):'); for(const p of [...new Set(problems)].slice(0,25)) console.log(' -',p.slice(0,300));
console.log('screenshots in',SHOTS); finish(filt().length?1:0,500);
