/* Mobile device detection and desktop requirement checks.
   Driving Freight Chain requires a physical keyboard for manual gearbox, clutch, steering and cab switches.
   Spectating live streams and replays is fully supported on mobile. */

import { API_BASE, GAME_BASE, SITE_BASE, WHITEPAPER_BASE } from './hosts.js';

export function isMobileDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  // URL query overrides for manual testing / development
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('desktop') === '1') return false;
    if (params.get('mobile') === '1') return true;
  } catch { /* ignore URL parse errors */ }

  const ua = navigator.userAgent || navigator.vendor || window.opera || '';

  // 1. Mobile & tablet user agent strings
  const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|Silk|Windows Phone/i.test(ua);

  // 2. Modern iPadOS (reports as Macintosh in UA, but has multi-touch capability)
  const isIPadOS = /Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;

  // 3. Primary coarse pointer (touch device without standard mouse hover)
  const isCoarseTouch = Boolean(
    window.matchMedia &&
    window.matchMedia('(pointer: coarse)').matches &&
    !window.matchMedia('(hover: hover)').matches
  );

  // 4. Handheld / small viewport with touch capability
  const isSmallTouch = Boolean(
    window.matchMedia &&
    window.matchMedia('(max-width: 900px)').matches &&
    (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
  );

  return Boolean(mobileUA || isIPadOS || isCoarseTouch || isSmallTouch);
}

/** Render a high-contrast, responsive blocker screen on play.html when driving is attempted on mobile. */
export function showMobileBlocker() {
  const overlay = document.getElementById('overlay');
  const panel = document.getElementById('panel');
  const boot = document.getElementById('boot');

  if (boot) boot.style.display = 'none';
  if (overlay) {
    overlay.classList.remove('booting', 'hide');
    overlay.classList.add('mobile-blocked');
  }

  const wpUrl = WHITEPAPER_BASE || '/whitepaper.html';
  const lobbyUrl = `${SITE_BASE}/lobby.html`;
  const liveUrl = `${SITE_BASE}/lobby.html#live`;
  const replaysUrl = `${SITE_BASE}/lobby.html#replays`;

  if (panel) {
    panel.className = 'panel mobile-panel';
    panel.innerHTML = `
      <div class="mobile-block-brand">⛟ FREIGHT CHAIN</div>
      <h1>DESKTOP REQUIRED TO DRIVE</h1>
      <h2>Physical keyboard required for manual truck controls</h2>
      <p class="ask" style="color:#d9ccaa;margin:12px 0 18px;line-height:1.5;font-size:14px">
        Freight Chain is a hardcore simulation featuring manual clutch, 7-speed gearbox, engine heat, parking brake, and dashboard switches. Driving is only supported on a desktop browser with a keyboard.
      </p>
      <div class="note" style="border-left:3px solid #14f195;background:#0c160eee;border-radius:6px;padding:10px 14px;margin-bottom:18px;font-size:13px;color:#c9f0c9">
        <b>Spectating is supported on mobile!</b> You can watch any active truck live on the road or replay past completed shifts right on your phone.
      </div>
      <div class="btns" id="mobile-blocker-btns" style="flex-direction:column;align-items:stretch;gap:10px">
        <a href="${liveUrl}" class="mobile-cta-btn live-btn">
          ▶ WATCH LIVE STREAMS
        </a>
        <a href="${replaysUrl}" class="mobile-cta-btn replays-btn">
          ▶ WATCH FINISHED REPLAYS
        </a>
        <div style="display:flex;gap:10px;width:100%">
          <a href="${lobbyUrl}" class="mobile-cta-btn alt-btn" style="flex:1">
            OPEN LOBBY
          </a>
          <a href="${wpUrl}" class="mobile-cta-btn alt-btn" style="flex:1">
            WHITEPAPER
          </a>
        </div>
      </div>
    `;

    if (typeof fetch !== 'undefined' && typeof window !== 'undefined') {
      fetch(`${API_BASE}/api/live?surface=game`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (!d) return;
          const live = d.rides && d.rides.length > 0 ? d.rides[0] : null;
          const target = live || (d.recent && d.recent.length > 0 ? d.recent[0] : null);
          const btns = document.getElementById('mobile-blocker-btns');
          if (!target || !btns || btns.querySelector('.direct-watch')) return;
          const a = document.createElement('a');
          a.className = 'mobile-cta-btn live-btn direct-watch';
          a.href = `${GAME_BASE}/play.html?watch=${encodeURIComponent(target.id)}`;
          const km = ((target.distance || target.metres || 0) / 1000).toFixed(1);
          const w = target.wallet ? `${target.wallet.slice(0, 4)}…${target.wallet.slice(-4)}` : 'driver';
          a.textContent = live ? `▶ WATCH ${w} LIVE NOW (${km} km)` : `▶ REPLAY ${w}'S SHIFT (${km} km)`;
          btns.prepend(a);
        })
        .catch(() => {});
    }
  }
}

