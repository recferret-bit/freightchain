export default {
  id: 'motel-twostory', kind: 'landmark', v: 1, anchor: 'base', label: 'motel · twostory',
  note: 'two floors, open balcony on the road side, stairs at the end',
  parts: [
    { geo: 'box', tag: 'wall', mat: 'wall', s: [6, 6, 22], at: [2, 0, 0] },
    { geo: 'box', tag: 'roof', mat: 'roof', s: [9, 0.3, 23], at: [0, 6, 0] },
    { geo: 'box', tag: 'balcony', mat: 'trim', s: [2, 0.2, 22], at: [-2, 3, 0] },
    { geo: 'box', tag: 'rail', mat: 'trim', s: [0.08, 0.9, 22], at: [-2.95, 3.2, 0] },
    { geo: 'box', tag: 'rail', mat: 'trim', s: [0.08, 0.9, 22], at: [-2.95, 6.1, 0] },
    { for: 'f', range: [0, 2], do: [
      { for: 'i', range: [0, 5], let: { z: '-9 + i * 4.2' }, do: [
        { geo: 'box', tag: 'door', mat: 'door', s: [0.1, 2, 1], at: [-1.02, 'f * 3', 'z'] },
        { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.1, 1.6], at: [-1.02, 'f * 3 + 0.9', 'z + 1.7'] },
      ] },
    ] },
    { for: 'k', range: [0, 6], note: 'stairs', do: [
      { geo: 'box', tag: 'step', mat: 'trim', s: [1.2, 0.2, 0.8], at: [-2.2, 'k * 0.5', '11.6 - k * 0.35 - 0.4'] },
    ] },
    { for: 'z', in: [-10.5, -3, 4.5, 10.5], do: [
      { geo: 'box', tag: 'post', mat: 'trim', s: [0.15, 3, 0.15], at: [-2.9, 0, 'z'] },
    ] },
    { geo: 'box', tag: 'pole', mat: 'metal', s: [0.3, 8, 0.3], at: [-4.6, 0, -11.4] },
    { sign: { style: 'neon', w: 3.8, h: 1.8 }, at: [-4.6, 8, -11.4] },
  ],
};
