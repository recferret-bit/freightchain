// The lobby's ticket flows (W3 orders / W4 chain) without a chain, in real headless Chrome against scripts/stub-api.mjs with a FAKE wallet:
// BUY (the wallet signs AND sends → /confirm), a buy that takes an open pool live, CLAIM REFUND (signAndSend → /api/chain/settle) on a failed pool (card + strip), the grant trail, SOON without the program.
// Needs internet once for web3.js (jsdelivr, as pay.js loads it). Nothing is signed for real and nothing is sent to any chain.   Usage: npm --prefix server run test:tickets-stub
// PORT = the DevTools port (default 9351), STUB_PORT = the stub's first port (default 3150; the other runs use +1…+4), SHOTS = screenshot dir (default $TMPDIR/fc-tickets-shots).
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

// ── the stub: the wallet pays its own fee
let BASE = await stub(STUB, {});
await h.send('Page.navigate', { url: `${BASE}/lobby.html#new` });
check('lobby on the stub: four cards', await until(async () => (await h.ev('document.querySelectorAll(".tier").length')) === 4));
check('8h = a FAILED pool: red chip, CLAIM REFUND, no BUY', (await txt('#tier-8h .st')) === 'FAILED – REFUND' && (await txt('#tier-8h .go')) === 'CLAIM REFUND' && !(await h.ev('!!document.querySelector("#tier-8h .buyb")')) && /refunded in full/.test(await txt('#tier-8h .ptext')), await txt('#tier-8h .ptext'));
check('an older failed pool no card shows: its own CLAIM REFUND row', /4H · week 41 \(pool #5\) failed/.test(await txt('#refunds')), await txt('#refunds'));
check('sales on (tiers.paymentMode = program): BUY is live with the price, the stepper adds', (await txt('#tier-1h .buyb')) === 'BUY 1 TICKET · 0.050 SOL' && await (async () => { await click('#tier-1h .qty button:last-child'); return (await txt('#tier-1h .buyb')) === 'BUY 2 TICKETS · 0.100 SOL'; })(), await txt('#tier-1h .buyb'));
await h.shot('stub-new-desktop');
await click('#tier-1h .buyb');
check('BUY: signed + sent by the wallet, confirmed, credited', await until(async () => /Paid – 2 tickets credited/.test(await txt('#msg-1h')), 30000), await txt('#msg-1h'));
check('…the wallet was asked to sign AND send (it pays its own fee)', JSON.stringify(await h.ev('__asked')) === '["signAndSendTransaction"]', JSON.stringify(await h.ev('__asked')));
check('…RIDE now has 3 tickets', (await txt('#tier-1h .go')) === 'RIDE (3 left)', await txt('#tier-1h .go'));
const dlg = () => h.ev(`(() => { const n = document.getElementById('ticket-dialog'), x = n?.querySelector('#td-share-x'); return n && !n.hidden ? { cls: n.className, title: n.querySelector('#tt-title')?.textContent, rows: [...n.querySelectorAll('dt')].map(d => d.textContent).join(','), tx: n.querySelector('dd a[href*="/tx/"]')?.href ?? '', x: x?.href ?? '', focus: document.activeElement === x } : null; })()`);
const d1 = await dlg(), post = d1 ? new URL(d1.x) : null;
check('…the RIDE PAID dialog: the receipt (paid, pool, transaction, escrow, program) on the explorer, focus on POST ON 𝕏', d1?.cls === 'ok' && d1.title === 'RIDE PAID' && d1.rows === 'paid,pool,transaction,escrow,program' && /explorer\.solana\.com\/tx\/self.+cluster=devnet/.test(d1.tx) && d1.focus, JSON.stringify(d1));
const origin = await h.ev('location.origin'), shareUrl = post?.searchParams.get('url') ?? '';
check('…POST ON 𝕏 is an x.com intent: the paid shift in its text, the site home (a blink) as its url', post?.origin === 'https://x.com' && post.pathname === '/intent/post' && /^Ride paid .*2 tickets for a 1 HOUR shift in @FreightChainSol – 0\.100 SOL .*@solana devnet/.test(post.searchParams.get('text')) && /The link buys one ticket/.test(post.searchParams.get('text')) && shareUrl === `${origin}/` && new URL(shareUrl).pathname === '/' && shareUrl !== d1.tx, d1?.x);
await h.shot('stub-ride-paid-desktop');
await size(390, 844, true); await sleep(300); await h.shot('stub-ride-paid-phone'); await size(1100, 900, false);
await h.ev('[...document.querySelectorAll("#tier-4h .qty button")][1].click(); [...document.querySelectorAll("#tier-4h .qty button")][1].click()');
await click('#tier-4h .buyb');
check('buying the last 3 of an open pool takes it LIVE: chip + RIDE (3 left)', await until(async () => (await txt('#tier-4h .st')) === 'LIVE' && (await txt('#tier-4h .go')) === 'RIDE (3 left)', 30000), `${await txt('#tier-4h .st')} / ${await txt('#tier-4h .go')}`);
const d2 = await dlg(); await h.ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))'); const d3 = await dlg();
check('…the next buy replaced the dialog (3 tickets); Esc closes it', d2?.title === 'RIDE PAID' && !d3, `${JSON.stringify(d2)} → ${JSON.stringify(d3)}`);
await click('#tier-8h .go');
check('CLAIM REFUND (card): the signature links to the explorer', await until(async () => /Refunded – the lamports are back/.test(await txt('#msg-8h')), 20000) && /explorer\.solana\.com\/tx\/.+cluster=devnet/.test(await h.ev('document.querySelector("#msg-8h a")?.href ?? ""')), await txt('#msg-8h'));
check('…and the card no longer offers it (nothing left to refund)', await until(async () => !(await h.ev('!!document.querySelector("#tier-8h .go")'))));
await click('#refunds button');
check('CLAIM REFUND (strip row): sent', await until(async () => /Refunded/.test(await txt('#msg-refund-5')) || (await txt('#refunds')) === '', 20000), await txt('#refunds'));
await size(390, 844, true); await sleep(300); await h.shot('stub-new-phone'); await size(1100, 900, false);
await h.ev('location.hash = "#profile"');
check('PROFILE: the bought tickets in the audit trail', await until(async () => /bought on chain\s*\S*\+2/.test(await h.ev('[...document.querySelectorAll(".hist .hrow")].map(n => n.textContent).join("|")'))), await h.ev('[...document.querySelectorAll(".hist .hrow")].map(n => n.textContent).join("|")'));
await h.shot('stub-profile-desktop');

