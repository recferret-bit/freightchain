export default {
  id: 'gulp-bay', kind: 'landmark', v: 1, anchor: 'base', label: 'gulp · bay',
  note: 'automatic GULP bay: one-storey shop, high canopy over a freighter lane, canopy lamps that glow at night, no wheels',
  parts: [
    { geo: 'box', tag: 'wall', mat: 'wall', s: [7, 4.2, 16], at: [6.4, 0, 2] },
    { geo: 'box', tag: 'roof', mat: 'roof', s: [7.5, 0.28, 16.6], at: [6.4, 4.2, 2] },
    { geo: 'box', tag: 'band', mat: 'neon', s: [0.08, 0.42, 16], at: [2.88, 3.55, 2] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.08, 1.35, 7.2], at: [2.88, 1.05, 0.2] },
    { geo: 'box', tag: 'door', mat: 'door', s: [0.08, 2.15, 1.35], at: [2.88, 0, 6.5] },
    { geo: 'box', tag: 'kiosk', mat: 'dark', s: [1.15, 2.15, 1.5], at: [3.7, 0, -4.4] },
    { geo: 'box', tag: 'screen', mat: 'glass', s: [0.06, 0.7, 0.85], at: [3.1, 1.05, -4.4] },
    { sign: { style: 'cream', w: 2.4, h: 0.7, text: 'AUTO' }, at: [2.35, 2.7, 2] },

    { geo: 'box', tag: 'canopy', mat: 'neon', s: [13, 0.32, 40], at: [-1.2, 6.4, 0] },
    { geo: 'box', tag: 'fascia', mat: 'dark', s: [13.12, 0.18, 40.12], at: [-1.2, 6.22, 0] },
    { sign: { style: 'neon', w: 10, h: 1.6, text: 'GULP' }, at: [-8.8, 4.7, 0] },
    { for: 'z', in: [-16, -8, 0, 8, 16], do: [
      { geo: 'box', tag: 'lamp', mat: { color: 0xffd84a, lamp: true }, s: [0.55, 0.16, 1.15], at: [-6.2, 6.06, 'z'] },
      { glow: { color: 0xffd84a, size: 4.2, gain: 1 }, at: [-6.2, 5.85, 'z'] },
    ] },
    { for: 'z', in: [-3.5, 0, 3.5], do: [
      { glow: { color: 0xffd84a, size: 3.4, gain: 0.9 }, at: [-9.4, 5.5, 'z'] },
    ] },
    { group: {}, at: [-3.5, 0, 18], do: [{ beam: { color: 0xffd84a, gain: 0.45, w: 14, l: 18, z0: 0 } }] },
    { group: {}, at: [-3.5, 0, 0], do: [{ beam: { color: 0xffd84a, gain: 0.45, w: 14, l: 18, z0: 0 } }] },
    { for: 'z', in: [-18, -6, 6, 18], do: [
      { for: 'x', in: [-6.8, 4.2], do: [
        { geo: 'box', tag: 'post', mat: 'dark', s: [0.42, 6.4, 0.42], at: ['x', 0, 'z'] },
      ] },
    ] },

    { for: 'z', in: [-16, -12, -8, -4, 0, 4, 8, 12, 16], do: [
      { geo: 'box', tag: 'stripe', mat: 'neon', s: [0.55, 0.04, 2.2], at: [-4.6, 0.05, 'z'] },
    ] },
    { for: 'z', in: [-11, -3, 5, 13], do: [
      { geo: 'box', tag: 'island', mat: 'lot', s: [1.6, 0.22, 4.4], at: [-2.4, 0, 'z'] },
      { geo: 'box', tag: 'curb', mat: 'neon', s: [1.7, 0.08, 4.5], at: [-2.4, 0.22, 'z'] },
      { geo: 'box', tag: 'pump', mat: 'metal', s: [1.15, 3.05, 1.35], at: [-2.4, 0.3, 'z'] },
      { geo: 'box', tag: 'screen', mat: 'neon', s: [0.16, 0.7, 0.9], at: [-2.935, 1.7, 'z'] },
      { glow: { color: 0xffd84a, size: 1.7, gain: 0.8 }, at: [-3.15, 2.05, 'z'] },
      { geo: 'box', tag: 'boom', mat: 'dark', s: [0.16, 2.9, 0.16], at: [-2.4, 3.35, 'z'] },
      { geo: 'box', tag: 'nozzle', mat: 'dark', s: [2.4, 0.14, 0.16], at: [-3.5, 4.7, 'z'] },
      { geo: 'box', tag: 'hose', mat: 'dark', s: [0.14, 4.4, 0.14], at: [-3.1, 0.3, 'z'] },
    ] },

    { geo: 'box', tag: 'arch', mat: 'dark', s: [0.38, 5.85, 0.38], at: [-5.6, 0, -16.4] },
    { geo: 'box', tag: 'arch', mat: 'dark', s: [0.38, 5.85, 0.38], at: [1.6, 0, -16.4] },
    { geo: 'box', tag: 'arch', mat: 'neon', s: [7.6, 0.42, 0.42], at: [-2, 5.82, -16.4] },
    { for: 'z', in: [-14, -10, -6, -2, 2, 6, 10, 14], do: [
      { geo: 'cyl', tag: 'bollard', mat: 'neon', s: [0.22, 1.05, 0.22], at: [-8.2, 0, 'z'] },
    ] },

    { geo: 'box', tag: 'pole', mat: 'dark', s: [0.42, 9.2, 0.42], at: [-11.2, 0, -18] },
    { sign: { style: 'neon', w: 6.2, h: 2.6, text: 'GULP' }, at: [-11.2, 8.6, -18] },
    { glow: { color: 0xffd84a, size: 6.5, gain: 1.05 }, at: [-11.6, 9.9, -18] },
  ],
};
