// Draws every achievement badge (earned + locked SVG, earned PNG) and its NFT metadata from the catalogue in
// server/src/domain/achievements/achievements.ts. Dependency-free; the PNGs are rendered with the local Google Chrome.
//   node design/achievements/generate.mjs            all SVG + metadata + PNG
//   node design/achievements/generate.mjs --no-png   SVG + metadata only (fast iteration)
//   node design/achievements/generate.mjs --only=century-3,free-hard
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const { ACHIEVEMENTS, TIER_NAMES, FAMILY_NAMES } = await import(resolve(ROOT, 'server/src/domain/achievements/achievements.ts'));

const SVG_DIR = join(ROOT, 'client/site/img/achievements');
const OUT = join(HERE, 'out');
const PNG_DIR = join(OUT, 'png');
const META_DIR = join(OUT, 'metadata');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
for (const d of [SVG_DIR, PNG_DIR, META_DIR]) mkdirSync(d, { recursive: true });

const args = process.argv.slice(2);
const NO_PNG = args.includes('--no-png');
const ONLY = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);

/* ---------- palette (landing/src/style.css) ---------- */
const BG = '#0b0a09', PANEL = '#17130f', DASH = '#26221d', AMBER = '#ffcf5a', GEAR = '#ffb03a', NEEDLE = '#ff7a2e', CREAM = '#e8e2cf', DIM = '#9d957f', LCD = '#7cff7c', BLUE = '#4a8fd8';
const FONT = `ui-monospace,'SF Mono',Menlo,Consolas,'Liberation Mono','DejaVu Sans Mono',monospace`;

/** per family: glyph gradient, the horizon glow and the flavour line of the NFT description */
const FAMILY = {
  road: { a: [AMBER, NEEDLE], glow: AMBER, flavour: 'Every haul starts with a single turn of the key. The road has noticed you.' },
  shift: { a: [CREAM, '#b9b19a'], glow: LCD, flavour: 'The clock ran out and the line was crossed. Paperwork stamped, cargo delivered.' },
  night: { a: ['#cfd8ff', '#7d8cff'], glow: '#6f7dff', flavour: 'Headlights, empty asphalt and a radio hiss. The dark is a coworker now.' },
  distance: { a: [NEEDLE, AMBER], glow: NEEDLE, flavour: 'The odometer keeps count even when you stop. Kilometre after kilometre, it adds up.' },
  clean: { a: ['#9ffcff', '#3fc9d8'], glow: '#3fe0e8', flavour: 'Not a dent, not a scratch. The hull came home as pristine as it left.' },
  siberia: { a: ['#e6f6ff', BLUE], glow: BLUE, flavour: 'Ice on the road, frost on the glass, a thousand empty kilometres of white.' },
  solo: { a: ['#ff9a8a', '#e23a2e'], glow: '#ff5a4a', flavour: 'No assist, no net. Just a driver, a wheel and the truth about their reflexes.' },
  licence: { a: [AMBER, GEAR], glow: AMBER, flavour: 'Every free run is a licence of its own. This one is stamped and framed.' },
  medium: { a: [AMBER, GEAR], glow: AMBER, flavour: 'Five minutes of bends, traffic and forks. You know the MEDIUM run by heart.' },
  hard: { a: [NEEDLE, '#e23a2e'], glow: NEEDLE, flavour: 'Thirty minutes without assist. Clearing the HARD run more than once is no accident.' },
  honk: { a: [AMBER, NEEDLE], glow: AMBER, flavour: 'The road paid this one in TEN4. A verified checkpoint, then the mint.' },
  convoy: { a: ['#ff8a1e', '#e07020'], glow: '#ff8a1e', flavour: 'You brought them, and they crossed the line. The convoy carries your name.' },
};

