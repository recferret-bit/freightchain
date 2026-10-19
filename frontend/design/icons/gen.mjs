// Generates 10 Freight Chain icon concepts as SVG (512 viewBox) + a picker page. Palette = the landing's (css in landing/src/style.css).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || new URL('.', import.meta.url).pathname;   // default: this folder (design/icons)
mkdirSync(OUT, { recursive: true });

const P = { ink: '#0b0a09', coal: '#26221d', ash: '#4a453b', stone: '#9d957f', sand: '#e8e2cf', bone: '#f4f1e8', amber: '#ffcf5a', orange: '#ffb03a', rust: '#b34a00', bark: '#7a4a00', dusk: '#1b0f2e', sol1: '#9945FF', sol2: '#14F195', green: '#4f9f55', mint: '#9fd89f' };
const svg = (inner, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs ? `<defs>${defs}</defs>` : ''}${inner}</svg>`;
const sq = (fill) => `<rect width="512" height="512" rx="112" fill="${fill}"/>`;   // iOS-ish squircle radius
const CLIP = `<clipPath id="c"><rect width="512" height="512" rx="112"/></clipPath>`;

const icons = [
  { id: 'horizon', name: 'Horizon', note: 'Road to a setting sun. The classic app-icon read.', svg: svg(`
    <g clip-path="url(#c)">
      <rect width="512" height="512" fill="url(#sky)"/>
      <circle cx="256" cy="262" r="96" fill="${P.amber}"/>
      <rect y="262" width="512" height="250" fill="${P.coal}"/>
      <polygon points="256,262 40,512 472,512" fill="${P.ash}"/>
      <polygon points="256,262 220,512 292,512" fill="${P.ash}"/>
      <g fill="${P.amber}"><polygon points="252,300 260,300 262,322 250,322"/><polygon points="248,345 264,345 268,385 244,385"/><polygon points="241,420 271,420 278,512 234,512"/></g>
    </g>`, CLIP + `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.dusk}"/><stop offset=".55" stop-color="${P.rust}"/><stop offset=".62" stop-color="${P.orange}"/></linearGradient>`) },

  { id: 'cab', name: 'Cab', note: 'The semi head-on: windscreen, grille, two headlamps, stacks.', svg: svg(`
    ${sq(P.ink)}
    <rect x="58" y="128" width="26" height="270" rx="6" fill="${P.stone}"/><rect x="428" y="128" width="26" height="270" rx="6" fill="${P.stone}"/>
    <rect x="96" y="150" width="320" height="256" rx="28" fill="${P.coal}"/>
    <g fill="${P.amber}"><circle cx="176" cy="138" r="8"/><circle cx="216" cy="138" r="8"/><circle cx="256" cy="138" r="8"/><circle cx="296" cy="138" r="8"/><circle cx="336" cy="138" r="8"/></g>
    <rect x="124" y="170" width="264" height="88" rx="14" fill="${P.ash}"/>
    <path d="M140 182h120l-40 64h-80z" fill="${P.stone}" opacity=".35"/>
    <rect x="156" y="282" width="200" height="66" rx="8" fill="${P.ink}"/>
    <g fill="${P.stone}"><rect x="172" y="292" width="10" height="46"/><rect x="200" y="292" width="10" height="46"/><rect x="228" y="292" width="10" height="46"/><rect x="256" y="292" width="10" height="46"/><rect x="284" y="292" width="10" height="46"/><rect x="312" y="292" width="10" height="46"/></g>
    <circle cx="128" cy="314" r="26" fill="${P.amber}"/><circle cx="128" cy="314" r="12" fill="${P.orange}"/>
    <circle cx="384" cy="314" r="26" fill="${P.amber}"/><circle cx="384" cy="314" r="12" fill="${P.orange}"/>
    <rect x="86" y="366" width="340" height="40" rx="10" fill="${P.stone}"/>`) },

  { id: 'chainroad', name: 'Chain Road', note: 'The lane dashes are chain links shrinking to the horizon.', svg: svg(`
    ${sq(P.ink)}
    <circle cx="256" cy="196" r="70" fill="${P.rust}"/>
    <rect y="196" width="512" height="316" fill="${P.ink}" clip-path="url(#c)"/>
    <polygon points="256,196 60,512 452,512" fill="${P.coal}" clip-path="url(#c)"/>
    <g fill="none" stroke="${P.amber}" stroke-linejoin="round">
      <rect x="208" y="368" width="96" height="144" rx="48" stroke-width="26" clip-path="url(#c)"/>
      <rect x="228" y="292" width="56" height="80" rx="28" stroke-width="16"/>
      <rect x="241" y="246" width="30" height="42" rx="15" stroke-width="9"/>
      <rect x="249" y="222" width="14" height="20" rx="7" stroke-width="4"/>
    </g>`, CLIP) },

  { id: 'hexfc', name: 'Hex FC', note: 'A badge: hexagon + FC monogram built from blocks, no font.', svg: svg(`
    ${sq(P.ink)}
    <polygon points="256,56 436,156 436,356 256,456 76,356 76,156" fill="none" stroke="${P.amber}" stroke-width="22" stroke-linejoin="round"/>
    <polygon points="256,96 400,176 400,336 256,416 112,336 112,176" fill="${P.coal}"/>
    <g fill="${P.sand}"><rect x="150" y="178" width="46" height="158"/><rect x="150" y="178" width="118" height="42"/><rect x="150" y="240" width="96" height="38"/></g>
    <path d="M378 304 A64 64 0 1 1 378 208" fill="none" stroke="${P.amber}" stroke-width="46"/>`) },

  { id: 'container', name: 'Container', note: 'The trailer, side on, with a chain stripe. Freight first.', svg: svg(`
    ${sq(P.sand)}
    <circle cx="420" cy="104" r="40" fill="${P.orange}"/>
    <rect x="76" y="158" width="360" height="196" rx="14" fill="${P.rust}"/>
    <g fill="${P.bark}" opacity=".55"><rect x="110" y="172" width="8" height="168"/><rect x="150" y="172" width="8" height="168"/><rect x="190" y="172" width="8" height="168"/><rect x="230" y="172" width="8" height="168"/><rect x="270" y="172" width="8" height="168"/><rect x="310" y="172" width="8" height="168"/><rect x="350" y="172" width="8" height="168"/><rect x="390" y="172" width="8" height="168"/></g>
    <g fill="none" stroke="${P.sand}" stroke-width="12"><rect x="100" y="238" width="52" height="36" rx="18"/><rect x="178" y="238" width="52" height="36" rx="18"/><rect x="256" y="238" width="52" height="36" rx="18"/><rect x="334" y="238" width="52" height="36" rx="18"/></g>
    <rect x="76" y="354" width="360" height="18" fill="${P.coal}"/>
    <g fill="${P.ink}"><circle cx="318" cy="392" r="30"/><circle cx="388" cy="392" r="30"/><rect x="112" y="372" width="18" height="40"/></g>
    <g fill="${P.stone}"><circle cx="318" cy="392" r="11"/><circle cx="388" cy="392" r="11"/></g>`) },

  { id: 'wheel', name: 'Wheel & Sun', note: 'Steering wheel with the sun for a hub. Reads at 16 px.', svg: svg(`
    ${sq(P.ink)}
    <circle cx="256" cy="256" r="166" fill="none" stroke="${P.amber}" stroke-width="46"/>
    <g stroke="${P.amber}" stroke-width="40" stroke-linecap="round"><line x1="256" y1="256" x2="256" y2="120"/><line x1="256" y1="256" x2="138" y2="324"/><line x1="256" y1="256" x2="374" y2="324"/></g>
    <circle cx="256" cy="256" r="70" fill="${P.orange}"/><circle cx="256" cy="256" r="30" fill="${P.rust}"/>`) },

  { id: 'flat', name: 'Flat Sun', note: 'Two colours, one shape. The most minimal; strongest at avatar size.', svg: svg(`
    ${sq(P.sand)}
    <circle cx="256" cy="214" r="124" fill="${P.rust}"/>
    <polygon points="256,214 112,512 400,512" fill="${P.ink}" clip-path="url(#c)"/>
    <g fill="${P.sand}" clip-path="url(#c)"><polygon points="252,300 260,300 263,338 249,338"/><polygon points="246,372 266,372 272,430 240,430"/><polygon points="236,462 276,462 284,512 228,512"/></g>`, CLIP) },

  { id: 'solana', name: 'Solana Road', note: 'Same road, lane markings in the Solana gradient. Says crypto.', svg: svg(`
    ${sq(P.ink)}
    <g clip-path="url(#c)">
      <ellipse cx="256" cy="206" rx="300" ry="120" fill="url(#glow)"/>
      <polygon points="256,206 36,512 476,512" fill="${P.coal}"/>
      <polygon points="256,206 36,512 70,512" fill="url(#lane)"/><polygon points="256,206 442,512 476,512" fill="url(#lane)"/>
      <g fill="url(#lane)"><polygon points="252,250 260,250 263,286 249,286"/><polygon points="246,320 266,320 273,380 239,380"/><polygon points="234,420 278,420 290,512 222,512"/></g>
    </g>`, CLIP + `<radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${P.sol1}" stop-opacity=".9"/><stop offset="1" stop-color="${P.sol1}" stop-opacity="0"/></radialGradient><linearGradient id="lane" x1="0" y1="206" x2="0" y2="512" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${P.sol1}"/><stop offset="1" stop-color="${P.sol2}"/></linearGradient>`) },

  { id: 'sunset', name: 'Sunset Rig', note: 'Truck and trailer in silhouette, round crop. Avatar-native.', svg: svg(`
    <g clip-path="url(#r)">
      <rect width="512" height="512" fill="url(#sun)"/>
      <circle cx="256" cy="286" r="118" fill="${P.amber}"/>
      <rect y="378" width="512" height="140" fill="${P.coal}"/>
      <g fill="${P.ink}">
        <rect x="98" y="238" width="236" height="112" rx="8"/>
        <path d="M334 350V266h44l40 34v50z"/>
        <rect x="372" y="300" width="56" height="50"/>
        <rect x="334" y="300" width="100" height="14"/>
        <circle cx="140" cy="356" r="22"/><circle cx="190" cy="356" r="22"/><circle cx="300" cy="356" r="22"/><circle cx="350" cy="356" r="22"/><circle cx="406" cy="356" r="22"/>
      </g>
      <rect y="378" width="512" height="6" fill="${P.ash}"/>
    </g>`, `<clipPath id="r"><circle cx="256" cy="256" r="256"/></clipPath><linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.dusk}"/><stop offset=".45" stop-color="${P.rust}"/><stop offset=".7" stop-color="${P.orange}"/></linearGradient>`) },

  { id: 'pixel', name: 'Pixel Rig', note: '16×16 pixel truck on sand. A Desert Bus (1995) nod.', svg: (() => {
    const rows = [
      '...........OO...', '..........OOOO..', '..........OOOO..', '...........OO...',
      '......RRRRRRRRR.', '......RRRRRRRRR.', '..KKKKKRRRRRRRR.', '..KAAKKRRRRRRRR.',
      '..KAAKKRRRRRRRR.', '.KKKKKKRRRRRRRR.', '.KOKKKKKKKKKKKK.', '..KK...KK.KK....',
      '..KK...KK.KK....', 'GGGGGGGGGGGGGGGG', '................', '................'];
    const col = { O: P.orange, R: P.rust, K: P.coal, A: P.amber, G: P.stone };
    let px = '';
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (col[ch]) px += `<rect x="${x * 32}" y="${y * 32}" width="32" height="32" fill="${col[ch]}"/>`; }));
    return svg(`${sq(P.sand)}<g clip-path="url(#c)" shape-rendering="crispEdges">${px}</g>`, CLIP);
  })() },
];

for (const i of icons) writeFileSync(join(OUT, `${i.id}.svg`), i.svg + '\n');
writeFileSync(join(OUT, 'icons.json'), JSON.stringify(icons.map(({ id, name, note }) => ({ id, name, note })), null, 2));
console.log(icons.map((i) => i.id).join(' '));
