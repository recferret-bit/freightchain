// The model EDITOR in real headless Chrome against a RUNNING server + the REAL entity MCP (mcp/src/http.js):
// an observer sees the viewer and a sign-in box; a wallet NOT on EDITOR_WALLETS is refused; the editor signs in (a fake Phantom holding a real keypair),
// edits an entity by hand (SOURCE: check → save draft), finds it in HISTORY, previews it, PUBLISHES it with a signature – and the public bundle the game
// loads now carries it; then a CHAT job (the server's fake model, EDITOR_FAKE_LLM=1) runs through the MCP's tools and saves a draft the viewer previews;
// a request the 3d-assets spec gate rejects ("a car with 2 wheels") never reaches a model. Screenshots in $SHOTS (fc-editor-shots).
// Easiest via `bash .claude/skills/run-tests/e2e.sh editor` (starts the MCP + the server with the right env).
//   EDITOR_KEYPAIR=<path to a JSON array secret key> BASE=http://localhost:<port> CHROME_PORT=… node scripts/e2e-editor.mjs
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../client/tools/cdp.mjs';

const BASE = process.env.BASE || 'http://localhost:3111', PORT = +(process.env.CHROME_PORT || 9361);
const fails = []; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
/* ev() answers an exception's TEXT when the expression throws – a probe wraps itself so a throw is false, never a truthy string */
const probe = (h, expr) => h.ev(`(async () => { try { return await (${expr}); } catch (e) { return false; } })()`);
const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };
const b64u = bytes => Buffer.from(bytes).toString('base64url');
/* a fake Phantom (window.solana) holding THIS keypair: WebCrypto ed25519 – the server verifies real signatures */
const fakeWallet = kp => `(() => {
  const jwk = { kty: 'OKP', crv: 'Ed25519', d: ${JSON.stringify(b64u(kp.secretKey.slice(0, 32)))}, x: ${JSON.stringify(b64u(kp.publicKey))} };
  const key = crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']), pub = ${JSON.stringify(bs58.encode(kp.publicKey))};
  window.__signed = 0;
  window.solana = { isPhantom: true, publicKey: null,
    async connect() { this.publicKey = { toString: () => pub }; return { publicKey: this.publicKey }; },
    async signMessage(msg) { window.__signed++; window.__lastMessage = new TextDecoder().decode(msg); return { signature: new Uint8Array(await crypto.subtle.sign('Ed25519', await key, msg)) }; },
    async disconnect() {} };
})();`;
const bundle = async () => (await fetch(`${BASE}/api/entities/bundle`)).json();
const bushOf = b => b.entities.find(e => e.id === 'bush');

const editorKp = nacl.sign.keyPair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.EDITOR_KEYPAIR, 'utf8')))), strangerKp = nacl.sign.keyPair();
const before = await bundle();
check('the public bundle answers with every entity', before.entities?.length >= 46, `${before.entities?.length} entities, rev ${before.rev}`);

/* ---------- a stranger: sees the viewer, is refused as an editor ---------- */
{
  const S = await launch({ port: PORT, shotsDir: 'fc-editor-shots' });
  await S.send('Page.addScriptToEvaluateOnNewDocument', { source: fakeWallet(strangerKp) });
  await S.send('Page.navigate', { url: `${BASE}/viewer.html?edit#route66%2Fbush` });
  check('the viewer boots from the API bundle', await until(() => probe(S, '!!window.__viewer && __viewer.items.length > 100'), 60000));
  check('the editor drawer shows a sign-in box', await until(() => probe(S, `!!document.querySelector('#editor .ed-signin') && !document.querySelector('#editor .ed-signin').hidden`)));
  await S.shot('01-observer');
  await S.ev(`[...document.querySelectorAll('#editor button')].find(b => b.textContent === 'CONNECT WALLET').click()`);
  const msg = await until(() => probe(S, `(document.querySelector('#editor .ed-msg')?.textContent || '').includes('not on the editor list') && document.querySelector('#editor .ed-msg').textContent`));
  check('a wallet that is not on EDITOR_WALLETS is refused', !!msg, String(msg));
  check('… and gets no editor tabs', await probe(S, `!document.querySelector('#editor .ed-tabs').offsetParent`));
  await S.shot('02-stranger-refused');
}

/* ---------- the editor ---------- */
const E = await launch({ port: PORT + 1, shotsDir: 'fc-editor-shots' });
await E.send('Page.addScriptToEvaluateOnNewDocument', { source: fakeWallet(editorKp) });
await E.send('Page.navigate', { url: `${BASE}/viewer.html?edit#route66%2Fbush` });
check('the editor\'s viewer boots', await until(() => probe(E, '!!window.__viewer && __viewer.items.length > 100'), 60000));
await until(() => probe(E, `[...document.querySelectorAll('#editor button')].some(b => b.textContent === 'CONNECT WALLET')`));   // the editor is a dynamic import: it mounts after __viewer exists
await E.ev(`[...document.querySelectorAll('#editor button')].find(b => b.textContent === 'CONNECT WALLET').click()`);
check('the editor signs in (one signature)', await until(() => probe(E, `!document.querySelector('#editor .ed-tabs').hidden && window.__signed === 1`)), await probe(E, `'signed ' + window.__signed + ' · ' + document.querySelector('#editor .ed-msg').textContent + ' · solana ' + typeof window.solana`));
const tab = t => E.ev(`[...document.querySelectorAll('#editor .ed-tab')].find(b => b.textContent === ${JSON.stringify(t)}).click()`);
const click = t => E.ev(`[...document.querySelectorAll('#editor button')].find(b => b.textContent === ${JSON.stringify(t)} && !b.disabled)?.click() ?? 'missing'`);

