// Headless smoke test of the real game modules (no browser): fake DOM + stubbed three.js (tools/stub-three.mjs),
// seeded Math.random and a simulated clock, so the printed trace is deterministic and diff-able between code versions.
// It plays a ride: engine start at the depot, the slow right turn onto the main road, gears, wipers/washer, a signalled crossroads, layout determinism,
// a jump 60 km out (the road never ends), a roadside crash, every route. It does NOT render anything –
// visual changes still need a real browser check.
//   npx esbuild js/main.js --bundle --format=esm --alias:three=./tools/stub-three.mjs --outfile=/tmp/fc-test.js
//   node tools/headless-test.mjs /tmp/fc-test.js
let seed=12345; Math.random=()=>{ seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; };
let now=1000; Object.defineProperty(globalThis,'performance',{value:{now:()=>now},configurable:true});
const listeners={}, store={};
const ctxStub=new Proxy(function(){}, { get:(t,p)=> p==='createLinearGradient'||p==='createRadialGradient' ? ()=>({addColorStop(){}}) : p==='measureText' ? ()=>({width:10}) : ()=>{}, set:()=>true });
class El{append(){} addEventListener(){} constructor(id){this.id=id;this.style={};this.classList={add(){},remove(){},toggle(){}};this.textContent='';this.innerHTML='';}getContext(){return ctxStub;}click(){this.onclick&&this.onclick();} querySelectorAll(){return [];} querySelector(){return new El('q');} addEventListener(){} appendChild(){}}
const els={}; globalThis.document={getElementById:id=>els[id]??=new El(id),createElement:()=>new El('x'),addEventListener:(k,f)=>(listeners['doc:'+k]??=[]).push(f),body:{style:{},appendChild(){},append(){},classList:{add(){},remove(){},toggle(){}}},querySelectorAll:()=>[],hidden:false}; globalThis.matchMedia=()=>({matches:false});
globalThis.window=globalThis; globalThis.addEventListener=(k,f)=>(listeners[k]??=[]).push(f);
globalThis.innerWidth=1280; globalThis.innerHeight=720; globalThis.devicePixelRatio=1; globalThis.AudioContext=undefined;
globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v);}};
let rafCb=null; globalThis.requestAnimationFrame=f=>{rafCb=f;};
const errors=[]; process.on('uncaughtException',e=>errors.push(e));
import { pathToFileURL } from 'node:url'; import { resolve } from 'node:path';
try{ await import(pathToFileURL(resolve(process.argv[2])).href); }catch(e){ console.log('IMPORT FAILED',e.stack); process.exit(1); }
const G=globalThis.__game, {st,input}=G;
const fire=(type,code)=>(listeners[type]||[]).forEach(f=>f({code,repeat:false,preventDefault(){}}));
const step=(n=1)=>{ for(let i=0;i<n;i++){ now+=1000/60; const cb=rafCb; rafCb=null; cb(now); } };
const out=[]; const snap=l=>out.push(`${l.padEnd(18)} s=${st.s.toFixed(2)} d=${st.d.toFixed(2)} psi=${st.psi.toFixed(3)} v=${st.v.toFixed(2)} rpm=${st.rpm.toFixed(0)} g=${st.gear} hull=${st.hull.toFixed(2)} eng=${st.engineOn} mode=${st.mode} wash=${st.wash.toFixed(2)}`);
// lane-keeping driver: runs every 6 frames while "playing"
const steerCtl=()=>{ const e=(st.d-2.4)+10*st.psi; input.left=e>.5?1:0; input.right=e<-.5?1:0; };
const drive=(sec,label)=>{ for(let i=0;i<Math.round(sec*10)&&st.mode==='drive';i++){ steerCtl(); step(6);} if(label)snap(label); };
// the scripted driver pops the clutch and steers in bangs, so it uses the pre-weight handling ("old" values in CFG.TRUCK); the F2-tunable feel is not what this trace checks
const TRUCK0={...G.CFG.TRUCK}; Object.assign(G.CFG.TRUCK,{MASS:1,BRAKE:9,STEER_RATE:1.8,STEER_RETURN:3.5,YAW_LAG:0,CENTRIF:.03});
const net=G.net, checks=[]; const check=(ok,l)=>{ checks.push((ok?'ok   ':'FAIL ')+l); };
// speed-held driving (gas/brake bang-bang around vmax) for the depot road and the turn
const crawl=(until,vmax,label,maxSec=120)=>{ for(let i=0;i<maxSec*10&&st.mode==='drive'&&!until();i++){ steerCtl(); input.gas=st.v<vmax?1:0; input.brake=st.v>vmax+1.5?1:0; step(6);} input.gas=0; input.brake=0; if(label)snap(label); };
// warmed-up engine: a cold one has thin power (CFG.COLD_POWER) and wears the hull when revved, so the scripted launch would stall
G.startRide(); const parkedAtStart=st.park; st.park=false; st.temp=G.CFG.ENGINE_WARM+5; snap('start (depot)'); check(parkedAtStart,'the ride starts with the parking brake ON (released here for the scripted driver)'); check(st.s===0&&!st.off,'starts in the depot yard, on the road'); step(30); fire('keydown','KeyI'); step(60*2.6); snap('after start');
fire('keydown','ShiftLeft'); step(20); fire('keydown','KeyE'); step(25); fire('keyup','ShiftLeft');
crawl(()=>st.s>40,4,'1st, yard');   // 1st tops out at 4.3 m/s (redline): holding more gas there would blow the engine (max-rev strain)
fire('keydown','ShiftLeft'); step(20); fire('keydown','KeyE'); fire('keyup','ShiftLeft');
crawl(()=>st.s>net.sA-25,5.5,'depot road'); crawl(()=>st.s>net.sA-1,3.5,'at the stop line');
let offInTurn=0; crawl(()=>{ offInTurn+=st.off?1:0; return st.s>net.Sm+30; },4,'turned right');
check(st.s>net.Sm+20&&Math.abs(st.d-2.4)<2.2&&offInTurn===0&&st.mode==='drive','right turn from the depot road onto the main road, on the tarmac (d='+st.d.toFixed(2)+')');
for(const g of [3,4,5,6,7]){ fire('keydown','KeyW'); for(let i=0;i<300&&st.rpm<2300&&st.mode==='drive';i++){ steerCtl(); step(6); }   // upshift like a driver: when the revs are up
  fire('keydown','ShiftLeft'); step(20); fire('keydown','KeyE'); fire('keyup','ShiftLeft'); drive(3.2,'gear '+g); }
