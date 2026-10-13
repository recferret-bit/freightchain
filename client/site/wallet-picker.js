/* The CONNECT dialog every site page shares (landing, lobby, watch, admin, blink): several wallets → pick one (the last one used on top); none → install
   links on a desktop, "open this page in the wallet's browser" links on a phone (Phantom / Solflare browse universal links – the in-app browser injects
   the wallet; a phone's own Safari / Chrome never has one). Inline styles: the pages do not share a stylesheet. Text via textContent, icons only data: URIs. */
import { isMobileDevice } from '../js/mobile.js';

/** docs.phantom.com/phantom-deeplinks/other-methods/browse (phantom.com host), docs.solflare.com/…/deeplinks/other-methods/browse – both parts URL-encoded. */
export const browseLinks = (href, origin) => [
  { name: 'Phantom', href: `https://phantom.com/ul/browse/${encodeURIComponent(href)}?ref=${encodeURIComponent(origin)}` },
  { name: 'Solflare', href: `https://solflare.com/ul/v1/browse/${encodeURIComponent(href)}?ref=${encodeURIComponent(origin)}` },
];
export const INSTALL = [{ name: 'Phantom', href: 'https://phantom.com/download' }, { name: 'Solflare', href: 'https://solflare.com/download' }];

const css = (node, style) => { Object.assign(node.style, style); return node; };
const h = (tag, style, text) => { const n = css(document.createElement(tag), style ?? {}); if (text) n.textContent = text; return n; };
const BTN = { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', margin: '6px 0', padding: '10px 12px', background: '#1b1b1b', color: '#f2f2f2', border: '1px solid #444', borderRadius: '6px', font: 'inherit', cursor: 'pointer', textDecoration: 'none', boxSizing: 'border-box' };

/** Resolves the chosen wallet, or null when the dialog is closed (or there is nothing to choose). `label(p)` names a wallet; `last` = the label used last time. */
export function pickWallet(list, label, last = null) {
  return new Promise(resolve => {
    const dlg = css(document.createElement('dialog'), { maxWidth: '340px', width: 'calc(100% - 32px)', padding: '16px 18px', background: '#101010', color: '#f2f2f2', border: '1px solid #d98a14', borderRadius: '8px', font: '14px/1.4 ui-monospace,Menlo,monospace' });
    dlg.setAttribute('aria-label', 'Connect a Solana wallet');
    let chosen = null;
    const done = p => { chosen = p; dlg.close(); };
    const body = [h('b', { display: 'block', marginBottom: '8px', color: '#d98a14', letterSpacing: '.06em' }, list.length ? 'CONNECT A WALLET' : 'NO SOLANA WALLET HERE')];
    if (list.length) {
      const sorted = [...list].sort((a, b) => (label(b) === last) - (label(a) === last));
      for (const p of sorted) {
        const b = h('button', BTN); b.type = 'button';
        if (p.icon) { const img = h('img', { width: '24px', height: '24px' }); img.alt = ''; img.src = p.icon; b.append(img); }
        b.append(h('span', {}, label(p)), label(p) === last ? h('span', { marginLeft: 'auto', opacity: '.6', fontSize: '12px' }, 'last used') : '');
        b.onclick = () => done(p);
        body.push(b);
      }
      body.push(h('p', { margin: '8px 0 0', opacity: '.65', fontSize: '12px' }, 'Set the wallet to Devnet – Freight Chain runs on Solana devnet.'));
    } else if (isMobileDevice()) {
      body.push(h('p', { margin: '0 0 6px' }, 'A phone browser has no wallet. Open this page inside your wallet app:'));
      for (const l of browseLinks(location.href, location.origin)) { const a = h('a', BTN, `Open in ${l.name}`); a.href = l.href; a.rel = 'noopener'; body.push(a); }
    } else {
      body.push(h('p', { margin: '0 0 6px' }, 'Install a Solana wallet extension, then reload this page:'));
      for (const l of INSTALL) { const a = h('a', BTN, `Get ${l.name}`); a.href = l.href; a.target = '_blank'; a.rel = 'noopener'; body.push(a); }
    }
    const close = h('button', { ...BTN, justifyContent: 'center', background: 'transparent', marginTop: '10px' }, 'CANCEL'); close.type = 'button'; close.onclick = () => done(null);
    dlg.append(...body, close);
    dlg.addEventListener('close', () => { dlg.remove(); resolve(chosen); });
    document.body.append(dlg);
    dlg.showModal();
  });
}
