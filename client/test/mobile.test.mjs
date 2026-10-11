import test from 'node:test';
import assert from 'node:assert/strict';
import { isMobileDevice, showMobileBlocker } from '../js/mobile.js';

function setMockEnv({ nav, win }) {
  const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const origWinDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');

  if (nav !== undefined) {
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  }
  if (win !== undefined) {
    Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
  }

  return () => {
    if (origNavDesc) Object.defineProperty(globalThis, 'navigator', origNavDesc);
    else delete globalThis.navigator;
    if (origWinDesc) Object.defineProperty(globalThis, 'window', origWinDesc);
    else delete globalThis.window;
  };
}

test('isMobileDevice returns false in default node/desktop environment without window', () => {
  const restore = setMockEnv({ win: undefined, nav: undefined });
  try {
    assert.equal(isMobileDevice(), false);
  } finally {
    restore();
  }
});

test('isMobileDevice detects mobile user agents', () => {
  const win = { location: { search: '' }, matchMedia: () => ({ matches: false }) };

  // iPhone
  let restore = setMockEnv({ win, nav: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 } });
  assert.equal(isMobileDevice(), true);
  restore();

  // Android
  restore = setMockEnv({ win, nav: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36', maxTouchPoints: 5 } });
  assert.equal(isMobileDevice(), true);
  restore();

  // iPad with Macintosh UA and multi-touch
  restore = setMockEnv({ win, nav: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', maxTouchPoints: 5 } });
  assert.equal(isMobileDevice(), true);
  restore();

  // Desktop Mac (0 touch points)
  restore = setMockEnv({ win, nav: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', maxTouchPoints: 0 } });
  assert.equal(isMobileDevice(), false);
  restore();

  // Desktop Windows
  restore = setMockEnv({ win, nav: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36', maxTouchPoints: 0 } });
  assert.equal(isMobileDevice(), false);
  restore();
});

test('isMobileDevice detects coarse touch pointer and small touchscreens', () => {
  const nav = { userAgent: 'CustomBrowser', maxTouchPoints: 2 };
  const win = {
    location: { search: '' },
    matchMedia: query => ({
      matches: query.includes('pointer: coarse') || query.includes('max-width: 900px')
    })
  };
  const restore = setMockEnv({ win, nav });
  try {
    assert.equal(isMobileDevice(), true);
  } finally {
    restore();
  }
});

test('isMobileDevice honors explicit desktop and mobile query overrides', () => {
  // desktop override
  let restore = setMockEnv({
    nav: { userAgent: 'iPhone', maxTouchPoints: 5 },
    win: { location: { search: '?desktop=1' } }
  });
  assert.equal(isMobileDevice(), false);
  restore();

  // mobile override
  restore = setMockEnv({
    nav: { userAgent: 'Desktop', maxTouchPoints: 0 },
    win: { location: { search: '?mobile=1' } }
  });
  assert.equal(isMobileDevice(), true);
  restore();
});

test('showMobileBlocker updates the overlay and panel with mobile guidance and spectator links', () => {
  const origDoc = globalThis.document;

  try {
    const overlay = {
      classList: {
        classes: new Set(['booting']),
        remove(...names) { names.forEach(n => this.classes.delete(n)); },
        add(...names) { names.forEach(n => this.classes.add(n)); }
      }
    };
    const boot = { style: {} };
    const panel = { className: '', innerHTML: '' };

    globalThis.document = {
      getElementById(id) {
        if (id === 'overlay') return overlay;
        if (id === 'boot') return boot;
        if (id === 'panel') return panel;
        return null;
      }
    };

    showMobileBlocker();

    assert.equal(boot.style.display, 'none');
    assert.ok(overlay.classList.classes.has('mobile-blocked'));
    assert.ok(!overlay.classList.classes.has('booting'));
    assert.ok(panel.innerHTML.includes('DESKTOP REQUIRED TO DRIVE'));
    assert.ok(panel.innerHTML.includes('WATCH LIVE STREAMS'));
    assert.ok(panel.innerHTML.includes('WATCH FINISHED REPLAYS'));
    assert.ok(panel.innerHTML.includes('OPEN LOBBY'));
  } finally {
    globalThis.document = origDoc;
  }
});
