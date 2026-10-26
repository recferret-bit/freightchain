/* Shared CONNECT list (landing, lobby, watch, admin, blink, the model editor). Always shown, even for one wallet (the last one used on top).
   None on a phone → open this page in Phantom, Solflare, or Backpack. None on a desktop → install those three, plus a QR that signs THIS browser in from the phone.
   An in-page overlay, not a browser dialog: a top-layer dialog swallows the click and the wallet draws nothing.
   Styles live on the overlay: the pages do not share a stylesheet. Text via textContent, icons only data: URIs. */
import { isMobileDevice } from '../mobile.js';

/** docs.phantom.com/phantom-deeplinks/other-methods/browse (phantom.com host), docs.solflare.com/…/deeplinks/other-methods/browse – both parts URL-encoded. */
export const browseLinks = (href, origin) => [
  { name: 'Phantom', href: `https://phantom.com/ul/browse/${encodeURIComponent(href)}?ref=${encodeURIComponent(origin)}` },
  { name: 'Solflare', href: `https://solflare.com/ul/v1/browse/${encodeURIComponent(href)}?ref=${encodeURIComponent(origin)}` },
  { name: 'Backpack', href: `https://backpack.app/ul/v1/browse/${encodeURIComponent(href)}?ref=${encodeURIComponent(origin)}` },
];
export const INSTALL = [
  { name: 'Phantom', href: 'https://phantom.com/download' },
  { name: 'Solflare', href: 'https://solflare.com/download' },
  { name: 'Backpack', href: 'https://backpack.app/download' },
];

/** Replace the list with the QR. Resolves the overlay when the phone has signed this browser in. */
async function runPhone(panel, finish, api) {
  let stopped = false;
  const sheet = panel.querySelector('[data-fc-sheet]') ?? panel;
  sheet.replaceChildren(title('SIGN IN WITH YOUR PHONE'));
  sheet.append(h('p', { margin: '0 0 8px' }, 'Scan with the phone camera. Approve in Phantom, Solflare, or Backpack. This computer signs in.'));
  const status = h('p', { margin: '8px 0', opacity: '.75' }, 'Preparing a code…');
  const cancel = press(h('button', { ...BTN, justifyContent: 'center', background: 'transparent' }, 'CANCEL'), () => { stopped = true; finish(null); }); cancel.type = 'button';
  sheet.append(status, cancel);
  try {
    const { startPhonePair, watchPhonePair } = await import('./phone.js');
    const opened = await startPhonePair(api);
    try {
      const { qrNode } = await import('../../site/qr.js');
      const code = qrNode(opened.url);
      code.style.width = '200px'; code.style.height = '200px'; code.style.display = 'block'; code.style.margin = '0 auto';
      status.before(code);
    } catch { status.textContent = opened.url; }
    if (stopped) return;
    status.textContent = 'Waiting for the phone…';
    const ready = await watchPhonePair(api, opened.id, () => stopped);
    if (ready) finish({ phone: true });
  } catch (e) {
    if (!stopped) status.textContent = e?.message || 'Phone sign-in did not start.';
  }
}

const css = (node, style) => { Object.assign(node.style, style); return node; };
const h = (tag, style, text) => { const n = css(document.createElement(tag), style ?? {}); if (text) n.textContent = text; return n; };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const title = text => h('b', { display: 'block', marginBottom: '8px', color: '#d98a14', letterSpacing: '.06em', userSelect: 'none' }, text);

/** The box sits still. Drag lives on a frame around it. The grab pad sticks out past the rounded corners.
 *  Follow is a little behind the pointer, then home on release. */