fire('keydown','KeyR'); drive(2,'wipers slow'); fire('keydown','KeyX'); drive(2,'washing'); fire('keyup','KeyX'); drive(3,'after wash');
drive(6,'cruise');
check(G.traffic.some(a=>a.road.main),'traffic on the main road');
// a signalled crossroads: put the truck 220 m before it (engine running, 14 m/s) and let the cycle + cross traffic run
const j=net.nextJunction(st.s,1,40000,q=>q.signal&&q.kind==='cross'); check(!!j,'a signalled crossroads within 40 km');
if(j){ Object.assign(st,{s:j.s-220,d:2.4,psi:0,v:14,hull:100,offT:0}); const seen=new Set(); let crossCars=0;
  for(let i=0;i<60*40;i++){ seen.add(net.signal(j,'main')+net.signal(j,'cross')); st.v=0; step(1); crossCars=Math.max(crossCars,G.traffic.filter(a=>a.road.j===j).length); }
  out.push('junction '+j.id+' s='+j.s+' lanes '+j.nR+'+'+j.nL+' side '+j.sl+' states '+[...seen].sort().join(','));
  check(seen.has('GR')&&seen.has('RG')&&!seen.has('GG'),'signal cycle: main/cross alternate, never both green'); check(crossCars>0,'cross traffic at the crossroads ('+crossCars+')'); }
