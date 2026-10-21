/* The cab's PHONE (the map) – a LEAF: the cockpit draws the phone on its dash mount and reads `open` / `thumb` from here, ui/map.js owns the big map and
   fills in `thumb` (the live picture on the mounted phone's screen). No imports, so cockpit/ stays free of the road network (the landing's dash cards bundle it). */
export const phone = {
  open: false,   // the big phone is in hand (ui/map.js)
  thumb: null,   // (ctx, x, y, w, h) => void – draws the small screen on the mounted phone
  power: 3,      // 0 off · 1 boot · 2 home (stays until an icon is opened) · 3 an app is open
  bootAt: 0, homeAt: 0, readyAt: 0,
  app: null,         // open app id; null on the home screen
  holdHome: false,   // home no longer auto-opens Maps
  awake: false,      // a revealed minigame keeps the screen on after the engine stops
  slowSince: 0,      // ms the truck has been stopped with the parking brake on
  notice: null,      // banner on the home screen
  badge: null,       // { id, n } launcher badge
  papers: null,      // cab stickers for phone-sms: [{ slot, img }] — pictures, not the answer
  iconOrder: null,   // personal 12-slot order from the open event
  lang: 'en',
};