/** the metal of each tier: rim stops, glow and the sheen strength */
const TIERS = [
  { name: 'Bronze', rim: ['#f4c79a', '#c9783a', '#7c3d17', '#d98d4f', '#f7d3ac'], edge: '#5a2b0f', glow: '#d98d4f', ink: '#ffd9b0' },
  { name: 'Silver', rim: ['#ffffff', '#c3cad6', '#7f8896', '#dfe4ec', '#ffffff'], edge: '#454c58', glow: '#cfd8e8', ink: '#f2f5fa' },
  { name: 'Gold', rim: ['#fff3b0', '#ffd24d', '#b97a08', '#ffe27a', '#fff6c9'], edge: '#6e4300', glow: '#ffcf5a', ink: '#ffe9a0' },
  { name: 'Platinum', rim: ['#e8fbff', '#8fe9ff', '#c79bff', '#ff9bd9', '#ffe29a', '#9bffd7', '#e8fbff'], edge: '#34306a', glow: '#b9a6ff', ink: '#f0eaff' },
];
/** a five-pointed star: outer radius R, inner r */
const starPts = (cx, cy, R, r = R * 0.45) => Array.from({ length: 10 }, (_, k) => { const a = ((-90 + 36 * k) * Math.PI) / 180, d = k % 2 ? r : R; return `${r1(cx + d * Math.cos(a))},${r1(cy + d * Math.sin(a))}`; }).join(' ');
/** every badge shows three stars – the level: tier 1 lights one, tier 2 two, tier 3 all three; tier 4 (platinum) lights all three in holographic colour */
const STARS = 3;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n) => Math.round(n * 10) / 10;

