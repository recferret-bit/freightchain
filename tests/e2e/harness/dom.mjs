/* One happy-dom window per process. Client modules read `document` / `location` as free globals;
   Node 22 resolves those on globalThis, so the window's properties are installed there before import. */
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));

let installed = null;

function install(window) {
  if (installed) throw new Error('one DOM window per process — split pages across test files');
  installed = window;
  const g = globalThis;
  const seen = new Set();
  let proto = window;
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const desc = Object.getOwnPropertyDescriptor(proto, key);
        if (!desc) continue;
        if (key in g && !['fetch', 'document', 'navigator', 'location', 'window'].includes(key)) continue;
        if (desc.get || desc.set) {
          Object.defineProperty(g, key, { configurable: true, get: () => window[key], set: (v) => { window[key] = v; } });
        } else if (typeof desc.value === 'function') {
          Object.defineProperty(g, key, { configurable: true, writable: true, value: desc.value.bind(window) });
        } else {
          Object.defineProperty(g, key, { configurable: true, writable: true, value: window[key] });
        }
      } catch { /* the host already locked this name */ }
    }
    proto = Object.getPrototypeOf(proto);
  }
  if (typeof g.requestIdleCallback !== 'function') g.requestIdleCallback = (fn) => setTimeout(fn, 0);
  if (typeof g.cancelIdleCallback !== 'function') g.cancelIdleCallback = (id) => clearTimeout(id);
}

/** `routes(method, url, body)` → `{ status, json }`. Unhandled paths are 404 so page `.catch` paths stay quiet. */
export function open({ html, url, routes }) {
  const window = new Window({
    url,
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true },
  });
  install(window);
  const calls = [];
  const fetchImpl = async (input, opts = {}) => {
    const raw = typeof input === 'string' ? input : input.url;
    const u = new URL(raw, url);
    const method = String(opts.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    let body = null;
    if (opts.body != null) {
      try { body = JSON.parse(String(opts.body)); } catch { body = String(opts.body); }
    }
    calls.push({ method, path: u.pathname, search: u.search, href: u.href, body });
    const hit = routes(method, u, body) ?? { status: 404, json: { title: 'no' } };
    const status = hit.status ?? 200;
    const payload = hit.json === undefined ? {} : hit.json;
    return new window.Response(payload == null ? '' : JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  globalThis.fetch = fetchImpl;
  window.fetch = fetchImpl;
  let frames = 0;
  const raf = window.requestAnimationFrame.bind(window);
  const capped = (fn) => (frames++ > 40 ? 0 : raf(fn));
  window.requestAnimationFrame = capped;
  globalThis.requestAnimationFrame = capped;
  const stopInterval = () => 0;
  window.setInterval = stopInterval;
  globalThis.setInterval = stopInterval;
  const grad = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') return () => grad;
      if (prop === 'canvas') return { width: 16, height: 16 };
      if (prop === 'measureText') return () => ({ width: 8 });
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return () => {};
    },
  });
  window.HTMLCanvasElement.prototype.getContext = function getContext() { return ctx; };
  window.document.write(html);
  window.document.close();
  return {
    window,
    document: window.document,
    calls,
    get location() { return window.location; },
    close() { try { window.close(); } catch { /* already closed */ } },
  };
}

export const html = (rel) => readFileSync(join(REPO, rel), 'utf8');
export const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));

/** happy-dom does not always emit hashchange when a tab link is clicked. */
export function hashTo(page, hash) {
  page.location.hash = hash.startsWith('#') ? hash : `#${hash}`;
  page.window.dispatchEvent(new page.window.Event('hashchange'));
}
export const called = (calls, method, path) => calls.filter((c) => c.method === method && c.path === path);
