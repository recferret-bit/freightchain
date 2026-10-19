export default {
  id: 'motel-cabins', kind: 'landmark', v: 1, anchor: 'base', label: 'motel · cabins',
  note: 'row of little hip-roofed cabins + a bigger office',
  parts: [
    { for: 'i', range: [0, 3], let: { z: '-8 + i * 5.4' }, do: [
      { geo: 'box', tag: 'wall', mat: 'wall', s: [4, 2.6, 4], at: [2, 0, 'z'] },
      { geo: 'pyr', tag: 'roof', mat: 'roof', s: [5.4, 1.7, 5.4], at: [2, 2.6, 'z'] },
      { geo: 'box', tag: 'door', mat: 'door', s: [0.1, 2, 1], at: [-0.02, 0, 'z - 0.8'] },
      { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1, 1.2], at: [-0.02, 1, 'z + 1'] },
      { geo: 'box', tag: 'porch', mat: 'trim', s: [1.4, 0.12, 3.4], at: [-0.7, 2.2, 'z'] },
    ] },
    { geo: 'box', tag: 'wall', mat: 'wall', s: [4.5, 3, 5], at: [2.2, 0, 8.4] },
    { geo: 'pyr', tag: 'roof', mat: 'roof', s: [6, 2, 6.2], at: [2.2, 3, 8.4] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.4, 3], at: [-0.06, 1, 8.4] },
    { geo: 'box', tag: 'door', mat: 'door', s: [0.1, 2, 1], at: [-0.06, 0, 6.6] },
    { geo: 'box', tag: 'pole', mat: 'metal', s: [0.25, 5, 0.25], at: [-4, 0, -12] },
    { sign: { style: 'red', w: 3.6, h: 1.6 }, at: [-4, 5, -12] },
  ],
};
