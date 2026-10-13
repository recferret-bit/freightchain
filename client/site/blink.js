/* blink.html – a self-hosted blink client: renders any Solana Action's card and runs its buttons the way the reference client (@dialectlabs/blinks-core)
   does – GET the card, POST { account, type } to a button's href, open an external link, sign a transaction with the injected wallet, then show the
   chained next action. Made for our own actions while dial.to (Dialect's interstitial) is paused, but any action URL works.
   Action requests are anonymous on purpose (credentials 'omit'): action APIs answer CORS `*`, which a browser refuses for a credentialed request,
   and the spec says the GET must not identify the user – so these are not hosts.js API calls; only the default page URL comes from hosts.js.
   Server text only via textContent (el()). */
import { el } from './dom.js';
import { chooseWallet, rememberWallet } from './wallet.js';
import { signAndSend } from './pay.js';
import { SITE_BASE } from '../js/hosts.js';
import { mapRule, resolveHref, unwrap } from './blink-map.js';

const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const CHAIN = { [DEVNET]: 'devnet', [MAINNET]: 'mainnet' };
const $ = id => document.getElementById(id);
const form = $('go'), input = $('url'), out = $('out');
let account = null;

const http = u => /^https?:\/\//.test(u ?? '');
async function json(url, init = {}) {
  const r = await fetch(url, { ...init, credentials: 'omit', headers: { Accept: 'application/json', ...(init.body && { 'Content-Type': 'application/json' }), ...init.headers } });
  const body = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, body, headers: r.headers };
}

/** The input → the action API URL (and the steps taken, shown under the card). */
async function resolve(raw) {
  const u = unwrap(raw);
  if (!u) throw new Error('Paste an https page, a solana-action: URL or a dial.to link.');
  if (u.api) return { api: u.api, how: 'the URL names the action API' };
  const page = new URL(u.site), aj = `${page.origin}/actions.json`;
  const r = await json(aj).catch(() => ({ ok: false, status: 0 }));
  if (!r.ok) return { api: u.site, how: `no ${aj} (${r.status || 'unreachable'}) – trying the URL as the action API` };
  const api = mapRule(r.body?.rules, u.site);
  if (!api) throw new Error(`${aj} has no rule for ${page.pathname}`);
  return { api, how: `${aj} maps ${page.pathname} → ${new URL(api).pathname}` };
}

async function connect() {
  const p = await chooseWallet().catch(e => { throw e.stage === 'no_provider' ? new Error('No Solana wallet in this browser (Phantom, Solflare…). The card renders without one; a button needs one.') : e; });
  rememberWallet(p);
  const r = await p.connect();
  account = String(r?.publicKey ?? p.publicKey);
  $('who').textContent = `${account.slice(0, 4)}…${account.slice(-4)}`;
  return account;
}

const meta = headers => {
  const ids = (headers.get('x-blockchain-ids') || '').split(',').map(s => s.trim()).filter(Boolean);
  return { version: headers.get('x-action-version') || '(none – a client assumes 2.2)', chains: ids.length ? ids.map(id => CHAIN[id] ?? id).join(', ') : '(none – a client assumes mainnet)' };
};

function render(api, card, info, how, note = null) {
  const status = el('p', { class: 'dim', role: 'status' });
  const raw = el('pre', { class: 'raw' }, JSON.stringify(card, null, 2));
  const buttons = (card.links?.actions?.length ? card.links.actions : [{ type: 'transaction', label: card.label, href: api }]).map(a => {
    const href = resolveHref(a.href, api);
    return el('button', { disabled: card.disabled || card.type === 'completed', title: `${a.type ?? 'transaction'} → ${href}`, onclick: e => press(e.currentTarget, a, href, status, api, info) }, a.label);
  });
  out.replaceChildren(el('article', { class: 'card blink' },
    http(card.icon) ? el('img', { src: card.icon, alt: '', width: 440, height: 440, loading: 'lazy' }) : null,
    el('div', { class: 'body' },
      el('p', { class: 'dim host' }, new URL(api).host),
      el('h1', {}, card.title ?? ''),
      el('p', {}, card.description ?? ''),
      card.error?.message ? el('p', { class: 'bad' }, card.error.message) : null,
      card.type === 'completed' ? null : el('div', { class: 'acts' }, buttons),
      note, status)),
  el('dl', { class: 'facts dim' },
    el('dt', {}, 'action API'), el('dd', {}, api),
    el('dt', {}, 'found by'), el('dd', {}, how),
    el('dt', {}, 'X-Action-Version'), el('dd', {}, info.version),
    el('dt', {}, 'X-Blockchain-Ids'), el('dd', {}, info.chains)),
  el('details', {}, el('summary', { class: 'dim' }, 'GET response'), raw));
}

