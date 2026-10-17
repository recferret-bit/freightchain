/* Cab colours the cockpit draws – VISUALS ONLY, no item changes handling or shifting. Colours differ; the hood ornament is the one shape that changes
   (cockpit/rig.js). Nine slots: `wheel`, `truck_color`, `gearbox`, `dice`, `needle`, `ornament`, `dash`, `indicator`, `phone`. Parts are minted by burning HONK; Convoy, Signal and Amber paints are referral gifts. Later an NFT replaces / extends the items – the slot model stays.
   A leaf module (no imports: the landing's dash cards run cockpit/* without three.js). The catalog mirrors server/src/domain/economy/cosmetics.ts – a server test
   (cosmetics.spec.ts) reads COSMETICS below and fails on drift. The first item of a slot is its default. To add an item: append its id here and in the server file and give it a palette
   in LOOKS (same keys as the default's). The DEFAULT loadout must keep drawing exactly what the cockpit always drew (the headless test pins the colours; the promo videos and the
   landing's dash cards rely on it). */
export const COSMETICS = {
  wheel: ['classic', 'crimson', 'ocean', 'moss', 'gold', 'ivory'],
  truck_color: ['red', 'blue', 'green', 'black', 'yellow', 'white', 'convoy', 'signal', 'amber'],
  gearbox: ['stick', 'chrome', 'wood', 'racing', 'gold', 'carbon'],
  dice: ['white', 'red', 'blue', 'gold', 'pink', 'black'],
  needle: ['orange', 'red', 'lime', 'cyan', 'white', 'gold'],
  ornament: ['spear', 'ball', 'star', 'gold', 'bird', 'flag'],
  dash: ['stock', 'wood', 'carbon', 'gold', 'red', 'ivory'],
  indicator: ['amber', 'red', 'green', 'gold', 'ice', 'white'],
  phone: ['black', 'silver', 'gold', 'red', 'blue', 'clear'],
};

export const REFERRAL_PAINTS = ['convoy', 'signal', 'amber'];

export const SLOTS = Object.keys(COSMETICS);
export const defaultLoadout = () => ({ wheel: 'classic', truck_color: 'red', gearbox: 'stick', dice: 'white', needle: 'orange', ornament: 'spear', dash: 'stock', indicator: 'amber', phone: 'black' });

/* wheel: rim, sheen (the inner ring), spoke, hub, mark (the FC letters + the 12-o'clock dot).
   truck_color: top / bottom (the hood gradient), fender, line (the centre highlight), frame (the windscreen edge), dashEdge (the dashboard's top edge).
   gearbox: knob, rim (its outline), boot, lever (null = the chrome gradient), text (the gear letter).
   dice: body, pip (the dice hanging from the mirror). needle: color (the needles of the big gauges).
   ornament: fill, edge (spear is the original triangle, not painted from this palette). dash: top, bottom (stock keeps the original fascia stops).
   indicator: bezel (the warning-lamp housing when it is dark; amber is the original off chrome). phone: frame, edge (black keeps the original gradient and stroke). */
