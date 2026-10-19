// Builds the shipped icon set from the chosen design (Solana Road) into client/: node design/icons/build-app-icons.mjs
//   client/icons/{icon.svg, icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png, favicon-32.png}  client/favicon.ico  client/manifest.webmanifest
// Needs Chrome (set CHROME=… if it is not in /Applications). The other candidates (Horizon etc.) stay in this folder as SVG + 1024 PNG.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname, out = join(here, '..', '..', 'client');
const CH = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tmp = mkdtempSync(join(tmpdir(), 'fc-icons-'));
mkdirSync(join(out, 'icons'), { recursive: true });

const C = { ink: '#0b0a09', coal: '#26221d', sol1: '#9945FF', sol2: '#14F195' };
const defs = (r) => `<defs><clipPath id="c"><rect width="512" height="512" rx="${r}"/></clipPath><radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${C.sol1}" stop-opacity=".9"/><stop offset="1" stop-color="${C.sol1}" stop-opacity="0"/></radialGradient><linearGradient id="lane" x1="0" y1="206" x2="0" y2="512" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.sol1}"/><stop offset="1" stop-color="${C.sol2}"/></linearGradient></defs>`;
// the road scene, scaled about the centre (k < 1 leaves a safe margin for maskable icons)
const road = (k = 1) => `<g transform="translate(256 256) scale(${k}) translate(-256 -256)"><ellipse cx="256" cy="206" rx="300" ry="120" fill="url(#glow)"/><polygon points="256,206 36,512 476,512" fill="${C.coal}"/><polygon points="256,206 36,512 70,512" fill="url(#lane)"/><polygon points="256,206 442,512 476,512" fill="url(#lane)"/><g fill="url(#lane)"><polygon points="252,250 260,250 263,286 249,286"/><polygon points="246,320 266,320 273,380 239,380"/><polygon points="234,420 278,420 290,512 222,512"/></g></g>`;
const wrap = (r, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs(r)}<rect width="512" height="512" rx="${r}" fill="${C.ink}"/><g clip-path="url(#c)">${body}</g></svg>`;

const full = wrap(112, road());                       // squircle, transparent corners: favicon.svg, 192, 512 (wallets crop it into a circle themselves)
const square = wrap(0, road());                       // full bleed: apple-touch-icon (iOS rounds it)
const maskable = wrap(0, road(0.8));                  // full bleed, content inside the 80 % safe zone (Android adaptive icons)
// tiny sizes: no glow, a fatter road and 3 bold dashes – the glow turns to mud at 16 px
const tiny = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs(96)}<rect width="512" height="512" rx="96" fill="${C.ink}"/><g clip-path="url(#c)"><polygon points="256,120 0,512 512,512" fill="url(#lane)"/><polygon points="256,200 118,512 394,512" fill="${C.coal}"/><g fill="url(#lane)"><polygon points="244,250 268,250 274,310 238,310"/><polygon points="232,350 280,350 292,430 220,430"/><polygon points="214,470 298,470 306,512 206,512"/></g></g></svg>`;

// headless Chrome cannot make a window below ~500 px (it crops instead of scaling), so: render at 1024, then downscale with macOS `sips`
const png = (svg, size, name) => {
  const f = join(tmp, `${name}.svg`), big = join(tmp, `${name}-big.png`), o = join(tmp, `${name}.png`);
  writeFileSync(f, svg);
  execFileSync(CH, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', '--window-size=1024,1024', `--screenshot=${big}`, `file://${f}`], { stdio: 'ignore' });
  execFileSync('sips', ['-z', String(size), String(size), big, '--out', o], { stdio: 'ignore' });
  return readFileSync(o);
};
const put = (rel, buf) => writeFileSync(join(out, rel), buf);

put('icons/icon.svg', full + '\n');
put('icons/icon-512.png', png(full, 512, 'i512'));
put('icons/icon-192.png', png(full, 192, 'i192'));
put('icons/maskable-512.png', png(maskable, 512, 'm512'));
put('icons/apple-touch-icon.png', png(square, 180, 'a180'));
put('icons/favicon-32.png', png(tiny, 32, 't32'));
// favicon.ico = PNG-compressed 16 / 32 / 48 (a PNG-in-ICO is valid since Vista; every browser reads it)
const sizes = [16, 32, 48], pics = sizes.map((s) => png(tiny, s, `t${s}`));
const head = Buffer.alloc(6 + 16 * sizes.length); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let off = head.length;
sizes.forEach((s, i) => { const e = 6 + 16 * i; head[e] = s; head[e + 1] = s; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(pics[i].length, e + 8); head.writeUInt32LE(off, e + 12); off += pics[i].length; });
put('../favicon.ico'.slice(1), Buffer.concat([head, ...pics]));
put('../manifest.webmanifest'.slice(1), JSON.stringify({
  name: 'Freight Chain', short_name: 'Freight Chain', description: 'The road never ends. Your shift does.',
  start_url: '/lobby.html', display: 'standalone', background_color: C.ink, theme_color: C.ink,
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2) + '\n');
rmSync(tmp, { recursive: true, force: true });
console.log('icons written to client/icons, client/favicon.ico, client/manifest.webmanifest');
