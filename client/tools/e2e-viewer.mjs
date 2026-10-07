// Real-Chrome check of viewer.html: loads every catalogue item, fails on any exception, drives orbit/zoom/pan with synthetic input, saves screenshots.
//   node tools/e2e-viewer.mjs [url]      default http://localhost:8765/viewer.html (run ./serve.sh first); env: CHROME, SHOTS (default <tmp>/fc-viewer-shots)
import { launch, sleep } from './cdp.mjs';
const PORT=+process.env.PORT||9334, URL=process.argv[2]||'http://localhost:8765/viewer.html';
const { send, ev, shot, problems, SHOTS, finish } = await launch({ port: PORT, shotsDir: 'fc-viewer-shots' });
const mouse=(type,x,y,extra={})=>send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1,...extra});
await send('Page.navigate',{url:URL}); await sleep(3000);
console.log('viewer:',await ev('typeof window.__viewer'),'| items:',await ev('__viewer.items.length'));
if(await ev('typeof window.__viewer')==='object'){
  const ids=await ev('__viewer.items.map(i=>i.id)'); const bad=[];
  for(const i of ids){ const r=await ev(`(()=>{try{__viewer.select('${i}');const b=new (Object.getPrototypeOf(__viewer.obj).constructor)();return __viewer.obj.children.length}catch(e){return 'ERR '+e.message}})()`); if(typeof r==='string') bad.push(i+': '+r); await sleep(30); }
  console.log('selected all', ids.length, 'items; failures:', bad.length?bad:'none');
  const pick=async(i,n)=>{ await ev(`__viewer.select('${i}')`); await sleep(400); await shot(n); };
  await pick('veh-bus-0','01-bus'); await pick('veh-police-0','02-police'); await pick('route66-cactus1','03-cactus'); await pick('siberia-spruce','04-spruce'); await pick('route66-gantry','05-gantry'); await pick('brenner-guardrail_segment','06-guardrail');
  // input: drag-rotate, wheel zoom, shift-drag pan on the bus
  await ev(`__viewer.select('veh-bus-0')`); await sleep(300); const c0=await ev('JSON.stringify({yaw:__viewer.cam.yaw,pitch:__viewer.cam.pitch,dist:__viewer.cam.dist,tx:__viewer.cam.target.x})');
  await mouse('mousePressed',700,300); await mouse('mouseMoved',800,260); await mouse('mouseReleased',800,260); const c1=await ev('JSON.stringify({yaw:__viewer.cam.yaw,pitch:__viewer.cam.pitch})');
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:700,y:300,deltaX:0,deltaY:-300}); const c2=await ev('__viewer.cam.dist');
  await mouse('mousePressed',700,300,{modifiers:8}); await mouse('mouseMoved',760,300,{modifiers:8}); await mouse('mouseReleased',760,300,{modifiers:8}); const c3=await ev('__viewer.cam.target.x');
  console.log('before',c0,'\nafter rotate',c1,'\nafter wheel dist',c2,'\nafter shift-pan target.x',c3); await sleep(300); await shot('07-after-input');
}
const p=problems.filter(x=>!/favicon/.test(x)); console.log(p.length?'PROBLEMS:\n'+p.join('\n'):'no errors'); console.log('screenshots in',SHOTS);
finish(p.length?1:0);