// layout: same seed -> same road; far ahead: the road never ends
const sig=()=>net.near(0,30000).map(q=>q.kind[0]+q.s+(q.signal?'*':'')).join(' ')+'|'+net.segs.filter(q=>q.s0<30000).map(q=>q.nR+'+'+q.nL).join(' ');
const a1=sig(), rseed=G.roads.seed; net.reset(rseed); check(sig()===a1,'same seed -> same layout ('+net.near(0,30000).length+' junctions in 30 km)');
const kinds=new Set(net.segs.map(q=>q.nR+'+'+q.nL)); out.push('lane layouts: '+[...kinds].join(' ')+' · patterns: '+[...new Set(net.segs.map(q=>q.pat))].join(' '));
Object.assign(st,{s:60000,d:2.4,psi:0,v:20,hull:100,offT:0}); drive(3,'60 km out'); check(st.mode==='drive'&&st.s>60000,'60 km: still road (endless)');
// roadside collision run
st.d=12; st.psi=0; for(let i=0;i<60&&st.mode==='drive';i++){ step(6); } snap('roadside run');
// every route: switch, start a ride, drive a bit on the main road (exercises sky/terrain/props/furniture/road build for each theme)
for(const t of G.THEMES){ G.selectTheme(t.id,false); G.st.mode='done'; G.startRide(); st.park=false; G.st.s=net.Sm+300; G.st.v=14; step(90); out.push(`route ${t.id.padEnd(12)} s=${G.st.s.toFixed(1)} chunks ok`); }
// road content never overlaps: over every route x several layouts, no two objects (props, furniture, warning signs, buildings) stand inside each other or closer than CFG-free GAP (world/spacing.js)
{ const { overlap } = G.spacing; let pairs=0, bad=[], n=0;
  for(const t of G.THEMES) for(const sd of [3,11,29,57,101,1337]) { G.selectTheme(t.id,false); net.reset(sd); G.holes.clearHoleCache(); for(const at of [0,2500,9000]) { G.roadObjects.update(at+net.Sm);
    const cs=[]; for(const [,g] of G.chunks) cs.push(...g.userData.layout); n+=cs.length;
    cs.sort((a,b)=>a.s-b.s); for(let i=0;i<cs.length;i++) for(let j=i+1;j<cs.length&&cs[j].s-cs[i].s<12;j++) { pairs++; const o=overlap(cs[i],cs[j]); if(o) bad.push(`${t.id}#${sd} ${cs[i].kind}@${cs[i].s.toFixed(0)}/${cs[i].l.toFixed(1)} ~ ${cs[j].kind}@${cs[j].s.toFixed(0)}/${cs[j].l.toFixed(1)}`); } } }
  check(n>2000&&bad.length===0,`road content: ${n} objects over 5 routes x 6 layouts, ${pairs} close pairs checked, ${bad.length} overlapping or too close`+(bad.length?' e.g. '+bad.slice(0,4).join(' | '):'')); }
snap('end');
// launch with the SHIPPED handling (not the old values above): clutch in, gear, gas, release the clutch, 5 s later the truck must be rolling (no gas / 6th = stall)
Object.assign(G.CFG.TRUCK,TRUCK0); G.selectTheme('route66',false);
for(const [gear,gas,temp,want] of [[1,1,null,1],[1,1,-22,1],[2,1,null,1],[1,0,null,0],[6,1,null,0]]){
  G.st.mode='done'; G.startRide(); st.park=false; if(temp!==null)st.temp=temp; fire('keydown','KeyI'); step(60*2.6);
  fire('keydown','ShiftLeft'); step(20); fire('keydown','Digit'+gear); step(60); if(gas)fire('keydown','KeyW'); step(20); const T0=st.temp; fire('keyup','ShiftLeft'); step(60*5); fire('keyup','KeyW');
  const ok=want?st.engineOn&&st.v>2:!st.engineOn; out.push(`launch g${gear} gas=${gas} T=${T0.toFixed(0)} °C at release  v=${st.v.toFixed(2)} rpm=${st.rpm.toFixed(0)} eng=${st.engineOn}`);
  check(ok,`launch in gear ${gear} ${gas?'with':'without'} gas${temp!==null?' at '+temp+' °C':''} ${want?'pulls away':'stalls'}`); }
