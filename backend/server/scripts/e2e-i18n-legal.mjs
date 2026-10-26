// Real API + PostgreSQL + Chrome acceptance of explicit versioned consent and existing EN/RU legal surfaces.
// BASE and DATABASE_URL must identify the disposable runner. Chrome failure is a failure, never a skip.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PrismaClient } from '@prisma/client';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';

const BASE = process.env.BASE || process.env.E2E_BASE;
assert(BASE && ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname), 'explicit local disposable API required');
const db = process.env.DATABASE_URL || process.env.E2E_DATABASE_URL;
assert(db && /freightchain_(?:e2e|consent)/.test(new URL(db).pathname), 'disposable acceptance database required');
const prisma = new PrismaClient({ datasources: { db: { url: db } } });
let chrome;
const check = (name, ok, info = '') => { assert(ok, `${name}: ${info}`); console.log(`ok   ${name}${info ? ` – ${info}` : ''}`); };
async function call(method, path, body, cookie) {
  const r = await fetch(`${BASE}/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? cookie, json: await r.json() };
}
try {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const nonce = await call('POST', 'auth/nonce', { wallet });
  const signed = await call('POST', 'auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(nonce.json.message), kp.secretKey)) });
  assert.equal(signed.status, 200); const cookie = signed.cookie;
  const get = path => call('GET', path, undefined, cookie);
  const status = (await get('profile/terms')).json;
  check('sign-in never invents version acceptance', status.required && status.acceptedTermsVersion < status.termsVersion);
  const count = async () => Number((await prisma.$queryRaw`SELECT count(*) FROM player."TermsAcceptance" WHERE wallet=${wallet}`)[0].count);
  check('new wallet has no acceptance audit', await count() === 0);
  chrome = await launch({ port: Number(process.env.CHROME_PORT || 9375), shotsDir: 'fc-consent-shots', evalProblems: true });
  const [name, value] = cookie.split('='); await chrome.send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
  const until = async (expr, ms = 15000) => { for (let end = Date.now() + ms; Date.now() < end;) { if (await chrome.ev(expr)) return true; await sleep(150); } return false; };
  const open = async path => { await chrome.send('Page.navigate', { url: `${BASE}${path}` }); };
  await open('/lobby.html?lang=en#profile');
  check('first authenticated lobby opens explicit consent', await until('!!document.querySelector("#terms-dialog[open]")'));
  check('age is unchecked and acceptance disabled', await chrome.ev('!document.querySelector("#terms-age").checked && document.querySelector("#terms-accept").disabled'));
  check('review links and visible draft label exist', await chrome.ev('document.querySelectorAll("#terms-dialog a").length === 2 && /draft/i.test(document.querySelector("#terms-dialog").textContent)'));
  await chrome.ev('document.querySelector("[data-terms-lang=ru]").click()');
  check('Russian consent meaning includes age, privacy and training', await chrome.ev('/18/.test(document.querySelector("#terms-dialog").textContent) && /конфиденциальности/.test(document.querySelector("#terms-dialog").textContent) && /Тренировки/.test(document.querySelector("#terms-dialog").textContent)'));
  await chrome.shot('consent-ru');
  await chrome.ev('document.querySelector("#terms-decline").click()');
  check('refusal persists no consent or audit', (await get('profile/terms')).json.required && await count() === 0);
  const training = await call('POST', 'rides', { tier: 'free', level: 1 }, cookie);
  check('training remains available after refusal', training.status === 200, JSON.stringify(training.json));
  check('profile legal copy follows Russian', await until('/МНЕ ИСПОЛНИЛОСЬ 18 ЛЕТ/.test(document.querySelector("#offer")?.textContent || "")'));
  await chrome.ev('document.querySelector("#agree-loss").click()');
  check('a protected write opens consent again without silently accepting', await until('!!document.querySelector("#terms-dialog[open]")') && await count() === 0);
  await chrome.ev('document.querySelector("#terms-age").click(); document.querySelector("#terms-accept").click()');
  check('explicit acceptance closes the modal', await until('!document.querySelector("#terms-dialog")'));
  check('accepted versions persist and append one record', !(await get('profile/terms')).json.required && await count() === 1);
  const accepted = { termsVersion: status.termsVersion, privacyVersion: status.privacyVersion, age18: true, accepted: true };
  const repeated = await call('POST', 'profile/terms', accepted, cookie);
  check('duplicate acceptance is idempotent', repeated.status === 200 && await count() === 1);
  await open('/lobby.html#profile');
  check('saved language survives navigation', await until('document.documentElement.lang === "ru" && /ПОВТОРЫ/.test(document.querySelector("[data-i18n=\\"lobby.tab.replays\\"]")?.textContent || "")'), 'ПОВТОРЫ');
  check('accepted wallet is not asked on reload', !(await chrome.ev('!!document.querySelector("#terms-dialog")')));
  const untranslated = await chrome.ev('[...document.querySelectorAll("[data-i18n]")].filter(n => !n.textContent.trim() || n.textContent.trim() === n.dataset.i18n).length');
  check('chrome data-i18n nodes are translated', untranslated === 0, `untranslated ${untranslated}`);
  await chrome.ev('document.querySelector("[data-set-lang=en]").click()');
  check('agreement card switches back to English', await until('/BEFORE A PAID SHIFT/.test(document.querySelector("#offer")?.textContent || "")'));
  await chrome.ev('document.querySelector("#agree-loss").click()');
  check('loss agreement saves through the real API after consent', await until('document.querySelector("#agree-loss")?.checked && document.querySelector("#agree-loss")?.disabled'));
  check('both profile agreements persist', (await get('profile')).json.agreements.loss === true && (await get('profile')).json.agreements.age18 === true);
  await prisma.$executeRaw`UPDATE player."Player" SET "termsVersion"=0 WHERE wallet=${wallet}`;
  await open('/lobby.html?lang=en#profile');
  check('an older stored version requires consent again', await until('!!document.querySelector("#terms-dialog[open]")'));
  await chrome.ev('document.querySelector("#terms-decline").click()');
  const refused = await call('PUT', 'profile/agreements', { age18: true, loss: true }, cookie);
  check('stale version refuses protected writes with 428 terms_required', refused.status === 428 && refused.json.code === 'terms_required');
  await open('/lobby.html?lang=ru#profile');
  assert(await until('!!document.querySelector("#terms-dialog[open]")'));
  await chrome.ev('document.querySelector("#terms-age").click(); document.querySelector("#terms-accept").click()');
  check('re-consent restores current versions without duplicating their immutable audit', await until('!document.querySelector("#terms-dialog")') && !(await get('profile/terms')).json.required && await count() === 1);
  for (const lang of ['en', 'ru']) {
    const source = readFileSync(new URL(`../../../docs/legal/PRESEASON_RULES${lang === 'ru' ? '_RU' : ''}.md`, import.meta.url), 'utf8');
    for (const page of ['terms', 'privacy', 'rules']) {
      await open(`/${page}/?lang=${lang}`);
      check(`${page} ${lang} preserves the full draft source and placeholders`, await until('!!document.querySelector("#legal-text")?.textContent') && await chrome.ev('document.querySelector("#legal-text").textContent') === source);
    }
  }
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  check('legal text fits phone width', await chrome.ev('document.documentElement.scrollWidth <= innerWidth + 1'));
  await chrome.shot('legal-ru-phone');
  const problems = chrome.filt().filter(x => !(/status of 428/.test(x) && /\/api\/profile\/agreements/.test(x)));
  check('no unexpected browser errors', !problems.length, problems.join(' | '));
  console.log('PASS explicit consent, refusal, re-consent, EN/RU and draft legal documents');
} finally { if (chrome) await chrome.close(); await prisma.$disconnect(); }
