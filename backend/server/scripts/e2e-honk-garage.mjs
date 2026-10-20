// Garage + weekly skill board in real headless Chrome against a RUNNING server.
// TEN4 is the token. The routes stay /api/honk and /api/honk/catalog. The skill board is GET /api/prize/board (not the distance leaderboard).
//   BASE=http://localhost:3104 CHROME_PORT=9234 DATABASE_URL=… node scripts/e2e-honk-garage.mjs
// HONK_PROGRAM_ID unset: a cab visual burns the ledger, no chain signature. DATABASE_URL credits the throwaway ledger (no credit route).
import { PrismaClient } from '@prisma/client';
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';

const BASE = process.env.BASE || 'http://localhost:3111';
const CDP = +(process.env.CHROME_PORT || process.env.PORT || 9234);
const REFERRAL = new Set(['convoy', 'signal', 'amber']);
const fails = [];
const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
const post = async (p, b, c) => { const r = await fetch(`${BASE}/api/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(c && { cookie: c }) }, body: JSON.stringify(b) }); return { r, j: await r.json().catch(() => ({})) }; };
const get = async (p, c) => { const r = await fetch(`${BASE}/api/${p}`, { headers: c ? { cookie: c } : {} }); return { r, j: await r.json().catch(() => ({})) }; };
async function wallet() {
  const kp = nacl.sign.keyPair(), address = bs58.encode(kp.publicKey), { j } = await post('auth/nonce', { wallet: address });
  const { r } = await post('auth/verify', { wallet: address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) });
  return { address, cookie: r.headers.get('set-cookie').split(';')[0] };
}
async function creditTen4(address, whole) {
  if (!process.env.DATABASE_URL) return;
  const prisma = new PrismaClient(), amount = BigInt(whole) * 1_000_000n, updatedAt = new Date();
  try {
    await prisma.honkAccount.upsert({ where: { wallet: address }, create: { wallet: address, balance: amount, minted: 0n, burned: 0n, updatedAt }, update: { balance: amount, updatedAt } });
  } finally { await prisma.$disconnect(); }
}
const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };
async function open(h, w, url) { const [n, v] = w.cookie.split('='); await h.send('Network.setCookie', { name: n, value: v, url: BASE, httpOnly: true }); await h.send('Page.navigate', { url }); }

const me = await wallet();
await creditTen4(me.address, 100);
const catalog = await get('honk/catalog');
const account = await get('honk', me.cookie);
check('GET /api/honk/catalog lists cab parts with prices', catalog.r.status === 200 && Array.isArray(catalog.j) && catalog.j.length >= 9 && catalog.j.some(row => row.price) && catalog.j.some(row => row.isDefault), `${catalog.r.status} · ${catalog.j.length ?? 0} parts`);
check('GET /api/honk returns this wallet’s TEN4 balance', account.r.status === 200 && typeof account.j.balance === 'string', JSON.stringify(account.j).slice(0, 180));
const priced = catalog.j.filter(row => row.price && !(row.slot === 'truck_color' && REFERRAL.has(row.item)));
const board = await get('prize/board?tier=1h');
check('GET /api/prize/board?tier=1h is the weekly skill board', board.r.status === 200 && board.j.tier === '1h' && typeof board.j.weekId === 'string' && Array.isArray(board.j.board), JSON.stringify({ status: board.r.status, tier: board.j.tier, week: board.j.weekId, rows: board.j.board?.length }));

const page = await launch({ port: CDP, shotsDir: 'fc-honk-garage-shots', evalProblems: true });
await page.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await open(page, me, `${BASE}/lobby.html#garage`);
check('garage tab renders the collection and the part slots', await until(() => page.ev(`!!document.getElementById('garage-slots') && !!document.getElementById('garage-progress') && !document.getElementById('view')?.textContent?.includes('Loading')`)));
const dom = await page.ev(`(() => {
  const buttons = [...document.querySelectorAll('#garage-slots button.item')].map(b => ({ id: b.dataset.item, text: b.textContent, worn: b.classList.contains('saved'), locked: b.classList.contains('lock') }));
  return { buttons, balance: document.getElementById('garage-honk')?.textContent ?? '', progress: document.getElementById('garage-progress')?.textContent ?? '' };
})()`);
check('the balance line names TEN4 and matches GET /api/honk', dom.balance === `You hold ${account.j.balance} TEN4.`, dom.balance);
check('every catalog part is a garage button', catalog.j.every(row => dom.buttons.some(b => b.id === row.item)), `buttons ${dom.buttons.length} catalog ${catalog.j.length}`);
const priceOk = priced.every(row => dom.buttons.some(b => b.id === row.item && b.text.includes(`Burns ${row.price} TEN4`)));
check('priced TEN4 parts show the catalog burn price', priceOk, priced.filter(row => !dom.buttons.some(b => b.id === row.item && b.text.includes(`Burns ${row.price} TEN4`))).slice(0, 3).map(row => row.item).join(','));
check('the worn defaults say WORN and locked parts stay locked', dom.buttons.some(b => b.worn && b.text.includes('WORN')) && dom.buttons.some(b => b.locked && b.text.includes('🔒')));
await page.ev(`document.querySelector('#garage-slots button.item[data-item="crimson"]').click()`);
check('a locked wheel shows its TEN4 price and a burn button', await until(() => page.ev(`(() => { const d = document.getElementById('garage-detail')?.textContent || ''; return d.includes('Burns 65 TEN4') && !!document.getElementById('garage-burn') && d; })()`)), await page.ev(`document.getElementById('garage-detail')?.textContent || ''`));
await page.shot('garage-price');
const beforeBurn = account.j.balance;
await page.ev(`document.getElementById('garage-burn').click()`);
check('burning the part equips it and the balance drops', await until(() => page.ev(`(() => { const msg = document.getElementById('garage-msg')?.textContent || ''; const bal = document.getElementById('garage-honk')?.textContent || ''; const worn = document.querySelector('#garage-slots button.item[data-item="crimson"]')?.textContent || ''; return /Minted by burning TEN4/.test(msg) && bal !== ${JSON.stringify(`You hold ${beforeBurn} TEN4.`)} && /WORN/.test(worn) && bal; })()`)), await page.ev(`(document.getElementById('garage-msg')?.textContent || '') + ' | ' + (document.getElementById('garage-honk')?.textContent || '')`));
const after = await get('honk', me.cookie);
check('GET /api/honk shows the balance the garage painted', (await page.ev(`document.getElementById('garage-honk')?.textContent`)) === `You hold ${after.j.balance} TEN4.`, after.j.balance);
await page.shot('garage-equipped');

const fromPage = await page.ev(`(async () => { const r = await fetch('/api/prize/board?tier=1h', { credentials: 'include' }); const j = await r.json(); return { status: r.status, tier: j.tier, weekId: j.weekId, phase: j.phase, rows: Array.isArray(j.board) ? j.board.length : -1, places: (j.board || []).map(row => row.place) }; })()`);
check('the page loads GET /api/prize/board without throwing', fromPage.status === 200 && fromPage.tier === '1h' && fromPage.weekId === board.j.weekId && fromPage.rows === board.j.board.length && fromPage.places.every((n, i) => n === board.j.board[i].place), JSON.stringify(fromPage));
await page.ev(`location.hash = '#board'`);
check('the leaderboard tab is separate and still renders', await until(() => page.ev(`/LEADERBOARD/.test(document.querySelector('#view h2')?.textContent || '') && !!document.getElementById('board-body')`)));
await page.shot('board');
const problems = page.filt().filter(p => !/favicon|status of 4\d\d/.test(p));
check('no page errors', problems.length === 0, problems.join(' | '));
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall garage checks passed');
page.finish(fails.length ? 1 : 0);