// brakes need the engine (dead pedal with the engine off); the parking brake (B) works without it and holds against thrust
G.st.mode='done'; G.startRide(); st.park=false;
Object.assign(st,{s:net.Sm+300,d:2.4,psi:0,v:15,gear:0,engineOn:false,keyOn:false,hull:100}); input.brake=1; step(60*3); const vDead=st.v; input.brake=0;
check(vDead>13,'engine off: the brake pedal does nothing (v '+vDead.toFixed(1)+' after 3 s of full brake)');
fire('keydown','KeyB'); step(60*3); check(st.park&&st.v===0,'parking brake stops the truck with the engine off');
fire('keydown','KeyB'); check(!st.park,'B again releases the parking brake');
Object.assign(st,{v:0,gear:1,engineOn:true,rpm:2000,clutch:0,slip:false,park:true}); input.gas=1; step(60*3); input.gas=0; check(st.v<.05,'parking brake holds the truck against 1st gear at full gas (v '+st.v.toFixed(2)+')');
// clutch in while rolling in 6th with the gas still held: the revs fall away from where they were, they must not flare to the redline
fire('keyup','ShiftLeft'); G.st.mode='done'; G.startRide(); st.park=false; st.temp=G.CFG.ENGINE_WARM+5; fire('keydown','KeyI'); step(60*2.6);
Object.assign(st,{s:net.Sm+300,d:2.4,psi:0,hull:100,gear:6,v:60/3.6,clutch:0,slip:false,park:false}); st.rpm=st.v*1.065*106.67; st.freeRpm=st.rpm; input.gas=1; for(let i=0;i<180;i++){ st.d=2.4; st.psi=0; step(1); }
const rpmBefore=st.rpm; fire('keydown','ShiftLeft'); let rpmPeak=0; for(let i=0;i<90;i++){ st.d=2.4; st.psi=0; step(1); rpmPeak=Math.max(rpmPeak,st.rpm); } fire('keyup','ShiftLeft'); input.gas=0;
check(rpmPeak<rpmBefore+150,'clutch in at speed with the gas held: revs do not flare ('+rpmBefore.toFixed(0)+' → peak '+rpmPeak.toFixed(0)+')');
// driving against the parking brake (gear in, clutch out, gas held): the brakes heat up, the drivetrain strains and finally gives out; letting go in time recovers
const fightRide=(releaseAt)=>{ fire('keyup','ShiftLeft'); input.gas=0; input.brake=0; G.st.mode='done'; G.startRide(); st.park=false; st.temp=G.CFG.ENGINE_WARM+5; fire('keydown','KeyI'); step(60*2.6);
  Object.assign(st,{s:net.Sm+300,d:2.4,psi:0,hull:100,v:0}); fire('keydown','ShiftLeft'); step(20); fire('keydown','Digit1'); step(30); fire('keydown','KeyB'); input.gas=1; fire('keyup','ShiftLeft');
  let peakHeat=0; for(let i=1;i<=60*14&&st.mode==='drive';i++){ st.d=2.4; st.psi=0; step(1); peakHeat=Math.max(peakHeat,st.brakeT); if(releaseAt&&i===releaseAt*60){ fire('keydown','ShiftLeft'); input.gas=0; } }
  input.gas=0; fire('keyup','ShiftLeft'); return { ended: st.mode!=='drive', why: st.blownWhy, peakHeat, strain: st.strain }; };
