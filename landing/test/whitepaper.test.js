import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/* Static checks on whitepaper.html + src/whitepaper.js and on the numbers it quotes – they must stay equal to the code they come from.
   The page has no fetch of its own. Web vitals and the page view post through client/js/analytics.js (API_BASE, so production posts to api.<apex>). */
const root = new URL('..', import.meta.url).pathname, repo = join(root, '..');
const html = readFileSync(join(root, 'whitepaper.html'), 'utf8'), js = readFileSync(join(root, 'src/whitepaper.js'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const text = html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&');
const src = f => readFileSync(join(repo, f), 'utf8');

test('ids are unique and every in-page anchor points at an element', () => {
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), []);
  assert.deepEqual([...new Set([...html.matchAll(/href="#([\w-]+)"/g)].map(m => m[1]))].filter(h => !ids.includes(h)), []);
});

test('the contents list and the sections match, one h1 and one h2 per chapter 01–08', () => {
  const toc = [...html.match(/<nav class="toc"[\s\S]*?<\/nav>/)[0].matchAll(/href="#([\w-]+)"/g)].map(m => m[1]);
  const sections = [...html.matchAll(/<section[^>]*\bid="([\w-]+)"/g)].map(m => m[1]);
  assert.deepEqual(toc, sections);
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.equal((html.match(/<h2[\s>]/g) ?? []).length, 8);
  for (const s of ['thesis', 'drive', 'rides', 'rewards', 'onchain', 'verify', 'stream', 'risks']) assert.ok(sections.includes(s), s);
});

test('the smoke test marker is on the page', () => { assert.match(html, /FREIGHT CHAIN · WHITEPAPER/); });

test('heat, cooling, fog and the replay switches match the game', () => {
  const cfg = src('client/js/config.js'), rules = src('server/src/domain/telemetry/telemetry-rules.ts'), flags = src('client/js/telemetry.js');
  const fog = Number(cfg.match(/FOG_FROM:\s*([\d.]+)/)[1]);
  assert.equal(fog, 18); assert.match(text, new RegExp(`above ${fog} °C`)); assert.match(text, new RegExp(`above ${fog} °C, needs cooling`));
  assert.match(cfg, /COOLER: 0\.005/); assert.match(cfg, /HEATER: 0\.005/);
  assert.match(text, /draws the same battery current/); assert.match(text, /does not end the ride/);
  assert.match(text, /Brenner frosts at night and does not fog/); assert.match(text, /Pan-American does neither/);
  assert.doesNotMatch(text, /Pan-American and Brenner do neither/);
  assert.doesNotMatch(text, /flat battery with the engine off ends the ride/); assert.doesNotMatch(text, /the ride is over/);
  assert.equal(Number(rules.match(/SAMPLE_MAX_WIDTH = (\d+)/)[1]), 16); assert.match(text, /16 numbers/); assert.match(text, /fork road/);
  assert.match(flags, /cooler:\s*2048/); assert.match(text, /heater and cooling/);
  const landing = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(landing, /LIGHTS, HEAT &amp; COLD/); assert.match(landing, /<kbd>J<\/kbd> clears fog/); assert.doesNotMatch(landing, /<kbd>N<\/kbd> night/);
  assert.match(landing, /HEAD, CAB, HEAT and COLD/);
});