/** deterministic PRNG (mulberry32) seeded from a string */
const seeded = (str) => {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const hexPts = (cx, cy, r) => Array.from({ length: 6 }, (_, k) => { const a = ((-90 + 60 * k) * Math.PI) / 180; return `${r1(cx + r * Math.cos(a))},${r1(cy + r * Math.sin(a))}`; }).join(' ');
const star4 = (x, y, r, fill, op = 1) => `<path d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z" fill="${fill}" opacity="${op}"/>`;
/** font size that makes `len` monospace glyphs fit `width` px (a monospace glyph is ~0.6 em wide) */
const fit = (len, width, max) => Math.min(max, Math.floor(width / (Math.max(len, 1) * 0.62)));

/* ---------- glyphs: drawn in a -100..100 box; c = { p primary fill, s light, d dark, k glow circles } ---------- */
const GLYPHS = {
  convoy(c) { // three cabs in echelon
    const cab = (x, y) => `<g transform="translate(${x} ${y})"><rect x="-34" y="-18" width="68" height="36" rx="7" fill="${c.p}"/><rect x="-26" y="-10" width="22" height="14" rx="2" fill="${c.d}"/><circle cx="20" cy="0" r="5" fill="${c.s}"/></g>`;
    return `<g>${cab(-36, 40)}${cab(0, 0)}${cab(36, -40)}</g>`;
  },
  road(c) { // a truck seen head-on
    return `<g>
      ${c.k ? `<circle cx="-54" cy="30" r="30" fill="${c.s}" opacity=".22"/><circle cx="54" cy="30" r="30" fill="${c.s}" opacity=".22"/>` : ''}
      <rect x="-94" y="-100" width="14" height="150" rx="6" fill="${c.s}" opacity=".9"/><rect x="80" y="-100" width="14" height="150" rx="6" fill="${c.s}" opacity=".9"/>
      <rect x="-72" y="-52" width="144" height="116" rx="18" fill="${c.p}"/>
      <rect x="-82" y="-68" width="164" height="22" rx="9" fill="${c.s}" opacity=".92"/>
      <path d="M-58 -36H58L50 8H-50Z" fill="${c.d}"/>
      <path d="M-50 -30H-6L-14 2H-44Z" fill="${c.s}" opacity=".2"/>
      <rect x="-36" y="22" width="72" height="28" rx="6" fill="${c.d}"/>
      ${[-24, -8, 8, 24].map((x) => `<rect x="${x - 2}" y="25" width="4" height="22" rx="2" fill="${c.p}"/>`).join('')}
      <circle cx="-54" cy="30" r="12" fill="${c.s}"/><circle cx="54" cy="30" r="12" fill="${c.s}"/>
      <circle cx="-54" cy="30" r="5" fill="${c.d}" opacity=".35"/><circle cx="54" cy="30" r="5" fill="${c.d}" opacity=".35"/>
      <rect x="-84" y="62" width="168" height="16" rx="7" fill="${c.s}"/>
      <rect x="-68" y="74" width="30" height="30" rx="9" fill="${c.d}" stroke="${c.s}" stroke-width="4"/>
      <rect x="38" y="74" width="30" height="30" rx="9" fill="${c.d}" stroke="${c.s}" stroke-width="4"/>
    </g>`;
  },
  shift(c) { // a chequered flag
    const cols = 6, rows = 4, x0 = -52, w = 22, y0 = -88, h = 22;
    const wave = (x) => Math.sin((x + 60) / 26) * 9;
    // every edge follows the same fine-sampled wave, so the cloth and the two border bars stay parallel (a cell edge is a curve, not a chord)
    const curve = (xa, xb, y) => { const pts = []; const n = Math.max(2, Math.round((xb - xa) / 2)); for (let k = 0; k <= n; k++) { const x = xa + ((xb - xa) * k) / n; pts.push(`${r1(x)},${r1(y + wave(x))}`); } return pts; };
    let cells = '';
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const xa = x0 + i * w, xb = xa + w, ya = y0 + j * h, yb = ya + h;
      cells += `<polygon points="${curve(xa, xb, ya).join(' ')} ${curve(xa, xb, yb).reverse().join(' ')}" fill="${(i + j) % 2 ? c.d : c.s}" stroke="${(i + j) % 2 ? c.d : c.s}" stroke-width=".6"/>`;
    }
    const bar = (y) => `<polyline points="${curve(x0, x0 + cols * w, y).join(' ')}" fill="none" stroke="${c.p}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
    return `<g>
      ${cells}
      ${bar(y0)}${bar(y0 + rows * h)}
      <rect x="-66" y="-100" width="12" height="206" rx="6" fill="${c.p}"/>
      <circle cx="-60" cy="-102" r="11" fill="${c.p}"/>
      <rect x="-80" y="100" width="40" height="9" rx="4.5" fill="${c.s}" opacity=".85"/>
    </g>`;
  },
  night(c) { // a crescent moon and stars
    return `<g>
      <path d="M26 -90A92 92 0 1 0 26 90A72 72 0 1 1 26 -90Z" fill="${c.p}"/>
      <path d="M-30 -52A60 60 0 0 0 -34 40" fill="none" stroke="${c.s}" stroke-width="5" stroke-linecap="round" opacity=".5"/>
      ${star4(58, -52, 22, c.s)}${star4(84, 6, 13, c.s, 0.9)}${star4(46, 56, 16, c.s, 0.8)}${star4(-86, -76, 9, c.s, 0.7)}${star4(86, -92, 8, c.s, 0.6)}
    </g>`;
  },
  distance(c) { // a speed dial with an odometer window
    const ticks = Array.from({ length: 13 }, (_, k) => { const a = ((-210 + k * 20) * Math.PI) / 180, big = k % 3 === 0; const r0 = big ? 66 : 72; return `<line x1="${r1(r0 * Math.cos(a))}" y1="${r1(r0 * Math.sin(a))}" x2="${r1(84 * Math.cos(a))}" y2="${r1(84 * Math.sin(a))}" stroke="${c.s}" stroke-width="${big ? 6 : 3}" stroke-linecap="round"/>`; }).join('');
    const na = (-210 + 20 * 9) * Math.PI / 180;
    return `<g>
      <path d="M${r1(94 * Math.cos((150 * Math.PI) / 180))} ${r1(94 * Math.sin((150 * Math.PI) / 180))}A94 94 0 1 1 ${r1(94 * Math.cos((30 * Math.PI) / 180))} ${r1(94 * Math.sin((30 * Math.PI) / 180))}" fill="none" stroke="${c.p}" stroke-width="12" stroke-linecap="round"/>
      ${ticks}
      <line x1="0" y1="0" x2="${r1(70 * Math.cos(na))}" y2="${r1(70 * Math.sin(na))}" stroke="${c.p}" stroke-width="9" stroke-linecap="round"/>
      <circle r="15" fill="${c.s}"/><circle r="6" fill="${c.d}"/>
      <rect x="-48" y="34" width="96" height="32" rx="7" fill="${c.d}" stroke="${c.s}" stroke-width="3"/>
      <text x="0" y="58" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="700" fill="${c.p}" letter-spacing="3">00100</text>
    </g>`;
  },
  clean(c) { // a shield with a sparkle
    return `<g>
      <path d="M0 -98L78 -66V10C78 58 40 86 0 104C-40 86 -78 58 -78 10V-66Z" fill="${c.p}"/>
      <path d="M0 -98L78 -66V10C78 58 40 86 0 104Z" fill="${c.d}" opacity=".16"/>
      <path d="M0 -80L62 -54V8C62 46 32 68 0 84C-32 68 -62 46 -62 8V-54Z" fill="none" stroke="${c.s}" stroke-width="4" opacity=".7"/>
      ${star4(0, 4, 56, c.s)}
      ${star4(-44, -34, 14, c.s, 0.85)}${star4(48, 42, 11, c.s, 0.8)}
    </g>`;
  },
  siberia(c) { // an ice crystal
    const arm = `<line x1="0" y1="0" x2="0" y2="-98" stroke="${c.p}" stroke-width="9" stroke-linecap="round"/>
      ${[-64, -38].map((y) => { const l = y === -64 ? 30 : 22; return `<line x1="0" y1="${y}" x2="${r1(l * Math.sin(0.9))}" y2="${r1(y - l * Math.cos(0.9))}" stroke="${c.p}" stroke-width="6" stroke-linecap="round"/><line x1="0" y1="${y}" x2="${r1(-l * Math.sin(0.9))}" y2="${r1(y - l * Math.cos(0.9))}" stroke="${c.p}" stroke-width="6" stroke-linecap="round"/>`; }).join('')}
      <circle cx="0" cy="-98" r="6" fill="${c.s}"/>`;
    return `<g>
      ${[0, 60, 120, 180, 240, 300].map((a) => `<g transform="rotate(${a})">${arm}</g>`).join('')}
      <polygon points="${hexPts(0, 0, 24)}" fill="${c.s}"/><polygon points="${hexPts(0, 0, 12)}" fill="${c.d}" opacity=".5"/>
    </g>`;
  },
  solo(c) { // a steering wheel
    return `<g>
      <circle r="84" fill="none" stroke="${c.p}" stroke-width="18"/>
      <circle r="84" fill="none" stroke="${c.d}" stroke-width="4" opacity=".35"/>
      <path d="M-76 -2Q-40 -14 -22 -4M76 -2Q40 -14 22 -4M0 24V80" fill="none" stroke="${c.p}" stroke-width="18" stroke-linecap="round"/>
      <circle r="26" fill="${c.s}"/><circle r="14" fill="${c.p}"/>
      <rect x="-9" y="-100" width="18" height="30" rx="4" fill="${c.s}"/>
    </g>`;
  },
  licence(c, a) { // an L-plate with a pip per level
    const level = a.tier;
    return `<g>
      <rect x="-72" y="-98" width="144" height="170" rx="16" fill="${c.p}"/>
      <rect x="-60" y="-86" width="120" height="146" rx="9" fill="none" stroke="${c.d}" stroke-width="4" opacity=".55"/>
      <path d="M-24 -64V20H34" fill="none" stroke="${c.d}" stroke-width="26" stroke-linejoin="miter" stroke-linecap="butt"/>
      ${[0, 1, 2].map((i) => `<circle cx="${(i - 1) * 40}" cy="92" r="13" fill="${i < level ? c.p : 'none'}" stroke="${c.p}" stroke-width="5"/>`).join('')}
      ${[0, 1, 2].map((i) => `<circle cx="${(i - 1) * 40}" cy="92" r="${i < level ? 5 : 0}" fill="${c.s}"/>`).join('')}
    </g>`;
  },
  medium(c, a) { return GLYPHS.licence(c, a); },
  hard(c, a) { return GLYPHS.licence(c, a); },
  honk(c) { // a cab horn: the mint you burn, and the mint a verified checkpoint pays
    return `<g>
      <rect x="-96" y="-6" width="28" height="40" rx="8" fill="${c.s}"/>
      <path d="M-72 14h40l78-78v156L-32 22h-40z" fill="${c.p}"/>
      <path d="M-20 -18h34l48-48v108L-20 28z" fill="${c.d}" opacity=".28"/>
      <path d="M62 -62c30 10 46 34 46 62" fill="none" stroke="${c.s}" stroke-width="8" stroke-linecap="round"/>
      <path d="M78 -46c20 8 30 22 30 40" fill="none" stroke="${c.s}" stroke-width="6" stroke-linecap="round" opacity=".65"/>
    </g>`;
  },
};

/* ---------- the badge ---------- */
/** One 1024×1024 SVG. `locked` = the steel, padlocked variant that shows the condition. */
function badge(a, locked, over = {}) {
  const fam = FAMILY[a.family] ?? FAMILY.road;
  const tier = TIERS[a.tier - 1];
  const rand = seeded(a.id);
  const name = over.name ?? a.name;
  const accent = locked ? '#7b7f86' : fam.glow;
  const g1 = locked ? '#8b9099' : fam.a[0], g2 = locked ? '#4c5058' : fam.a[1];
  const cream = locked ? '#9aa0a8' : CREAM;
  const rim = locked ? ['#9aa0a8', '#6a6f77', '#3c4047', '#80858d', '#a9aeb5'] : tier.rim;
  const edge = locked ? '#26292e' : tier.edge;
  const CX = 512, CY = 452;

  const stars = Array.from({ length: 46 }, () => { const x = r1(rand() * 1024), y = r1(rand() * 215), r = r1(0.8 + rand() * 1.9); return `<circle cx="${x}" cy="${y}" r="${r}" fill="${cream}" opacity="${r1(0.15 + rand() * 0.5)}"/>`; }).join('');
  const dashes = Array.from({ length: 5 }, (_, i) => { const t0 = i * 0.2 + 0.03, t1 = t0 + 0.09; if (220 + 804 * t1 ** 1.6 > 800 && 220 + 804 * t0 ** 1.6 < 940) return ''; const y0 = 220 + (1024 - 220) * t0 ** 1.6, y1 = 220 + (1024 - 220) * t1 ** 1.6, w0 = 3 + 36 * t0 ** 1.6, w1 = 3 + 36 * t1 ** 1.6; return `<polygon points="${r1(512 - w0 / 2)},${r1(y0)} ${r1(512 + w0 / 2)},${r1(y0)} ${r1(512 + w1 / 2)},${r1(y1)} ${r1(512 - w1 / 2)},${r1(y1)}" fill="${locked ? '#5b5f66' : AMBER}" opacity="${locked ? 0.5 : 0.8}"/>`; }).join('');
  const ridge = (() => { let d = 'M0 222'; for (let x = 0; x <= 1024; x += 64) d += `L${x} ${r1(222 - 18 - rand() * 46)}`; return `${d}L1024 222Z`; })();

  const rimStops = rim.map((c, i) => `<stop offset="${r1((i / (rim.length - 1)) * 100)}%" stop-color="${c}"/>`).join('');
  const defs = `<defs>
    <radialGradient id="bg" cx="50%" cy="22%" r="85%"><stop offset="0" stop-color="${locked ? '#1c1d20' : '#1d1710'}"/><stop offset="1" stop-color="${BG}"/></radialGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG}"/><stop offset="1" stop-color="${accent}" stop-opacity="${locked ? 0.1 : 0.34}"/></linearGradient>
    <linearGradient id="road" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2724"/><stop offset="1" stop-color="#0d0c0b"/></linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">${rimStops}</linearGradient>
    <linearGradient id="rimB" x1="1" y1="0" x2="0" y2="1">${rimStops}</linearGradient>
    <linearGradient id="bevel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${edge}"/><stop offset=".5" stop-color="#16120e"/><stop offset="1" stop-color="${edge}"/></linearGradient>
    <radialGradient id="plate" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="${locked ? '#24262a' : PANEL}"/><stop offset=".65" stop-color="${locked ? '#121315' : '#0f0c09'}"/><stop offset="1" stop-color="#070605"/></radialGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${accent}" stop-opacity="${locked ? 0.06 : 0.3}"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    <linearGradient id="ga" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${g1}"/><stop offset="1" stop-color="${g2}"/></linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity="${locked ? 0 : 0.16}"/><stop offset=".56" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;

  const bolt = (x, y) => `<circle cx="${r1(x)}" cy="${r1(y)}" r="10" fill="url(#rimB)" stroke="${edge}" stroke-width="3"/><circle cx="${r1(x)}" cy="${r1(y)}" r="3.5" fill="${edge}"/>`;
  const bolts = Array.from({ length: 6 }, (_, k) => { const an = ((-90 + 60 * k) * Math.PI) / 180; return bolt(CX + 322 * Math.cos(an), CY + 322 * Math.sin(an)); }).join('');
  const grid = Array.from({ length: 9 }, (_, i) => `<line x1="${CX - 300}" y1="${CY - 240 + i * 60}" x2="${CX + 300}" y2="${CY - 240 + i * 60}"/>`).join('');
  const c = { p: 'url(#ga)', s: cream, d: locked ? '#17181a' : '#120d08', k: !locked };
  const glyphScale = 1.62;
  const glyph = GLYPHS[a.family] ? GLYPHS[a.family](c, a) : GLYPHS.road(c, a);

  // tier decoration: gold/platinum get an extra outer ring, platinum a holographic sheen and sparkles
  const extra = (!locked && a.tier >= 3 ? `<polygon points="${hexPts(CX, CY, 356)}" fill="none" stroke="url(#rim)" stroke-width="5" stroke-linejoin="round" opacity=".8"/>` : '')
    + (!locked && a.tier === 4 ? [[150, 150, 26], [880, 190, 20], [120, 700, 18], [905, 650, 28]].map(([x, y, r]) => star4(x, y, r, '#fff', 0.85)).join('') : '')
    + (!locked && a.tier === 2 ? star4(842, 168, 16, '#fff', 0.55) : '');

  const nameFs = fit(name.length, 790, 66);
  const bannerTop = locked ? 800 : 812, bannerH = locked ? 98 : 104;
  const banner = `<rect x="86" y="${bannerTop}" width="852" height="${bannerH}" rx="18" fill="url(#bevel)" stroke="url(#rim)" stroke-width="6"/>
    <rect x="104" y="${bannerTop + 14}" width="816" height="${bannerH - 28}" rx="10" fill="#0a0806" opacity=".9"/>
    <text x="512" y="${bannerTop + (locked ? 64 : 70)}" text-anchor="middle" font-family="${FONT}" font-size="${nameFs}" font-weight="800" fill="${locked ? '#8d9299' : tier.ink}" letter-spacing="1">${esc(name.toUpperCase())}</text>`;

  // the level: three stars under the banner, `tier` of them lit (the same row on the locked art, all unlit)
  const lit = (n) => (locked ? false : n < Math.min(a.tier, STARS) || a.tier > STARS);
  const starRow = (cy, R) => Array.from({ length: STARS }, (_, n) => {
    const x = CX + (n - 1) * R * 2.7, on = lit(n), line = locked ? '#5b5f66' : tier.rim[1];
    return on
      ? `<polygon points="${starPts(x, cy, R)}" fill="${a.tier > 3 ? 'url(#rimB)' : 'url(#rim)'}" stroke="${edge}" stroke-width="4" stroke-linejoin="round" ${a.tier > 3 ? 'filter="url(#glow)"' : ''}/>`
      : `<polygon points="${starPts(x, cy, R)}" fill="${line}" fill-opacity=".08" stroke="${line}" stroke-width="5" stroke-linejoin="round" stroke-dasharray="${locked ? '0' : '2 9'}" stroke-linecap="round" opacity="${locked ? 0.55 : 0.75}"/>`;
  }).join('');
  const bottom = over.bottom
    ? `<text x="512" y="${bannerTop + bannerH + 62}" text-anchor="middle" font-family="${FONT}" font-size="38" font-weight="700" fill="${tier.rim[1]}" letter-spacing="8">${esc(over.bottom)}</text>`
    : starRow(bannerTop + bannerH + 52, 40);

  const lockIcon = locked ? `<g transform="translate(${CX} ${CY + 18})">
      <circle r="92" fill="#0b0a09" opacity=".62"/>
      <path d="M-34 -14V-38A34 34 0 0 1 34 -38V-14" fill="none" stroke="#c7ccd3" stroke-width="15" stroke-linecap="round"/>
      <rect x="-52" y="-16" width="104" height="80" rx="15" fill="#a8adb5"/><rect x="-52" y="-16" width="104" height="80" rx="15" fill="none" stroke="#3c4047" stroke-width="4"/>
      <circle cy="20" r="11" fill="#2b2e33"/><rect x="-4.5" y="26" width="9" height="22" rx="4.5" fill="#2b2e33"/></g>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="${esc(name)} – Freight Chain achievement${locked ? ' (locked)' : ''}">
  <title>${esc(name)}${locked ? ' (locked)' : ''}</title>
  ${defs}
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="222" fill="url(#sky)"/>${stars}
  <path d="${ridge}" fill="#0a0908" opacity=".9"/>
  <polygon points="512,222 -260,1024 1284,1024" fill="url(#road)"/>
  <line x1="512" y1="222" x2="-260" y2="1024" stroke="${locked ? '#3a3d42' : accent}" stroke-width="4" opacity=".7"/><line x1="512" y1="222" x2="1284" y2="1024" stroke="${locked ? '#3a3d42' : accent}" stroke-width="4" opacity=".7"/>
  ${dashes}
  <circle cx="${CX}" cy="${CY}" r="470" fill="url(#halo)"/>
  <text x="512" y="84" text-anchor="middle" font-family="${FONT}" font-size="31" font-weight="700" fill="${locked ? '#6f747b' : AMBER}" letter-spacing="12">FREIGHT CHAIN</text>
  ${extra}
  <polygon points="${hexPts(CX, CY, 346)}" fill="url(#rim)" stroke="${edge}" stroke-width="8" stroke-linejoin="round"/>
  <polygon points="${hexPts(CX, CY, 312)}" fill="url(#bevel)" stroke="url(#rimB)" stroke-width="5" stroke-linejoin="round"/>
  <polygon points="${hexPts(CX, CY, 292)}" fill="url(#plate)" stroke="#000" stroke-width="3" stroke-linejoin="round"/>
  <g stroke="${accent}" stroke-width="1.5" opacity="${locked ? 0.08 : 0.12}" clip-path="url(#cl)">${grid}</g>
  <clipPath id="cl"><polygon points="${hexPts(CX, CY, 292)}"/></clipPath>
  <polygon points="${hexPts(CX, CY, 274)}" fill="none" stroke="${accent}" stroke-width="2.5" stroke-dasharray="3 12" stroke-linecap="round" opacity="${locked ? 0.35 : 0.7}"/>
  ${bolts}
  <g transform="translate(${CX} ${CY - 12}) scale(${glyphScale})" ${locked ? 'opacity=".34"' : 'filter="url(#glow)"'}>${glyph}</g>
  ${lockIcon}
  <polygon points="${hexPts(CX, CY, 346)}" fill="url(#sheen)" stroke="none"/>
  ${a.tier === 4 && !locked ? `<polygon points="${hexPts(CX, CY, 346)}" fill="none" stroke="url(#rimB)" stroke-width="3" stroke-linejoin="round" opacity=".9" filter="url(#glow)"/>` : ''}
  ${banner}
  ${bottom}
</svg>
`;
}

