import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* Search + link previews: one canonical URL per public page, absolute og:image, JSON-LD that parses, robots.txt / sitemap.xml / llms.txt that agree with the pages,
   noindex where a page is not for search. The production URLs are written out on purpose (a staging copy must point search at production, not compete with it). */
const root = new URL('..', import.meta.url).pathname, client = join(root, '..', 'client');
const read = f => readFileSync(f, 'utf8');
const pages = { landing: read(join(root, 'index.html')), whitepaper: read(join(root, 'whitepaper.html')), play: read(join(client, 'play.html')), lobby: read(join(client, 'lobby.html')), viewer: read(join(client, 'viewer.html')) };
const URLS = { landing: 'https://freightchain.fun/', whitepaper: 'https://whitepaper.freightchain.fun/', play: 'https://ride.freightchain.fun/play.html' };
const robots = read(join(root, 'public/robots.txt')), sitemap = read(join(root, 'public/sitemap.xml')), llms = read(join(root, 'public/llms.txt'));
const meta = (html, attr, name) => html.match(new RegExp(`<meta ${attr}="${name.replace(/[:]/g, '\\$&')}" content="([^"]*)"`))?.[1];
const canonical = html => html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
const jsonLd = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

test('each public page names its one canonical URL; the landing and the whitepaper also as og:url', () => {
  for (const [p, url] of Object.entries(URLS)) assert.equal(canonical(pages[p]), url, p);
  for (const p of ['landing', 'whitepaper']) assert.equal(meta(pages[p], 'property', 'og:url'), URLS[p], p);
  assert.equal(meta(pages.play, 'property', 'og:url'), undefined, 'a shared ?watch= link keeps its own URL in the preview');
});

test('link previews: og:image is absolute and the file exists; titles are distinct and say what the page is', () => {
  for (const p of ['landing', 'whitepaper', 'play']) {
    const img = meta(pages[p], 'property', 'og:image');
    assert.match(img, /^https:\/\/freightchain\.fun\/media\/og\.jpg$/, p);
    if (p === 'landing') assert.equal(meta(pages[p], 'name', 'twitter:image'), img, 'X reads twitter:image first');
    assert.ok(meta(pages[p], 'name', 'description')?.length >= 50, `${p}: a real description`);
  }
  const titles = Object.values(pages).map(h => h.match(/<title>([^<]+)<\/title>/)[1]);
  assert.equal(new Set(titles).size, titles.length, titles.join(' | '));
  assert.match(titles[0], /truck/i); assert.match(titles[1], /whitepaper/i); assert.match(titles[2], /truck/i);
  for (const t of titles.slice(0, 3)) assert.ok(t.length <= 75, `${t}: ${t.length} chars – search cuts long titles`);
});

test('JSON-LD parses: the game + organisation on the landing, the article on the whitepaper (its version and date = the header chip)', () => {
  const graph = jsonLd(pages.landing)[0]['@graph'], types = graph.map(n => [n['@type']].flat()).flat();
  for (const t of ['Organization', 'WebSite', 'VideoGame']) assert.ok(types.includes(t), t);
  const game = graph.find(n => [n['@type']].flat().includes('VideoGame'));
  assert.equal(game.url, URLS.landing); assert.equal(game.offers.price, '0');
  assert.ok(!JSON.stringify(graph).includes('aggregateRating'), 'never a made-up rating');
  const org = graph.find(n => n['@type'] === 'Organization');
  const body = pages.landing.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '');
  for (const s of org.sameAs) assert.ok(body.includes(`href="${s}"`), `${s} is linked from the page itself`);
  const [article] = jsonLd(pages.whitepaper), chip = pages.whitepaper.match(/<span class="chip">v([\d.]+) · ([A-Z]{3}) (\d+) (\d{4})<\/span>/);
  assert.ok(chip, 'the whitepaper header chip "vX · MON D YYYY"');
  const month = String('JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC'.indexOf(chip[2]) / 3 + 1).padStart(2, '0');
  assert.equal(article['@type'], 'TechArticle'); assert.equal(article.version, chip[1]);
  assert.equal(article.dateModified, `${chip[4]}-${month}-${chip[3].padStart(2, '0')}`, 'bump dateModified with the chip');
  assert.equal(article.url, URLS.whitepaper); assert.equal(article.about['@id'], game['@id']);
});

test('noindex exactly where a page is not for search (lobby, model viewer, admin, the pitch deck), never on the public pages', () => {
  for (const p of ['lobby', 'viewer']) assert.match(pages[p], /<meta name="robots" content="noindex[^"]*">/, p);
  assert.match(read(join(client, 'admin.html')), /<meta name="robots" content="noindex/);
  assert.match(read(join(root, 'pitchdeck.html')), /<meta name="robots" content="noindex[^"]*">/, 'pitchdeck');
  assert.doesNotMatch(sitemap + llms, /pitchdeck/, 'the deck is not advertised to search or AI crawlers');
  for (const p of Object.keys(URLS)) assert.doesNotMatch(pages[p], /name="robots"/, p);
});

test('robots.txt: everything open but the API, AI crawlers named and allowed, the sitemap absolute', () => {
  assert.doesNotMatch(robots, /^Disallow:\s*\/\s*$/m, 'nothing blocks the whole site');
  assert.doesNotMatch(robots, /^Disallow:.*(lobby|viewer|pitchdeck)/m, 'a noindex page must stay fetchable, or its tag is never read');
  const groups = robots.split(/\n\s*\n/).filter(g => /^User-agent:/m.test(g));
  for (const g of groups) assert.match(g, /^Disallow: \/api\/$/m, `every group keeps /api/ out: ${g.split('\n')[0]}`);
  for (const bot of ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) assert.match(robots, new RegExp(`^User-agent: ${bot}$`, 'm'), bot);
  assert.match(robots, /^Sitemap: https:\/\/freightchain\.fun\/sitemap\.xml$/m);
});

test('sitemap.xml lists exactly the canonical URLs, llms.txt points at them', () => {
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual(locs.sort(), Object.values(URLS).sort());
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/); assert.match(sitemap, /xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
  assert.match(llms, /^# Freight Chain\n\n> /, 'llms.txt: title, then the one-line summary as a blockquote');
  for (const url of Object.values(URLS)) assert.ok(llms.includes(`](${url})`), `llms.txt links ${url}`);
  assert.ok(llms.includes(jsonLd(pages.landing)[0]['@graph'].find(n => n.name && n.description).description.replace(/\.$/, '')), 'the same one-line description as the JSON-LD');
});

test('IndexNow key: 32 hex characters, nothing else in the file', () => {
  assert.match(read(join(root, 'public/indexnow-key.txt')), /^[0-9a-f]{32}$/);
});

test('crawlers that run no JavaScript see neutral placeholders, not zeros (an AI summary would quote "0 rides")', () => {
  for (const id of ['hero-pot', 'hero-live', 'hero-km', 'hero-time']) assert.match(pages.landing, new RegExp(`id="${id}">–<`), id);
  assert.match(pages.landing, /id="hero-shifts">– rides</);
});
