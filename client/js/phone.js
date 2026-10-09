/* The cab's PHONE (the map) – a LEAF: the cockpit draws the phone on its dash mount and reads `open` / `thumb` from here, ui/map.js owns the big map and
   fills in `thumb` (the live picture on the mounted phone's screen). No imports, so cockpit/ stays free of the road network (the landing's dash cards bundle it). */
export const phone = {
  open: false,   // the big map is showing (ui/map.js)
  thumb: null,   // (ctx, x, y, w, h) => void – draws the small map on the mounted phone; null = a still map picture
};
