export default {
  id: 'police-checkpoint', kind: 'landmark', v: 1, anchor: 'base', label: 'police · checkpoint',
  note: 'guard booth, raised barrier arm, cones and a cruiser',
  parts: [
    { geo: 'box', tag: 'wall', mat: 'wall', s: [2.4, 2.6, 2.4], at: [2.8, 0, -3.5] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.1, 1.8], at: [1.58, 1, -3.5] },
    { geo: 'box', tag: 'roof', mat: 'blue', s: [3, 0.25, 3], at: [2.8, 2.6, -3.5] },
    { geo: 'box', tag: 'beacon', mat: 'red', s: [0.4, 0.2, 0.4], at: [2.3, 2.85, -3.5] },
    { geo: 'box', tag: 'beacon', mat: 'blue', s: [0.4, 0.2, 0.4], at: [3.3, 2.85, -3.5] },
    { geo: 'box', tag: 'post', mat: 'dark', s: [0.3, 1.1, 0.3], at: [0.4, 0, -0.9] },
    { group: {}, at: [0.4, 1.1, -0.9], rot: [0, 0, -1.1], note: 'barrier arm, raised', do: [
      { for: 'i', range: [0, 6], do: [
        { geo: 'box', tag: 'barrier', mat: { if: 'i % 2', then: 'white', else: 'red' }, s: [0.7, 0.14, 0.14], at: ['-0.35 - i * 0.7', 0, 0] },
      ] },
    ] },
    { use: 'lm-cones', with: { x: -3, z0: -4.5, n: 5, dz: 1.6 } },
    { ref: 'cruiser', at: [2.4, 0, 3], rot: [0, 0, 0] },
    { geo: 'box', tag: 'pole', mat: 'metal', s: [0.12, 2.6, 0.12], at: [-3.8, 0, 4.8] },
    { sign: { style: 'red', w: 1.8, h: 1, text: 'STOP' }, at: [-3.8, 2.4, 4.8] },
  ],
};