const stuck=fightRide(0); check(stuck.ended&&stuck.why==='brakes'&&stuck.peakHeat>.5,'driving against the parking brake: brakes overheat ('+stuck.peakHeat.toFixed(2)+') and the drivetrain gives out');
const freed=fightRide(3); check(!freed.ended&&freed.strain<.1,'clutch in after 3 s against the parking brake: no failure, strain recovers ('+freed.strain.toFixed(2)+')');
// battery: the starter costs charge, consumers flatten it with the engine off (then lights/radio/heater cut out and the engine won't start), the alternator refills it
const batFresh=()=>{ fire('keyup','ShiftLeft'); input.gas=0; input.brake=0; G.st.mode='done'; G.startRide(); st.park=false; st.temp=G.CFG.ENGINE_WARM+5; Object.assign(st,{s:net.Sm+300,d:2.4,psi:0,hull:100,v:0}); };
batFresh(); const b0=st.batt; fire('keydown','KeyI'); step(60*2.6); check(st.engineOn&&b0-st.batt>.04&&b0-st.batt<.15,'starting the engine costs battery charge ('+(b0-st.batt).toFixed(3)+')');
batFresh(); G.dn.head=true; if(!G.radio.on) fire('keydown','KeyT'); st.keyOn=true; st.heater=true; let sawDead=false; for(let i=0;i<60*60;i++){ step(1); if(st.battDead) sawDead=true; }
check(sawDead&&st.mode!=='done'&&!G.dn.head&&!st.heater,'engine off, everything on: the battery goes flat, the consumers cut out, the ride goes on');
batFresh(); st.batt=.005; st.keyOn=true; step(60*60); check(st.batt>G.CFG.BATT.START_MIN,'flat battery, key on, nothing else: it recovers enough to crank again ('+st.batt.toFixed(3)+')');
batFresh(); st.batt=.1; fire('keydown','KeyI'); step(60); check(!st.engineOn&&!st.ign,'a battery below START_MIN will not crank the engine');
batFresh(); st.batt=.05; step(60*30); check(st.batt>.05+.04,'everything off: the battery heals ('+st.batt.toFixed(3)+')');
batFresh(); st.batt=G.CFG.BATT.REST_MAX+.05; step(60*30); check(Math.abs(st.batt-(G.CFG.BATT.REST_MAX+.05))<1e-6,'resting stops healing at REST_MAX');
batFresh(); const on0=st.batt; G.dn.head=true; st.keyOn=true; step(60*10); const offDrain=on0-st.batt; batFresh(); fire('keydown','KeyI'); step(60*2.6); const e0=st.batt; G.dn.head=true; Object.assign(st,{gear:0}); step(60*10); const onDrain=e0-st.batt;
check(offDrain>.015&&offDrain>onDrain*2,'engine off drains fast ('+offDrain.toFixed(3)+' in 10 s), engine on much slower ('+onDrain.toFixed(3)+')');
batFresh(); st.batt=.5; fire('keydown','KeyI'); step(60*2.6); const bRun=st.batt; Object.assign(st,{gear:6,v:60/3.6,clutch:0,slip:false}); st.rpm=st.v*1.065*106.67; input.gas=1; for(let i=0;i<60*30;i++){ st.d=2.4; st.psi=0; step(1); } input.gas=0;
check(st.batt>bRun+.03,'engine running at cruise: the alternator refills the battery ('+bRun.toFixed(2)+' → '+st.batt.toFixed(2)+')');
// cab light: works whenever the key is on (engine off too); it goes out with the key off
batFresh(); fire('keydown','KeyC'); check(!G.dn.cab,'cab light refuses to switch on with the key off');
st.keyOn=true; fire('keydown','KeyC'); check(!st.engineOn&&G.dn.cab,'cab light switches on with the key ON and the engine off');
st.keyOn=false; step(30); check(!G.dn.cab,'key off: the cab light goes out');
// what the lobby's live feed and Night Owl read from every heartbeat: follows the RUNNING clock (not the last press of N), and the route is a real theme id
G.dn.run=false; G.setClock(23,true,false); step(60); const nightX=G.online.extra(); G.setClock(12,true,false); step(60); const dayX=G.online.extra();
check(nightX.night===true&&dayX.night===false&&G.THEMES.some(t=>t.id===dayX.route),'heartbeat extras follow the clock: night at 23:00 ('+nightX.night+'), day at 12:00 ('+dayX.night+'), route '+dayX.route);
// cosmetics (promo wardrobe): the DEFAULT items draw exactly the colours the cockpit always had; junk values fall back per slot; every item draws without an exception
{ const C=G.cosmetics, l=C.look; C.setLoadout(null);
  const t=l('truck_color'), w=l('wheel'), g=l('gearbox');
  check(t.top==='#b0281f'&&t.bottom==='#6e130f'&&t.fender==='#5c120e'&&t.line==='rgba(255,200,190,.35)'&&t.frame==='#3d372f'&&t.dashEdge==='#5a554a','default truck paint = the original red hood, window frame and dashboard edge');
  check(w.rim==='#0e0d0b'&&w.sheen==='#2b2722'&&w.spoke==='#1b1814'&&w.hub==='#26221d'&&w.mark==='#ffcf5a','default steering wheel = the original');
  check(g.knob==='#17150f'&&g.rim==='#555'&&g.boot==='#0c0b0a'&&g.lever===null&&g.text==='#e8e2cf','default shifter = the original');
  check(l('dice').body==='#f4f1e8'&&l('dice').pip==='#b11'&&l('needle').color==='#ff7a2e','default hanging dice and gauge needles = the original');
  C.setLoadout({wheel:'gold',truck_color:'<script>',gearbox:7,seat:'x'}); check(C.loadout.wheel==='gold'&&C.loadout.truck_color==='red'&&C.loadout.gearbox==='stick'&&C.loadout.dice==='white'&&C.loadout.needle==='orange'&&!('seat' in C.loadout),'a loadout keeps the known items and falls back to the default of a slot for junk');
  let worn=0; for(const slot of Object.keys(C.COSMETICS)) for(const item of C.COSMETICS[slot]){ C.setLoadout({[slot]:item}); step(2); worn++; }
  C.setLoadout(null); check(worn>=30&&errors.length===0,'every item of every slot draws without an exception ('+worn+' worn)'); }
