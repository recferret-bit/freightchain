import { sleep } from './cdp.mjs';

/** Normal input for the OS. Only the explicitly marked station/toll/SMS sections inject scenario fixtures. */
export async function phoneControls({ tab, check, tap, until }) {
  const ev = async source => { const value = await tab.ev(source); if (typeof value === 'string' && /^(SyntaxError|ReferenceError|TypeError):/.test(value)) throw new Error(value); return value; };
  await ev(`(async () => { window.__phoneTest = {
    os: (await import('./js/phone/os.js')).os,
    view: (await import('./js/ui/map/state.js')).view,
    gulp: (await import('./js/phone/gulp-state.js')).gulp,
    pike: (await import('./js/phone/pike-state.js')).pike,
    machine: (await import('./js/minigames/machine.js')).machine
  }; })()`);
  const mouse = (type, x, y) => tab.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const click = async id => {
    await until(`__phoneTest.view.hits.some(h => h.id === ${JSON.stringify(id)})`, `phone hit ${id}`, 5000);
    const p = await ev(`(() => { const v = __phoneTest.view, h = v.hits.find(h => h.id === ${JSON.stringify(id)}), r = v.cv.getBoundingClientRect(); return { x: r.x + (h.x + h.w / 2) * v.k, y: r.y + (h.y + h.h / 2) * v.k }; })()`);
    await mouse('mousePressed', p.x, p.y); await mouse('mouseReleased', p.x, p.y); await sleep(100);
  };
  const home = async () => { if (await ev('!!__game.phone.app')) await tap('Escape'); await until('__game.phone.open && __game.phone.power === 2', 'phone home'); };
  const open = async id => { await home(); await click(`app:${id}`); await until(`__game.phone.app === ${JSON.stringify(id)}`, `open ${id}`); };
  await tap('KeyN'); await until('__game.phone.open && __game.phone.power === 0', 'unpowered phone');
  check('phone remains off until engine starts', await ev('__phoneTest.view.hits.every(h => !h.id.startsWith("app:"))'));
  await tap('KeyN'); await tap('KeyI'); await until('__game.st.engineOn', 'engine restarts for phone');
  await tap('KeyN'); await until('__game.phone.power === 2', 'phone boot reaches home');
  await sleep(1000); check('home stays home instead of opening Maps automatically', await ev('__game.phone.app === null && __game.phone.power === 2'));
  await tab.shot('phone-home');
  const ids = await ev("import('./js/phone/catalog.js').then(m => m.APPS.map(a => a.id))");
  for (const id of ids) { await open(id); check(`phone launcher opens ${id}`, await ev('__game.phone.power === 3')); }
  await open('maps');
  const zoom = await ev('__phoneTest.view.z'); await click('in');
  check('Maps zoom responds to a screen click', await ev(`__phoneTest.view.z !== ${JSON.stringify(zoom)}`));
  const rect = await ev('(() => { const r = __phoneTest.view.cv.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()');
  await mouse('mousePressed', rect.x + rect.w / 2, rect.y + rect.h - 12);
  await mouse('mouseMoved', rect.x + rect.w / 2, rect.y + rect.h - 120);
  await mouse('mouseReleased', rect.x + rect.w / 2, rect.y + rect.h - 120);
  await until('__game.phone.power === 2', 'bottom swipe goes home');
  check('bottom swipe returns an app to the launcher', await ev('__game.phone.app === null'));

  // Observe rendered Messages text, not the private payment state, when reading its local four-digit code.
  await ev(`__phoneTest.text = []; __phoneTest.fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      if (this.canvas === __phoneTest.view.cv) { __phoneTest.text.push(String(text)); if (__phoneTest.text.length > 300) __phoneTest.text.splice(0, 150); }
      return __phoneTest.fillText.call(this, text, ...args);
    };`);
  const readCode = async () => {
    await open('chat'); await ev('__phoneTest.text = []'); await sleep(150);
    const code = await ev('__phoneTest.text.find(s => /^\\d{4}$/.test(s))');
    if (!code) throw new Error('Messages did not render a payment code');
    return code;
  };
  const type = async value => { for (const digit of value) await tap(`Digit${digit}`); };

  // Station location/resource fixtures: normal UI still decides the purchase and mutates fuel/repair.
  const bay = await ev("import('./js/ui/map/state.js').then(m => m.places(0, 200).find(p => p.impl === 'gulp-bay')?.s)");
  if (typeof bay !== 'number') throw new Error('seeded depot GULP bay missing');
  await ev(`__game.st.s = ${bay}; __game.st.tankBonus = -.3; __game.st.mend = 0; __game.st.scratches = [{ x: .2, y: .2, pts: [[0, 0], [.05, .03]], a: .4 }];`);
  await until('__phoneTest.gulp.at && __phoneTest.gulp.phase === "pick"', 'station location fixture');
  await open('gulp'); await click('gulp:send');
  check('GULP refuses to send without selecting a service', await ev('__phoneTest.gulp.phase === "pick"'));
  await click('gulp:fill'); await click('gulp:body'); await click('gulp:send');
  const gulpCode = await readCode(); await tab.shot('phone-gulp-message');
  await open('gulp'); await type(String((Number(gulpCode) + 1) % 10000).padStart(4, '0')); await tap('Enter');
  check('GULP rejects a wrong code without fuel or repairs', await ev('__phoneTest.gulp.wrong && __phoneTest.gulp.phase === "code" && __game.st.tankBonus === -.3 && __game.st.mend === 0'));
  await type(gulpCode); await tap('Enter');
  check('GULP code fills fuel and clears bodywork once', await ev('__phoneTest.gulp.phase === "done" && __game.st.tankBonus > 0 && __game.st.mend === 100 && __game.st.scratches.length === 0'));
  await tab.shot('phone-gulp-paid');

  // Two distinct toll location fixtures exercise the paid-gate/next-gate transition; travel is not shortened evidence.
  for (const gate of [130, 8130]) {
    await ev(`__game.st.s = ${gate - 10}`);
    await until(`__phoneTest.pike.at && __phoneTest.pike.gate === ${gate} && __phoneTest.pike.phase === "pay"`, `PIKE ${gate} is payable`);
    await open('pike'); await click('pike:pay');
    const code = await readCode(); await open('pike');
    await type(String((Number(code) + 1) % 10000).padStart(4, '0')); await tap('Enter');
    check(`PIKE ${gate} wrong code leaves the arm unpaid`, await ev(`__phoneTest.pike.wrong && __phoneTest.pike.paid !== ${gate}`));
    await type(code); await tap('Enter');
    check(`PIKE ${gate} correct code opens this arm`, await ev(`__phoneTest.pike.phase === "open" && __phoneTest.pike.paid === ${gate}`));
    await tab.shot(`phone-pike-${gate}-paid`);
    await ev(`__game.st.s = ${gate + 25}`);
    await until('__phoneTest.pike.phase === "idle"', 'passed paid booth clears against the paid gate');
  }

  // Optional phone-sms renderer fixture: real pictures and input, captured payload only (no server verdict claim).
  await ev(`__phoneTest.originalAnswer = __phoneTest.os.onAnswer;
    const picture = document.createElement('canvas'); picture.width=420; picture.height=120;
    const g=picture.getContext('2d'); g.fillStyle='#fff';g.fillRect(0,0,420,120);g.fillStyle='#000';g.font='28px monospace';g.fillText('Dispatch: enter 4826',12,65);
    __phoneTest.machine.send('arm');__phoneTest.machine.send('open');__phoneTest.machine.send('reveal');
    __phoneTest.os.job={id:'browser-fixture',kind:'phone-sms',phase:'revealed',ui:'list',draft:'',images:new Map([['dispatch-picture',picture]]),layout:{threads:[{id:'dispatch',role:'dispatch',previewAsset:'dispatch-picture',bubbles:[{assetId:'dispatch-picture'}]}],keys:['8','2','6','1','9','4','7','0','3','5'],sendSlot:2},shownAt:performance.now(),windowMs:120000,touched:false};
    __phoneTest.os.onAnswer=answer=>{__phoneTest.answer=answer};`);
  await open('chat'); await click('mg:thread:dispatch');
  check('optional SMS picture opens through Messages', await ev('__phoneTest.os.job.ui === "body" && __phoneTest.os.job.images.get("dispatch-picture").width === 420'));
  await tab.shot('phone-sms-picture'); await click('mg:reply');
  await click('mg:key:4'); await click('mg:key:8'); await click('mg:key:2'); await click('mg:key:9'); await tap('Backspace'); await tap('Digit6');
  check('shuffled SMS keypad and keyboard backspace edit the displayed draft', await ev('__phoneTest.os.job.draft === "4826"'));
  await click('mg:send');
  check('optional SMS sends exactly the entered code through its answer callback', await ev('__phoneTest.answer?.type === "code" && __phoneTest.answer.value === "4826"'));
  await tab.shot('phone-sms-keypad');
  await ev('__phoneTest.os.onAnswer=__phoneTest.originalAnswer;__phoneTest.os.job=null;__phoneTest.machine.send("idle");CanvasRenderingContext2D.prototype.fillText=__phoneTest.fillText');
  await home(); await tap('KeyN'); await tap('KeyO');
  await until('__game.phone.power === 0', 'phone powers down with engine');
}
