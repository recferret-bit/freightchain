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
class El{constructor(id){this.id=id;this.style={};this.classList={add(){},remove(){},toggle(){}};this.textContent='';this.innerHTML='';}getContext(){return ctxStub;}click(){this.onclick&&this.onclick();} querySelectorAll(){return [];} querySelector(){return new El('q');} addEventListener(){} appendChild(){}}
const els={}; globalThis.document={getElementById:id=>els[id]??=new El(id),createElement:()=>new El('x'),addEventListener:(k,f)=>(listeners['doc:'+k]??=[]).push(f),body:{style:{},appendChild(){}},hidden:false};
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
snap('end');
// launch with the SHIPPED handling (not the old values above): clutch in, gear, gas, release the clutch, 5 s later the truck must be rolling (no gas / 6th = stall)
Object.assign(G.CFG.TRUCK,TRUCK0); G.selectTheme('route66',false);
for(const [gear,gas,temp,want] of [[1,1,null,1],[1,1,-22,1],[2,1,null,1],[1,0,null,0],[6,1,null,0]]){
  G.st.mode='done'; G.startRide(); st.park=false; if(temp!==null)st.temp=temp; fire('keydown','KeyI'); step(60*2.6);
  fire('keydown','ShiftLeft'); step(20); fire('keydown','Digit'+gear); step(60); if(gas)fire('keydown','KeyW'); step(20); const T0=st.temp; fire('keyup','ShiftLeft'); step(60*5); fire('keyup','KeyW');
  const ok=want?st.engineOn&&st.v>2:!st.engineOn; out.push(`launch g${gear} gas=${gas} T=${T0.toFixed(0)} °C at release  v=${st.v.toFixed(2)} rpm=${st.rpm.toFixed(0)} eng=${st.engineOn}`);
  check(ok,`launch in gear ${gear} ${gas?'with':'without'} gas${temp!==null?' at '+temp+' °C':''} ${want?'pulls away':'stalls'}`); }
// brakes need the engine (dead pedal with the engine off); the parking brake (B) works without it and holds against thrust
G.Wallet.set(100); G.st.mode='done'; G.startRide(); st.park=false;
Object.assign(st,{s:net.Sm+300,d:2.4,psi:0,v:15,gear:0,engineOn:false,keyOn:false,hull:100}); input.brake=1; step(60*3); const vDead=st.v; input.brake=0;
check(vDead>13,'engine off: the brake pedal does nothing (v '+vDead.toFixed(1)+' after 3 s of full brake)');
fire('keydown','KeyB'); step(60*3); check(st.park&&st.v===0,'parking brake stops the truck with the engine off');
fire('keydown','KeyB'); check(!st.park,'B again releases the parking brake');
Object.assign(st,{v:0,gear:1,engineOn:true,rpm:2000,clutch:0,slip:false,park:true}); input.gas=1; step(60*3); input.gas=0; check(st.v<.05,'parking brake holds the truck against 1st gear at full gas (v '+st.v.toFixed(2)+')');
// clutch in while rolling in 6th with the gas still held: the revs fall away from where they were, they must not flare to the redline
fire('keyup','ShiftLeft'); G.Wallet.set(100); G.st.mode='done'; G.startRide(); st.park=false; st.temp=G.CFG.ENGINE_WARM+5; fire('keydown','KeyI'); step(60*2.6);
Object.assign(st,{s:net.Sm+300,d:2.4,psi:0,hull:100,gear:6,v:60/3.6,clutch:0,slip:false,park:false}); st.rpm=st.v*1.065*106.67; st.freeRpm=st.rpm; input.gas=1; for(let i=0;i<180;i++){ st.d=2.4; st.psi=0; step(1); }
const rpmBefore=st.rpm; fire('keydown','ShiftLeft'); let rpmPeak=0; for(let i=0;i<90;i++){ st.d=2.4; st.psi=0; step(1); rpmPeak=Math.max(rpmPeak,st.rpm); } fire('keyup','ShiftLeft'); input.gas=0;
check(rpmPeak<rpmBefore+150,'clutch in at speed with the gas held: revs do not flare ('+rpmBefore.toFixed(0)+' → peak '+rpmPeak.toFixed(0)+')');
// driving against the parking brake (gear in, clutch out, gas held): the brakes heat up, the drivetrain strains and finally gives out; letting go in time recovers
const fightRide=(releaseAt)=>{ fire('keyup','ShiftLeft'); input.gas=0; input.brake=0; G.Wallet.set(100); G.st.mode='done'; G.startRide(); st.park=false; st.temp=G.CFG.ENGINE_WARM+5; fire('keydown','KeyI'); step(60*2.6);
  Object.assign(st,{s:net.Sm+300,d:2.4,psi:0,hull:100,v:0}); fire('keydown','ShiftLeft'); step(20); fire('keydown','Digit1'); step(30); fire('keydown','KeyB'); input.gas=1; fire('keyup','ShiftLeft');
  let peakHeat=0; for(let i=1;i<=60*14&&st.mode==='drive';i++){ st.d=2.4; st.psi=0; step(1); peakHeat=Math.max(peakHeat,st.brakeT); if(releaseAt&&i===releaseAt*60){ fire('keydown','ShiftLeft'); input.gas=0; } }
  input.gas=0; fire('keyup','ShiftLeft'); return { ended: st.mode!=='drive', why: st.blownWhy, peakHeat, strain: st.strain }; };