// crash counters (the server's statistics): a ride starts at 0, a vehicle contact raises crashV, a building crash raises crashB, both ride along in every report (online.js progress())
{ G.startRide(); check(st.crashV===0&&st.crashB===0,'a new ride starts with no crashes counted');
  st.park=false; st.engineOn=true; st.keyOn=true; st.s=net.Sm+400; st.d=2.4; st.psi=0; st.v=14; st.hull=100; step(5);
  let car=null; for(const off of [400,700,1100,1500,2000,2600]){ st.s=net.Sm+off; st.d=2.4; st.psi=0; st.v=14; step(3); car=G.spawn('sedan','slow','ahead',9,2.4); if(car) break; }   // a spot on the (fresh) road where a car can be placed
  if(car){ car.v=0; for(let i=0;i<60*6&&!st.crashV&&st.mode==='drive';i++){ st.v=Math.max(st.v,10); step(1); } }
  check(!!car&&st.crashV>=1,'a contact with a vehicle is counted (crashV '+st.crashV+')'); }
// the free ride's ASSIST (guide.js): the battery drains half as fast and a hit costs half the hull (a fatal one stays fatal); the TUTORIAL walks its steps and holds the free run's finish line
{ const drain=()=>{ batFresh(); G.dn.head=true; st.keyOn=true; const a=st.batt; step(60*10); return a-st.batt; };
  G.setGuide({}); const plain=drain(); G.setGuide({assist:true}); const eased=drain();
  check(plain>.015&&Math.abs(eased-plain*G.CFG.ASSIST.BATT_DRAIN)<plain*.08,'assist: the battery drains half as fast ('+plain.toFixed(3)+' → '+eased.toFixed(3)+' in 10 s)');
  G.setGuide({}); st.hull=100; G.hurt(10,10); const hit=100-st.hull; G.setGuide({assist:true}); st.hull=100; G.hurt(10,10); const easedHit=100-st.hull; st.hull=100; G.hurt(100,10,'X',true);
  check(Math.abs(hit-10)<1e-9&&Math.abs(easedHit-10*G.CFG.ASSIST.HULL_DMG)<1e-9&&st.hull===0,'assist: a hit costs half the hull ('+hit.toFixed(1)+' → '+easedHit.toFixed(1)+'), a fatal one is still fatal');
  G.setGuide({}); batFresh(); step(5); check(G.guide.tips.length===0&&!G.guide.hold,'no tutorial, no assist: nothing highlighted, nothing held');
  G.setGuide({tutorial:true}); G.st.mode='done'; G.startRide(); step(5); const ids=()=>G.guide.tips.map(t=>t.id).join();
  check(G.guide.hold&&st.mode==='drive'&&ids().startsWith('key-on'),'tutorial step 1 (ignition): the key is highlighted ['+ids()+']');
  fire('keydown','KeyI'); step(60*4); check(G.guide.banner&&/ENGINE RUNNING/.test(G.guide.banner.text),'a finished step cheers with a green banner ['+(G.guide.banner?.text)+']'); step(60*4); check(st.engineOn&&ids()==='park','tutorial step 2 (parking brake) once the engine runs ['+ids()+']');
  fire('keydown','KeyB'); step(60*7); check(!st.park&&ids().startsWith('CLU'),'tutorial step 3 (first gear + clutch) once the brake is off ['+ids()+']');
  fire('keydown','ShiftLeft'); step(20); fire('keydown','Digit1'); step(60*7); check(st.gear===1&&ids().startsWith('GAS'),'tutorial step 4 (moving off) once 1st is in ['+ids()+']');
  st.engineOn=false; st.stalled=true; st.rpm=0; step(70); check(G.guide.note==='ENGINE STALLED'&&ids().startsWith('STALL,CLU,key-start'),'tutorial step 4, the engine stalls: a warning with the next actions ['+G.guide.note+' | '+ids()+']');
  st.engineOn=true; st.stalled=false; st.rpm=900; step(60*7); check(G.guide.note===''&&ids().startsWith('GAS'),'… and the lesson is back once the engine runs again ['+ids()+']');
  st.t=1e3; st.s=1e6; step(3); check(!st.complete&&G.guide.hold,'the tutorial holds the finish line while it is open');
  G.setGuide({}); step(3); check(!G.guide.hold&&st.complete,'… and lets the ride complete once it is closed'); fire('keyup','ShiftLeft'); }
