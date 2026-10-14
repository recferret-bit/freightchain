export default {
  id: 'motel-strip', kind: 'landmark', v: 1, anchor: 'base', label: 'motel · strip',
  note: 'classic one-storey strip, doors under a covered walkway, tall neon pylon. Front (door side) faces -x, the road runs along z',
  parts: [
    { geo: 'box', tag: 'wall', mat: 'wall', s: [5, 3, 24], at: [2, 0, 0] },
    { geo: 'box', tag: 'roof', mat: 'roof', s: [9.4, 0.3, 25], at: [-0.3, 3, 0] },
    { for: 'i', range: [0, 6], let: { z: '-10 + i * 4' }, do: [
      { geo: 'box', tag: 'door', mat: 'door', s: [0.1, 2.1, 1.1], at: [-0.52, 0, 'z'] },
      { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.1, 1.6], at: [-0.52, 1, 'z + 1.8'] },
    ] },
    { for: 'z', from: -11.5, step: 4.6, while: 'z <= 11.5', note: 'walkway posts', do: [
      { geo: 'box', tag: 'post', mat: 'trim', s: [0.15, 3, 0.15], at: [-4.7, 0, 'z'] },
    ] },
    { geo: 'box', tag: 'pole', mat: 'metal', s: [0.3, 7, 0.3], at: [-4.6, 0, 12.4] },
    { sign: { style: 'neon', w: 4.2, h: 1.8 }, at: [-4.6, 7, 12.4] },
  ],
};