/* ---------- metadata ---------- */
const metadata = (a) => {
  const tier = TIERS[a.tier - 1];
  const fam = FAMILY[a.family];
  return {
    name: a.name,
    symbol: 'FCHAIN',
    description: `${fam.flavour} Condition: ${a.desc} A soulbound Freight Chain achievement – compressed NFT, non-transferable.`,
    image: '__IMAGE__',
    seller_fee_basis_points: 0,
    external_url: 'https://freightchain.fun/',
    collection: { name: 'Freight Chain Achievements', family: 'Freight Chain' },
    attributes: [
      { trait_type: 'Family', value: FAMILY_NAMES[a.family] },
      { trait_type: 'Tier', value: tier.name },
      { trait_type: 'Tier Number', value: a.tier },
      { trait_type: 'Condition', value: a.desc },
      { trait_type: 'Requirement', value: a.target, display_type: 'number' },
      { trait_type: 'Soulbound', value: 'Yes' },
      { trait_type: 'Game', value: 'Freight Chain' },
    ],
    properties: { category: 'image', files: [{ uri: '__IMAGE__', type: 'image/png' }] },
  };
};

/* ---------- run ---------- */
const list = ACHIEVEMENTS.filter((a) => a.id !== 'top-20' && (!ONLY.length || ONLY.includes(a.id)));
const collection = { id: 'collection', family: 'road', tier: 4, name: 'FC Achievements', desc: 'Freight Chain achievements.' };
const writes = [];
for (const a of list) {
  writeFileSync(join(SVG_DIR, `${a.id}.svg`), badge(a, false));
  writeFileSync(join(SVG_DIR, `${a.id}-locked.svg`), badge(a, true));
  writeFileSync(join(META_DIR, `${a.id}.json`), JSON.stringify(metadata(a), null, 2) + '\n');
  writes.push(a.id);
}
if (!ONLY.length) {
  writeFileSync(join(OUT, 'collection.svg'), badge(collection, false, { name: 'FC ACHIEVEMENTS', bottom: 'SOULBOUND · cNFT' }));
  writeFileSync(join(META_DIR, 'collection.json'), JSON.stringify({
    name: 'Freight Chain Achievements',
    symbol: 'FCHAIN',
    description: 'Soulbound compressed NFTs earned by driving in Freight Chain – first mile to platinum legend. One badge per milestone, minted to the wallet that earned it.',
    image: '__IMAGE__',
    seller_fee_basis_points: 0,
    external_url: 'https://freightchain.fun/',
    properties: { category: 'image', files: [{ uri: '__IMAGE__', type: 'image/png' }] },
  }, null, 2) + '\n');
}
// contact sheet: a row per family, a column per tier, earned over locked
if (!ONLY.length) {
  const fams = [...new Set(ACHIEVEMENTS.filter((a) => a.id !== 'top-20').map((a) => a.family))];
  const rows = fams.map((f) => `<h2>${esc(FAMILY_NAMES[f])}</h2><div class="row">${ACHIEVEMENTS.filter((a) => a.family === f && a.id !== 'top-20').map((a) => `<figure><img src="../../client/site/img/achievements/${a.id}.svg" alt=""><img src="../../client/site/img/achievements/${a.id}-locked.svg" alt=""><figcaption>${esc(a.id)}</figcaption></figure>`).join('')}</div>`).join('');
  writeFileSync(join(HERE, 'preview.html'), `<!doctype html><meta charset="utf-8"><title>Freight Chain achievements</title><style>body{background:${BG};color:${CREAM};font:14px ${FONT};margin:24px}h2{color:${AMBER};margin:18px 0 6px;letter-spacing:4px;text-transform:uppercase}.row{display:flex;gap:14px}figure{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:6px;width:420px}figure img{width:100%;border-radius:8px}figcaption{grid-column:1/3;color:${DIM}}</style><h1>FREIGHT CHAIN · achievement badges</h1>${rows}`);
}
console.log(`${list.length} badge(s): SVG → ${SVG_DIR}, metadata → ${META_DIR}`);

