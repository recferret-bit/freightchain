/* The 2D cockpit canvas and its size (view). */

export const cv = document.getElementById('cockpit'), ctx = cv.getContext('2d');
export const view = { W: 0, H: 0, DPR: 1 };   // set by resize() in world/render.js

/* Screen rects of the mirror glass. The cockpit canvas punches see-through holes there; the WebGL rear view is drawn underneath. */
export function mirrorRects() {
  const { W, H } = view;
  const u = Math.min(H / 100, W / 150), mw = W * .052, my = 16 * u, mh = 32 * u;
  return [{ side: -1, x: W * .008, y: my, w: mw, h: mh }, { side: 1, x: W - W * .008 - mw, y: my, w: mw, h: mh }];
}
