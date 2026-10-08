/* National flags painted onto the police-station cloth. `side` is which face of the thin box:
   three.js puts texture-left of the +x face at +z (the pole) and texture-left of the -x face at -z,
   so the -x face is drawn mirrored and the hoist stays on the pole from the road as well.
   Canvas y grows downward; both faces already put the top of the texture at +y. */
const star = (g, x, y, r, n = 5) => {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n, rr = i % 2 ? r * .38 : r;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.closePath(); g.fill();
};
const bands = (g, w, h, cols, vertical) => {
  const n = cols.length, s = (vertical ? w : h) / n;
  cols.forEach((c, i) => { g.fillStyle = c; if (vertical) g.fillRect(i * s, 0, s + 1, h); else g.fillRect(0, i * s, w, s + 1); });
};
/* Simplified jack: it has to read at the size of a roadside cloth, not survive a vexillology check. */
const jack = (g, w, h) => {
  g.fillStyle = '#012169'; g.fillRect(0, 0, w, h);
  g.lineCap = 'square'; g.strokeStyle = '#fff'; g.lineWidth = h * .2;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
  g.strokeStyle = '#c8102e'; g.lineWidth = h * .08; g.stroke();
  g.fillStyle = '#fff'; g.fillRect(w * .38, 0, w * .24, h); g.fillRect(0, h * .36, w, h * .28);
  g.fillStyle = '#c8102e'; g.fillRect(w * .44, 0, w * .12, h); g.fillRect(0, h * .43, w, h * .14);
};
const paint = {
  us(g, w, h) {
    const rows = 13, bh = h / rows;
    for (let i = 0; i < rows; i++) { g.fillStyle = i % 2 ? '#fff' : '#b22234'; g.fillRect(0, i * bh, w, bh + 1); }
    const cw = w * .4, ch = bh * 7; g.fillStyle = '#3c3b6e'; g.fillRect(0, 0, cw, ch); g.fillStyle = '#fff';
    for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) star(g, cw * ((c + .5) / 6), ch * ((r + .5) / 5), ch * .06);
  },
  au(g, w, h) {
    g.fillStyle = '#012169'; g.fillRect(0, 0, w, h);
    g.save(); g.scale(.5, .5); jack(g, w, h); g.restore();
    g.fillStyle = '#fff'; star(g, w * .25, h * .72, h * .1, 7);
    for (const [x, y, r, n] of [[.62, .28, .045, 7], [.78, .42, .05, 7], [.68, .62, .035, 5], [.84, .72, .045, 7], [.72, .86, .04, 7]]) star(g, x * w, y * h, r * h, n);
  },
  ru: (g, w, h) => bands(g, w, h, ['#fff', '#0039a6', '#d52b1e']),
  cl(g, w, h) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h / 2); g.fillStyle = '#d52b1e'; g.fillRect(0, h / 2, w, h / 2 + 1);
    g.fillStyle = '#0039a6'; g.fillRect(0, 0, h / 2, h / 2); g.fillStyle = '#fff'; star(g, h / 4, h / 4, h * .08);
  },
  at: (g, w, h) => bands(g, w, h, ['#ed2939', '#fff', '#ed2939']),
  it: (g, w, h) => bands(g, w, h, ['#009246', '#fff', '#ce2b37'], true),
};
export function drawFlag(g, w, h, id, side) {
  g.save();
  if (side === 'nx') { g.translate(w, 0); g.scale(-1, 1); }   // hoist toward the pole on the road-facing face
  (paint[id] ?? paint.us)(g, w, h);
  g.restore();
}
