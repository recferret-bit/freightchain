export default {
  id: 'gas-canopy', kind: 'landmark', v: 1, anchor: 'base', label: 'gas · canopy',
  note: 'highway service station: convenience store with ice chest & HVAC, lit canopy over two bollard-guarded pump islands & price pylon',
  parts: [
    { geo: 'box', tag: 'plinth', mat: 'dark', s: [6.2, 0.26, 10.2], at: [5.1, 0, 0] },
    { geo: 'rbox', tag: 'wall', mat: 'wall', s: [5.9, 3.15, 10], at: [5.1, 0.22, 0] },
    { geo: 'box', tag: 'band', mat: 'accent', s: [0.12, 0.42, 10], at: [2.12, 2.75, 0] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.55, 6.2], at: [2.12, 0.85, -1.1] },
    { geo: 'box', tag: 'door', mat: 'door', s: [0.14, 2.1, 1.5], at: [2.12, 0.22, 3.2] },
    { geo: 'rbox', tag: 'chest', mat: 'white', s: [0.85, 1.15, 1.6], at: [1.65, 0, -4.1] },
    { geo: 'rbox', tag: 'roof', mat: 'roof', s: [6.4, 0.32, 10.5], at: [5.1, 3.3, 0] },
    { geo: 'rbox', tag: 'hvac', mat: 'metal', s: [1.6, 0.55, 1.9], at: [5.4, 3.58, 2] },
    { geo: 'rbox', tag: 'canopy', mat: 'trim', s: [8.8, 0.32, 14], at: [-1.8, 5.1, 0] },
    { geo: 'rbox', tag: 'band', mat: 'accent', s: [8.96, 0.42, 14.16], at: [-1.8, 4.72, 0] },
    { geo: 'box', tag: 'stripe', mat: 'neon', s: [9.02, 0.1, 14.22], at: [-1.8, 5.36, 0] },
    { for: 'lz', in: [-4.2, 0, 4.2], do: [
      { geo: 'box', tag: 'lamp', mat: { color: 0xfff2c0, lamp: true }, s: [0.7, 0.08, 1.2], at: [-1.8, 4.66, 'lz'] },
    ] },
    { for: 'z', in: [-5.5, 5.5], do: [
      { for: 'x', in: [-4.8, 1], do: [
        { geo: 'oct', tag: 'base', mat: 'dark', s: [0.78, 0.45, 0.78], at: ['x', 0, 'z'] },
        { geo: 'rbox', tag: 'post', mat: 'trim', s: [0.46, 4.75, 0.46], at: ['x', 0.35, 'z'] },
      ] },
    ] },
    { for: 'z', in: [-3, 3], do: [
      { geo: 'rbox', tag: 'island', mat: 'lot', s: [1.35, 0.25, 3.8], at: [-1.8, 0, 'z'] },
      { for: 'bz', in: [-1.7, 1.7], do: [
        { geo: 'cyl16', tag: 'bollard', mat: 'accent', s: [0.11, 0.85, 0.11], at: [-1.8, 0.2, 'z + bz'] },
      ] },
      { use: 'lm-pump', with: { x: -1.8, z: 'z - 0.9' } },
      { use: 'lm-pump', with: { x: -1.8, z: 'z + 0.9' } },
    ] },
    { geo: 'oct', tag: 'base', mat: 'dark', s: [0.85, 0.4, 0.85], at: [-6.8, 0, -9.4] },
    { geo: 'cyl16', tag: 'pole', mat: 'metal', s: [0.19, 7, 0.19], at: [-6.8, 0.2, -9.4] },
    { sign: { style: 'red', w: 3.2, h: 2.6 }, at: [-6.8, 7, -9.4] },
  ],
};
