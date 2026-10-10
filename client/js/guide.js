/* The free ride's two helpers – a LEAF (no imports: sim/, cockpit/ and ui/ all read it, and the landing's dash cards bundle cockpit/).
   TUTORIAL (ui/tutorial.js): a step-by-step dialog over the gameplay that waits for the driver to do each thing.
   ASSIST (ui/assist.js): the truck wears out half as fast (CFG.ASSIST: hull damage + battery drain ×0.5) and every control / indicator gets a tip at the moment it matters.
   Both say WHAT to highlight through `guide.tips`; cockpit/guide.js draws it on top of the dash. Both are off by default – everything here is inert then (the trace stays identical).
   The server owns the flags of an online ride (Ride.tutorial / Ride.assist, free tier only). Offline (play.html without ?ride) they come from ?tutorial=1&assist=1. */
export const guide = {
  tutorial: false,
  assist: false,
  hold: false, // the tutorial is not finished: the free run's finish line waits for it (sim/physics.js) so the lesson is never cut off by the win
  banner: null, // { text, at } – a SUCCESS banner on the windscreen (the tutorial cheers a finished step); drawn by cockpit/guide.js for BANNER_MS
  note: '',    // the tutorial's current trouble ("ENGINE STALLED"…), '' = none – read by the tests
  tips: [],    // [{ id, text, key? }] – what to highlight THIS frame (id = a dash button id from uiBtns, or an indicator id from `rects`)
  rects: [],   // [{ id, x, y, w, h }] – where the indicators sit THIS frame (screen px like uiBtns); rebuilt by the cockpit every frame
};
export const hint = (id, x, y, w, h) => { guide.rects.push({ id, x, y, w, h }); };
export const BANNER_MS = 2600;
export const cheer = text => { guide.banner = { text, at: performance.now() }; };
export const setGuide = (f = {}) => { guide.tutorial = f.tutorial === true; guide.assist = f.assist === true; guide.tips.length = 0; guide.banner = null; guide.hold = guide.tutorial; };
