// Real Chrome on inert local admin response fixtures: no credentials or external requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://fixture.test').pathname;
    if (pathname === '/fixture.html') {
      res.setHeader('content-type', 'text/html');
      res.end(`<html lang="en"><meta charset="utf-8"><title>Sign-in privacy local fixture</title><link rel="stylesheet" href="site/site.css"><body><main style="max-width:900px;margin:20px auto"></main><script type="module">
import {sessionsTab,playersTab} from './site/admin-directory.js';import {el} from './site/dom.js';
const hash='ab'.repeat(32), now=Date.UTC(2026,9,26),wallet='LocalFixtureWallet';
const rows=[{wallet,lastAt:now,signIns:2,ipHash:hash,network:{status:'observed',asn:'AS15169',mobile:true,hosting:false,anonymous:false,excluded:'mobile'}},{wallet:'SignalUnavailable',lastAt:now,signIns:1,ipHash:null}];
const detail={player:{wallet,createdAt:now,freeRides:5,freeRidesMax:5,freeDay:'2026-10-26'},payments:{count:0,lamports:0},fundingEvidence:{status:'disabled',funder:null,transfers:[],complete:false},stats:null,tickets:[],grants:[],rides:[],signIns:rows.map(r=>({...r,at:now}))};
const ctx={el,view:document.querySelector('main'),time:n=>new Date(n).toISOString(),ago:()=> 'just now',go:()=>{},api:async p=>p.startsWith('players/')?detail:{rows,truncated:false}};
window.showPlayer=()=>playersTab(ctx,wallet);window.showFunding=async value=>{detail.fundingEvidence=value;await playersTab(ctx,wallet)};await sessionsTab(ctx);window.ready=true;
</script></body></html>`); return;
    }
    if (pathname === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
    const path = fileURLToPath(new URL('.' + pathname, new URL('../', import.meta.url)));
    if (!path.startsWith(root)) { res.statusCode = 403; res.end(); return; }
    res.setHeader('content-type', pathname.endsWith('.js') ? 'text/javascript' : 'text/css');
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const chrome = await launch({ port: Number(process.env.PORT || 9481), shotsDir: 'fc-admin-privacy-shots', evalProblems: true });
try {
  await chrome.send('Network.enable'); await chrome.send('Network.setBlockedURLs', { urls: ['https://*'] });
  await chrome.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/fixture.html` });
  for (let i = 0; i < 100 && !await chrome.ev('window.ready===true'); i++) await sleep(50);
  assert.equal(await chrome.ev("document.querySelector('#se-table th:last-child').textContent"), 'subnet hash');
  assert.deepEqual(await chrome.ev("[...document.querySelectorAll('#se-table tbody tr')].map(r=>r.lastChild.textContent)"), ['abababababab…', 'unavailable']);
  assert.equal(await chrome.ev("document.querySelector('#se-table tbody tr td:last-child').title"), 'ab'.repeat(32));
  await chrome.shot('01-admin-session-hashes');
  await chrome.ev('window.showPlayer()');
  assert.equal(await chrome.ev("document.querySelector('#pl-signins th:nth-child(2)').textContent"), 'subnet hash');
  assert.equal(await chrome.ev("document.querySelector('#pl-signins').textContent.includes('unavailable')"), true);
  assert.equal(await chrome.ev("/browser|user.agent|1\\.2\\.3\\.4/i.test(document.querySelector('#pl-signins').textContent)"), false);
  assert.equal(await chrome.ev("document.querySelector('#pl-signins').textContent.includes('mobile — excluded')"), true);
  assert.equal(await chrome.ev("document.querySelector('#pl-funding-evidence').textContent.includes('disabled')"), true);
  await chrome.ev("window.showFunding({status:'incomplete',funder:null,transfers:[{},{}],complete:false})");
  assert.equal(await chrome.ev("document.querySelector('#pl-funding-evidence').textContent.includes('2 observed transfers · history incomplete')"), true);
  await chrome.ev("window.showFunding({status:'observed',funder:{wallet:'LocalExchangeWallet',type:'exchange'},excluded:'exchange'})");
  assert.equal(await chrome.ev("document.querySelector('#pl-funding-evidence').textContent.includes('exchange — excluded')"), true);
  await chrome.ev("document.querySelector('#pl-signins').scrollIntoView()"); await chrome.shot('02-admin-player-hashes');
  assert.deepEqual(chrome.filt(), []);
  console.log('PASS admin privacy Chrome: subnet hash label, truncated display/full tooltip, unavailable signal, player history, no raw address/browser columns; disabled/incomplete funding and mobile/exchange exclusions.');
} finally { await chrome.close(); await new Promise(resolve => server.close(resolve)); }
