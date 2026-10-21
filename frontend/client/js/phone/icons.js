/* App glyphs drawn in a 40-unit box centered on the origin. White on the icon's own colour. */

const GLYPH = {
  maps(g) {
    g.beginPath(); g.moveTo(-14, -6); g.lineTo(-6, -12); g.lineTo(2, -7); g.lineTo(12, -13); g.lineTo(14, 8); g.lineTo(4, 13); g.lineTo(-4, 8); g.lineTo(-14, 12); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(-6, -12); g.lineTo(-5, 8); g.moveTo(2, -7); g.lineTo(4, 13); g.stroke();
    g.fillStyle = '#ff5a4a'; g.beginPath(); g.arc(1, -1, 3.4, 0, 7); g.fill();
  },
  wallet(g) {
    g.beginPath(); g.roundRect(-14, -10, 28, 20, 4); g.stroke();
    g.beginPath(); g.moveTo(-14, -3); g.lineTo(14, -3); g.stroke();
    g.beginPath(); g.arc(7, 3, 2.2, 0, 7); g.fill();
  },
  radio(g) {
    g.beginPath(); g.roundRect(-13, -4, 26, 16, 3); g.stroke();
    g.beginPath(); g.arc(-5, 4, 3.2, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(2, 1); g.lineTo(9, 1); g.moveTo(2, 6); g.lineTo(9, 6); g.stroke();
    g.beginPath(); g.moveTo(-4, -4); g.quadraticCurveTo(0, -14, 8, -8); g.stroke();
  },
  weather(g) {
    g.beginPath(); g.arc(-2, -4, 6, 0, 7); g.fill();
    g.beginPath(); g.roundRect(-13, 2, 26, 8, 4); g.fill();
  },
  truck(g) {
    g.beginPath(); g.roundRect(-15, -8, 16, 12, 2); g.stroke();
    g.beginPath(); g.moveTo(1, -3); g.lineTo(8, -3); g.lineTo(14, 2); g.lineTo(14, 4); g.lineTo(1, 4); g.stroke();
    g.beginPath(); g.arc(-8, 7, 2.6, 0, 7); g.arc(8, 7, 2.6, 0, 7); g.fill();
  },
  chat(g) {
    g.beginPath(); g.roundRect(-14, -12, 28, 18, 5); g.stroke();
    g.beginPath(); g.moveTo(-6, 6); g.lineTo(-10, 13); g.lineTo(0, 6); g.stroke();
  },
  cam(g) {
    g.beginPath(); g.roundRect(-14, -8, 28, 18, 3); g.stroke();
    g.beginPath(); g.moveTo(-8, -8); g.lineTo(-4, -12); g.lineTo(4, -12); g.lineTo(8, -8); g.stroke();
    g.beginPath(); g.arc(0, 1, 5, 0, 7); g.stroke();
  },
  cog(g) {
    g.beginPath(); g.arc(0, 0, 5, 0, 7); g.stroke();
    for (let a = 0; a < 8; a++) { const c = Math.cos(a * Math.PI / 4), s = Math.sin(a * Math.PI / 4); g.beginPath(); g.moveTo(c * 8, s * 8); g.lineTo(c * 13, s * 13); g.stroke(); }
  },
  swap(g) {
    g.beginPath(); g.arc(-6, -4, 6, 0, 7); g.stroke();
    g.beginPath(); g.arc(6, 4, 6, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(-12, 6); g.lineTo(-4, 10); g.lineTo(-6, 2); g.moveTo(12, -6); g.lineTo(4, -10); g.lineTo(6, -2); g.stroke();
  },
  calls(g) {
    g.beginPath(); g.arc(-2, 2, 8, 0.8, 2.4); g.stroke();
    g.beginPath(); g.moveTo(-8, 6); g.quadraticCurveTo(-14, 14, -4, 12); g.stroke();
    g.beginPath(); g.moveTo(4, -8); g.quadraticCurveTo(12, -14, 10, -4); g.stroke();
  },
  web(g) {
    g.beginPath(); g.arc(0, 0, 12, 0, 7); g.stroke();
    g.beginPath(); g.ellipse(0, 0, 5, 12, 0, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(-12, 0); g.lineTo(12, 0); g.moveTo(-8, -8); g.bezierCurveTo(-2, -4, 2, -4, 8, -8); g.moveTo(-8, 8); g.bezierCurveTo(-2, 4, 2, 4, 8, 8); g.stroke();
  },
  gulp(g) {
    g.beginPath(); g.roundRect(-5, -14, 8, 14, 2); g.stroke();
    g.beginPath(); g.moveTo(3, -8); g.lineTo(13, -2); g.lineTo(11, 2); g.lineTo(3, -2); g.stroke();
    g.beginPath(); g.moveTo(-10, 4); g.lineTo(8, 4); g.lineTo(6, 14); g.lineTo(-8, 14); g.closePath(); g.stroke();
  },
  pike(g) {
    g.beginPath(); g.moveTo(10, -12); g.lineTo(10, 14); g.stroke();
    g.beginPath(); g.moveTo(-12, 0); g.lineTo(10, 0); g.lineTo(10, -8); g.stroke();
  },
  music(g) {
    g.beginPath(); g.arc(-6, 8, 4, 0, 7); g.fill();
    g.beginPath(); g.moveTo(-2, 8); g.lineTo(-2, -10); g.lineTo(12, -14); g.lineTo(12, 4); g.stroke();
    g.beginPath(); g.arc(8, 4, 3.4, 0, 7); g.fill();
  },
};

/** Draw one glyph. The context is translated to the icon centre and scaled so 40 units ≈ the icon side. */
export function paintGlyph(g, id) {
  const fn = GLYPH[id]; if (!fn) return;
  g.save(); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
  fn(g); g.restore();
}
