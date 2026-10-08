// Real-Chrome capture: serves client/, boots play.html on a virtual clock (lib/clock.js), drives lib/page.js frame by frame and saves one JPEG per video frame.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../../client/tools/cdp.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), CLIENT = path.resolve(here, '../../client');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveClient() {   // tiny static server: the game must be served over http (ES modules); no API needed offline
  const srv = http.createServer((req, res) => {
    const f = path.join(CLIENT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); const ok = f.startsWith(CLIENT) && fs.existsSync(f) && fs.statSync(f).isFile();
    if (!ok) { res.writeHead(404).end(); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// Software GL (SwiftShader, what cdp.mjs forces) z-fights the road ribbon (y .03) against the ground: the asphalt blinks on and off while moving. The real GPU (Metal via ANGLE) does not;
// GPU=0 falls back to software rendering (other OS / no GPU).
const GPU_ARGS = process.env.GPU !== '0' && process.platform === 'darwin' ? ['--use-angle=metal'] : [];

export async function capture(spec, framesDir, { log = console.log, only = null } = {}) {
  fs.rmSync(framesDir, { recursive: true, force: true }); fs.mkdirSync(framesDir, { recursive: true });
  if (!GPU_ARGS.length) log('  WARNING: software GL – the road ribbon z-fights and flashes; use a GPU (macOS: leave GPU unset) for final renders');
  const srv = await serveClient(), port = srv.address().port;
  const { send, ev, filt, finish } = await launch({ port: +process.env.PORT || 9555, shotsDir: 'fc-video', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', ...GPU_ARGS, ...(process.env.EXTRA_ARGS ? process.env.EXTRA_ARGS.split(' ') : []), `--window-size=${spec.width},${spec.height}`], evalProblems: true });
  try {
    await send('Emulation.setDeviceMetricsOverride', { width: spec.width, height: spec.height, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(path.join(here, 'clock.js'), 'utf8') });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/play.html` });
    for (let i = 0; i < 100 && await ev('typeof window.__game') !== 'object'; i++) await sleep(150);
    if (await ev('typeof window.__game') !== 'object') throw new Error('the game did not boot: ' + filt().join(' | '));
    for (let i = 0; i < 5; i++) await ev('__vstep(50)');
    await ev(fs.readFileSync(path.join(here, 'page.js'), 'utf8'));
    await ev(`__dir.init(${JSON.stringify(spec)})`);
    const dtMs = 1000 / spec.fps, n = Math.round(spec.total * spec.fps), t0 = Date.now(); let wrote = 0;
    for (let i = 0; i < n; i++) {
      if (only && (i / spec.fps < only[0] || i / spec.fps >= only[1])) { await ev(`__dir.frame(${i / spec.fps}, ${dtMs})`); continue; }   // still stepped, so state stays right, just not saved
      const info = await ev(`__dir.frame(${i / spec.fps}, ${dtMs})`);
      if (typeof info !== 'object') throw new Error(`frame ${i} failed: ${info}`);
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
      fs.writeFileSync(path.join(framesDir, String(++wrote).padStart(5, '0') + '.jpg'), Buffer.from(shot.data, 'base64'));
      if (i % spec.fps === 0 || process.env.VERBOSE) log(`  t=${(i / spec.fps).toFixed(1)}s ${info.scene} mode=${info.mode} v=${info.v} gear=${info.gear} rpm=${info.rpm} clutch=${info.clutch} slip=${info.slip}  (${((Date.now() - t0) / 1000).toFixed(0)}s elapsed)`);
    }
    const problems = filt(); if (problems.length) log('  page problems:\n    ' + problems.slice(0, 8).join('\n    '));
    return { frames: wrote, problems };
  } finally { srv.close(); setTimeout(() => finish(0), 50); }   // finish() exits the process: run this file as a child (make.mjs does), don't import it into something that still has work to do
}

// CLI (spawned by make.mjs): node lib/capture.mjs <spec.json> <framesDir> [fromSec toSec]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { loadSpec } = await import('./spec.mjs'), spec = loadSpec(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
  const only = process.argv[4] ? [+process.argv[4], +process.argv[5]] : null;
  const r = await capture(spec, process.argv[3], { only }); console.log(`captured ${r.frames} frames`);
}
