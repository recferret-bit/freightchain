/* Cosmetics: what a promo code can unlock and the cockpit draws – VISUALS ONLY, no item changes handling or shifting. A leaf module (no imports: the landing's dash cards run
   cockpit/* without three.js). The catalog mirrors server/src/domain/economy/cosmetics.ts – a server test (cosmetics.spec.ts) reads COSMETICS below and fails on drift.
   The first item of a slot is its default. To add an item: append it here and in the server file, give it a look in LOOKS, and – only if the shape differs –
   draw it in cockpit/rig.js (steering wheel, hood + fenders, shifter). The default loadout must keep drawing exactly what the cockpit always drew (the headless trace and the promo videos rely on it). */
export const COSMETICS = {
  wheel: ['classic', 'sport', 'wood', 'gold'],
  truck_color: ['red', 'blue', 'green', 'black', 'yellow'],
  gearbox: ['stick', 'chrome', 'wood', 'racing'],
};

export const SLOTS = Object.keys(COSMETICS);
export const defaultLoadout = () => ({ wheel: 'classic', truck_color: 'red', gearbox: 'stick' });

/* How each item looks. truck_color: hood gradient top / bottom, fender fill and the centre highlight line. wheel: rim + width, rim sheen (inner stroke) + width, spokes (colour, width, count)
   and hub fill, mark = the FC letters + 12-o'clock dot. gearbox: knob fill + radius, knob rim, boot colour, lever (null = the chrome gradient), the gear letter. Widths / radii are in cockpit units (u). */
export const LOOKS = {
  wheel: {
    classic: { rim: '#0e0d0b', rimW: 5.4, sheen: '#2b2722', sheenW: 2.6, spoke: '#1b1814', spokeW: 3, spokes: 4, hub: '#26221d', mark: '#ffcf5a' },
    sport: { rim: '#0a0a0c', rimW: 4.6, sheen: '#c9301f', sheenW: 1.4, spoke: '#2a2a30', spokeW: 4.2, spokes: 3, hub: '#15151a', mark: '#ffffff' },
    wood: { rim: '#2b1608', rimW: 6.2, sheen: '#9a6535', sheenW: 3.6, spoke: '#4a2a12', spokeW: 3, spokes: 4, hub: '#2e2218', mark: '#e8c38a' },
    gold: { rim: '#3d2f06', rimW: 5.4, sheen: '#e8c040', sheenW: 2.6, spoke: '#8a6d14', spokeW: 2.2, spokes: 6, hub: '#5a4510', mark: '#fff2b0' },
  },
  truck_color: {
    red: { top: '#b0281f', bottom: '#6e130f', fender: '#5c120e', line: 'rgba(255,200,190,.35)' },
    blue: { top: '#2a63b8', bottom: '#12356e', fender: '#0f2c5c', line: 'rgba(190,215,255,.35)' },
    green: { top: '#2f8a45', bottom: '#14502a', fender: '#10401f', line: 'rgba(200,255,210,.35)' },
    black: { top: '#33343a', bottom: '#0f1013', fender: '#0b0c0e', line: 'rgba(220,225,235,.3)' },
    yellow: { top: '#e0b324', bottom: '#8f6d0c', fender: '#6f550a', line: 'rgba(255,245,200,.4)' },
  },
  gearbox: {
    stick: { knob: '#17150f', knobR: 2.8, rim: '#555', boot: '#0c0b0a', lever: null, text: '#e8e2cf' },
    chrome: { knob: '#cfd4d9', knobR: 2.8, rim: '#ffffff', boot: '#1a1a1c', lever: null, text: '#1a1a1c' },
    wood: { knob: '#6a3f1d', knobR: 3.3, rim: '#b98a56', boot: '#24170d', lever: null, text: '#f3e2c5' },
    racing: { knob: '#c9301f', knobR: 2.3, rim: '#ff8a7a', boot: '#101012', lever: '#9aa0a6', text: '#ffffff' },
  },
};

/* What the cockpit wears right now. Mutated in place (the cockpit reads it every frame); set from the player's wardrobe by online.js, from the lobby's preview, or by hand. */
export const loadout = defaultLoadout();

/** Wear `next` ({ slot: item }); unknown slots / items are ignored (the default stays), so a stale or hostile value can never break the cockpit. Returns the loadout. */
export function setLoadout(next) {
  const base = defaultLoadout();
  for (const slot of SLOTS) loadout[slot] = next && COSMETICS[slot].includes(next[slot]) ? next[slot] : base[slot];
  return loadout;
}

export const look = (slot) => LOOKS[slot][loadout[slot]] ?? LOOKS[slot][COSMETICS[slot][0]];
