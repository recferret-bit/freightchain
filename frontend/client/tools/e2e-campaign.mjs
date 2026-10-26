// Inert campaign HTTP fixtures + real Chrome. No provider requests, wallet signatures or chain traffic.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const status = () => ({ campaign: 'preseason', code: 'FC-LocalWallet123', completedTasks: 1, points: 0, rideUnlocked: true, telegram: { bound: false, member: false, groupMember: false, active: false, loginBot: null, channel: '@FreightChain', group: '@FreightChainChat' }, x: { bound: false, ageOk: false, followersOk: false, follows: false, quoteOk: false }, turnstile: { required: false, passed: false, siteKey: null }, tasksComplete: false, event: { enabled: false, startsAt: null, lastStartAt: null, rulesAccepted: false, attemptGranted: false } });
let row = status(), fail = false;
const calls = [];
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://local.test').pathname;
    if (pathname.startsWith('/api/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      calls.push({ path: pathname, body: body ? JSON.parse(body) : null });
      res.setHeader('content-type', 'application/json');
      if (fail) { res.statusCode = 503; res.end(JSON.stringify({ detail: 'X verification is pending; retry in ten minutes' })); return; }
      if (pathname.endsWith('/verify-x')) { row.x = { bound: true, ageOk: true, followersOk: true, follows: true, quoteOk: true }; row.completedTasks = 2; }
      if (pathname.endsWith('/verify-telegram')) { row.telegram = { ...row.telegram, bound: true, member: true, groupMember: true, active: true }; row.completedTasks = 3; row.tasksComplete = true; row.event = { ...row.event, enabled: true, startsAt: '2026-11-09T00:00:00Z', lastStartAt: '2026-11-15T10:45:00Z' }; }
      if (pathname.endsWith('/claim-attempt')) row.event = { ...row.event, attemptGranted: true, rulesAccepted: true };
      res.end(JSON.stringify(row)); return;
    }
    if (pathname === '/fixture.html') {
      res.setHeader('content-type', 'text/html');
      res.end(`<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Campaign local fixture</title><link rel="stylesheet" href="site/site.css"><link rel="stylesheet" href="site/lobby.css"><body><main style="max-width:850px;margin:20px auto"><script type="module">import {campaignSection} from './site/lobby-campaign.js'; const api=async(path,body)=>{const r=await fetch('/api/'+path,{credentials:'include',method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined}); const value=await r.json(); if(!r.ok)throw new Error(value.detail); return value;};document.querySelector('main').append(...campaignSection({api}));</script></main></body></html>`); return;
    }
    if (pathname === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
    const path = fileURLToPath(new URL('.' + pathname, new URL('../', import.meta.url)));
    if (!path.startsWith(root)) { res.statusCode = 403; res.end(); return; }
    res.setHeader('content-type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/plain');
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const chrome = await launch({ port: +(process.env.PORT || 59443), shotsDir: 'fc-campaign-shots', evalProblems: true });
const until = async test => { for (let i = 0; i < 60; i++) { if (await chrome.ev(test)) return; await sleep(50); } throw new Error(`Timed out: ${test}`); };
const click = id => chrome.ev(`document.getElementById(${JSON.stringify(id)}).click()`);
try {
  await chrome.send('Network.enable'); await chrome.send('Network.setBlockedURLs', { urls: ['https://*'] });
  await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/fixture.html` });
  await until("document.querySelector('#campaign-code')?.textContent === 'FC-LocalWallet123'");
  assert.equal(await chrome.ev("document.querySelector('#campaign-attempt') === null"), true);
  await click('campaign-verify-x');
  await until("document.querySelector('#campaign-msg').textContent.includes('valid X post')");
  assert.equal(calls.filter(c => c.path.endsWith('/verify-x')).length, 0);
  await chrome.ev("for(const [id,value] of [['campaign-x-handle','ada'],['campaign-x-post','https://x.com/ada/status/123']]){const field=document.getElementById(id);field.value=value;field.dispatchEvent(new Event('input'));}");
  fail = true; await click('campaign-verify-x');
  await until("document.querySelector('#campaign-msg').textContent.includes('ten minutes')");
  fail = false; await click('campaign-verify-x');
  await until("document.querySelector('#campaign-box').textContent.includes('2 of 3')");
  assert.deepEqual(calls.find(c => c.path.endsWith('/verify-x')).body, { handle: 'ada', postId: '123' });
  await chrome.ev("window[Object.keys(window).find(k=>k.startsWith('fcCampaignTelegram'))]({id:42,first_name:'Fixture',auth_date:1,hash:'0'.repeat(64)})");
  await until("document.querySelector('#campaign-attempt') && !document.querySelector('#campaign-attempt').disabled");
  await click('campaign-attempt');
  await until("document.querySelector('#campaign-msg').textContent.includes('Accept the event rules')");
  assert.equal(calls.filter(c => c.path.endsWith('/claim-attempt')).length, 0);
  await click('campaign-rules'); await click('campaign-attempt');
  await until("document.querySelector('#campaign-attempt').textContent.includes('ATTEMPT ISSUED')");
  assert.equal(calls.filter(c => c.path.endsWith('/claim-attempt')).length, 1);
  await chrome.ev('window.scrollTo(0,0)'); await chrome.shot('01-campaign-en');
  await click('campaign-language');
  await until("document.querySelector('#campaign').textContent === 'КАМПАНИЯ'");
  assert.equal(await chrome.ev("document.querySelector('#campaign-box').lang"), 'ru');
  assert.equal(await chrome.ev("document.querySelector('#campaign-attempt').textContent.includes('ПОПЫТКА ВЫДАНА')"), true);
  await chrome.shot('02-campaign-ru');
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await chrome.ev('window.scrollTo(0,0)'); await chrome.shot('03-campaign-mobile');
  await chrome.ev('window.scrollTo(0,document.documentElement.scrollHeight)'); await chrome.shot('04-campaign-mobile-actions');
  assert.equal(await chrome.ev('document.documentElement.scrollWidth <= window.innerWidth'), true);
  assert.deepEqual(chrome.filt().filter(p => !p.includes('503 (Service Unavailable)') || !p.includes('/api/airdrop/verify-x')), []);
  console.log('PASS campaign Chrome: task progress, X validation/retry, Telegram callback, event consent/idempotence, EN/RU, mobile.');
} finally { await chrome.close(); await new Promise(resolve => server.close(resolve)); }
