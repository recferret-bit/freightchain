/* The GAMEPLAY side of every entity the game places – code, never data, so no entity edit (by hand or by the AI editor) can change
   a collision, a footprint, the layout of a seed or what a ride recording means:
   – prop / furniture: the collision kind (a key of KINDS in client/js/world/props.js) and the `size` expression passed to it,
     plus the params and slots the game's call sites supply (themes/<route>/props.js, themes/_shared/furniture.js);
   – landmark: the footprint (hl / hd, half length along the road / half depth, m) and the ORDER of the implementations –
     site() picks impls[floor(rnd · n)], so reordering would move buildings on every seed;
   – vehicle: size comes from VEHICLES (client/shared/traffic.js, also used by the server's anti-cheat traffic sim) and the roles
     the traffic AI drives; `flash` (a siren) is stored in the ride recording, so only these types may have one.
   Adding a new prop / landmark / vehicle TO THE GAME = a row here + its call site. An entity that is not on the roster is shown by the viewer only. */

export const ROSTER = {
  prop: {
    cactus: { kind: 'cactus', size: 'h', params: ['h', 'r2'], slots: ['m'] },
    rock: { kind: 'rock', size: 's', params: ['s', 'r2'], slots: ['m1', 'm2'] },
    bush: { kind: 'bush', size: 's', params: ['s'], slots: ['m'] },
    tuft: { kind: 'bush', size: 's', params: ['s'], slots: ['m'] },
    termite: { kind: 'termite', size: 'h', params: ['h'], slots: ['m'] },
    cairn: { kind: 'rock', size: 's', params: ['s'], slots: ['m'] },
    drift: { kind: 'drift', size: 's', params: ['s'], slots: ['m'] },
    spruce: { kind: 'tree', size: 'h', params: ['h'], slots: ['trunk', 'leaf', 'snow'] },
    'round-tree': { kind: 'tree', size: 'h', params: ['h'], slots: ['trunk', 'leaf'] },
    'gum-tree': { kind: 'tree', size: 'h', params: ['h'], slots: ['trunk', 'leaf'] },
    birch: { kind: 'tree', size: 'h', params: ['h'], slots: ['trunk', 'mark'] },
  },
  furniture: {
    post: { kind: 'post', size: 1, params: [], slots: ['body', 'cap'] },
    lamp: { kind: 'lamp', size: 1, params: ['h', 'arm', 'sd', 'light'], slots: ['mast', 'bulb'], roles: ['glow'] },
    pole: { kind: 'pole', size: 1, params: [], slots: ['m'] },
    guard: { kind: 'guard', size: 1, params: [], slots: ['rail', 'post'] },
  },
  landmark: {
    motel: [{ id: 'motel-strip', hl: 13, hd: 5 }, { id: 'motel-cabins', hl: 13, hd: 5 }, { id: 'motel-twostory', hl: 12, hd: 5 }],
    hotel: [{ id: 'hotel-tower', hl: 8, hd: 6 }, { id: 'hotel-resort', hl: 14, hd: 7 }],
    restaurant: [{ id: 'diner-chrome', hl: 8, hd: 5 }, { id: 'roadhouse-porch', hl: 7, hd: 6 }, { id: 'fastfood-drive', hl: 7, hd: 6 }],
    gas: [{ id: 'gas-canopy', hl: 11, hd: 8 }, { id: 'gas-truckstop', hl: 14, hd: 9 }, { id: 'gas-kiosk', hl: 7, hd: 6 }],
    police: [{ id: 'police-checkpoint', hl: 6, hd: 4 }, { id: 'police-speedtrap', hl: 5, hd: 4 }, { id: 'police-station', hl: 10, hd: 6 }],
  },
  vehicle: {
    sedan: { roles: ['ind.l', 'ind.r', 'brake'] },
    truck: { roles: ['ind.l', 'ind.r', 'brake'] },
    bus: { roles: ['ind.l', 'ind.r', 'brake'] },
    freighter: { roles: ['ind.l', 'ind.r', 'brake'] },
    police: { roles: ['ind.l', 'ind.r', 'brake', 'flash.0', 'flash.1'] },
    medic: { roles: ['ind.l', 'ind.r', 'brake', 'flash.0', 'flash.1'] },
    fire: { roles: ['ind.l', 'ind.r', 'brake', 'flash.0', 'flash.1'] },
  },
  gantry: { gantry: {} },
};
/* the params a landmark is built with (landmarks/index.js model()): the sign text comes from the site, the flags from the route */
export const LANDMARK_PARAMS = ['flags'];
export const LANDMARK_SLOTS = ['wall', 'roof', 'trim', 'glass', 'door', 'lot', 'apron', 'metal', 'dark', 'accent', 'accent2', 'neon', 'leaf', 'trunk', 'cone', 'white', 'red', 'blue'];
export const VEHICLE_PARAMS = ['len', 'w', 'h', 'pick', 'hi'];

/* id → { kind, lock } for every rostered entity; `landmarkFootprint(id)` → { hl, hd, type, index } */
export function rosterOf(id) {
  for (const k of ['prop', 'furniture', 'vehicle', 'gantry']) if (Object.hasOwn(ROSTER[k], id)) return { kind: k, lock: ROSTER[k][id] };
  const lm = landmarkFootprint(id);
  return lm ? { kind: 'landmark', lock: lm } : null;
}
export function landmarkFootprint(id) {
  for (const [type, impls] of Object.entries(ROSTER.landmark)) { const index = impls.findIndex(v => v.id === id); if (index >= 0) return { ...impls[index], type, index }; }
  return null;
}