const stuck=fightRide(0); check(stuck.ended&&stuck.why==='brakes'&&stuck.peakHeat>.5,'driving against the parking brake: brakes overheat ('+stuck.peakHeat.toFixed(2)+') and the drivetrain gives out');
const freed=fightRide(3); check(!freed.ended&&freed.strain<.1,'clutch in after 3 s against the parking brake: no failure, strain recovers ('+freed.strain.toFixed(2)+')');
// battery: the starter costs charge, consumers flatten it with the engine off (then lights/radio/heater cut out and the engine won't start), the alternator refills it
const batFresh=()=>{ fire('keyup','ShiftLeft'); input.gas=0; input.brake=0; G.Wallet.set(100); G.st.mode='done'; G.startRide(); st.park=false; st.temp=G.CFG.ENGINE_WARM+5; Object.assign(st,{s:net.Sm+300,d:2.4,psi:0,hull:100,v:0}); };
batFresh(); const b0=st.batt; fire('keydown','KeyI'); step(60*2.6); check(st.engineOn&&b0-st.batt>.04&&b0-st.batt<.15,'starting the engine costs battery charge ('+(b0-st.batt).toFixed(3)+')');
batFresh(); G.dn.head=true; if(!G.radio.on) fire('keydown','KeyT'); st.keyOn=true; st.heater=true; step(60*200);
check(st.battDead&&!G.dn.head&&!st.heater&&!G.radio.on,'engine off, everything on: the battery goes flat and lights / radio / heater cut out');
fire('keydown','KeyI'); step(60); check(!st.engineOn&&!st.ign,'a flat battery will not crank the engine');
batFresh(); st.batt=.5; fire('keydown','KeyI'); step(60*2.6); const bRun=st.batt; Object.assign(st,{gear:6,v:60/3.6,clutch:0,slip:false}); st.rpm=st.v*1.065*106.67; input.gas=1; for(let i=0;i<60*30;i++){ st.d=2.4; st.psi=0; step(1); } input.gas=0;
check(st.batt>bRun+.03,'engine running at cruise: the alternator refills the battery ('+bRun.toFixed(2)+' → '+st.batt.toFixed(2)+')');
// cab light: only with the engine running (or starting); it goes out when the engine stops
batFresh(); fire('keydown','KeyC'); check(!G.dn.cab,'cab light refuses to switch on with the engine off');
fire('keydown','KeyI'); step(60*2.6); fire('keydown','KeyC'); check(st.engineOn&&G.dn.cab,'cab light switches on once the engine runs');
fire('keydown','KeyO'); step(30); check(!st.engineOn&&!G.dn.cab,'engine off: the cab light goes out');
// what the lobby's live feed and Night Owl read from every heartbeat: follows the RUNNING clock (not the last press of N), and the route is a real theme id
G.dn.run=false; G.setClock(23,true,false); step(60); const nightX=G.online.extra(); G.setClock(12,true,false); step(60); const dayX=G.online.extra();
check(nightX.night===true&&dayX.night===false&&G.THEMES.some(t=>t.id===dayX.route),'heartbeat extras follow the clock: night at 23:00 ('+nightX.night+'), day at 12:00 ('+dayX.night+'), route '+dayX.route);
// cosmetics (promo wardrobe): the CLASSIC cabin draws exactly the colours the cockpit always had; junk values fall back; every cabin draws without an exception
{ const C=G.cosmetics, cab=()=>C.look('cabin'); C.setLoadout(null);
  const c=cab();
  check(c.interior.join()==='#26221d,#0c0a08'&&c.frame==='#3d372f'&&c.dash.join()==='#4b473f,#27241f,#14120f,#0a0908'&&c.dashEdge==='#5a554a'&&c.binnacle==='#0b0a08'&&c.binnacleEdge==='#34302a','classic cabin: the original interior, window frame, dashboard and instrument housing');
  check(c.hood.top==='#b0281f'&&c.hood.bottom==='#6e130f'&&c.hood.fender==='#5c120e'&&c.hood.line==='rgba(255,200,190,.35)','classic cabin: the original red hood');
  check(c.wheel.rim==='#0e0d0b'&&c.wheel.sheen==='#2b2722'&&c.wheel.spoke==='#1b1814'&&c.wheel.hub==='#26221d'&&c.wheel.mark==='#ffcf5a'&&c.shifter.knob==='#17150f'&&c.shifter.rim==='#555'&&c.shifter.boot==='#0c0b0a'&&c.shifter.lever===null&&c.shifter.text==='#e8e2cf','classic cabin: the original steering wheel and shifter');
  C.setLoadout({cabin:'noir',seat:'x'}); check(C.loadout.cabin==='noir'&&!('seat' in C.loadout),'a loadout keeps a known cabin and drops what it does not know');
  C.setLoadout({cabin:'<script>'}); check(C.loadout.cabin==='classic','a junk cabin falls back to the classic one');
  let worn=0; for(const item of C.COSMETICS.cabin){ C.setLoadout({cabin:item}); step(2); worn++; }
  C.setLoadout(null); check(worn>=6&&errors.length===0,'every cabin draws without an exception ('+worn+' worn)'); }
out.push(...checks); out.push('errors='+errors.length+(errors[0]?' '+errors[0].message:''));
console.log(out.join('\n'));
const failed=checks.filter(c=>c.startsWith('FAIL'));
if(errors.length||failed.length){ console.log('FAILED: '+(errors.length?'uncaught exceptions':failed.length+' check(s)')); process.exit(1); }
process.exit(0);   // the game's timers (toasts, radio) would keep node alive
