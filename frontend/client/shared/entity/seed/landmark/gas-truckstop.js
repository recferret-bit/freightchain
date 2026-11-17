export default {
  id: 'gas-truckstop', kind: 'landmark', v: 1, anchor: 'base', label: 'gas · truckstop',
  note: 'highway diesel travel plaza: large store with truck service bay & HVAC, 24 m high-clearance canopy, bollard-guarded diesel island & tall pylon',
  parts: [
    { geo: 'box', tag: 'plinth', mat: 'dark', s: [8, 0.3, 22.2], at: [5.2, 0, 0] },
    { geo: 'rbox', tag: 'wall', mat: 'wall', s: [7.7, 4, 22], at: [5.2, 0.24, 0] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.12, 1.95, 12.6], at: [1.32, 0.92, -3.2] },
    { geo: 'box', tag: 'door', mat: 'door', s: [0.16, 2.25, 2], at: [1.3, 0.24, 4.4] },
    { geo: 'box', tag: 'door', mat: 'dark', s: [0.14, 3.1, 3.4], at: [1.32, 0.24, 8.4] },
    { geo: 'box', tag: 'trim', mat: 'trim', s: [0.18, 0.16, 3.6], at: [1.3, 3.3, 8.4] },
    { geo: 'rbox', tag: 'roof', mat: 'roof', s: [8.3, 0.34, 22.6], at: [5.2, 4.18, 0] },
    { geo: 'box', tag: 'band', mat: 'accent', s: [0.12, 0.56, 21.8], at: [1.3, 3.35, 0] },
    { for: 'hz', in: [-6.5, 0, 6.5], do: [
      { geo: 'rbox', tag: 'hvac', mat: 'metal', s: [1.9, 0.65, 2.3], at: [5.6, 4.48, 'hz'] },
    ] },
    { geo: 'rbox', tag: 'canopy', mat: 'trim', s: [9.6, 0.34, 24], at: [-3.2, 5.9, 0] },
    { geo: 'rbox', tag: 'band', mat: 'accent2', s: [9.76, 0.5, 24.16], at: [-3.2, 5.48, 0] },
    { geo: 'box', tag: 'stripe', mat: 'neon', s: [9.82, 0.12, 24.22], at: [-3.2, 6.18, 0] },
    { for: 'lz', in: [-8, -3, 3, 8], do: [
      { geo: 'box', tag: 'lamp', mat: { color: 0xfff2c0, lamp: true }, s: [0.85, 0.08, 1.5], at: [-3.2, 5.42, 'lz'] },
    ] },
    { for: 'z', in: [-10, 0, 10], do: [
      { for: 'x', in: [-7.2, -0.4], do: [
        { geo: 'oct', tag: 'base', mat: 'dark', s: [0.82, 0.48, 0.82], at: ['x', 0, 'z'] },
        { geo: 'rbox', tag: 'post', mat: 'trim', s: [0.48, 5.55, 0.48], at: ['x', 0.38, 'z'] },
      ] },
    ] },
    { geo: 'rbox', tag: 'island', mat: 'lot', s: [1.5, 0.25, 18.4], at: [-4.1, 0, 0] },
    { for: 'bz', in: [-8.8, -4, 0, 4, 8.8], do: [
      { geo: 'cyl16', tag: 'bollard', mat: 'neon', s: [0.12, 0.92, 0.12], at: [-4.1, 0.2, 'bz'] },
    ] },
    { for: 'z', in: [-6, -2, 2, 6], do: [
      { use: 'lm-pump', with: { x: -4.1, z: 'z', h: 1.7 } },
    ] },
    { geo: 'oct', tag: 'base', mat: 'dark', s: [1, 0.48, 1], at: [-7.8, 0, -12.6] },
    { geo: 'cyl16', tag: 'pole', mat: 'metal', s: [0.24, 11, 0.24], at: [-7.8, 0.2, -12.6] },
    { sign: { style: 'blue', w: 4, h: 3 }, at: [-7.8, 11, -12.6] },
  ],
};