// the free LEVELS (trips.js free-1/2/3) and FORKS (net/patterns.js FORK): the easy run is four lanes without a junction; a fork's two roads meet again where
// they parted, so switching roads changes nothing after the merge; crossing the commit point on the other road's side switches the spine and keeps the truck in place
{ const F=G.forkRules; G.setGuide({}); G.setTrip('free-1'); G.roads.newTrip(777); net.ensure(6000);
  check(net.near(0,6000).filter(j=>j.kind!=='start').length===0&&net.segs.every(g=>g.pat==='dual')&&net.lanes(net.Sm+500,1)===2,'free-1 (EASY): four lanes, no junction in 6 km');
  G.setTrip('free-2'); G.startRide(); G.roads.newTrip(4242); net.ensure(6000); const f=net.forks[0];   // (startRide first: it re-seeds the road)
  check(!!f&&Math.abs(f.f1-f.f0-F.len)<1e-6&&net.near(f.f0,f.f1).length===0,'free-2 (CROSSROADS): a fork early on, no junction inside it');
  if(f){ const a=net.world(f.f1+60,0), mid=net.sep((f.f0+f.f1)/2); net.setChoice(f,1); const b=net.world(f.f1+60,0); net.setChoice(f,0);
    check(Math.hypot(a.x-b.x,a.z-b.z)<1e-3&&mid>150,'a fork closes: the road after the merge is where it was ('+Math.hypot(a.x-b.x,a.z-b.z).toExponential(1)+' m), the roads '+mid.toFixed(0)+' m apart in the middle');
    st.park=false; st.engineOn=true; st.keyOn=true; const c=f.f0+F.commit, side=-net.bulge(f);
    Object.assign(st,{s:c-3,d:side*(net.sep(c-3)*.75),psi:0,v:8,gear:3,hull:100}); G.roads.lastS=st.s;
    const w0=net.world(st.s,st.d); for(let i=0;i<30&&st.s<c+2;i++){ st.s+=.25; G.roads.update(1/60); }
    const w1=net.world(st.s,st.d);
    check(f.choice===1&&Math.abs(st.d)<6&&Math.hypot(w1.x-w0.x,w1.z-w0.z)<12,'crossing the commit point on the other road\'s side switches roads and keeps the truck where it is (d '+st.d.toFixed(2)+')');
    check(net.onRoad(c-40,-net.bulge(f)*net.sep(c-40))&&net.onRoad(c-40,0)&&!net.onRoad(c+400,-net.bulge(f)*net.sep(c+400)/2),'the split apron is road on both roads (past it, the ground between them is not)');
    st.mode='done'; }
  G.setTrip('1h'); G.roads.newTrip(); }
