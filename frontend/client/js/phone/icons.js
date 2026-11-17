/* App glyphs drawn in a 40-unit box centered on the origin. High-contrast on each icon's colour. */

const TAU = Math.PI * 2;

const GLYPH = {
  maps(g) {
    g.beginPath(); g.moveTo(-13, -7); g.lineTo(-4, -12); g.lineTo(4, -8); g.lineTo(13, -12);
    g.lineTo(13, 8); g.lineTo(4, 13); g.lineTo(-4, 9); g.lineTo(-13, 13); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(-4, -12); g.lineTo(-4, 9); g.moveTo(4, -8); g.lineTo(4, 13); g.stroke();
    g.fillStyle = '#ff4d3d';
    g.beginPath(); g.arc(4, -3.5, 4.2, 0, TAU); g.fill();
    g.beginPath(); g.moveTo(0.4, -1.5); g.lineTo(4, 4.5); g.lineTo(7.6, -1.5); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(4, -3.5, 1.6, 0, TAU); g.fill();
  },
  wallet(g) {
    g.beginPath(); g.roundRect(-13.5, -8.5, 25, 18, 3.5); g.stroke();
    g.beginPath(); g.moveTo(-10, -8.5); g.lineTo(-10, -11.5); g.lineTo(7, -11.5); g.lineTo(7, -8.5); g.stroke();
    g.fillStyle = '#c9862a'; g.beginPath(); g.roundRect(3.5, -2.5, 10, 6, 2.5); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(6.8, 0.5, 1.3, 0, TAU); g.fill();
  },
  radio(g) {
    g.beginPath(); g.moveTo(-8.5, -4); g.lineTo(7, -12.5); g.stroke();
    g.beginPath(); g.arc(7, -12.5, 1.5, 0, TAU); g.fill();
    g.beginPath(); g.roundRect(-13, -4, 26, 16.5, 3.5); g.stroke();
    g.beginPath(); g.arc(-5.5, 4.2, 3.8, 0, TAU); g.stroke();
    g.beginPath();
    g.moveTo(1.5, 1.2); g.lineTo(9.5, 1.2);
    g.moveTo(1.5, 4.2); g.lineTo(9.5, 4.2);
    g.moveTo(1.5, 7.2); g.lineTo(9.5, 7.2);
    g.stroke();
  },
  weather(g) {
    g.fillStyle = '#ffd54f'; g.beginPath(); g.arc(-6, -5.5, 5.2, 0, TAU); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(-8.5, 3.5, 4.5, 0, TAU); g.fill();
    g.beginPath(); g.arc(-2, -0.5, 6.2, 0, TAU); g.fill();
    g.beginPath(); g.arc(5.8, 2.8, 4.8, 0, TAU); g.fill();
    g.beginPath(); g.roundRect(-13, 2.5, 23.6, 5.5, 2.7); g.fill();
  },
  truck(g) {
    g.beginPath(); g.roundRect(-15, -8.5, 15.5, 11, 2); g.stroke();
    g.beginPath(); g.moveTo(2.5, -4.5); g.lineTo(8.5, -4.5); g.lineTo(13.5, 0.5); g.lineTo(13.5, 2.5); g.lineTo(2.5, 2.5); g.closePath(); g.stroke();
    g.beginPath(); g.arc(-7.5, 6.5, 2.8, 0, TAU); g.fill();
    g.beginPath(); g.arc(8.5, 6.5, 2.8, 0, TAU); g.fill();
  },
  chat(g) {
    g.beginPath(); g.roundRect(-13.5, -11, 27, 17.5, 5.5); g.fill();
    g.beginPath(); g.moveTo(-7, 5.5); g.lineTo(-10.5, 12); g.lineTo(-1, 5.5); g.closePath(); g.fill();
    g.strokeStyle = '#148f77'; g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(-7.5, -4.2); g.lineTo(7.5, -4.2); g.moveTo(-7.5, 0.8); g.lineTo(3.5, 0.8); g.stroke();
  },
  cam(g) {
    g.beginPath();
    g.moveTo(-12.5, -6); g.lineTo(-6.5, -6); g.lineTo(-4.2, -10); g.lineTo(4.2, -10); g.lineTo(6.5, -6); g.lineTo(12.5, -6);
    g.quadraticCurveTo(14, -6, 14, -4.5); g.lineTo(14, 8); g.quadraticCurveTo(14, 9.5, 12.5, 9.5);
    g.lineTo(-12.5, 9.5); g.quadraticCurveTo(-14, 9.5, -14, 8); g.lineTo(-14, -4.5); g.quadraticCurveTo(-14, -6, -12.5, -6);
    g.closePath(); g.stroke();
    g.beginPath(); g.arc(0, 1.5, 5, 0, TAU); g.stroke();
    g.beginPath(); g.arc(0, 1.5, 1.6, 0, TAU); g.fill();
    g.beginPath(); g.arc(8.8, -3.2, 1.3, 0, TAU); g.fill();
  },
  cog(g) {
    const teeth = 8, rOut = 12.5, rRoot = 9.2;
    g.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a = (i * TAU) / teeth;
      for (const [r, da] of [[rRoot, -0.22], [rOut, -0.15], [rOut, 0.15], [rRoot, 0.22]]) {
        const px = Math.cos(a + da) * r, py = Math.sin(a + da) * r;
        if (i === 0 && da === -0.22) g.moveTo(px, py); else g.lineTo(px, py);
      }
    }
    g.closePath();
    g.moveTo(4.2, 0);
    g.arc(0, 0, 4.2, 0, TAU, true);
    g.fill('evenodd');
  },
  swap(g) {
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(-10, -4.5); g.lineTo(10, -4.5);
    g.moveTo(5.5, -9); g.lineTo(10, -4.5); g.lineTo(5.5, 0);
    g.moveTo(10, 4.5); g.lineTo(-10, 4.5);
    g.moveTo(-5.5, 0); g.lineTo(-10, 4.5); g.lineTo(-5.5, 9);
    g.stroke();
  },
  calls(g) {
    g.rotate(-Math.PI / 4);
    g.translate(1.5, 0);
    g.beginPath();
    g.moveTo(-2.5, -12);
    g.quadraticCurveTo(0.5, -13.5, 3.5, -11.5);
    g.lineTo(4.5, -7.5);
    g.quadraticCurveTo(4.8, -5.5, 2.2, -5.2);
    g.lineTo(0.4, -5.0);
    g.quadraticCurveTo(-1.4, 0, 0.4, 5.0);
    g.lineTo(2.2, 5.2);
    g.quadraticCurveTo(4.8, 5.5, 4.5, 7.5);
    g.lineTo(3.5, 11.5);
    g.quadraticCurveTo(0.5, 13.5, -2.5, 12);
    g.bezierCurveTo(-8.2, 5.5, -8.2, -5.5, -2.5, -12);
    g.closePath();
    g.fill();
  },
  web(g) {
    g.save();
    g.beginPath(); g.arc(0, 0, 12.5, 0, TAU); g.clip();
    g.beginPath(); g.ellipse(0, 0, 5.6, 12.5, 0, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(-12.5, 0); g.lineTo(12.5, 0);
    g.moveTo(-12, -6.5); g.quadraticCurveTo(0, -4.2, 12, -6.5);
    g.moveTo(-12, 6.5); g.quadraticCurveTo(0, 4.2, 12, 6.5);
    g.stroke();
    g.restore();
    g.beginPath(); g.arc(0, 0, 12.5, 0, TAU); g.stroke();
  },
  gulp(g) {
    g.strokeStyle = '#1a1408'; g.fillStyle = '#1a1408';
    g.beginPath(); g.moveTo(-10.5, 12); g.lineTo(5.5, 12); g.stroke();
    g.beginPath(); g.roundRect(-8.5, -11, 12, 23, 2.5); g.fill();
    g.fillStyle = '#f5c400';
    g.beginPath(); g.roundRect(-6, -8.5, 7, 5.5, 1); g.fill();
    g.beginPath();
    g.moveTo(3.5, 1); g.bezierCurveTo(8, 1, 8, 8, 10.5, 6);
    g.lineTo(10.5, -4); g.lineTo(7.5, -7.5);
    g.stroke();
  },
  pike(g) {
    g.beginPath(); g.moveTo(-15.5, 12); g.lineTo(-6, 12); g.stroke();
    g.beginPath(); g.roundRect(-14, -2, 6.5, 14, 1.5); g.fill();
    g.beginPath(); g.arc(-10.75, -6, 3.2, 0, TAU); g.fill();
    g.save();
    g.beginPath(); g.roundRect(-8.5, -8.5, 22.5, 5, 2); g.fill(); g.clip();
    g.strokeStyle = '#ff5a1f'; g.lineWidth = 2.6;
    for (let sx = -4; sx <= 10; sx += 6.5) { g.beginPath(); g.moveTo(sx, -10); g.lineTo(sx - 3, -2); g.stroke(); }
    g.restore();
  },
  music(g) {
    g.beginPath(); g.ellipse(-6.2, 7.2, 4.1, 3.0, -0.35, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(5.4, 4.4, 4.1, 3.0, -0.35, 0, TAU); g.fill();
    g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(-2.5, 6.8); g.lineTo(-2.5, -9.5); g.moveTo(9.1, 4.0); g.lineTo(9.1, -12.3); g.stroke();
    g.beginPath(); g.moveTo(-3.7, -7.6); g.lineTo(10.3, -10.4); g.lineTo(10.3, -13.8); g.lineTo(-3.7, -11.0); g.closePath(); g.fill();
  },
};

/** Draw one glyph. The context is translated to the icon centre and scaled so 40 units ≈ the icon side. */
export function paintGlyph(g, id) {
  const fn = GLYPH[id]; if (!fn) return;
  g.save(); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
  fn(g); g.restore();
}