async function press(btn, a, href, status, api, info) {
  const all = [...btn.parentElement.querySelectorAll('button')];
  all.forEach(b => { b.disabled = true; });
  const say = (t, cls = 'dim') => { status.className = cls; status.textContent = t; };
  try {
    const who = account ?? await connect();
    say(`POST ${new URL(href).pathname} …`);
    const r = await json(href, { method: 'POST', body: JSON.stringify({ account: who, type: a.type ?? 'transaction' }) });
    if (!r.ok) { say(r.body?.message ?? `The action answered ${r.status}.`, 'bad'); return; }
    const res = r.body;
    if (res.type === 'external-link') {
      if (!http(res.externalLink)) { say('The action answered a link that is not http(s); not opened.', 'bad'); return; }
      say(`${res.message ? res.message + ' ' : ''}Opening ${res.externalLink}`, 'good');
      window.open(res.externalLink, '_blank', 'noopener,noreferrer');
      return;
    }
    if (res.type === 'transaction' || typeof res.transaction === 'string') {
      say(`${res.message ?? 'A transaction to sign.'} Check it in the wallet…`);
      const signature = await signAndSend(res.transaction, account);
      const cluster = info.chains.includes('devnet') ? '?cluster=devnet' : '';
      const sent = el('p', { class: 'good' }, 'Sent: ', el('a', { href: `https://explorer.solana.com/tx/${signature}${cluster}`, target: '_blank', rel: 'noopener' }, `${signature.slice(0, 10)}…`));
      say(''); status.append(sent);
      return next(res.links?.next, { account: who, signature }, api, sent.cloneNode(true));   // the explorer link stays on the next card
    }
    if (res.type === 'post') return next(res.links?.next, { account: who }, api);
    say(`Not supported here: a "${res.type}" response.`, 'bad');
  } catch (e) {
    say(e?.message ?? String(e), 'bad');
  } finally { all.forEach(b => { b.disabled = false; }); }
}

/** links.next: an inline next action is shown as it is; a post link is POSTed (same origin only, as the spec says) for the next card. */
async function next(link, body, api, note = null) {
  if (!link) return;
  if (link.type === 'inline') return render(api, link.action, { version: '(chained)', chains: '(chained)' }, 'the previous action chained to it', note);
  if (link.type === 'post') {
    const href = resolveHref(link.href, api);
    if (new URL(href).origin !== new URL(api).origin) throw new Error('The next action is on another origin; not followed.');
    const r = await json(href, { method: 'POST', body: JSON.stringify(body) });
    if (r.ok) render(api, r.body, meta(r.headers), 'the previous action chained to it', note);
  }
}

async function open(raw) {
  out.replaceChildren(el('p', { class: 'dim' }, 'Loading…'));
  try {
    const { api, how } = await resolve(raw);
    const r = await json(api);
    if (!r.ok || !r.body) throw new Error(r.body?.message ?? `GET ${api} answered ${r.status}.`);
    render(api, r.body, meta(r.headers), how);
  } catch (e) { out.replaceChildren(el('p', { class: 'bad' }, e?.message ?? String(e))); }
}

form.addEventListener('submit', e => {
  e.preventDefault();
  const u = new URL(location.href); u.searchParams.set('url', input.value.trim()); history.replaceState(null, '', u);
  open(input.value);
});
$('connect').addEventListener('click', () => connect().catch(e => out.prepend(el('p', { class: 'bad' }, e.message))));
input.value = new URLSearchParams(location.search).get('url') || `${SITE_BASE || location.origin}/`;
open(input.value);
