export default {
  id: 'motel-twostory', kind: 'landmark', v: 1, anchor: 'base', label: 'motel · twostory',
  note: 'two-storey motor inn: ground & upper walkways with railings, 10 rooms with wall AC units, solid stringer staircase, roof HVAC & neon pylon',
  parts: [
    { geo: 'box', tag: 'walkway', mat: 'lot', s: [2.5, 0.16, 25.2], at: [-1.9, 0, 1.3] },
    { geo: 'box', tag: 'plinth', mat: 'dark', s: [6.1, 0.28, 22.1], at: [2.1, 0, 0] },
    { geo: 'rbox', tag: 'wall', mat: 'wall', s: [5.9, 5.95, 22], at: [2.1, 0.2, 0] },
    { geo: 'rbox', tag: 'roof', mat: 'roof', s: [9.1, 0.32, 23], at: [0.1, 6.08, 0] },
    { geo: 'box', tag: 'band', mat: 'neon', s: [0.1, 0.2, 23.06], at: [-4.48, 6.14, 0] },
    { geo: 'rbox', tag: 'balcony', mat: 'trim', s: [2.2, 0.24, 22.2], at: [-1.9, 2.96, 0] },
    { geo: 'box', tag: 'rail', mat: 'trim', s: [0.08, 0.12, 22.2], at: [-2.92, 3.98, 0] },
    { geo: 'box', tag: 'rail', mat: 'trim', s: [0.08, 0.1, 22.2], at: [-2.92, 3.55, 0] },
    { geo: 'box', tag: 'rail', mat: 'trim', s: [2.1, 0.12, 0.08], at: [-1.9, 3.98, -11.04] },
    { for: 'bz', from: -10.8, step: 2.7, while: 'bz <= 10.9', do: [
      { geo: 'box', tag: 'baluster', mat: 'trim', s: [0.09, 0.96, 0.09], at: [-2.92, 3.14, 'bz'] },
    ] },
    { geo: 'rbox', tag: 'hvac', mat: 'metal', s: [1.8, 0.65, 2.2], at: [2.4, 6.36, -5.5] },
    { geo: 'rbox', tag: 'hvac', mat: 'metal', s: [1.8, 0.65, 2.2], at: [2.4, 6.36, 5.5] },
    { for: 'f', range: [0, 2], do: [
      { for: 'i', range: [0, 5], let: { z: '-9 + i * 4.2', fy: '0.16 + f * 3.02' }, do: [
        { geo: 'box', tag: 'door', mat: 'door', s: [0.1, 2.02, 1], at: [-0.88, 'fy', 'z'] },
        { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.1, 1.56], at: [-0.9, 'fy + 0.88', 'z + 1.7'] },
        { geo: 'box', tag: 'sill', mat: 'trim', s: [0.16, 0.08, 1.68], at: [-0.92, 'fy + 0.8', 'z + 1.7'] },
        { geo: 'rbox', tag: 'ac', mat: 'metal', s: [0.34, 0.36, 0.64], at: [-0.96, 'fy + 0.32', 'z + 1.7'] },
      ] },
    ] },
    { geo: 'rbox', anchor: 'center', tag: 'stringer', mat: 'dark', s: [1.1, 0.22, 4.15], at: [-2.05, 1.52, 12.18], rot: [0.74, 0, 0] },
    { for: 'k', range: [0, 7], note: 'solid overlapping stair risers & treads up to balcony', do: [
      { geo: 'rbox', tag: 'step', mat: 'trim', s: [1.25, 0.52, 0.65], at: [-2.05, 'k * 0.44', '13.4 - k * 0.42'] },
    ] },
    { for: 'z', in: [-10.5, -3.5, 3.5, 10.5], do: [
      { geo: 'cyl16', tag: 'post', mat: 'trim', s: [0.11, 6.12, 0.11], at: [-2.92, 0.12, 'z'] },
    ] },
    { geo: 'oct', tag: 'base', mat: 'dark', s: [0.78, 0.4, 0.78], at: [-5.45, 0, -11.8] },
    { geo: 'cyl16', tag: 'pole', mat: 'metal', s: [0.18, 8.1, 0.18], at: [-5.45, 0.2, -11.8] },
    { sign: { style: 'neon', w: 3.8, h: 1.8 }, at: [-5.45, 8.1, -11.8] },
  ],
};
