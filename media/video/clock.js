// Injected BEFORE the game's modules (Page.addScriptToEvaluateOnNewDocument): a virtual clock, so every video frame is one exact game step
// no matter how slow software WebGL renders. rAF only queues; __vstep(ms) advances time, runs the per-step hook, then flushes the queue.
(() => {
  let t = 1000, q = [], id = 0, seed = 1;
  performance.now = () => t;
  Date.now = () => 1.7e12 + t;   // radio's wall-clock "broadcast" stays reproducible too
  window.requestAnimationFrame = cb => { q.push([++id, cb]); return id; };
  window.cancelAnimationFrame = i => { q = q.filter(e => e[0] !== i); };
  Math.random = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };   // mulberry32: same take every run
  window.__reseed = s => { seed = s | 0; };
  window.__hook = null;
  window.__vstep = ms => { t += ms; window.__hook?.(ms / 1000); const run = q; q = []; for (const [, cb] of run) cb(t); };
})();