if (!NO_PNG) {
  if (!existsSync(CHROME)) { console.error(`Chrome not found at ${CHROME} (set CHROME=…); PNGs skipped`); process.exit(1); }
  const profile = mkdtempSync(join(tmpdir(), 'fc-ach-'));
  // headless Chrome sometimes lingers after it has written the screenshot: wait for the file to settle, then stop the process
  const shot = (svg, png) => new Promise((done, fail) => {
    rmSync(png, { force: true });
    const p = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--user-data-dir=${profile}`, '--window-size=1024,1024', `--screenshot=${png}`, `file://${svg}`], { stdio: 'ignore' });
    let last = -1, settled = 0;
    const t0 = Date.now();
    const poll = setInterval(() => {
      const size = existsSync(png) ? statSync(png).size : 0;
      settled = size > 0 && size === last ? settled + 1 : 0;
      last = size;
      if (settled >= 2 || p.exitCode !== null && size > 0) { clearInterval(poll); p.kill('SIGKILL'); done(); }
      else if (Date.now() - t0 > 60_000) { clearInterval(poll); p.kill('SIGKILL'); fail(new Error(`no screenshot for ${svg}`)); }
    }, 400);
  });
  try {
    for (const id of writes) await shot(join(SVG_DIR, `${id}.svg`), join(PNG_DIR, `${id}.png`));
    if (!ONLY.length) await shot(join(OUT, 'collection.svg'), join(PNG_DIR, 'collection.png'));
  } finally { rmSync(profile, { recursive: true, force: true }); }
  console.log(`PNG → ${PNG_DIR}`);
}
