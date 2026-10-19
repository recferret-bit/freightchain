// Tell IndexNow (Bing, Yandex, Seznam, Naver… – Bing's index also feeds ChatGPT search and Copilot) that the public pages changed: node indexnow.mjs <site-url> [--dry-run]
// Reads the LIVE sitemap, groups its URLs by host and posts each group with the key from landing/public/indexnow-key.txt (served at /indexnow-key.txt on every host).
// The deploy runs it after the smoke test; a failure only warns. Google does not take IndexNow – it reads the sitemap named in robots.txt.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [base, ...rest] = process.argv.slice(2), dry = rest.includes('--dry-run');
if (!base) { console.error('usage: node indexnow.mjs <site-url> [--dry-run]'); process.exit(2); }
const key = readFileSync(fileURLToPath(new URL('../../../frontend/landing/public/indexnow-key.txt', import.meta.url)), 'utf8').trim();
const res = await fetch(`${base.replace(/\/$/, '')}/sitemap.xml`, { signal: AbortSignal.timeout(20_000) });
if (!res.ok) { console.error(`sitemap: ${res.status}`); process.exit(1); }
const urls = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
const byHost = Map.groupBy(urls, u => new URL(u).host);
let failed = 0;
for (const [host, urlList] of byHost) {
  const body = { host, key, keyLocation: `https://${host}/indexnow-key.txt`, urlList };
  if (dry) { console.log(`would submit ${urlList.length} URL(s) for ${host}: ${urlList.join(' ')}`); continue; }
  const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const ok = r.status === 200 || r.status === 202;   // 202 = accepted, the key is checked later
  console.log(`${ok ? '✔' : '✘'} IndexNow ${host}: ${r.status} (${urlList.length} URL(s))`); if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