function liveDialog(panel) {
  const frame = h('div');
  panel.replaceWith(frame);
  frame.append(panel);
  panel.style.position = 'relative';
  const pad = h('div', { position: 'absolute', inset: '-14px', borderRadius: '20px', cursor: 'grab', touchAction: 'none', zIndex: '0' });
  pad.dataset.fcDrag = '';
  panel.prepend(pad);
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0, tx = 0, ty = 0, x = 0, y = 0, raf = 0;
  const step = reduced() ? 1 : 0.12;   // pitch cards chase at .06; a dialog should trail, not swim
  const paint = () => {
    x += (tx - x) * step; y += (ty - y) * step;
    if (Math.abs(tx - x) < 0.4 && Math.abs(ty - y) < 0.4) { x = tx; y = ty; }
    frame.style.translate = (x || y) ? `${x.toFixed(1)}px ${y.toFixed(1)}px` : '';
    raf = (dragging || x !== tx || y !== ty) ? requestAnimationFrame(paint) : 0;
  };
  const kick = () => { raf ||= requestAnimationFrame(paint); };
  const onDown = e => {
    if (e.button !== 0 || e.target.closest('button, a, input, textarea, select')) return;
    dragging = true; sx = e.clientX; sy = e.clientY; ox = x; oy = y;   // grab it where it is, even mid-return
    pad.style.cursor = 'grabbing';
    panel.setPointerCapture?.(e.pointerId);
    kick();
  };
  const onMove = e => {
    if (!dragging) return;
    const box = frame.getBoundingClientRect();
    const left0 = box.left - x, top0 = box.top - y;
    tx = Math.max(24 - box.width - left0, Math.min(innerWidth - 24 - left0, ox + e.clientX - sx));
    ty = Math.max(24 - box.height - top0, Math.min(innerHeight - 24 - top0, oy + e.clientY - sy));
    kick();
  };
  const onUp = () => { if (!dragging) return; dragging = false; tx = 0; ty = 0; pad.style.cursor = 'grab'; kick(); };
  panel.addEventListener('pointerdown', onDown);
  panel.addEventListener('pointermove', onMove);
  panel.addEventListener('pointerup', onUp);
  panel.addEventListener('pointercancel', onUp);
  return () => { cancelAnimationFrame(raf); };
}
const BTN = { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', margin: '6px 0', padding: '10px 12px', background: '#1b1b1b', color: '#f2f2f2', border: '1px solid #444', borderRadius: '6px', font: 'inherit', cursor: 'pointer', textDecoration: 'none', boxSizing: 'border-box', pointerEvents: 'auto', position: 'relative', overflow: 'hidden' };

const AFTER = 40;   // the ring has just finished; the dialog closes on its heels
/** A press ring in Solana green bleeding into purple. Returns the animation, or null when motion is reduced. */
function ripple(e) {
  if (reduced()) return null;
  const host = e.currentTarget, box = host.getBoundingClientRect();
  const d = Math.hypot(box.width, box.height);
  const x = e.clientX || box.left + box.width / 2, y = e.clientY || box.top + box.height / 2;
  const ring = h('i', { position: 'absolute', left: `${x - box.left - d / 2}px`, top: `${y - box.top - d / 2}px`, width: `${d}px`, height: `${d}px`, borderRadius: '50%', pointerEvents: 'none', background: 'radial-gradient(circle, #14f195ee 0%, #9945ffaa 42%, transparent 70%)', zIndex: '2' });
  host.append(ring);
  const anim = ring.animate({ transform: ['scale(.12)', 'scale(1.15)'], opacity: [.95, 0] }, { duration: 620, easing: 'ease-out' });
  anim.onfinish = () => ring.remove();
  return anim;
}
/** The ring plays out, then a short pause, then `run`. A second click during that wait does nothing. */
function press(node, run) {
  node.classList.add('amber');   /* the shared halo in css/amber-glow.css, on every host including the viewer */
  let pending = null, gone = false;
  node.addEventListener('pointerdown', e => { if (e.button === 0) pending = ripple(e); });
  node.addEventListener('click', e => {
    e.preventDefault();
    if (gone) return;
    gone = true;
    const anim = pending || ripple(e);
    pending = null;
    const go = () => run();
    if (!anim) { go(); return; }
    const later = () => setTimeout(go, AFTER);
    if (anim.playState === 'finished') later(); else anim.addEventListener('finish', later);
  });
  return node;
}

/** Resolves the chosen wallet, `{ phone: true }` when the desktop QR finished, or null when closed. `label(p)` names a wallet; `last` = the label used last time.
 *  `onPick` runs after that row's ripple and a short pause. `opts.phone` is the desktop QR (never on a phone). */
export function pickWallet(list, label, last = null, onPick = null, opts = null) {
  return new Promise(resolve => {
    const root = css(document.createElement('div'), { position: 'fixed', inset: '0', zIndex: '2147483000', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.55)' });
    root.setAttribute('data-fc-wallets', '');
    const panel = css(document.createElement('div'), { width: 'min(340px, calc(100vw - 32px))', padding: '16px 18px', background: '#101010', color: '#f2f2f2', border: '1px solid #d98a14', borderRadius: '8px', font: '14px/1.4 ui-monospace,Menlo,monospace' });
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Connect a Solana wallet');
    let settled = false, stopMotion = () => {};
    const finish = p => {
      if (settled) return;
      settled = true;
      stopMotion();
      // Pairing already adopted the session; it is not a local wallet to connect or sign with.
      if (p && !p.phone) onPick?.(p);
      document.removeEventListener('keydown', onKey);
      const done = () => { root.remove(); resolve(p ?? null); };
      if (reduced()) { done(); return; }
      panel.getAnimations().forEach(a => a.cancel());   // hover and the entrance must not hold the box in place while it leaves
      root.animate({ opacity: [1, 0] }, { duration: 220, easing: 'ease-in', fill: 'forwards' });
      panel.animate({ opacity: [1, 0], scale: [1, 0.96] }, { duration: 220, easing: 'ease-in', fill: 'forwards' }).onfinish = done;
    };
    const onKey = e => { if (e.key === 'Escape') finish(null); };
    const body = [title(list.length ? 'CONNECT A WALLET' : 'NO SOLANA WALLET HERE')];
    if (list.length) {
      const sorted = [...list].sort((a, b) => (label(b) === last) - (label(a) === last));
      for (const p of sorted) {
        const b = h('button', BTN); b.type = 'button';
        if (p.icon) { const img = h('img', { width: '24px', height: '24px', flex: '0 0 24px', objectFit: 'contain' }); img.alt = ''; img.src = p.icon; b.append(img); }
        b.append(h('span', {}, label(p)));
        if (label(p) === last) b.append(h('span', { marginLeft: 'auto', opacity: '.6', fontSize: '12px' }, 'last used'));
        body.push(press(b, () => finish(p)));
      }
      body.push(h('p', { margin: '8px 0 0', opacity: '.65', fontSize: '12px' }, 'Set the wallet to Devnet – Freight Chain runs on Solana devnet.'));
    } else if (isMobileDevice()) {
      body.push(h('p', { margin: '0 0 6px' }, 'A phone browser has no wallet. Open this page inside your wallet app:'));
      for (const l of browseLinks(location.href, location.origin)) { const a = h('a', BTN, `Open in ${l.name}`); a.href = l.href; a.rel = 'noopener'; body.push(press(a, () => { location.href = a.href; })); }
    } else {
      body.push(h('p', { margin: '0 0 6px' }, 'Install a Solana wallet extension, then reload this page:'));
      for (const l of INSTALL) { const a = h('a', BTN, `Get ${l.name}`); a.href = l.href; a.target = '_blank'; a.rel = 'noopener'; body.push(press(a, () => { const w = window.open(a.href, '_blank', 'noopener'); if (!w) location.href = a.href; })); }
    }
    if (opts?.phone && !isMobileDevice()) {
      const phone = press(h('button', { ...BTN, justifyContent: 'center' }, 'Sign in with your phone'), () => runPhone(panel, finish, opts.api)); phone.type = 'button';
      body.push(phone);
    }
    const close = press(h('button', { ...BTN, justifyContent: 'center', background: 'transparent', marginTop: '10px' }, 'CANCEL'), () => finish(null)); close.type = 'button';
    const sheet = h('div', { position: 'relative', zIndex: '1', pointerEvents: 'none' }); sheet.dataset.fcSheet = ''; sheet.append(...body, close); panel.append(sheet);
    root.style.opacity = '0';
    panel.style.opacity = '0';
    panel.style.scale = '.96';
    root.append(panel);
    root.addEventListener('click', e => { if (e.target === root) finish(null); });
    document.addEventListener('keydown', onKey);
    document.body.append(root);
    stopMotion = liveDialog(panel);
    if (reduced()) { root.style.opacity = '1'; panel.style.opacity = '1'; panel.style.scale = '1'; }
    else {
      root.animate({ opacity: [0, 1] }, { duration: 280, easing: 'ease-out', fill: 'forwards' });
      panel.animate({ opacity: [0, 1], scale: [0.96, 1] }, { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    }
    panel.querySelector('button')?.focus();
  });
}