function ensureMobileToastStyles() {
  if (typeof document === 'undefined' || document.getElementById('fc-mobile-toast-styles')) return;

  const style = document.createElement('style');
  style.id = 'fc-mobile-toast-styles';
  style.textContent = '.fc-mobile-toast{position:fixed;top:max(16px,env(safe-area-inset-top,16px));left:50%;transform:translateX(-50%) translateY(-130%);width:min(480px,calc(100vw - 24px));box-sizing:border-box;z-index:99999;padding:14px 16px;background:linear-gradient(135deg,rgba(22,17,12,.97),rgba(10,9,8,.98));border:1.5px solid #ffcf5a;border-radius:12px;box-shadow:0 12px 40px #000d,0 0 24px #ffb02e59;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);font-family:ui-monospace,Menlo,Consolas,monospace;color:#efe6cf;opacity:0;transition:transform .32s cubic-bezier(.16,1,.3,1),opacity .25s ease;pointer-events:auto}.fc-mobile-toast.fc-toast-visible{transform:translateX(-50%) translateY(0);opacity:1}.fc-mobile-toast.fc-toast-pulse{animation:fcP .3s ease}@keyframes fcP{0%,100%{transform:translateX(-50%) scale(1)}50%{transform:translateX(-50%) scale(1.03)}}.fc-toast-top-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.fc-toast-brand{font-size:12px;font-weight:bold;letter-spacing:1.2px;color:#ffcf5a;display:flex;align-items:center;gap:6px}.fc-toast-close{background:transparent;border:0;color:#b9ad8d;font-size:16px;line-height:1;cursor:pointer;padding:4px 8px;border-radius:4px;font-family:inherit}.fc-toast-close:hover{color:#ffcf5a;background:#ffcf5a26}.fc-toast-msg{margin:0 0 8px;font-size:12.5px;line-height:1.45;color:#d9ccaa}.fc-toast-note{margin:0 0 12px;font-size:12px;line-height:1.4;color:#c9f0c9;background:#14f19514;border-left:3px solid #14f195;padding:6px 10px;border-radius:4px}.fc-toast-actions{display:flex;gap:8px;flex-wrap:wrap}.fc-toast-btn{display:inline-flex;align-items:center;justify-content:center;padding:7px 13px;border-radius:6px;font:inherit;font-size:11.5px;font-weight:bold;letter-spacing:.5px;cursor:pointer;text-decoration:none;box-sizing:border-box;border:0}.fc-toast-btn.live{background:#ffcf5a;color:#1b1408;box-shadow:0 0 12px #ffcf5a59}.fc-toast-btn.replays{background:transparent;color:#14f195;border:1.5px solid #14f19599}';
  (document.head || document.documentElement).appendChild(style);
}

let toastTimeout = null;

export function dismissMobileToast() {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('fc-mobile-toast');
  if (existing) {
    existing.classList.remove('fc-toast-visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      existing.remove();
    }, 320);
  }
}

export function showMobileToast(opts = {}) {
  if (typeof document === 'undefined') return null;

  ensureMobileToastStyles();

  let toast = document.getElementById('fc-mobile-toast');
  const isNew = !toast;

  if (isNew) {
    toast = document.createElement('div');
    toast.id = 'fc-mobile-toast';
    toast.className = 'fc-mobile-toast';
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    const target = document.body || document.documentElement;
    target.appendChild(toast);
  } else {
    toast.classList.remove('fc-toast-pulse');
    void toast.offsetWidth;
    toast.classList.add('fc-toast-pulse');
  }

  toast.replaceChildren();

  const topRow = document.createElement('div');
  topRow.className = 'fc-toast-top-row';

  const brand = document.createElement('div');
  brand.className = 'fc-toast-brand';
  brand.textContent = opts.title || '⛟ DESKTOP REQUIRED TO DRIVE';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'fc-toast-close';
  closeBtn.setAttribute('aria-label', 'Dismiss toast');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    dismissMobileToast();
  });

  topRow.append(brand, closeBtn);

  const msg = document.createElement('p');
  msg.className = 'fc-toast-msg';
  msg.textContent = opts.message || 'Freight Chain requires a physical keyboard for manual gearbox, clutch, steering and cab switches.';

  const note = document.createElement('div');
  note.className = 'fc-toast-note';
  const noteBold = document.createElement('b');
  noteBold.textContent = 'Spectating is supported on mobile! ';
  note.append(noteBold, document.createTextNode(opts.note || 'Watch active trucks live or replay finished shifts right now.'));

  const actions = document.createElement('div');
  actions.className = 'fc-toast-actions';

  const liveAction = opts.liveAction ?? `${SITE_BASE}/lobby.html#live`;
  const replaysAction = opts.replaysAction ?? `${SITE_BASE}/lobby.html#replays`;

  const buildToastActionBtn = (cls, label, action) => {
    const isLink = typeof action === 'string';
    const btn = document.createElement(isLink ? 'a' : 'button');
    btn.className = `fc-toast-btn ${cls}`;
    btn.textContent = label;
    if (isLink) btn.setAttribute('href', action);
    else btn.setAttribute('type', 'button');
    btn.addEventListener('click', () => {
      dismissMobileToast();
      if (!isLink) action();
    });
    return btn;
  };

  actions.append(
    buildToastActionBtn('live', '▶ WATCH LIVE', liveAction),
    buildToastActionBtn('replays', '▶ REPLAYS', replaysAction),
  );
  toast.append(topRow, msg, note, actions);

  requestAnimationFrame(() => {
    toast.classList.add('fc-toast-visible');
  });

  clearTimeout(toastTimeout);
  const timeoutMs = opts.timeoutMs ?? 7000;
  if (timeoutMs > 0) {
    toastTimeout = setTimeout(() => {
      dismissMobileToast();
    }, timeoutMs);
  }

  return toast;
}