// traffic around the truck (sim/traffic.js): an oncoming overtaker on a 1+1 road never pulls into the lane the truck is crawling down; a car pinned against the
// truck's nose is ONE crash (st.crashV) and one bump's worth of hull, not one every 0.8 s
{ G.setGuide({}); G.st.mode='done'; G.startRide(); st.park=false; st.engineOn=true; st.keyOn=true;
  const one=s=>net.lanes(s,1)===1&&net.lanes(s,-1)===1; let s0=null;
  for(let s=net.Sm+600;s<net.Sm+40000&&s0===null;s+=50){ let ok=!net.near(s-100,s+700).some(j=>j.kind!=='start')&&!(net.forksNear?.(s-100,s+700)||[]).length; for(let x=s-50;ok&&x<s+700;x+=25) ok=one(x); if(ok) s0=s; }
  check(s0!==null,'a 1+1 stretch without junctions for the traffic checks'+(s0!==null?' at '+s0.toFixed(0)+' m':''));
  if(s0!==null){ const hold=v=>{ st.d=2.4; st.psi=0; st.v=v; };
    Object.assign(st,{s:s0,d:2.4,psi:0,v:3,hull:100,crashV:0}); G.roads.lastS=st.s; step(2); G.traffic.length=0;
    const slow=G.spawn('sedan','slow','oncoming',260,-2.4), fast=G.spawn('sedan','overtake','oncoming',310,-2.4); let worst=Infinity, pulled=false;
    if(slow&&fast){ for(let i=0;i<60*25&&st.mode==='drive';i++){ hold(3); step(1);
      for(const a of G.traffic) if(a.road.main&&a.dir<0&&a.lat>-.6){ pulled=true; const ahead=a.s-st.s; if(ahead>-5) worst=Math.min(worst,ahead); } } }
    check(!!slow&&!!fast&&st.crashV===0&&worst>80,'an oncoming overtaker keeps out of the truck\'s lane near it (closest '+(worst===Infinity?'never in it':worst.toFixed(0)+' m')+', pulled out: '+pulled+', crashes '+st.crashV+')');
    Object.assign(st,{s:s0+150,d:2.4,psi:0,v:1,hull:100,crashV:0}); G.roads.lastS=st.s; step(2); G.traffic.length=0;
    const fire=G.spawn('fire','emergency','oncoming',20,2.4);
    if(fire){ for(let i=0;i<60*6&&st.mode==='drive';i++){ hold(1); Object.assign(fire,{s:st.s+3.3+fire.def.len/2-.3,lat:2.4,v:0,lv:0}); step(1); } }
    check(!!fire&&st.crashV===1&&100-st.hull<1.5&&st.mode==='drive','a vehicle pinned against the truck for 6 s is one crash (crashV '+st.crashV+', hull −'+(100-st.hull).toFixed(2)+' %)'); }
  st.mode='done'; }
// one pool, one ride (the server gives every rider of a pool its seed): the same seed starts the trip among the same cars, whatever the last trip left behind
{ const cars=()=>{ st.s=0; G.roads.newTrip(12345); return G.traffic.map(a=>a.preset+a.pick+'@'+a.s.toFixed(2)+'/'+a.lat.toFixed(2)+'>'+a.vDes.toFixed(2)).join(' '); };
  const t1=cars(), t2=cars(); check(t1!==''&&t1===t2,'same seed -> same starting traffic ('+G.traffic.length+' cars)'); }
out.push(...checks); out.push('errors='+errors.length+(errors[0]?' '+errors[0].message:''));
console.log(out.join('\n'));
const failed=checks.filter(c=>c.startsWith('FAIL'));
if(errors.length||failed.length){ console.log('FAILED: '+(errors.length?'uncaught exceptions':failed.length+' check(s)')); process.exit(1); }
process.exit(0);   // the game's timers (toasts, radio) would keep node alive
