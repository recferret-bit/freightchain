/* Cosmetics: what a promo code can unlock and the cockpit draws – VISUALS ONLY, no item changes handling or shifting. A leaf module (no imports: the landing's dash cards
   run cockpit/* without three.js). Today there is ONE slot, `cabin`: a colour scheme for the whole inside of the cab. Later an NFT replaces / extends the items – the slot
   model stays. The catalog mirrors server/src/domain/economy/cosmetics.ts – a server test (cosmetics.spec.ts) reads COSMETICS below and fails on drift.
   The first item of a slot is its default. To add a cabin: append its id here and in the server file, add a palette to LOOKS.cabin (same keys as `classic`).
   The default loadout must keep drawing exactly what the cockpit always drew (the headless test pins the colours; the promo videos and the landing's dash cards rely on it). */
export const COSMETICS = {
  cabin: ['classic', 'midnight', 'forest', 'sunset', 'arctic', 'noir'],
};

export const SLOTS = Object.keys(COSMETICS);
export const defaultLoadout = () => ({ cabin: 'classic' });

/* A cabin palette. interior: the cab behind the glass (top → bottom); frame: the windscreen's edge; hood: the bonnet gradient (top, bottom), the fenders and the centre
   highlight; dash: the dashboard top (4 gradient stops, light → dark) + its edge line; binnacle: the instrument housing + its edge; wheel: rim, the sheen ring, spokes, hub,
   mark (the FC letters + the 12-o'clock dot); shifter: knob, knob rim, boot, lever (null = the chrome gradient), the gear letter. Shapes (widths, radii) are the same in every cabin. */
export const LOOKS = {
  cabin: {
    classic: {
      interior: ['#26221d', '#0c0a08'], frame: '#3d372f',
      hood: { top: '#b0281f', bottom: '#6e130f', fender: '#5c120e', line: 'rgba(255,200,190,.35)' },
      dash: ['#4b473f', '#27241f', '#14120f', '#0a0908'], dashEdge: '#5a554a', binnacle: '#0b0a08', binnacleEdge: '#34302a',
      wheel: { rim: '#0e0d0b', sheen: '#2b2722', spoke: '#1b1814', hub: '#26221d', mark: '#ffcf5a' },
      shifter: { knob: '#17150f', rim: '#555', boot: '#0c0b0a', lever: null, text: '#e8e2cf' },
    },
    midnight: {
      interior: ['#1b2230', '#070a10'], frame: '#34425e',
      hood: { top: '#2a63b8', bottom: '#12356e', fender: '#0f2c5c', line: 'rgba(190,215,255,.35)' },
      dash: ['#3f4a63', '#212a3d', '#10151f', '#07090e'], dashEdge: '#52628a', binnacle: '#070a11', binnacleEdge: '#2a3650',
      wheel: { rim: '#0a0d14', sheen: '#3d5a9a', spoke: '#171d2e', hub: '#1c2538', mark: '#9fc4ff' },
      shifter: { knob: '#cfd4d9', rim: '#ffffff', boot: '#10141d', lever: null, text: '#1a1a1c' },
    },
    forest: {
      interior: ['#1f2a20', '#080d09'], frame: '#35503a',
      hood: { top: '#2f8a45', bottom: '#14502a', fender: '#10401f', line: 'rgba(200,255,210,.35)' },
      dash: ['#3f5242', '#222f24', '#111a12', '#070b08'], dashEdge: '#55715a', binnacle: '#070b08', binnacleEdge: '#2c4331',
      wheel: { rim: '#0c120d', sheen: '#4a7a52', spoke: '#18241a', hub: '#1f2d21', mark: '#bff0c4' },
      shifter: { knob: '#6a3f1d', rim: '#b98a56', boot: '#13170f', lever: null, text: '#f3e2c5' },
    },
    sunset: {
      interior: ['#33231a', '#100905'], frame: '#6a4228',
      hood: { top: '#e0731f', bottom: '#8f3d0a', fender: '#6f2f08', line: 'rgba(255,225,190,.4)' },
      dash: ['#5c4636', '#33241a', '#1a110b', '#0c0805'], dashEdge: '#8a6240', binnacle: '#0e0805', binnacleEdge: '#4a3220',
      wheel: { rim: '#1a0f08', sheen: '#e8913a', spoke: '#2a1a0f', hub: '#3a2414', mark: '#ffd9a0' },
      shifter: { knob: '#e8913a', rim: '#ffd9a0', boot: '#150c06', lever: null, text: '#1a0f08' },
    },
    arctic: {
      interior: ['#4a5560', '#1a2128'], frame: '#8fa0b0',
      hood: { top: '#e6eef5', bottom: '#9db0c2', fender: '#7d90a3', line: 'rgba(255,255,255,.6)' },
      dash: ['#8a98a6', '#56626e', '#2d353d', '#171c21'], dashEdge: '#b4c3d0', binnacle: '#10151a', binnacleEdge: '#5d6c7a',
      wheel: { rim: '#1a2128', sheen: '#7fb4e0', spoke: '#2c3640', hub: '#3a4652', mark: '#e8f4ff' },
      shifter: { knob: '#e8f4ff', rim: '#7fb4e0', boot: '#1a2128', lever: null, text: '#1a2128' },
    },
    noir: {
      interior: ['#18171a', '#050506'], frame: '#2c2a30',
      hood: { top: '#2b2c31', bottom: '#0d0e10', fender: '#08090a', line: 'rgba(255,215,120,.45)' },
      dash: ['#2f2e33', '#19181b', '#0d0c0e', '#050506'], dashEdge: '#d4af37', binnacle: '#050506', binnacleEdge: '#8a7020',
      wheel: { rim: '#050506', sheen: '#d4af37', spoke: '#2a2410', hub: '#1a160a', mark: '#ffe27a' },
      shifter: { knob: '#d4af37', rim: '#fff2b0', boot: '#050506', lever: null, text: '#1a160a' },
    },
  },
};

/* What the cockpit wears right now. Mutated in place (the cockpit reads it every frame); set from the ride's cabin by online.js / watch.js, from the lobby's preview, or by hand. */
export const loadout = defaultLoadout();

/** Wear `next` ({ slot: item }); unknown slots / items are ignored (the default stays), so a stale or hostile value can never break the cockpit. Returns the loadout. */
export function setLoadout(next) {
  const base = defaultLoadout();
  for (const slot of SLOTS) loadout[slot] = next && COSMETICS[slot].includes(next[slot]) ? next[slot] : base[slot];
  return loadout;
}

/** The palette of the worn item of `slot` (today only 'cabin'). */
export const look = (slot) => LOOKS[slot][loadout[slot]] ?? LOOKS[slot][COSMETICS[slot][0]];