test('head basics, icons that exist, no inline scripts or handlers, noopener on _blank', () => {
  assert.match(html, /<html lang="en">/); assert.match(html, /<title>[^<]{5,}<\/title>/);
  for (const m of ['name="description"', 'name="viewport"', 'name="theme-color"', 'property="og:title"', 'property="og:image"', 'name="twitter:card"']) assert.ok(html.includes(m), m);
  const links = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="(\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(links.length >= 4); assert.deepEqual(links.filter(l => !existsSync(join(repo, 'client', l))), []);
  assert.doesNotMatch(html, /\son[a-z]+="/i); assert.deepEqual(html.match(/<script(?![^>]*\b(?:src=|type="application\/ld\+json"))[^>]*>/g) ?? [], []);   // JSON-LD is data, never run
  for (const tag of html.match(/<a [^>]*target="_blank"[^>]*>/g) ?? []) assert.match(tag, /noopener/);
});

test('images: local WebP, alt, intrinsic size, async decode, and the files exist', () => {
  const tags = html.match(/<img [^>]*>/g) ?? [];   // chapter 02's dash cards are canvases, not images
  for (const t of tags) { assert.match(t, /\balt="[^"]+"/, t); assert.match(t, /\bwidth="\d+"/, t); assert.match(t, /\bheight="\d+"/, t); assert.match(t, /decoding="async"/, t); assert.match(t, /src="\/media\/[\w./-]+\.webp"/, t); }
  for (const f of [...html.matchAll(/src="(\/media\/[\w./-]+)"/g)].map(m => m[1])) assert.ok(existsSync(join(root, 'public', f)), f);
});

test('links that leave the page go through the host bases; analytics posts go through analytics.js', () => {
  assert.match(js, /from '\.\.\/\.\.\/client\/js\/hosts\.js'/); for (const b of ['GAME_BASE', 'SITE_BASE', 'STORYBOOK_BASE']) assert.match(js, new RegExp(b));
  assert.match(js, /reportWebVitals\('whitepaper'\)/);
  assert.match(js, /track\('whitepaper_viewed', \{ surface: 'whitepaper' \}\)/);
  assert.match(js, /getElementById\('play-top'\)[\s\S]*offline_practice_clicked/);
  assert.match(js, /getElementById\('storybook-link'\)[\s\S]*storybook_link_clicked/);
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  for (const tag of html.match(/<a [^>]*href="\/(?:play|lobby|viewer)\.html"[^>]*>|<a [^>]*href="\/(?:escrow\/|)"[^>]*>/g) ?? []) assert.match(tag, /data-to="(site|game|storybook)"/, tag);
  const back = html.match(/<a [^>]*id="landing-top"[^>]*>/)[0];
  assert.match(back, /data-to="site"/); assert.match(back, /data-path="\/"/); assert.match(back, /class="[^"]*\bcta\b[^"]*\bghost\b/);
  assert.match(html, /id="landing-top"[^>]*>← <span class="hide-sm">LANDING<\/span><\/a>/);
});

test('host wiring: hosts.js knows the whitepaper prefix and exports its base; vite builds both pages', () => {
  const hosts = src('client/js/hosts.js'); assert.match(hosts, /\(ride\|api\|storybook\|whitepaper\|admin\|www\)/); assert.match(hosts, /export const WHITEPAPER_BASE/);
  assert.match(readFileSync(join(root, 'vite.config.js'), 'utf8'), /whitepaper: 'whitepaper\.html'/);
});

test('numbers: tiers, governor and completion distance equal the server rules', () => {
  const tiers = src('server/src/domain/rides/ride-tier.ts');
  for (const [id, usd] of [['1h', 5], ['4h', 15], ['8h', 50]]) { assert.match(tiers, new RegExp(`id: '${id}'[^}]*usd: ${usd}\\b`)); assert.match(text, new RegExp(`\\$${usd}\\b`)); }
  assert.match(tiers, /id: '1h'[^}]*minTickets: 20\b/); assert.match(tiers, /id: '4h'[^}]*minTickets: null/);
  assert.match(text, /WHY 20 TICKETS AT \$5/); assert.match(text, /\$26/); assert.match(text, /\$13\.50/);
  const landing = readFileSync(join(root, 'index.html'), 'utf8'); assert.match(landing, /id="why-20"/); assert.match(landing, /20 tickets of \$5/); assert.match(landing, /\$26/);
  const rules = src('server/src/domain/rides/ride-rules.ts'); assert.match(rules, /MAX_SPEED = 28/); assert.match(rules, /COMPLETE_DIST_K = 0\.5/);
  assert.match(text, /28 m\/s/); assert.match(text, /100\.8 km\/h/); assert.match(text, /50\.4 km/, '½ × 28 m/s × 3600 s');
  // the free run: FREE_RIDE_SECONDS (180 = EASY's length) × the level's multiple – EASY 1 · CROSSROADS 2 · HARD 5, i.e. 3 · 6 · 15 minutes (server/src/domain/rides/ride-trip.ts FREE_LEVELS – not quoted here: the landing image does not copy it), ending by itself at the line
  assert.match(src('server/src/infrastructure/config/env.schema.ts'), /FREE_RIDE_SECONDS: z\.coerce\.number\(\)\.positive\(\)\.default\(180\)/); assert.match(text, /FREE\s+3–15 minutes/);
  assert.match(src('client/js/trips.js'), /free: \{[^}]*finish: true/); assert.match(text, /ends by itself at the line/);
});

test('numbers: verdict thresholds equal verdict-rules.ts', () => {
  const v = src('server/src/domain/verdict/verdict-rules.ts'), num = n => Number(v.match(new RegExp(`${n} = ([\\d.]+)`))[1]);
  assert.equal(num('SPEED_TOLERANCE'), 1.05); assert.ok(Math.abs(28 * num('SPEED_TOLERANCE') - 29.4) < 1e-9); assert.match(text, /29\.4 m\/s/);
  assert.equal(num('TELEPORT_FACTOR'), 1.2); assert.equal(num('TELEPORT_SLACK_METRES'), 2); assert.match(text, /×1\.2, plus 2 m/);
  assert.equal(num('AGREE_METRES'), 30); assert.equal(num('AGREE_SHARE'), 0.01); assert.match(text, /30 m \+ 1 %/);
  assert.equal(num('COVERAGE_REJECT'), 0.5); assert.equal(num('COVERAGE_FLAG'), 0.9); assert.match(text, /Under 50 % of the driven time recorded rejects; under 90 % only flags/);
  assert.equal(num('MOVED_METRES'), 50); assert.match(text, /more than 50 m/);
  assert.equal(num('HUMAN_MIN_PRESSES'), 8); assert.match(text, /fewer than 8 presses/);
  assert.equal(num('HOLD_CV_MIN'), 0.08); assert.equal(num('HOLD_MIN_PER_KEY'), 6); assert.match(text, /under 8 %, over 6\+ holds/);
  assert.equal(num('REPEAT_TOP_N'), 3); assert.equal(num('REPEAT_SHARE_MAX'), 0.6); assert.match(text, /3 most common gaps[^.]*more than 60 %/);
  assert.equal(num('INSTANT_HOLD_MS'), 10); assert.equal(num('INSTANT_SHARE_MAX'), 0.3); assert.match(text, /More than 30 % of presses released within 10 ms/);
  assert.equal(num('RULES_VERSION'), 3); assert.match(text, /rules v3 run in/i); assert.match(text, /Anti-cheat v3/);
  // dispatch prompts: the window and the default interval live with the ride, the thresholds with the verdict
  assert.equal(num('CHALLENGE_MIN_REACTION_MS'), 80); assert.match(text, /under 80 ms after the server issued the prompt/);
  assert.equal(num('CHALLENGE_IGNORED_MIN_ISSUED'), 3); assert.equal(num('CHALLENGE_IGNORED_SHARE'), 0.5); assert.match(text, /Half or more of 3\+ prompts ignored rejects/);
  assert.match(src('server/src/domain/rides/ride-challenge.ts'), /CHALLENGE_WINDOW_MS = 20_000/); assert.match(text, /that key within 20 s/);
  assert.match(src('server/src/infrastructure/config/env.schema.ts'), /CHALLENGE_INTERVAL_SECONDS: z\.coerce\.number\(\)\.min\(0\)\.default\(240\)/); assert.match(text, /every 240 s of driving/);
  assert.match(text, /captcha before a paid shift/); assert.match(text, /CHALLENGE CHANNEL/); assert.match(text, /table is empty today/); assert.doesNotMatch(text, /FLASH YOUR HEADLIGHTS/);
  assert.match(src('server/src/infrastructure/config/env.schema.ts'), /SIGNIN_RETENTION_DAYS: z\.coerce\.number\(\)\.int\(\)\.min\(0\)\.default\(180\)/); assert.match(text, /the sign-in log after 180 days/);
  assert.match(src('server/src/domain/telemetry/telemetry-rules.ts'), /RECORDING_BYTES_PER_SECOND = 4096/); assert.match(text, /bytes ≤ wall × 4 kB \+ 256 kB/);
  assert.match(text, /NINE LAYERS, FROM CHEAPEST TO STRONGEST/); assert.equal((html.match(/NINE LAYERS[\s\S]*?<\/ol>/)[0].match(/<li>/g) ?? []).length, 9); assert.match(text, /docs\/anti-cheat\//);
});

test('numbers: the server\'s road – verdict-rules.ts, and the game\'s own constants (server/src/domain/road/road-rules.ts mirrors them; its road-drift.spec.ts holds the two together)', () => {
  const v = src('server/src/domain/verdict/verdict-rules.ts'), num = n => Number(v.match(new RegExp(`${n} = ([\\d.]+)`))[1]);
  const cfg = src('client/js/config.js'), holes = src('client/js/net/obstacles.js'), damage = src('client/js/sim/damage.js');
  assert.equal(num('OBSTACLE_IGNORED_REJECT'), 2); assert.match(text, /Two or more holes driven through untouched reject; one flags/);
  assert.equal(num('PASS_DAMAGE_SHARE'), 0.25); assert.match(text, /at least a quarter of that loss/);
  assert.match(cfg, /OFFROAD_FAIL_SECONDS: 20,/); assert.match(text, /the game ends a ride at 20 s/);
  assert.equal(20 * num('OFFROAD_FACTOR') + num('OFFROAD_SLACK_SECONDS'), 27); assert.match(text, /more than 27 s rejects/); assert.match(text, /20 s, ×1\.25 \+ 2 s/);
  assert.equal(num('GASLESS_REJECT_GAIN'), 2); assert.equal(num('GASLESS_REJECT_STEPS'), 5); assert.match(text, /2 m\/s of it, or 5 such steps, rejects/);
  assert.match(cfg, /MAX_SPEED: 28,/); assert.match(holes, /sinkhole: \{[^\n]*\], dmg: 14, slow: \.35,/); assert.match(damage, /clamp\(st\.v \/ 28, 0, 1\.2\) \*\* 2 \* \(axle \? \.6 : 1\)/);
  assert.match(text, /dmg × \(v\/28\)²\s+– 14 % for the front axle in a sinkhole at 28 m\/s, rear axles × 0\.6/);
  assert.match(text, /stamps NO IMPACT/);
});

test('numbers: live-stream prices and limits equal live-rules.ts', () => {
  const l = src('server/src/domain/live/live-rules.ts');
  for (const [id, sol, label] of [['tip', 0.01, 'Tip'], ['night', 0.02, 'Night'], ['day', 0.02, 'Day'], ['potholes', 0.02, 'Potholes'], ['trench', 0.03, 'Trench'], ['sinkhole', 0.05, 'Sinkhole']]) {
    assert.match(l, new RegExp(`${id}: \\{ lamports: ${sol} \\* LAMPORTS_PER_SOL`), id);
    assert.match(text, new RegExp(`${label}\\s+${sol.toFixed(2)} SOL`), `${label} ${sol}`);
  }
  assert.match(l, /MESSAGE_MAX_LENGTH = 140/); assert.match(text, /140 characters/); assert.match(l, /NOTE_MAX_LENGTH = 80/); assert.match(text, /80 characters/);
  assert.match(l, /EFFECT_WINDOW_MS = 20_000/); assert.match(text, /per ride per 20 s/); assert.match(l, /LINE_WINDOW_MS = 3_000/); assert.match(text, /per 3 s/);
});

test('the landing image copies every repo file this test reads', () => {
  const docker = src('deploy/Dockerfile');
  const ignore = src('.dockerignore');
  const self = readFileSync(new URL(import.meta.url), 'utf8');
  for (const p of [...self.matchAll(/src\('([^']+)'\)/g)].map((m) => m[1])) {
    if (p.startsWith('client/')) continue; // the image copies client/ whole
    assert.ok(docker.includes(p), `${p} is quoted by the whitepaper test but not copied into the landing image`);
    if (p.startsWith('deploy/')) assert.ok(ignore.includes(`!${p}`), `${p} is excluded from the image build`);
  }
});

test('numbers: the production live flags and the program facts the page states', () => {
  const compose = src('deploy/docker-compose.prod.yml'); assert.match(compose, /LIVE_FREE_DONATIONS[^\n]*off/); assert.match(compose, /LIVE_EFFECTS[^\n]*free/);
  assert.match(text, /game effects on free rides only/);
  const idl = JSON.parse(src('programs/freightchain-pools/idl/freightchain_pools.json'));
  assert.equal(idl.instructions.length, 17, 'the page says 17 instructions'); assert.equal(idl.events.length, 14, '14 events'); assert.equal(idl.errors.length, 25, '25 error codes');
  assert.match(text, /17 instructions, 14 events, 25 error codes/);
  const tiers = src('server/src/domain/rides/ride-tier.ts');
  assert.match(tiers, /id: '1h'[^}]*schedule: \{ saleHours: 24, playHours: 2, reviewHours: 48 \}/, 'the page says a new pool every 24 h, rides 2 h more, 48 h review');
  assert.match(text, /A new 1-hour pool every 24 hours/); assert.match(text, /48 hours after the last rides/);
});
