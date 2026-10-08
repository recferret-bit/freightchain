// The lobby's ticket flows that the real server can't run yet (W3 orders / W4 chain), in real headless Chrome against scripts/stub-api.mjs with a FAKE wallet:
// BUY (gasless: signTransaction → /submit, then self-paid: signAndSendTransaction), a buy that takes an open pool live, CLAIM REFUND on a failed pool (card + strip), the grant trail.
// Needs internet once for web3.js (jsdelivr, as pay.js loads it). Nothing is signed for real and nothing is sent to any chain.   Usage (from server/): node scripts/e2e-tickets-stub.mjs
// PORT = the DevTools port (default 9351), STUB_PORT = the stub's first port (default 3150; the self-paid run uses +1), SHOTS = screenshot dir (default $TMPDIR/fc-tickets-shots).
import { spawn } from 'node:child_process';
import { launch, sleep } from '../../client/tools/cdp.mjs';
const CDP = +(process.env.PORT || 9351), STUB = +(process.env.STUB_PORT || 3150);
const T0 = Date.now(), fails = []; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} [${((Date.now() - T0) / 1000).toFixed(0)} s] ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
const until = async (fn, ms = 20000) => { for (let i = 0; i <= ms / 250; i++) { const v = await fn(); if (v) return v; await sleep(250); } return false; };   // counts polls, not wall time: a laptop that sleeps mid-run must not time a check out
const stubs = [];
async function stub(port, env) {
  const p = spawn('node', [new URL('./stub-api.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'inherit'] }); stubs.push(p);
  process.on('exit', () => p.kill());
  await new Promise(ok => p.stdout.once('data', ok));
  return `http://localhost:${port}`;
}
// a fake Phantom: "signs" by handing the transaction back (the stub only parses it), "sends" by inventing a signature; it records what was asked
const FAKE = `window.__asked = []; window.phantom = { solana: { isPhantom: true, publicKey: null,
  connect: async () => ({}), disconnect: async () => {},
  signTransaction: async tx => { __asked.push('signTransaction'); return tx; },
  signAndSendTransaction: async tx => { __asked.push('signAndSendTransaction'); return { signature: 'self' + Math.random().toString(36).slice(2) }; } } };`;
const h = await launch({ port: CDP, shotsDir: 'fc-tickets-shots', evalProblems: true });
await h.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
const size = (w, hgt, mobile) => h.send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile });
const txt = sel => h.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);
const click = sel => h.ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
await size(1100, 900, false);

// ── sponsored (gasless) stub
let BASE = await stub(STUB, { SPONSORED: '1' });
await h.send('Page.navigate', { url: `${BASE}/lobby.html#new` });
check('lobby on the stub: four cards', await until(async () => (await h.ev('document.querySelectorAll(".tier").length')) === 4));
check('8h = a FAILED pool: red chip, CLAIM REFUND, no BUY', (await txt('#tier-8h .st')) === 'FAILED – REFUND' && (await txt('#tier-8h .go')) === 'CLAIM REFUND' && !(await h.ev('!!document.querySelector("#tier-8h .buyb")')) && /refunded in full/.test(await txt('#tier-8h .ptext')), await txt('#tier-8h .ptext'));
check('an older failed pool no card shows: its own CLAIM REFUND row', /4H · week 41 \(pool #5\) failed/.test(await txt('#refunds')), await txt('#refunds'));
check('sales on (tiers.ticketSales): BUY is live with the price, the stepper adds', (await txt('#tier-1h .buyb')) === 'BUY 1 TICKET · 0.050 SOL' && await (async () => { await click('#tier-1h .qty button:last-child'); return (await txt('#tier-1h .buyb')) === 'BUY 2 TICKETS · 0.100 SOL'; })(), await txt('#tier-1h .buyb'));
await h.shot('stub-new-desktop');
await click('#tier-1h .buyb');
check('BUY (sponsored): "network fee: sponsored" step, then paid + credited', await until(async () => /network fee: sponsored|Waiting for the network/.test(await txt('#msg-1h')), 15000) && await until(async () => /Paid – 2 tickets credited/.test(await txt('#msg-1h')), 30000), await txt('#msg-1h'));
check('…the wallet was only asked to SIGN (the server sends)', JSON.stringify(await h.ev('__asked')) === '["signTransaction"]', JSON.stringify(await h.ev('__asked')));
check('…RIDE now has 3 tickets', (await txt('#tier-1h .go')) === 'RIDE (3 left)', await txt('#tier-1h .go'));
await h.ev('[...document.querySelectorAll("#tier-4h .qty button")][1].click(); [...document.querySelectorAll("#tier-4h .qty button")][1].click()');
await click('#tier-4h .buyb');
check('buying the last 3 of an open pool takes it LIVE: chip + RIDE (3 left)', await until(async () => (await txt('#tier-4h .st')) === 'LIVE' && (await txt('#tier-4h .go')) === 'RIDE (3 left)', 30000), `${await txt('#tier-4h .st')} / ${await txt('#tier-4h .go')}`);
await click('#tier-8h .go');
check('CLAIM REFUND (card): the signature links to the explorer', await until(async () => /Refund sent/.test(await txt('#msg-8h')), 20000) && /explorer\.solana\.com\/tx\/.+cluster=devnet/.test(await h.ev('document.querySelector("#msg-8h a")?.href ?? ""')), await txt('#msg-8h'));
check('…and the card no longer offers it (nothing left to refund)', await until(async () => !(await h.ev('!!document.querySelector("#tier-8h .go")'))));
await click('#refunds button');
check('CLAIM REFUND (strip row): sent', await until(async () => /Refund sent/.test(await txt('#msg-refund-5')) || (await txt('#refunds')) === '', 20000), await txt('#refunds'));
await size(390, 844, true); await sleep(300); await h.shot('stub-new-phone'); await size(1100, 900, false);
await h.ev('location.hash = "#profile"');
check('PROFILE: the bought tickets in the audit trail', await until(async () => /bought on chain\s*\S*\+2/.test(await h.ev('[...document.querySelectorAll(".hist .hrow")].map(n => n.textContent).join("|")'))), await h.ev('[...document.querySelectorAll(".hist .hrow")].map(n => n.textContent).join("|")'));
await h.shot('stub-profile-desktop');

// ── self-paid stub (no sponsor): the wallet signs AND sends
BASE = await stub(STUB + 1, { SPONSORED: '0' });
await h.ev('__asked.length = 0'); await h.send('Page.navigate', { url: `${BASE}/lobby.html#new` }); await until(async () => (await h.ev('document.querySelectorAll(".tier").length')) === 4);
await click('#tier-1h .buyb');
check('BUY (self-paid): fee estimate shown, signAndSendTransaction, credited', await until(async () => /Paid – 1 ticket credited/.test(await txt('#msg-1h')), 30000) && JSON.stringify(await h.ev('__asked')) === '["signAndSendTransaction"]', `${await txt('#msg-1h')} ${JSON.stringify(await h.ev('__asked'))}`);

const pr = h.filt().filter(p => !/status of 409/.test(p)); check('no page errors', !pr.length, pr.join(' | '));
console.log(`screenshots: ${h.SHOTS}`);
for (const p of stubs) p.kill();
h.finish(fails.length ? 1 : 0, 300);
