/* Mobile device detection and desktop requirement checks.
   Driving Freight Chain requires a physical keyboard for manual gearbox, clutch, steering and cab switches.
   Spectating live streams and replays is fully supported on mobile. */

import { SITE_BASE, WHITEPAPER_BASE } from './hosts.js';

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
      <div class="btns" style="flex-direction:column;align-items:stretch;gap:10px">
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
  }
}
