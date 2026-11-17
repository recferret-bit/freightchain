export default {
  id: 'gulp-bay', kind: 'landmark', v: 1, anchor: 'base', label: 'gulp · bay',
  note: 'automated GULP freighter plaza: two-storey dispatch concourse, unobstructed high-bay AUTO service wing, 30 m crowned refueler canopy, 4 robotic refuelers & monumental pylon',
  parts: [
    { geo: 'box', tag: 'plinth', mat: 'dark', s: [7.6, 0.32, 19.6], at: [7.8, 0, 1.5] },
    { geo: 'rbox', tag: 'wall', mat: { facade: [6, 2] }, s: [7.2, 7.3, 19.2], at: [7.8, 0.28, 1.5] },
    { geo: 'rbox', tag: 'roof', mat: 'roof', s: [7.8, 0.36, 19.8], at: [7.8, 7.52, 1.5] },
    { geo: 'box', tag: 'band', mat: 'neon', s: [7.92, 0.22, 19.92], at: [7.8, 7.82, 1.5] },
    { geo: 'rbox', tag: 'hvac', mat: 'metal', s: [2.1, 0.72, 2.6], at: [8.2, 7.84, -3.5] },
    { geo: 'rbox', tag: 'frame', mat: 'dark', s: [0.46, 2.85, 12.2], at: [4.08, 0.28, 0.4] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 2.05, 8.2], at: [3.82, 0.72, -1.5] },
    { geo: 'box', tag: 'door', mat: 'door', s: [0.12, 2.35, 1.8], at: [3.82, 0.28, 4.6] },

    { geo: 'box', tag: 'plinth', mat: 'dark', s: [9.2, 0.32, 10.2], at: [7.1, 0, 16.2] },
    { geo: 'rbox', tag: 'wall', mat: 'wall', s: [8.8, 7.8, 9.8], at: [7.1, 0.28, 16.2] },
    { geo: 'rbox', tag: 'roof', mat: 'roof', s: [9.4, 0.38, 10.4], at: [7.1, 8.02, 16.2] },
    { geo: 'box', tag: 'band', mat: 'neon', s: [8.94, 0.36, 9.94], at: [7.1, 7.36, 16.2] },
    { geo: 'rbox', tag: 'hvac', mat: 'metal', s: [2.2, 0.74, 2.5], at: [7.6, 8.36, 16.2] },
    { geo: 'rbox', tag: 'canopy', mat: 'dark', s: [2, 0.28, 8.8], at: [1.85, 4.88, 16.2] },
    { sign: { style: 'cream', w: 3.4, h: 1.1, text: 'AUTO' }, at: [1.78, 5.14, 16.2] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [5.4, 1.35, 0.12], at: [7.1, 5.15, 21.12] },
    { geo: 'box', tag: 'sill', mat: 'trim', s: [5.6, 0.12, 0.16], at: [7.1, 5.04, 21.14] },
    { for: 'mx', in: [5.3, 8.9], do: [
      { geo: 'box', tag: 'mullion', mat: 'dark', s: [0.12, 1.4, 0.14], at: ['mx', 5.13, 21.15] },
    ] },
    { geo: 'box', tag: 'door', mat: 'door', s: [1.35, 2.25, 0.14], at: [5.1, 0.28, 21.11] },
    { geo: 'rbox', tag: 'canopy', mat: 'dark', s: [1.85, 0.22, 0.9], at: [5.1, 2.62, 21.45] },
    { geo: 'rbox', tag: 'vent', mat: 'metal', s: [1.8, 1.4, 0.14], at: [8.9, 1.55, 21.11] },
    { for: 'bz', in: [13.9, 18.5], do: [
      { geo: 'box', tag: 'door', mat: 'dark', s: [0.14, 4.35, 3.4], at: [2.66, 0.28, 'bz'] },
      { geo: 'box', tag: 'trim', mat: 'trim', s: [0.18, 0.14, 3.6], at: [2.64, 4.58, 'bz'] },
    ] },
    { for: 'pz', in: [12, 16.2, 20.4], do: [
      { geo: 'cyl16', tag: 'bollard', mat: 'neon', s: [0.14, 1.05, 0.14], at: [1.75, 0, 'pz'] },
    ] },

    { geo: 'rbox', tag: 'kiosk', mat: 'dark', s: [1.1, 2.18, 1.5], at: [1.6, 0, -6.4] },
    { geo: 'box', tag: 'screen', mat: 'glass', s: [0.08, 0.72, 0.92], at: [1.02, 1.08, -6.4] },

    { geo: 'rbox', tag: 'canopy', mat: 'dark', s: [10.4, 0.38, 30], at: [-2.6, 6.22, -4] },
    { geo: 'rbox', tag: 'fascia', mat: 'neon', s: [10.58, 0.32, 30.18], at: [-2.6, 6.54, -4] },
    { geo: 'box', tag: 'trim', mat: 'trim', s: [10.66, 0.1, 30.26], at: [-2.6, 6.84, -4] },
    { geo: 'rbox', tag: 'spine', mat: 'metal', s: [2.1, 0.38, 28.8], at: [-2.6, 6.9, -4] },
    { geo: 'rbox', tag: 'crown', mat: 'dark', s: [2.8, 0.34, 4.9], at: [-6.1, 6.86, -4] },
    { sign: { style: 'neon', w: 4.4, h: 1.65, text: 'GULP' }, at: [-6.1, 7.16, -4] },
    { for: 'z', in: [-16, -10, -4, 2, 8], do: [
      { geo: 'rbox', tag: 'lamp', mat: { color: 0xffd84a, lamp: true }, s: [0.62, 0.14, 1.25], at: [-5.8, 6.12, 'z'] },
      { glow: { color: 0xffd84a, size: 4.2, gain: 1 }, at: [-5.8, 5.88, 'z'] },
    ] },
    { for: 'z', in: [-6.5, -4, -1.5], do: [
      { glow: { color: 0xffd84a, size: 3.4, gain: 0.9 }, at: [-7.8, 7.9, 'z'] },
    ] },
    { group: {}, at: [-3.5, 0, 12], do: [{ beam: { color: 0xffd84a, gain: 0.45, w: 14, l: 16, z0: 0 } }] },
    { group: {}, at: [-3.5, 0, -4], do: [{ beam: { color: 0xffd84a, gain: 0.45, w: 14, l: 16, z0: 0 } }] },
    { for: 'z', in: [-17.5, -8.5, 0.5, 9.5], do: [
      { for: 'x', in: [-6.8, 1.6], do: [
        { geo: 'oct', tag: 'base', mat: 'dark', s: [0.78, 0.42, 0.78], at: ['x', 0, 'z'] },
        { geo: 'rbox', tag: 'post', mat: 'dark', s: [0.44, 6.02, 0.44], at: ['x', 0.3, 'z'] },
      ] },
    ] },

    { for: 'z', in: [-16, -12, -8, -4, 0, 4, 8], do: [
      { geo: 'box', tag: 'guide', mat: 'neon', s: [0.55, 0.05, 2.2], at: [-4.6, 0, 'z'] },
    ] },
    { for: 'z', in: [-14.5, -6.5, 1.5, 9.5], do: [
      { geo: 'rbox', tag: 'island', mat: 'lot', s: [1.65, 0.22, 4.2], at: [-2.4, 0, 'z'] },
      { geo: 'box', tag: 'curb', mat: 'neon', s: [1.74, 0.08, 4.3], at: [-2.4, 0.21, 'z'] },
      { geo: 'rbox', tag: 'pump', mat: 'metal', s: [1.12, 3, 1.3], at: [-2.4, 0.26, 'z'] },
      { geo: 'box', tag: 'screen', mat: 'neon', s: [0.12, 0.68, 0.88], at: [-3.01, 1.68, 'z'] },
      { glow: { color: 0xffd84a, size: 1.7, gain: 0.8 }, at: [-3.15, 2.02, 'z'] },
      { geo: 'rbox', tag: 'boom', mat: 'dark', s: [0.18, 2.9, 0.18], at: [-2.4, 3.2, 'z'] },
      { geo: 'rbox', tag: 'nozzle', mat: 'dark', s: [2.4, 0.16, 0.18], at: [-3.5, 4.6, 'z'] },
      { geo: 'cyl16', tag: 'hose', mat: 'dark', s: [0.06, 4.4, 0.06], at: [-4.55, 0.25, 'z'] },
    ] },

    { geo: 'rbox', tag: 'arch', mat: 'dark', s: [0.42, 5.8, 0.42], at: [-5.6, 0, -19.6] },
    { geo: 'rbox', tag: 'arch', mat: 'dark', s: [0.42, 5.8, 0.42], at: [1.6, 0, -19.6] },
    { geo: 'rbox', tag: 'arch', mat: 'neon', s: [7.7, 0.44, 0.46], at: [-2, 5.72, -19.6] },
    { for: 'z', in: [-16, -12, -8, -4, 0, 4, 8], do: [
      { geo: 'oct', tag: 'base', mat: 'dark', s: [0.42, 0.16, 0.42], at: [-8.2, 0, 'z'] },
      { geo: 'cyl16', tag: 'bollard', mat: 'neon', s: [0.18, 0.98, 0.18], at: [-8.2, 0.12, 'z'] },
    ] },

    { geo: 'oct', tag: 'base', mat: 'dark', s: [1.1, 0.5, 1.1], at: [-11.2, 0, -18.4] },
    { geo: 'rbox', tag: 'pole', mat: 'dark', s: [0.46, 9.2, 0.46], at: [-11.2, 0.35, -18.4] },
    { sign: { style: 'neon', w: 5.4, h: 2.3, text: 'GULP' }, at: [-11.2, 9.3, -18.4] },
    { glow: { color: 0xffd84a, size: 6.5, gain: 1.05 }, at: [-11.6, 10.4, -18.4] },
  ],
};
