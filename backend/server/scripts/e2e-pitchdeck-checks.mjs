// Real deck controls, media and phone layout; physical motion sensors still need a device check.
import { sleep } from '../../../frontend/client/tools/cdp.mjs';
export async function pitchdeckChecks(page, base, check) {
  const until = async source => { for (let i = 0; i < 80; i++) { if (await page.ev(source)) return true; await sleep(100); } return false; };
  const key = async (key, code = key) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code }); await sleep(150); };
  const click = async selector => {
    const box = await page.ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button: 'left', clickCount: 1 });
  };
  const index = () => page.ev('Number(document.querySelector(".slide.on")?.dataset.i)');
  await page.send('Page.navigate', { url: `${base}/pitchdeck.html#1` });
  check('pitch deck opens the first slide', await until('document.querySelector(".slide.on")?.dataset.i === "0"'));
  const total = await page.ev('document.querySelectorAll(".slide").length');
  check('deck has all authored slides', total >= 6);
  await key('ArrowRight'); check('right arrow advances once', await index() === 1);
  await key('ArrowLeft'); check('left arrow returns once', await index() === 0);
  await key(' ', 'Space'); check('space advances once', await index() === 1);
  await key('End'); check('End selects the final slide', await index() === total - 1);
  await key('ArrowRight'); check('next stays bounded at the final slide', await index() === total - 1);
  await key('Home'); await click('#help [data-go="1"]'); check('visible next button advances', await index() === 1);
  await click('#help [data-go="-1"]'); check('visible previous button returns', await index() === 0);
  await key('f', 'KeyF'); check('fullscreen enters from a keyboard gesture', await until('!!document.fullscreenElement'));
  await key('f', 'KeyF'); check('fullscreen exits and updates its label', await until('!document.fullscreenElement && document.getElementById("fs").getAttribute("aria-label") === "Full screen"'));
  let media = true;
  for (let i = 0; i < total; i++) {
    media &&= await until('!!document.querySelector(".slide.on")?.dataset.ready && [...document.querySelectorAll(".slide.on img")].every(i => i.complete && i.naturalWidth > 0)');
    if (i < total - 1) await key('ArrowRight');
  }
  check('all slides hydrate visible images', media);
  await sleep(1200);
  await page.shot('pitchdeck-desktop');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.send('Page.navigate', { url: `${base}/pitchdeck.html?phone=1#1` });
  await until('document.querySelector(".slide.on")?.dataset.i === "0"');
  check('phone loads the touch controls', await until('document.body.classList.contains("touch")'));
  const motion = await page.ev('!document.getElementById("tilt").hidden');
  if (motion) { await click('#tilt-no'); check('phone motion prompt can be declined', await until('document.getElementById("tilt").hidden')); }
  await click('#next'); check('phone next control advances', await index() === 1);
  check('phone layout has no horizontal overflow', await page.ev('document.documentElement.scrollWidth <= innerWidth + 1'));
  await sleep(1200);
  await page.shot('pitchdeck-phone');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  check('portrait phone offers a rotation prompt', await until('!document.getElementById("turn").hidden'));
  await click('#turn-skip'); check('portrait rotation prompt can be dismissed', await until('document.getElementById("turn").hidden'));
  await sleep(1200);
  await page.shot('pitchdeck-portrait');
}