export const LOOKS = {
  wheel: {
    classic: { rim: '#0e0d0b', sheen: '#2b2722', spoke: '#1b1814', hub: '#26221d', mark: '#ffcf5a' },
    crimson: { rim: '#14090a', sheen: '#c9301f', spoke: '#2a1214', hub: '#2a0f10', mark: '#ffd0c8' },
    ocean: { rim: '#0a0d14', sheen: '#3d7ad6', spoke: '#141c2e', hub: '#1b2640', mark: '#bcd8ff' },
    moss: { rim: '#0c120d', sheen: '#4a9a58', spoke: '#18241a', hub: '#1f3022', mark: '#c4f2c9' },
    gold: { rim: '#2a2006', sheen: '#e8c040', spoke: '#8a6d14', hub: '#5a4510', mark: '#fff2b0' },
    ivory: { rim: '#d9d4c4', sheen: '#f6f2e6', spoke: '#a9a392', hub: '#8f8a7a', mark: '#3a352a' },
  },
  truck_color: {
    red: { top: '#b0281f', bottom: '#6e130f', fender: '#5c120e', line: 'rgba(255,200,190,.35)', frame: '#3d372f', dashEdge: '#5a554a' },
    blue: { top: '#2a63b8', bottom: '#12356e', fender: '#0f2c5c', line: 'rgba(190,215,255,.35)', frame: '#34425e', dashEdge: '#52628a' },
    green: { top: '#2f8a45', bottom: '#14502a', fender: '#10401f', line: 'rgba(200,255,210,.35)', frame: '#35503a', dashEdge: '#55715a' },
    black: { top: '#2b2c31', bottom: '#0d0e10', fender: '#08090a', line: 'rgba(255,215,120,.45)', frame: '#2c2a30', dashEdge: '#d4af37' },
    yellow: { top: '#e0b324', bottom: '#8f6d0c', fender: '#6f550a', line: 'rgba(255,245,200,.4)', frame: '#7a6420', dashEdge: '#a88a2c' },
    white: { top: '#e6eef5', bottom: '#9db0c2', fender: '#7d90a3', line: 'rgba(255,255,255,.6)', frame: '#8fa0b0', dashEdge: '#b4c3d0' },
    convoy: { top: '#ff8a1e', bottom: '#8a3a08', fender: '#6e2e06', line: 'rgba(255,220,160,.45)', frame: '#5a3a22', dashEdge: '#e07020' },
    signal: { top: '#f2f20a', bottom: '#6e6e04', fender: '#555504', line: 'rgba(255,255,180,.5)', frame: '#4a4a18', dashEdge: '#d6d620' },
    amber: { top: '#ffb000', bottom: '#8a5a00', fender: '#6e4800', line: 'rgba(255,220,140,.45)', frame: '#5a4010', dashEdge: '#ffb000' },
  },
  gearbox: {
    stick: { knob: '#17150f', rim: '#555', boot: '#0c0b0a', lever: null, text: '#e8e2cf' },
    chrome: { knob: '#cfd4d9', rim: '#ffffff', boot: '#1a1a1c', lever: '#e8ecef', text: '#1a1a1c' },
    wood: { knob: '#6a3f1d', rim: '#b98a56', boot: '#24170d', lever: '#c4894e', text: '#f3e2c5' },
    racing: { knob: '#c9301f', rim: '#ff8a7a', boot: '#101012', lever: '#9aa0a6', text: '#ffffff' },
    gold: { knob: '#d4af37', rim: '#fff2b0', boot: '#050506', lever: '#f0d56a', text: '#1a160a' },
    carbon: { knob: '#2a2c31', rim: '#7a7f88', boot: '#0a0a0c', lever: '#4a4d55', text: '#e8e2cf' },
  },
  dice: {
    white: { body: '#f4f1e8', pip: '#b11' },
    red: { body: '#c9301f', pip: '#ffffff' },
    blue: { body: '#2a63b8', pip: '#ffffff' },
    gold: { body: '#d4af37', pip: '#3a2c06' },
    pink: { body: '#f08ab8', pip: '#ffffff' },
    black: { body: '#1c1c20', pip: '#f4f1e8' },
  },
  needle: {
    orange: { color: '#ff7a2e' },
    red: { color: '#ff3a2a' },
    lime: { color: '#9dff3a' },
    cyan: { color: '#3ad8ff' },
    white: { color: '#ffffff' },
    gold: { color: '#ffd24a' },
  },
  ornament: {
    spear: { fill: '#e8ecef', edge: '#9aa1a8' },
    ball: { fill: '#b9c2cc', edge: '#3e4650' },
    star: { fill: '#f7f8fa', edge: '#6a7178' },
    gold: { fill: '#d4af37', edge: '#fff2b0' },
    bird: { fill: '#1a1c22', edge: '#d4af37' },
    flag: { fill: '#c9301f', edge: '#f4f1e8' },
  },
  dash: {
    stock: { top: '#4b473f', bottom: '#0a0908' },
    wood: { top: '#8d5a30', bottom: '#3a2414' },
    carbon: { top: '#3c4048', bottom: '#101114' },
    gold: { top: '#e8c040', bottom: '#5a4510' },
    red: { top: '#8e241c', bottom: '#2a0c0a' },
    ivory: { top: '#f3efe4', bottom: '#b7b1a2' },
  },
  indicator: {
    amber: { bezel: '#2a2622' },
    red: { bezel: '#6a2c28' },
    green: { bezel: '#1f4d34' },
    gold: { bezel: '#d4af37' },
    ice: { bezel: '#b7dff0' },
    white: { bezel: '#f4f1e8' },
  },
  phone: {
    black: { frame: '#2b2d31', edge: '#45484e' },
    silver: { frame: '#d5dbe1', edge: '#6d737a' },
    gold: { frame: '#d4af37', edge: '#8a6d14' },
    red: { frame: '#c9301f', edge: '#5c140e' },
    blue: { frame: '#2a63b8', edge: '#12356e' },
    clear: { frame: '#e7eef6', edge: '#9aafc2' },
  },
};

/* What the cockpit wears right now. Mutated in place (the cockpit reads it every frame); set from the ride's loadout by online.js / watch.js, or by hand. */
export const loadout = defaultLoadout();

/* Transient poses the cockpit adds on top of the physics: the Garage swings the dice with it (site/garage-cab.js). 0 in the game, so nothing changes there. */
export const pose = { dice: 0 };

/** Wear `next` ({ slot: item }); unknown slots / items are ignored (the default of that slot stays), so a stale or hostile value can never break the cockpit. Returns the loadout. */
export function setLoadout(next) {
  const base = defaultLoadout();
  for (const slot of SLOTS) loadout[slot] = next && COSMETICS[slot].includes(next[slot]) ? next[slot] : base[slot];
  return loadout;
}

/** The palette of the worn item of `slot` (wheel | truck_color | gearbox | dice | needle | ornament | dash | indicator | phone). */
export const look = (slot) => LOOKS[slot][loadout[slot]] ?? LOOKS[slot][COSMETICS[slot][0]];
