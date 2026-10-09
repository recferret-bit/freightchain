/* Failed-ride feedback (the promo trailer's crash beat, for real): the whole screen shakes and flashes red, a translucent tilted "SHIFT OVER" stamp slams in,
   and the result panel (CSS `#overlay.late`) fades in after it. DOM only – nothing here touches the sim or the canvases' drawing. */
const MS = 1500;   // the effect; the panel appears at the end
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function failFx(text = '✖ SHIFT OVER') {
  const overlay = document.getElementById('overlay');
  const flash = document.createElement('div'), stamp = document.createElement('div');
  flash.className = 'fail-flash'; stamp.className = 'fail-stamp'; stamp.textContent = text;
  document.body.appendChild(flash); document.body.appendChild(stamp);
  overlay.classList.add('late');
  if (!reduced()) {
    const kf = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => { const f = 1 - i / 8; return { transform: i === 8 ? 'none' : `translate(${(Math.random() - .5) * 40 * f}px,${(Math.random() - .5) * 30 * f}px)` }; });
    for (const c of document.querySelectorAll('canvas')) c.animate(kf, { duration: 500, easing: 'linear' });
  }
  setTimeout(() => { flash.remove(); stamp.remove(); overlay.classList.remove('late'); }, MS + 400);
}