// SOURCE: a hand edit of the bush (wider), check, save as a draft
const width = () => probe(E, `+(__viewer.obj?.children[0]?.scale.x ?? 0).toFixed(3)`);
const wide0 = await width();
await tab('SOURCE');
check('SOURCE shows the head of the selected entity (bush)', await until(() => probe(E, `document.querySelector('#editor .ed-src').value.includes("id: 'bush'")`)));
await E.ev(`(() => { const t = document.querySelector('#editor .ed-src'); t.value = t.value.replace("s: ['s', 's * 0.9', 's']", "s: ['s * 1.6', 's * 0.9', 's * 1.6']"); })()`);
await click('CHECK');
check('CHECK runs the validator in the page', await until(() => probe(E, `(document.querySelector('#editor .ed-out')?.textContent || '').startsWith('valid')`)));
await E.ev(`document.querySelector('#editor .ed-in:not(.ed-newid)').value = 'wider bush (e2e)'`);
await click('SAVE DRAFT');
const saved = await until(() => probe(E, `(document.querySelector('#editor .ed-msg')?.textContent || '').match(/saved bush #(\\d+)/)?.[1]`));
check('SAVE DRAFT stores a revision', !!saved, `#${saved}`);
const wide = await until(async () => { const w = await width(); return w > wide0 * 1.5 && w; });
check('the viewer previews the draft at once (the bush is 1.6× wider)', !!wide, `scale.x ${wide0} → ${wide}`);
await E.shot('03-source-saved');
check('the draft is NOT in the public bundle', JSON.stringify(bushOf(await bundle())) === JSON.stringify(bushOf(before)));

// HISTORY: the new head, a diff, a signed publish
await tab('HISTORY');
check('HISTORY lists the draft as HEAD', await until(() => probe(E, `[...document.querySelectorAll('#editor .ed-item')].some(i => i.textContent.includes('#${saved}') && i.textContent.includes('HEAD'))`)));
await E.ev(`[...document.querySelectorAll('#editor .ed-item')].find(i => i.textContent.includes('#${saved}')).click()`);
await until(() => probe(E, `[...document.querySelectorAll('#editor button')].some(b => b.textContent === 'PUBLISH')`));
for (let i = 0; i < 3 && (await click('PUBLISH')) === 'missing'; i++) await sleep(500);   // the list may re-render under the click
check('PUBLISH asks the wallet to sign the entity + revision', await until(() => probe(E, `window.__signed === 2 && /bush/.test(window.__lastMessage)`)), await E.ev('window.__lastMessage?.split("\\n").slice(0, 3).join(" | ")'));
const after = await until(async () => { const b = await bundle(); return b.rev !== before.rev && b; }, 30000);
check('the public bundle now carries the published bush', !!after && JSON.stringify(bushOf(after).parts).includes('s * 1.6'), after ? `rev ${before.rev} → ${after.rev}` : 'unchanged');
check('after PUBLISH the viewer draws the published (wider) bush', !!(await until(async () => { const w = await width(); return w > wide0 * 1.5 && w; })));
await tab('HISTORY');
check('HISTORY lists each revision once', await until(() => probe(E, `(() => { const ids = [...document.querySelectorAll('#editor .ed-revs > .ed-item b')].map(b => b.textContent); return ids.length >= 2 && new Set(ids).size === ids.length; })()`)));
await E.shot('04-published');

// CHAT: a job with the server's fake model through the real MCP; the draft it saves is previewed
await tab('CHAT');
await until(() => probe(E, `[...document.querySelectorAll('#editor .ed-sel option')].some(o => o.value === 'fake')`));
await E.ev(`(() => { const s = [...document.querySelectorAll('#editor .ed-sel')].find(x => [...x.options].some(o => o.value === 'fake')); s.value = 'fake'; s.dispatchEvent(new Event('change')); document.querySelector('#editor .ed-prompt').value = 'make the bush look drier'; })()`);
await click('SEND');
const done = await until(() => probe(E, `(() => { const t = document.querySelector('#editor .ed-log')?.textContent || ''; return /done – the result is a DRAFT/.test(t) ? t : /failed|cancelled/.test(t) && 'FAILED ' + t; })()`), 60000);
check('a chat job runs through the MCP and saves a draft', !!done && !String(done).startsWith('FAILED'), String(done).slice(0, 300));
check('… its tool calls are in the log (get_entity, check_entity, save_draft)', /get_entity[\s\S]*check_entity[\s\S]*save_draft/.test(String(done)));
await E.shot('05-chat-job');
await tab('SOURCE');
check('the job\'s draft is the new head (the fake model\'s note)', await until(() => probe(E, `document.querySelector('#editor .ed-src').value.includes("fake edit: make the bush look drier")`)));

// the spec gate: an impossible car never reaches a model
await E.ev(`__viewer.select('sedan')`); await tab('CHAT');
await E.ev(`document.querySelector('#editor .ed-prompt').value = 'a car with 2 wheels'`); await click('SEND');
check('the 3d-assets spec gate refuses "a car with 2 wheels" before any model runs', await until(() => probe(E, `/wheels must be 4/.test(document.querySelector('#editor .ed-log')?.textContent || '')`)));
await E.shot('06-spec-refused');

// the game draws what the API publishes
await E.send('Page.navigate', { url: `${BASE}/play.html` });
check('the game boots from the API bundle', await until(() => probe(E, `!!window.__game && !document.body.textContent.includes('could not be loaded')`), 30000));
await sleep(1500); await E.shot('07-game');

const problems = E.problems.filter(p => !/favicon|status of 4\d\d/.test(p));
for (const p of problems) check('page problem', false, p);
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall editor checks passed');
await E.finish(fails.length ? 1 : 0);