const fresh = async (port, env) => { BASE = await stub(port, env); await h.ev('__asked.length = 0'); await h.send('Page.navigate', { url: `${BASE}/lobby.html#new` }); await until(async () => (await h.ev('document.querySelectorAll(".tier").length')) === 4); };
const asked = () => h.ev('JSON.stringify(__asked)');

// ── a second purchase on a fresh stub: the wallet signs AND sends, confirm
await fresh(STUB + 2, {});
await click('#tier-1h .buyb');
check('BUY (fresh stub): signAndSendTransaction, confirm, credited', await until(async () => /Paid – 1 ticket credited/.test(await txt('#msg-1h')), 30000) && (await asked()) === '["signAndSendTransaction"]', `${await txt('#msg-1h')} ${await asked()}`);

// ── a payment in flight survives a reload: GET /api/tickets/pending → the banner → RETRY CONFIRM (the signature this browser kept) → paid
await fresh(STUB + 3, { CONFIRM_PENDING: '8' });
await click('#tier-1h .buyb');
await until(async () => /Waiting for the network/.test(await txt('#msg-1h')));
await h.send('Page.reload'); await until(async () => (await h.ev('document.querySelectorAll(".tier").length')) === 4);
check('after a reload: "a payment for 1 ticket is in flight" + RETRY CONFIRM', await until(async () => /A payment for 1 ticket is in flight/.test(await txt('#orderbox')) && (await txt('#orderbox button')) === 'RETRY CONFIRM'), await txt('#orderbox'));
await click('#orderbox button');
check('…RETRY CONFIRM lands it: the banner goes, the ticket is there', await until(async () => (await txt('#orderbox')) === '' && (await txt('#tier-1h .go')) === 'RIDE (2 left)', 30000), `${await txt('#orderbox')} / ${await txt('#tier-1h .go')}`);

// ── a server without the program (paymentMode transfer): BUY is SOON and disabled
await fresh(STUB + 4, { SALES: '0' });
check('no program: BUY TICKETS · SOON, disabled', /SOON/.test(await txt('#tier-1h .buyb')) && await h.ev('document.querySelector("#tier-1h .buyb").disabled'), await txt('#tier-1h .buyb'));

const pr = h.filt().filter(p => !/status of 409/.test(p));
check('no page errors', !pr.length, pr.join(' | '));
console.log(`screenshots: ${h.SHOTS}`);
for (const p of stubs) p.kill();
h.finish(fails.length ? 1 : 0, 300);
