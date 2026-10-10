/* The cab's PHONE (the map) – a LEAF: the cockpit draws the phone on its dash mount and reads `open` / `thumb` from here, ui/map.js owns the big map and
   fills in `thumb` (the live picture on the mounted phone's screen). No imports, so cockpit/ stays free of the road network (the landing's dash cards bundle it). */
export const phone = {
  open: false,   // the big map is showing (ui/map.js)
  thumb: null,   // (ctx, x, y, w, h) => void – draws the small map on the mounted phone; null = a still map picture
  power: 3,      // 0 off (a new ride: the phone wakes with the engine) · 1 boot animation · 2 home screen (Maps opens) · 3 on – and it stays on for the rest of the ride, engine off or not (ui/map.js)
  bootAt: 0,     // ms (performance.now) the boot began
  homeAt: 0,     // ms the home screen came up
  readyAt: 0,    // ms the Maps app finished opening
};
